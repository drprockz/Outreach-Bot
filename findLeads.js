import 'dotenv/config';
import { getDb, logCron, finishCron, logError, bumpMetric, isRejected, today, getConfigMap, getConfigInt, getConfigStr } from './utils/db.js';
import { callGemini } from './utils/gemini.js';
import { callClaude } from './utils/claude.js';
import { verifyEmail } from './utils/mev.js';
import { sendAlert } from './utils/telegram.js';
import { withConcurrency } from './utils/concurrency.js';

// ── Niche rotation: DB-backed ─────────────────────────────
function getNicheForToday(db) {
  const dow = new Date().getDay();
  return db.prepare('SELECT * FROM niches WHERE day_of_week = ? AND enabled = 1 LIMIT 1').get(dow)
    || db.prepare('SELECT * FROM niches WHERE enabled = 1 ORDER BY sort_order LIMIT 1').get();
}

function buildIcpRubric(db) {
  const rules = db.prepare('SELECT * FROM icp_rules WHERE enabled = 1 ORDER BY sort_order').all();
  return rules.map(r => `${r.points > 0 ? '+' : ''}${r.points}  ${r.label}`).join('\n');
}

// Strip markdown code fences Gemini sometimes wraps JSON in
function stripJson(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// ── Stage 1: Discovery — Gemini with grounding ───────────
// Run in batches of perBatch to get leads total
async function stage1_discover(niche, batchIndex, perBatch) {
  const prompt = `You are a B2B lead researcher. Discover ${perBatch} real Indian businesses in the "${niche.label}" niche that likely have outdated websites. Search query context: "${niche.query}". Batch ${batchIndex + 1} — find DIFFERENT businesses than previous batches. Return a JSON array of objects: [{business_name, website_url, city, category}]. Return only valid JSON, no markdown.`;
  const result = await callGemini(prompt, { useGrounding: true });
  try {
    return { leads: JSON.parse(stripJson(result.text)), costUsd: result.costUsd };
  } catch {
    return { leads: [], costUsd: result.costUsd };
  }
}

// ── Stages 2–6: Extraction + tech + signals + judge + DM finder ──
async function stages2to6_extract(lead) {
  const prompt = `Analyze this business website and return a JSON object with these fields:
- owner_name: owner/founder name (string or null)
- owner_role: their role e.g. "Founder", "Director" (string or null)
- contact_email: guessed email from name + domain pattern firstname@domain.com (string or null)
- contact_confidence: "high" if pattern match verified, "medium" if guessed, "low" if generic (string)
- contact_source: where you found the contact info e.g. "about page", "linkedin", "pattern guess" (string)
- tech_stack: JSON array of technologies detected e.g. ["WordPress","jQuery","PHP"] (array)
- website_problems: JSON array of specific issues e.g. ["no SSL","broken links","outdated design"] (array)
- last_updated: approximate date the site was last meaningfully updated (string or null)
- has_ssl: 1 if HTTPS, 0 if not (number)
- has_analytics: 1 if Google Analytics/GTM found, 0 if not (number)
- business_signals: JSON array e.g. ["low reviews","no booking","dated design","active social"] (array)
- social_active: 1 if active social media but neglected website, 0 otherwise (number)
- website_quality_score: 1-10 where 1=terrible needs complete rebuild, 10=excellent modern site (number)
- judge_reason: one sentence explaining the quality score (string)

Business: ${lead.business_name}, Website: ${lead.website_url}, City: ${lead.city}

Return only valid JSON, no markdown.`;
  const result = await callGemini(prompt, { useGrounding: true });
  try {
    return { data: JSON.parse(stripJson(result.text)), costUsd: result.costUsd };
  } catch {
    return { data: null, costUsd: result.costUsd };
  }
}

// ── Stage 9: ICP scorer — Gemini ─────────────────────────
async function stage9_icpScore(lead, rubric, threshA, threshB) {
  const prompt = `Score this lead on the ICP rubric and return JSON {icp_score: number, icp_priority: "A"|"B"|"C", icp_reason: "brief explanation"}.

Rubric:
${rubric}

Priority: A=${threshA}-10, B=${threshB}-${threshA - 1}, C=below ${threshB} (including negative)

Lead data:
Company: ${lead.business_name}
Tech stack: ${JSON.stringify(lead.tech_stack) || 'unknown'}
Business signals: ${JSON.stringify(lead.business_signals) || 'none'}
City: ${lead.city}
Category: ${lead.category}
Quality score: ${lead.website_quality_score}

Return only valid JSON.`;
  const result = await callGemini(prompt);
  try {
    return { data: JSON.parse(stripJson(result.text)), costUsd: result.costUsd };
  } catch {
    return { data: { icp_score: 0, icp_priority: 'C', icp_reason: 'parse error' }, costUsd: result.costUsd };
  }
}

// ── Stage 10: Hook generation — Claude Sonnet ────────────
async function stage10_hook(lead, persona) {
  const result = await callClaude('sonnet',
    `Write ONE sentence (max 20 words) that makes a hyper-specific observation about ${lead.business_name}'s website (${lead.website_url}). Focus on something concrete you'd notice as a ${persona.role} — outdated tech, missing feature, design issue. No fluff, no compliments.`,
    { maxTokens: 60 }
  );
  return { hook: result.text.trim(), costUsd: result.costUsd, model: result.model };
}

// ── Stage 11: Email body — Claude Haiku ──────────────────
async function stage11_body(lead, hook, persona) {
  const result = await callClaude('haiku',
    `Write a cold email from ${persona.name} (${persona.role}, ${persona.company}) to ${lead.contact_name || lead.owner_name || 'the owner'} at ${lead.business_name}.

Hook to open with: "${hook}"

Services context: ${persona.services}

Rules:
- Plain text only, no HTML
- 50-90 words total
- No links, no URLs
- CTA: ask to reply
- Tone: ${persona.tone}
- Do not mention price

Return only the email body, no subject line.`,
    { maxTokens: 200 }
  );
  return { body: result.text.trim(), costUsd: result.costUsd, model: result.model };
}

// ── Stage 11b: Subject line — Claude Haiku ───────────────
async function stage11_subject(lead) {
  const result = await callClaude('haiku',
    `Write a cold email subject line for ${lead.business_name}. Max 7 words. No ! or ? or ALL CAPS. Make it sound like a human colleague writing, not marketing. Return only the subject line text.`,
    { maxTokens: 30 }
  );
  return { subject: result.text.trim(), costUsd: result.costUsd };
}

// ── Main pipeline ────────────────────────────────────────
export default async function findLeads() {
  const cronId = logCron('findLeads');

  const cfg = getConfigMap();

  if (!getConfigInt(cfg, 'find_leads_enabled', 1)) {
    finishCron(cronId, { status: 'skipped' });
    return;
  }

  let totalCost = 0;
  let leadsReady = 0;
  let leadsProcessed = 0;
  let leadsSkipped = 0;

  try {
    const db = getDb();
    const niche = getNicheForToday(db);

    if (!niche) {
      finishCron(cronId, { status: 'failed', error: 'No enabled niches configured' });
      await sendAlert('findLeads failed: No enabled niches configured');
      return;
    }

    const batches = getConfigInt(cfg, 'find_leads_batches', 5);
    const perBatch = getConfigInt(cfg, 'find_leads_per_batch', 30);
    const rubric = buildIcpRubric(db);
    const threshA = getConfigInt(cfg, 'icp_threshold_a', 7);
    const threshB = getConfigInt(cfg, 'icp_threshold_b', 4);
    const persona = {
      name:     getConfigStr(cfg, 'persona_name',     'Darshan Parmar'),
      role:     getConfigStr(cfg, 'persona_role',     'Full-Stack Developer'),
      company:  getConfigStr(cfg, 'persona_company',  'Simple Inc'),
      tone:     getConfigStr(cfg, 'persona_tone',     'professional but direct'),
      services: getConfigStr(cfg, 'persona_services', ''),
    };

    // ── Dedup guards — pre-load before any concurrent work ───────────────
    // Loaded synchronously once. Workers use Set.has/add (synchronous, no await)
    // so JS's single-threaded event loop guarantees no two workers race on these.
    const knownEmails = new Set(
      db.prepare('SELECT contact_email FROM leads WHERE contact_email IS NOT NULL')
        .all().map(r => r.contact_email)
    );
    const rejectedEmails = new Set(
      db.prepare('SELECT email FROM reject_list').all().map(r => r.email)
    );
    const cooledDomains = new Set(
      db.prepare(`
        SELECT DISTINCT substr(contact_email, instr(contact_email, '@') + 1) AS domain
        FROM leads
        WHERE status IN ('sent', 'replied')
          AND domain_last_contacted >= datetime('now', '-90 days')
          AND contact_email IS NOT NULL
      `).all().map(r => r.domain)
    );

    // Stage 1: Discovery — all batches concurrent (cap=5 to stay within grounding RPM)
    const batchIndices = Array.from({ length: batches }, (_, i) => i);
    const discoveryResults = await withConcurrency(batchIndices, 5, async (batchIndex) => {
      try {
        const { leads, costUsd } = await stage1_discover(niche, batchIndex, perBatch);
        totalCost += costUsd;
        bumpMetric('gemini_cost_usd', costUsd);
        bumpMetric('total_api_cost_usd', costUsd);
        return leads;
      } catch (err) {
        logError('findLeads.discovery', err, { jobName: 'findLeads' });
        return [];
      }
    });
    const rawLeads = discoveryResults.flat();

    bumpMetric('leads_discovered', rawLeads.length);

    for (const raw of rawLeads) {
      try {
        leadsProcessed++;

        // Stages 2–6: Extract + tech fingerprint + signals + judge + DM finder
        const { data: extracted, costUsd: extractCost } = await stages2to6_extract(raw);
        totalCost += extractCost;
        bumpMetric('gemini_cost_usd', extractCost);
        bumpMetric('total_api_cost_usd', extractCost);

        if (!extracted) {
          // Extraction failed — mark and skip
          leadsSkipped++;
          continue;
        }

        bumpMetric('leads_extracted');

        const lead = { ...raw, ...extracted };

        // Gate 1: Drop if modern stack + no signals + quality score >= 7
        const techStack = Array.isArray(lead.tech_stack) ? lead.tech_stack : [];
        const modernTech = techStack.some(t =>
          /next\.?js|react|webflow|gatsby|nuxt|svelte/i.test(t)
        );
        const hasSignals = Array.isArray(lead.business_signals) && lead.business_signals.length > 0;
        if (modernTech && !hasSignals && (lead.website_quality_score || 0) >= 7) {
          lead.judge_skip = 1;
          leadsSkipped++;
          continue;
        }

        bumpMetric('leads_judge_passed');

        // Check for contact email
        if (!lead.contact_email) {
          leadsSkipped++;
          continue;
        }

        bumpMetric('leads_email_found');

        // Stage 7: Email verification via MEV
        const { status: verifyStatus, confidence } = await verifyEmail(lead.contact_email);
        lead.email_status = verifyStatus;

        if (verifyStatus === 'invalid' || verifyStatus === 'disposable') {
          leadsSkipped++;
          // Still insert as email_invalid for tracking
          db.prepare(`
            INSERT INTO leads (business_name, website_url, category, city, contact_email, email_status, status)
            VALUES (?, ?, ?, ?, ?, ?, 'email_invalid')
          `).run(lead.business_name, lead.website_url, lead.category, lead.city, lead.contact_email, verifyStatus);
          continue;
        }

        // Gate 2: unknown + low confidence = skip
        if (verifyStatus === 'unknown' && confidence < 0.5) {
          leadsSkipped++;
          continue;
        }

        bumpMetric('leads_email_valid');

        // Stage 8: Dedup — reject list check
        if (isRejected(lead.contact_email)) {
          leadsSkipped++;
          continue;
        }

        // Stage 8: Dedup — already in database check
        const existing = db.prepare(
          `SELECT id FROM leads WHERE contact_email = ?`
        ).get(lead.contact_email);
        if (existing) {
          leadsSkipped++;
          continue;
        }

        // Stage 8: Domain-level cooldown — skip if domain contacted in last 90 days
        const emailDomain = lead.contact_email.split('@')[1];
        const recentDomain = db.prepare(`
          SELECT 1 FROM leads
          WHERE contact_email LIKE ? AND status IN ('sent', 'replied', 'contacted')
            AND domain_last_contacted >= datetime('now', '-90 days')
          LIMIT 1
        `).get(`%@${emailDomain}`);
        if (recentDomain) {
          leadsSkipped++;
          continue;
        }

        // Stage 9: ICP scoring
        const { data: icp, costUsd: icpCost } = await stage9_icpScore(lead, rubric, threshA, threshB);
        totalCost += icpCost;
        bumpMetric('gemini_cost_usd', icpCost);
        bumpMetric('total_api_cost_usd', icpCost);

        lead.icp_score = icp.icp_score;
        lead.icp_priority = icp.icp_priority;
        lead.icp_reason = icp.icp_reason;

        // Gate 3: C-priority -> nurture, not discard
        if (icp.icp_priority === 'C') {
          db.prepare(`
            INSERT INTO leads (
              business_name, website_url, category, city, country, search_query,
              tech_stack, website_problems, last_updated, has_ssl, has_analytics,
              owner_name, owner_role, business_signals, social_active,
              website_quality_score, judge_reason,
              contact_name, contact_email, contact_confidence, contact_source,
              email_status, icp_score, icp_priority, icp_reason,
              status, gemini_cost_usd
            ) VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nurture', ?)
          `).run(
            lead.business_name, lead.website_url, lead.category, lead.city, niche.query,
            JSON.stringify(lead.tech_stack), JSON.stringify(lead.website_problems),
            lead.last_updated, lead.has_ssl, lead.has_analytics,
            lead.owner_name, lead.owner_role,
            JSON.stringify(lead.business_signals), lead.social_active,
            lead.website_quality_score, lead.judge_reason,
            lead.owner_name, lead.contact_email, lead.contact_confidence, lead.contact_source,
            lead.email_status, lead.icp_score, lead.icp_priority, lead.icp_reason,
            extractCost + icpCost
          );
          leadsSkipped++;
          continue;
        }

        bumpMetric('leads_icp_ab');

        // Stage 10: Hook generation (only for A/B priority)
        const hookResult = await stage10_hook(lead, persona);
        const hook = hookResult.hook;
        totalCost += hookResult.costUsd;
        // Note: callClaude already writes sonnet_cost_usd + total_api_cost_usd to daily_metrics

        // Stage 11: Email body + subject (only for A/B priority with hook)
        const [bodyResult, subjectResult] = await Promise.all([
          stage11_body(lead, hook, persona),
          stage11_subject(lead)
        ]);
        const emailBody = bodyResult.body;
        const emailSubject = subjectResult.subject;
        const bodyCost = bodyResult.costUsd + subjectResult.costUsd;
        totalCost += bodyCost;
        // Note: callClaude already writes haiku_cost_usd + total_api_cost_usd to daily_metrics

        const geminiCost = extractCost + icpCost;

        // Insert lead into database with full spec columns
        const leadInsert = db.prepare(`
          INSERT INTO leads (
            business_name, website_url, category, city, country, search_query,
            tech_stack, website_problems, last_updated, has_ssl, has_analytics,
            owner_name, owner_role, business_signals, social_active,
            website_quality_score, judge_reason,
            contact_name, contact_email, contact_confidence, contact_source,
            email_status, email_verified_at,
            icp_score, icp_priority, icp_reason,
            status, gemini_cost_usd, discovery_model, extraction_model
          ) VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, 'ready', ?, 'gemini-2.5-flash', 'gemini-2.5-flash')
        `).run(
          lead.business_name, lead.website_url, lead.category, lead.city, niche.query,
          JSON.stringify(lead.tech_stack), JSON.stringify(lead.website_problems),
          lead.last_updated, lead.has_ssl, lead.has_analytics,
          lead.owner_name, lead.owner_role,
          JSON.stringify(lead.business_signals), lead.social_active,
          lead.website_quality_score, lead.judge_reason,
          lead.owner_name, lead.contact_email, lead.contact_confidence, lead.contact_source,
          lead.email_status,
          lead.icp_score, lead.icp_priority, lead.icp_reason,
          geminiCost
        );

        // Insert pre-generated email into emails table
        const leadId = leadInsert.lastInsertRowid;
        db.prepare(`
          INSERT INTO emails (
            lead_id, sequence_step, subject, body, word_count, hook,
            contains_link, is_html, is_plain_text, content_valid,
            status, hook_model, body_model, hook_cost_usd, body_cost_usd, total_cost_usd
          ) VALUES (?, 0, ?, ?, ?, ?, 0, 0, 1, 1, 'pending', ?, ?, ?, ?, ?)
        `).run(
          leadId, emailSubject, emailBody,
          emailBody.trim().split(/\s+/).filter(Boolean).length,
          hook, hookResult.model, bodyResult.model,
          hookResult.costUsd, bodyCost, hookResult.costUsd + bodyCost
        );

        bumpMetric('leads_ready');
        leadsReady++;
      } catch (leadErr) {
        logError('findLeads.lead', leadErr, { jobName: 'findLeads' });
        leadsSkipped++;
      }
    }

    finishCron(cronId, { status: 'success', recordsProcessed: leadsProcessed, recordsSkipped: leadsSkipped, costUsd: totalCost });
    await sendAlert(`findLeads: ${leadsReady} leads ready, ${leadsProcessed} processed, ${leadsSkipped} skipped (cost $${totalCost.toFixed(4)})`);
  } catch (err) {
    logError('findLeads', err, { jobName: 'findLeads' });
    finishCron(cronId, { status: 'failed', error: err.message });
    await sendAlert(`findLeads failed: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  findLeads().catch(console.error);
}
