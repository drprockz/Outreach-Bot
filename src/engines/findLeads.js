import 'dotenv/config';
import { getDb, logCron, finishCron, logError, bumpMetric, getConfigMap, getConfigInt, getConfigStr } from './utils/db.js';
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

// ── Size constraint prompt fragments ──────────────────────
const SIZE_PROMPTS = {
  msme: 'Target ONLY micro/small owner-operated businesses — 1–10 employees, turnover under ₹5cr. EXCLUDE listed companies, national brands, unicorns, VC-backed startups, companies with 50+ employees.',
  sme:  'Target ONLY small/medium regional businesses — 10–200 employees, ₹5cr–₹250cr turnover. EXCLUDE listed companies, unicorns, MNCs.',
  both: 'Target MSME/SME businesses only — owner-operated to regional scale, up to 200 employees, under ₹250cr turnover. EXCLUDE listed companies, unicorns, MNCs.',
};

// Exported for unit testing
export function buildDiscoveryPrompt(niche, batchIndex, perBatch, cities, businessSize) {
  return `You are a B2B lead researcher. Discover ${perBatch} real Indian businesses in the "${niche.label}" niche that likely have outdated websites.

Search query context: "${niche.query}". Batch ${batchIndex + 1} — find DIFFERENT businesses than previous batches.

Geographic target: Target businesses located in: ${cities.join(', ')}. Do not return businesses from other cities.

Business size: ${SIZE_PROMPTS[businessSize] || SIZE_PROMPTS.msme}

Return a JSON array of objects: [{business_name, website_url, city, category}]. Return only valid JSON, no markdown.`;
}

// ── Stage 1: Discovery — Gemini with grounding ───────────
async function stage1_discover(niche, batchIndex, perBatch, cities, businessSize) {
  const prompt = buildDiscoveryPrompt(niche, batchIndex, perBatch, cities, businessSize);
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

const ANTHROPIC_DISABLED = process.env.ANTHROPIC_DISABLED === 'true';

// ── Stage 10: Hook generation — Claude Sonnet (or Gemini fallback) ──
async function stage10_hook(lead, persona) {
  const prompt = `Write ONE sentence (max 20 words) that makes a hyper-specific observation about ${lead.business_name}'s website (${lead.website_url}). Focus on something concrete you'd notice as a ${persona.role} — outdated tech, missing feature, design issue. No fluff, no compliments.`;
  if (ANTHROPIC_DISABLED) {
    const result = await callGemini(prompt);
    return { hook: result.text.trim(), costUsd: result.costUsd, model: 'gemini-2.5-flash' };
  }
  const result = await callClaude('sonnet', prompt, { maxTokens: 60 });
  return { hook: result.text.trim(), costUsd: result.costUsd, model: result.model };
}

// ── Stage 11: Email body — Claude Haiku (or Gemini fallback) ─────────
async function stage11_body(lead, hook, persona) {
  const prompt = `Write a cold email from ${persona.name} (${persona.role}, ${persona.company}) to ${lead.contact_name || lead.owner_name || 'the owner'} at ${lead.business_name}.

Hook to open with: "${hook}"

Services context: ${persona.services}

Rules:
- Plain text only, no HTML
- 50-90 words total
- No links, no URLs
- CTA: ask to reply
- Tone: ${persona.tone}
- Do not mention price

Return only the email body, no subject line.`;
  if (ANTHROPIC_DISABLED) {
    const result = await callGemini(prompt);
    return { body: result.text.trim(), costUsd: result.costUsd, model: 'gemini-2.5-flash' };
  }
  const result = await callClaude('haiku', prompt, { maxTokens: 200 });
  return { body: result.text.trim(), costUsd: result.costUsd, model: result.model };
}

// ── Stage 11b: Subject line — Claude Haiku (or Gemini fallback) ──────
async function stage11_subject(lead) {
  const prompt = `Write a cold email subject line for ${lead.business_name}. Max 7 words. No ! or ? or ALL CAPS. Make it sound like a human colleague writing, not marketing. Return only the subject line text.`;
  if (ANTHROPIC_DISABLED) {
    const result = await callGemini(prompt);
    return { subject: result.text.trim(), costUsd: result.costUsd };
  }
  const result = await callClaude('haiku', prompt, { maxTokens: 30 });
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

    const FALLBACK_CITIES = ['Mumbai', 'Bangalore', 'Delhi NCR', 'Pune'];
    const VALID_SIZES = ['msme', 'sme', 'both'];

    let cities = FALLBACK_CITIES;
    try {
      const raw = JSON.parse(getConfigStr(cfg, 'find_leads_cities', JSON.stringify(FALLBACK_CITIES)));
      cities = Array.isArray(raw) && raw.length > 0 ? raw : FALLBACK_CITIES;
    } catch {
      // malformed JSON in DB — use fallback
    }

    const businessSizeRaw = getConfigStr(cfg, 'find_leads_business_size', 'msme');
    const businessSize = VALID_SIZES.includes(businessSizeRaw) ? businessSizeRaw : 'msme';

    const leadsCount = Math.max(50, getConfigInt(cfg, 'find_leads_count', 150));
    const perBatch = getConfigInt(cfg, 'find_leads_per_batch', 30);
    const batches = Math.ceil(leadsCount / perBatch);
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
          -- 'contacted' excluded: not a valid status in the pipeline state machine
          AND domain_last_contacted >= datetime('now', '-90 days')
          AND contact_email IS NOT NULL
      `).all().map(r => r.domain)
    );

    // Stage 1: Discovery — all batches concurrent (cap=5 to stay within grounding RPM)
    const batchIndices = Array.from({ length: batches }, (_, i) => i);
    const discoveryResults = await withConcurrency(batchIndices, 5, async (batchIndex) => {
      try {
        const { leads, costUsd } = await stage1_discover(niche, batchIndex, perBatch, cities, businessSize);
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

    // ── Stage 2-6: Extract + Gate 1 + email check + dedup ────────────────
    // 20 concurrent Gemini calls — safe on paid tier (1,000 RPM generation limit)
    const extractedLeads = await withConcurrency(rawLeads, 20, async (raw) => {
      try {
        leadsProcessed++;

        const { data: extracted, costUsd: extractCost } = await stages2to6_extract(raw);
        totalCost += extractCost;
        bumpMetric('gemini_cost_usd', extractCost);
        bumpMetric('total_api_cost_usd', extractCost);

        if (!extracted) {
          leadsSkipped++;
          return null;
        }

        bumpMetric('leads_extracted');

        const lead = { ...raw, ...extracted, extractCost };

        // Gate 1: Drop if modern stack + no signals + quality score >= 7
        const techStack = Array.isArray(lead.tech_stack) ? lead.tech_stack : [];
        const modernTech = techStack.some(t =>
          /next\.?js|react|webflow|gatsby|nuxt|svelte/i.test(t)
        );
        const hasSignals = Array.isArray(lead.business_signals) && lead.business_signals.length > 0;
        if (modernTech && !hasSignals && (lead.website_quality_score || 0) >= 7) {
          leadsSkipped++;
          return null;
        }

        bumpMetric('leads_judge_passed');

        if (!lead.contact_email) {
          leadsSkipped++;
          return null;
        }

        bumpMetric('leads_email_found');

        // Stage 8: Dedup — all three checks use pre-loaded Sets (no DB query, race-free)
        // .has() and .add() are synchronous — JS event loop guarantees no interleave
        const emailDomain = lead.contact_email.split('@')[1];
        if (
          rejectedEmails.has(lead.contact_email) ||
          knownEmails.has(lead.contact_email) ||
          cooledDomains.has(emailDomain)
        ) {
          leadsSkipped++;
          return null;
        }
        knownEmails.add(lead.contact_email);
        cooledDomains.add(emailDomain);

        return lead;
      } catch (err) {
        logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
        return null;
      }
    });
    const gate1Passed = extractedLeads.filter(Boolean);

    // ── Stage 7: Email verification (MEV) ────────────────────────────────
    const verifiedLeads = await withConcurrency(gate1Passed, 20, async (lead) => {
      try {
        const { status: verifyStatus, confidence } = await verifyEmail(lead.contact_email);
        lead.email_status = verifyStatus;

        if (verifyStatus === 'invalid' || verifyStatus === 'disposable') {
          leadsSkipped++;
          db.prepare(`
            INSERT INTO leads (business_name, website_url, category, city, contact_email, email_status, status)
            VALUES (?, ?, ?, ?, ?, ?, 'email_invalid')
          `).run(lead.business_name, lead.website_url, lead.category, lead.city, lead.contact_email, verifyStatus);
          return null;
        }

        // Gate 2: unknown + low confidence = skip
        if (verifyStatus === 'unknown' && confidence < 0.5) {
          leadsSkipped++;
          return null;
        }

        bumpMetric('leads_email_valid');
        return lead;
      } catch (err) {
        logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
        return null;
      }
    });
    const gate2Passed = verifiedLeads.filter(Boolean);

    // ── Stage 9: ICP scoring ─────────────────────────────────────────────
    const scoredLeads = await withConcurrency(gate2Passed, 20, async (lead) => {
      try {
        const { data: icp, costUsd: icpCost } = await stage9_icpScore(lead, rubric, threshA, threshB);
        totalCost += icpCost;
        bumpMetric('gemini_cost_usd', icpCost);
        bumpMetric('total_api_cost_usd', icpCost);

        lead.icp_score = icp.icp_score;
        lead.icp_priority = icp.icp_priority;
        lead.icp_reason = icp.icp_reason;
        lead.icpCost = icpCost;

        // Gate 3: C-priority → nurture (not discarded)
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
            lead.extractCost + icpCost
          );
          leadsSkipped++;
          return null;
        }

        bumpMetric('leads_icp_ab');
        return lead;
      } catch (err) {
        logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
        return null;
      }
    });
    const abLeads = scoredLeads.filter(Boolean);

    // ── Stage 10/11: Hook + email body + subject + DB insert ─────────────
    // Pre-check spend cap once before launching concurrent workers.
    // Workers fire simultaneously so per-request cap checks can race — a single
    // synchronous guard here prevents the entire stage from starting if cap is hit.
    const todayStr = new Date().toISOString().slice(0, 10);
    const aiSpendToday = ANTHROPIC_DISABLED
      ? (db.prepare(`SELECT COALESCE(gemini_cost_usd, 0) AS total FROM daily_metrics WHERE date = ?`).get(todayStr)?.total ?? 0)
      : (db.prepare(`SELECT COALESCE(sonnet_cost_usd, 0) + COALESCE(haiku_cost_usd, 0) AS total FROM daily_metrics WHERE date = ?`).get(todayStr)?.total ?? 0);
    const claudeCap = parseFloat(process.env.CLAUDE_DAILY_SPEND_CAP || '5.00');
    if (aiSpendToday >= claudeCap) {
      const provider = ANTHROPIC_DISABLED ? 'Gemini' : 'Claude';
      await sendAlert(`findLeads: ${provider} spend cap hit ($${aiSpendToday.toFixed(3)} >= $${claudeCap}) — skipping Stage 10/11 for ${abLeads.length} leads`);
      finishCron(cronId, { status: 'success', recordsProcessed: leadsProcessed, recordsSkipped: leadsSkipped + abLeads.length, costUsd: totalCost });
      return;
    }

    // cap=10 concurrent — Gemini/Claude RPM limits are safe at this concurrency
    await withConcurrency(abLeads, 10, async (lead) => {
      try {
        // Stage 10: Hook
        const hookResult = await stage10_hook(lead, persona);
        totalCost += hookResult.costUsd;

        // Stage 11: Body + subject in parallel
        const [bodyResult, subjectResult] = await Promise.all([
          stage11_body(lead, hookResult.hook, persona),
          stage11_subject(lead)
        ]);
        const bodyCost = bodyResult.costUsd + subjectResult.costUsd;
        totalCost += bodyCost;
        if (ANTHROPIC_DISABLED) {
          bumpMetric('gemini_cost_usd', hookResult.costUsd + bodyCost);
        } else {
          bumpMetric('sonnet_cost_usd', hookResult.costUsd);
          bumpMetric('haiku_cost_usd', bodyCost);
        }
        bumpMetric('total_api_cost_usd', hookResult.costUsd + bodyCost);

        const geminiCost = lead.extractCost + lead.icpCost;

        // Insert lead
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

        // Insert pre-generated email
        const leadId = leadInsert.lastInsertRowid;
        db.prepare(`
          INSERT INTO emails (
            lead_id, sequence_step, subject, body, word_count, hook,
            contains_link, is_html, is_plain_text, content_valid,
            status, hook_model, body_model, hook_cost_usd, body_cost_usd, total_cost_usd
          ) VALUES (?, 0, ?, ?, ?, ?, 0, 0, 1, 1, 'pending', ?, ?, ?, ?, ?)
        `).run(
          leadId, subjectResult.subject, bodyResult.body,
          bodyResult.body.trim().split(/\s+/).filter(Boolean).length,
          hookResult.hook, hookResult.model, bodyResult.model,
          hookResult.costUsd, bodyCost, hookResult.costUsd + bodyCost
        );

        bumpMetric('leads_ready');
        leadsReady++;
      } catch (err) {
        logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
      }
    });

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
