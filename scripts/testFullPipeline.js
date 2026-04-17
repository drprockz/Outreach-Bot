/**
 * testFullPipeline.js — Full 11-stage pipeline using Gemini only
 * Stages 10 (hook) and 11 (body/subject) use Gemini-Flash instead of Claude.
 * MEV skipped (API not responding) — emails treated as catch-all.
 * Stops before sendEmails.js — writes status='ready' to SQLite.
 * Delete after testing.
 */
import 'dotenv/config';
import { getDb, logCron, finishCron, logError, bumpMetric, isRejected, today } from './utils/db.js';
import { callGemini } from './utils/gemini.js';

const NICHE = { label: 'Real estate agencies', query: 'Mumbai Bangalore Delhi real estate agency property outdated website' };

function stripJson(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// ── Stage 1: Discovery ───────────────────────────────────
async function stage1_discover() {
  console.log('\n[Stage 1] Discovering leads via Gemini grounding...');
  const prompt = `You are a B2B lead researcher. Discover 30 real Indian businesses in the "${NICHE.label}" niche that likely have outdated websites. Search query: "${NICHE.query}". Each business MUST have its own website URL (not JustDial/Google Maps links). Return a JSON array: [{business_name, website_url, city, category}]. Only valid JSON, no markdown.`;
  const result = await callGemini(prompt, { useGrounding: true });
  try {
    const leads = JSON.parse(stripJson(result.text));
    console.log(`  → Found ${leads.length} raw leads. Cost: $${result.costUsd.toFixed(4)}`);
    return { leads, costUsd: result.costUsd };
  } catch {
    console.log('  → Parse failed. Raw snippet:', result.text.slice(0, 200));
    return { leads: [], costUsd: result.costUsd };
  }
}

// ── Stages 2–6: Extraction + tech + signals + judge + DM finder ──
async function stages2to6_extract(lead) {
  const domain = lead.website_url?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || '';
  const prompt = `Analyze this Indian business website and return a JSON object:
- owner_name: owner/founder name from About/Contact page (string or null)
- owner_role: e.g. "Founder", "Director" (string or null)
- contact_email: best contact email — prefer firstname@${domain} if owner found, else info@${domain} or contact@${domain} (string, NEVER null)
- contact_confidence: "high" if found on page, "medium" if pattern guess with owner name, "low" if generic fallback
- contact_source: "about page" / "contact page" / "pattern guess" / "generic fallback"
- tech_stack: array e.g. ["WordPress","jQuery","PHP"]
- website_problems: array of specific issues e.g. ["outdated design","no SSL","no booking system"]
- last_updated: approximate date last updated e.g. "2021-03" (string or null)
- has_ssl: 1 if HTTPS, 0 if not
- has_analytics: 1 if Google Analytics/GTM found, 0 if not
- business_signals: array e.g. ["45 Google reviews","active Instagram","no online booking"]
- social_active: 1 if active social but neglected website, 0 otherwise
- website_quality_score: 1-10 (1=terrible needs rebuild, 10=excellent modern)
- judge_reason: one sentence explaining the quality score

Business: ${lead.business_name}, Website: ${lead.website_url}, City: ${lead.city}
Return only valid JSON, no markdown.`;
  const result = await callGemini(prompt, { useGrounding: true });
  try {
    return { data: JSON.parse(stripJson(result.text)), costUsd: result.costUsd };
  } catch {
    return { data: null, costUsd: result.costUsd };
  }
}

// ── Stage 9: ICP Scorer ──────────────────────────────────
async function stage9_icpScore(lead) {
  const prompt = `Score this lead on the ICP rubric. Return JSON: {icp_score: number, icp_priority: "A"|"B"|"C", icp_reason: "brief explanation"}

Rubric:
+3  India-based B2C-facing (restaurant, salon, real estate, D2C)
+2  20+ Google reviews
+2  WordPress/Wix/Squarespace stack
+2  Website last updated 2+ years ago
+1  Active Instagram/Facebook but neglected website
+1  WhatsApp Business on site but no online booking
-2  Freelancer or solo consultant
-3  Already on modern stack (Next.js, React, Webflow)

Priority: A=7-10, B=4-6, C=0-3

Lead:
Company: ${lead.business_name}
Tech: ${JSON.stringify(lead.tech_stack)}
Signals: ${JSON.stringify(lead.business_signals)}
City: ${lead.city}, Category: ${lead.category}
Quality score: ${lead.website_quality_score}

Return only valid JSON.`;
  const result = await callGemini(prompt);
  try {
    return { data: JSON.parse(stripJson(result.text)), costUsd: result.costUsd };
  } catch {
    return { data: { icp_score: 0, icp_priority: 'C', icp_reason: 'parse error' }, costUsd: result.costUsd };
  }
}

// ── Stage 10: Hook generation (Gemini instead of Sonnet) ─
async function stage10_hook(lead) {
  const prompt = `Write ONE sentence (max 20 words) making a hyper-specific observation about ${lead.business_name}'s website (${lead.website_url}). Focus on something concrete a developer would notice — outdated tech, missing feature, design issue. No fluff, no compliments. Return only the sentence.`;
  const result = await callGemini(prompt);
  return { hook: result.text.trim().replace(/^["']|["']$/g, ''), costUsd: result.costUsd, model: 'gemini-2.5-flash' };
}

// ── Stage 11: Email body (Gemini instead of Haiku) ───────
async function stage11_body(lead, hook) {
  const prompt = `Write a cold email from Darshan Parmar (Full-Stack Developer, Simple Inc) to ${lead.contact_name || lead.owner_name || 'the owner'} at ${lead.business_name}.

Opening hook: "${hook}"

Rules:
- Plain text only, no HTML
- 50-90 words total
- No links, no URLs
- CTA: ask if they have 15 minutes this week
- Professional but conversational
- Do not mention price

Return only the email body, no subject line.`;
  const result = await callGemini(prompt);
  return { body: result.text.trim(), costUsd: result.costUsd, model: 'gemini-2.5-flash' };
}

// ── Stage 11b: Subject line (Gemini) ─────────────────────
async function stage11_subject(lead) {
  const prompt = `Write a cold email subject line for ${lead.business_name}. Max 7 words. No ! or ? or ALL CAPS. Sound like a human colleague, not marketing. Return only the subject line text.`;
  const result = await callGemini(prompt);
  return { subject: result.text.trim().replace(/^["']|["']$/g, ''), costUsd: result.costUsd };
}

// ── Content Validator (mirrors utils/contentValidator.js) ─
const SPAM_WORDS = (process.env.SPAM_WORDS || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
const MAX_WORDS = parseInt(process.env.MAX_EMAIL_WORDS || '90');
const MIN_WORDS = parseInt(process.env.MIN_EMAIL_WORDS || '40');

function validateContent(subject, body) {
  const bodyLower = body.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;

  if (/<[a-z][\s\S]*>/i.test(body)) return { valid: false, reason: 'HTML detected' };
  if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) return { valid: false, reason: `Word count ${wordCount} outside ${MIN_WORDS}-${MAX_WORDS}` };
  if (/https?:\/\/|www\./i.test(body)) return { valid: false, reason: 'URL detected in body' };
  if (/\{\{/.test(body)) return { valid: false, reason: 'Unfilled template variable' };
  if (subject.split(/\s+/).length > 8) return { valid: false, reason: 'Subject too long (>8 words)' };
  if (/[!?]/.test(subject)) return { valid: false, reason: 'Subject contains ! or ?' };
  if (/[A-Z]{3,}/.test(subject)) return { valid: false, reason: 'Subject has ALL CAPS' };
  for (const word of SPAM_WORDS) {
    if (bodyLower.includes(word) || subjectLower.includes(word)) return { valid: false, reason: `Spam word: "${word}"` };
  }
  return { valid: true, reason: null };
}

// ── Main ─────────────────────────────────────────────────
console.log('═'.repeat(60));
console.log('RADAR — Full 11-Stage Pipeline Test (Gemini-only)');
console.log('Niche:', NICHE.label);
console.log('MEV: SKIPPED (API key not responding — emails treated as catch-all)');
console.log('Claude: SKIPPED (using Gemini-Flash for stages 10–11)');
console.log('Sending: STOPPED before sendEmails.js');
console.log('═'.repeat(60));

const cronId = logCron('findLeads');
let totalCost = 0;
let leadsReady = 0;
let leadsProcessed = 0;
let leadsSkipped = 0;
let contentRejected = 0;
let contentRegenerated = 0;

try {
  const db = getDb();

  // Stage 1
  const { leads: rawLeads, costUsd: discoverCost } = await stage1_discover();
  totalCost += discoverCost;
  bumpMetric('gemini_cost_usd', discoverCost);
  bumpMetric('total_api_cost_usd', discoverCost);
  bumpMetric('leads_discovered', rawLeads.length);

  console.log(`\n[Pipeline] Processing ${rawLeads.length} leads...\n`);

  for (const raw of rawLeads) {
    try {
      leadsProcessed++;
      const tag = `[${leadsProcessed}/${rawLeads.length}] ${raw.business_name}`;
      process.stdout.write(`${tag}\n`);

      // ── Stages 2–6: Extract ───────────────────────────
      const { data: extracted, costUsd: extractCost } = await stages2to6_extract(raw);
      totalCost += extractCost;
      bumpMetric('gemini_cost_usd', extractCost);
      bumpMetric('total_api_cost_usd', extractCost);

      if (!extracted) {
        process.stdout.write(`  → ❌ Extraction failed\n`);
        leadsSkipped++; continue;
      }
      bumpMetric('leads_extracted');

      const lead = { ...raw, ...extracted };
      process.stdout.write(`  → Tech: ${JSON.stringify(lead.tech_stack)} | Quality: ${lead.website_quality_score}/10\n`);

      // ── Gate 1 ────────────────────────────────────────
      const techStack = Array.isArray(lead.tech_stack) ? lead.tech_stack : [];
      const modernTech = techStack.some(t => /next\.?js|react|webflow|gatsby|nuxt|svelte/i.test(t));
      const hasSignals = Array.isArray(lead.business_signals) && lead.business_signals.length > 0;
      if (modernTech && !hasSignals && (lead.website_quality_score || 0) >= 7) {
        process.stdout.write(`  → ⛔ Gate 1: modern stack, no signals, quality ≥7\n`);
        leadsSkipped++; continue;
      }
      bumpMetric('leads_judge_passed');

      // ── Contact email check ───────────────────────────
      if (!lead.contact_email) {
        process.stdout.write(`  → ⛔ No contact email found\n`);
        leadsSkipped++; continue;
      }
      bumpMetric('leads_email_found');
      process.stdout.write(`  → Email: ${lead.contact_email} (${lead.contact_confidence})\n`);

      // ── Stage 7: MEV skipped ──────────────────────────
      lead.email_status = 'catch-all'; // treated as valid, verification skipped
      bumpMetric('leads_email_valid');

      // ── Stage 8: Dedup ────────────────────────────────
      if (isRejected(lead.contact_email)) {
        process.stdout.write(`  → ⛔ In reject list\n`);
        leadsSkipped++; continue;
      }
      const existing = db.prepare(`SELECT id FROM leads WHERE contact_email = ?`).get(lead.contact_email);
      if (existing) {
        process.stdout.write(`  → ⛔ Duplicate (lead #${existing.id})\n`);
        leadsSkipped++; continue;
      }
      const emailDomain = lead.contact_email.split('@')[1];
      const recentDomain = db.prepare(`SELECT 1 FROM leads WHERE contact_email LIKE ? AND status IN ('sent','replied','contacted') AND domain_last_contacted >= datetime('now', '-90 days') LIMIT 1`).get(`%@${emailDomain}`);
      if (recentDomain) {
        process.stdout.write(`  → ⛔ Domain cooldown (contacted in last 90 days)\n`);
        leadsSkipped++; continue;
      }

      // ── Stage 9: ICP ──────────────────────────────────
      const { data: icp, costUsd: icpCost } = await stage9_icpScore(lead);
      totalCost += icpCost;
      bumpMetric('gemini_cost_usd', icpCost);
      bumpMetric('total_api_cost_usd', icpCost);
      lead.icp_score = icp.icp_score;
      lead.icp_priority = icp.icp_priority;
      lead.icp_reason = icp.icp_reason;
      process.stdout.write(`  → ICP: ${icp.icp_priority}(${icp.icp_score}) — ${icp.icp_reason}\n`);

      // ── Gate 3: C → nurture ───────────────────────────
      const geminiCost = extractCost + icpCost;
      if (icp.icp_priority === 'C') {
        db.prepare(`INSERT INTO leads (business_name, website_url, category, city, country, search_query, tech_stack, website_problems, last_updated, has_ssl, has_analytics, owner_name, owner_role, business_signals, social_active, website_quality_score, judge_reason, contact_name, contact_email, contact_confidence, contact_source, email_status, icp_score, icp_priority, icp_reason, status, gemini_cost_usd, discovery_model, extraction_model) VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nurture', ?, 'gemini-2.5-flash', 'gemini-2.5-flash')`)
          .run(lead.business_name, lead.website_url, lead.category, lead.city, NICHE.query, JSON.stringify(lead.tech_stack), JSON.stringify(lead.website_problems), lead.last_updated, lead.has_ssl, lead.has_analytics, lead.owner_name, lead.owner_role, JSON.stringify(lead.business_signals), lead.social_active, lead.website_quality_score, lead.judge_reason, lead.owner_name, lead.contact_email, lead.contact_confidence, lead.contact_source, lead.email_status, lead.icp_score, lead.icp_priority, lead.icp_reason, geminiCost);
        process.stdout.write(`  → 🌱 Nurture (ICP C)\n`);
        leadsSkipped++; continue;
      }
      bumpMetric('leads_icp_ab');

      // ── Stage 10: Hook (Gemini) ───────────────────────
      const hookResult = await stage10_hook(lead);
      totalCost += hookResult.costUsd;
      bumpMetric('gemini_cost_usd', hookResult.costUsd);
      bumpMetric('total_api_cost_usd', hookResult.costUsd);
      process.stdout.write(`  → Hook: "${hookResult.hook}"\n`);

      // ── Stage 11: Body + Subject (Gemini) ─────────────
      let bodyResult = await stage11_body(lead, hookResult.hook);
      let subjectResult = await stage11_subject(lead);
      totalCost += bodyResult.costUsd + subjectResult.costUsd;
      bumpMetric('gemini_cost_usd', bodyResult.costUsd + subjectResult.costUsd);
      bumpMetric('total_api_cost_usd', bodyResult.costUsd + subjectResult.costUsd);

      // ── Content Validation ────────────────────────────
      let validation = validateContent(subjectResult.subject, bodyResult.body);
      if (!validation.valid) {
        process.stdout.write(`  → ⚠️  Content invalid (${validation.reason}) — regenerating...\n`);
        contentRegenerated++;
        bodyResult = await stage11_body(lead, hookResult.hook);
        subjectResult = await stage11_subject(lead);
        totalCost += bodyResult.costUsd + subjectResult.costUsd;
        validation = validateContent(subjectResult.subject, bodyResult.body);
        if (!validation.valid) {
          process.stdout.write(`  → ❌ Content rejected after regen: ${validation.reason}\n`);
          contentRejected++; leadsSkipped++; continue;
        }
      }

      const wordCount = bodyResult.body.trim().split(/\s+/).filter(Boolean).length;
      process.stdout.write(`  → Subject: "${subjectResult.subject}"\n`);
      process.stdout.write(`  → Body (${wordCount} words): ${bodyResult.body.slice(0, 80)}...\n`);

      // ── DB insert — lead ──────────────────────────────
      const leadInsert = db.prepare(`INSERT INTO leads (business_name, website_url, category, city, country, search_query, tech_stack, website_problems, last_updated, has_ssl, has_analytics, owner_name, owner_role, business_signals, social_active, website_quality_score, judge_reason, contact_name, contact_email, contact_confidence, contact_source, email_status, email_verified_at, icp_score, icp_priority, icp_reason, status, gemini_cost_usd, discovery_model, extraction_model) VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, 'ready', ?, 'gemini-2.5-flash', 'gemini-2.5-flash')`)
        .run(lead.business_name, lead.website_url, lead.category, lead.city, NICHE.query, JSON.stringify(lead.tech_stack), JSON.stringify(lead.website_problems), lead.last_updated, lead.has_ssl, lead.has_analytics, lead.owner_name, lead.owner_role, JSON.stringify(lead.business_signals), lead.social_active, lead.website_quality_score, lead.judge_reason, lead.owner_name, lead.contact_email, lead.contact_confidence, lead.contact_source, lead.email_status, lead.icp_score, lead.icp_priority, lead.icp_reason, geminiCost);

      // ── DB insert — email ─────────────────────────────
      db.prepare(`INSERT INTO emails (lead_id, sequence_step, subject, body, word_count, hook, contains_link, is_html, is_plain_text, content_valid, status, hook_model, body_model, hook_cost_usd, body_cost_usd, total_cost_usd) VALUES (?, 0, ?, ?, ?, ?, 0, 0, 1, 1, 'pending', ?, ?, ?, ?, ?)`)
        .run(leadInsert.lastInsertRowid, subjectResult.subject, bodyResult.body, wordCount, hookResult.hook, 'gemini-2.5-flash', 'gemini-2.5-flash', hookResult.costUsd, bodyResult.costUsd + subjectResult.costUsd, hookResult.costUsd + bodyResult.costUsd + subjectResult.costUsd);

      bumpMetric('leads_ready');
      leadsReady++;
      process.stdout.write(`  → ✅ READY — stored in DB (lead #${leadInsert.lastInsertRowid})\n`);
      process.stdout.write('\n');

    } catch (err) {
      logError('findLeads.lead', err, { jobName: 'findLeads' });
      process.stdout.write(`  → 💥 ERROR: ${err.message}\n\n`);
      leadsSkipped++;
    }
  }

  finishCron(cronId, { status: 'success', recordsProcessed: leadsProcessed, recordsSkipped: leadsSkipped, costUsd: totalCost });

  // ── Final summary ─────────────────────────────────────
  const dbReady = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE status='ready'`).get().c;
  const dbTotal = db.prepare(`SELECT COUNT(*) as c FROM leads`).get().c;

  console.log('\n' + '═'.repeat(60));
  console.log('PIPELINE COMPLETE — STOPPED BEFORE EMAIL SEND');
  console.log('─'.repeat(60));
  console.log(`  Discovered:           ${rawLeads.length}`);
  console.log(`  Extracted:            ${leadsProcessed - leadsSkipped + leadsReady}`);
  console.log(`  Content rejected:     ${contentRejected} (${contentRegenerated} regenerated)`);
  console.log(`  ICP C → nurture:      ${rawLeads.length - leadsReady - contentRejected - leadsSkipped + (leadsSkipped - contentRejected)}`);
  console.log(`  Ready for sending:    ${leadsReady}`);
  console.log(`  Total cost:           $${totalCost.toFixed(4)} (~₹${(totalCost * 84).toFixed(2)})`);
  console.log('─'.repeat(60));
  console.log(`  DB total leads:       ${dbTotal}`);
  console.log(`  DB ready leads:       ${dbReady}`);
  console.log('─'.repeat(60));
  console.log('  Next step: add Anthropic credits → sendEmails.js will pick up ready leads');
  console.log('═'.repeat(60));

} catch (err) {
  logError('findLeads', err, { jobName: 'findLeads' });
  finishCron(cronId, { status: 'failed', error: err.message });
  console.error('\nFATAL:', err.message);
}
