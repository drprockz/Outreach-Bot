/**
 * testFindLeads.js — 1-batch test run of the lead discovery pipeline
 * Discovers 30 leads (instead of 150), runs all 11 stages, writes to SQLite.
 * Safe to run locally. Costs ~$0.30–0.50.
 * Delete this file after testing.
 */
import 'dotenv/config';
import { getDb, logCron, finishCron, logError, bumpMetric, isRejected } from '../src/core/db/index.js';
import { callGemini } from '../src/core/ai/gemini.js';
import { callClaude } from '../src/core/ai/claude.js';
import { verifyEmail } from '../src/core/integrations/mev.js';
import { sendAlert } from '../src/core/integrations/telegram.js';

const NICHE = { label: 'Real estate agencies', query: 'Mumbai Bangalore Delhi real estate agency property outdated website' };

function stripJson(text) {
  // Strip markdown code fences if present
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

async function stage1_discover() {
  console.log('\n[Stage 1] Discovering leads via Gemini grounding...');
  const prompt = `You are a B2B lead researcher. Discover 30 real Indian businesses in the "${NICHE.label}" niche that likely have outdated websites. Search query context: "${NICHE.query}". Requirements: each business MUST have its own website URL (not a JustDial/Google Maps link). Return a JSON array of objects: [{business_name, website_url, city, category}]. Return only valid JSON, no markdown.`;
  const result = await callGemini(prompt, { useGrounding: true });
  try {
    const leads = JSON.parse(stripJson(result.text));
    console.log(`  → Found ${leads.length} raw leads. Cost: $${result.costUsd.toFixed(4)}`);
    return { leads, costUsd: result.costUsd };
  } catch {
    console.log('  → Parse failed. Raw response:');
    console.log(result.text.slice(0, 500));
    return { leads: [], costUsd: result.costUsd };
  }
}

async function stages2to6_extract(lead) {
  const domain = lead.website_url?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || '';
  const prompt = `Analyze this business website and return a JSON object with these fields:
- owner_name: owner/founder name from About/Contact page (string or null)
- owner_role: their role e.g. "Founder", "Director" (string or null)
- contact_email: best contact email — prefer firstname@domain if owner found, else try info@${domain} or contact@${domain} (string, NEVER null — always provide a best guess)
- contact_confidence: "high" if found on page, "medium" if pattern guess with owner name, "low" if generic fallback (string)
- contact_source: "about page" / "contact page" / "pattern guess" / "generic fallback" (string)
- tech_stack: JSON array e.g. ["WordPress","jQuery","PHP"] (array)
- website_problems: JSON array of specific issues e.g. ["no SSL","outdated design","no contact form"] (array)
- last_updated: approximate date last meaningfully updated e.g. "2021-03" (string or null)
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

async function stage9_icpScore(lead) {
  const prompt = `Score this lead on the ICP rubric and return JSON {icp_score: number, icp_priority: "A"|"B"|"C", icp_reason: "brief explanation"}.

Rubric:
+3  India-based B2C-facing (restaurant, salon, real estate, D2C)
+2  20+ Google reviews (established business, has budget)
+2  WordPress/Wix/Squarespace stack (easiest sell)
+2  Website last updated 2+ years ago
+1  Active Instagram/Facebook but neglected website
+1  WhatsApp Business on site but no online booking/ordering
-2  Freelancer or solo consultant (low budget)
-3  Already on modern stack (Next.js, custom React, Webflow)

Priority: A=7-10, B=4-6, C=0-3

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

async function stage10_hook(lead) {
  const result = await callClaude('sonnet',
    `Write ONE sentence (max 20 words) that makes a hyper-specific observation about ${lead.business_name}'s website (${lead.website_url}). Focus on something concrete you'd notice as a developer — outdated tech, missing feature, design issue. No fluff, no compliments.`,
    { maxTokens: 60 }
  );
  return { hook: result.text.trim(), costUsd: result.costUsd, model: result.model };
}

async function stage11_body(lead, hook) {
  const result = await callClaude('haiku',
    `Write a cold email from Darshan Parmar (Full-Stack Developer, Simple Inc) to ${lead.contact_name || lead.owner_name || 'the owner'} at ${lead.business_name}.

Hook to open with: "${hook}"

Rules:
- Plain text only, no HTML
- 50-90 words total
- No links, no URLs
- CTA: ask to reply
- Professional but direct tone
- Do not mention price

Return only the email body, no subject line.`,
    { maxTokens: 200 }
  );
  return { body: result.text.trim(), costUsd: result.costUsd, model: result.model };
}

async function stage11_subject(lead) {
  const result = await callClaude('haiku',
    `Write a cold email subject line for ${lead.business_name}. Max 7 words. No ! or ? or ALL CAPS. Make it sound like a human colleague writing, not marketing. Return only the subject line text.`,
    { maxTokens: 30 }
  );
  return { subject: result.text.trim(), costUsd: result.costUsd };
}

// ── Main ─────────────────────────────────────────────────
const cronId = logCron('findLeads');
let totalCost = 0;
let leadsReady = 0;
let leadsProcessed = 0;
let leadsSkipped = 0;

try {
  const db = getDb();

  // Stage 1: 1 batch only (30 leads)
  const { leads: rawLeads, costUsd: discoverCost } = await stage1_discover();
  totalCost += discoverCost;
  bumpMetric('gemini_cost_usd', discoverCost);
  bumpMetric('total_api_cost_usd', discoverCost);
  bumpMetric('leads_discovered', rawLeads.length);

  console.log(`\n[Pipeline] Processing ${rawLeads.length} leads through stages 2–11...\n`);

  for (const raw of rawLeads) {
    try {
      leadsProcessed++;
      const name = raw.business_name || 'Unknown';

      process.stdout.write(`[${leadsProcessed}/${rawLeads.length}] ${name} — `);

      // Stages 2–6
      const { data: extracted, costUsd: extractCost } = await stages2to6_extract(raw);
      totalCost += extractCost;
      bumpMetric('gemini_cost_usd', extractCost);
      bumpMetric('total_api_cost_usd', extractCost);

      if (!extracted) { process.stdout.write('extraction failed\n'); leadsSkipped++; continue; }
      bumpMetric('leads_extracted');

      const lead = { ...raw, ...extracted };

      // Gate 1
      const techStack = Array.isArray(lead.tech_stack) ? lead.tech_stack : [];
      const modernTech = techStack.some(t => /next\.?js|react|webflow|gatsby|nuxt|svelte/i.test(t));
      const hasSignals = Array.isArray(lead.business_signals) && lead.business_signals.length > 0;
      if (modernTech && !hasSignals && (lead.website_quality_score || 0) >= 7) {
        process.stdout.write('Gate 1 failed (modern stack)\n');
        leadsSkipped++; continue;
      }
      bumpMetric('leads_judge_passed');

      if (!lead.contact_email) { process.stdout.write('no email found\n'); leadsSkipped++; continue; }
      bumpMetric('leads_email_found');

      // Stage 7: Email verify
      const { status: verifyStatus, confidence } = await verifyEmail(lead.contact_email);
      lead.email_status = verifyStatus;

      if (verifyStatus === 'invalid' || verifyStatus === 'disposable') {
        process.stdout.write(`email ${verifyStatus}\n`);
        leadsSkipped++;
        db.prepare(`INSERT INTO leads (business_name, website_url, category, city, contact_email, email_status, status) VALUES (?, ?, ?, ?, ?, ?, 'email_invalid')`).run(lead.business_name, lead.website_url, lead.category, lead.city, lead.contact_email, verifyStatus);
        continue;
      }

      // Gate 2
      if (verifyStatus === 'unknown' && confidence < 0.5) { process.stdout.write('Gate 2 failed (low confidence)\n'); leadsSkipped++; continue; }
      bumpMetric('leads_email_valid');

      // Stage 8: Dedup
      if (isRejected(lead.contact_email)) { process.stdout.write('in reject list\n'); leadsSkipped++; continue; }
      const existing = db.prepare(`SELECT id FROM leads WHERE contact_email = ?`).get(lead.contact_email);
      if (existing) { process.stdout.write('duplicate\n'); leadsSkipped++; continue; }

      const emailDomain = lead.contact_email.split('@')[1];
      const recentDomain = db.prepare(`SELECT 1 FROM leads WHERE contact_email LIKE ? AND status IN ('sent','replied','contacted') AND domain_last_contacted >= datetime('now', '-90 days') LIMIT 1`).get(`%@${emailDomain}`);
      if (recentDomain) { process.stdout.write('domain cooldown\n'); leadsSkipped++; continue; }

      // Stage 9: ICP
      const { data: icp, costUsd: icpCost } = await stage9_icpScore(lead);
      totalCost += icpCost;
      bumpMetric('gemini_cost_usd', icpCost);
      bumpMetric('total_api_cost_usd', icpCost);
      lead.icp_score = icp.icp_score;
      lead.icp_priority = icp.icp_priority;
      lead.icp_reason = icp.icp_reason;

      // Gate 3: C → nurture
      if (icp.icp_priority === 'C') {
        process.stdout.write(`ICP C → nurture\n`);
        db.prepare(`INSERT INTO leads (business_name, website_url, category, city, country, search_query, tech_stack, website_problems, last_updated, has_ssl, has_analytics, owner_name, owner_role, business_signals, social_active, website_quality_score, judge_reason, contact_name, contact_email, contact_confidence, contact_source, email_status, icp_score, icp_priority, icp_reason, status, gemini_cost_usd) VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nurture', ?)`)
          .run(lead.business_name, lead.website_url, lead.category, lead.city, NICHE.query, JSON.stringify(lead.tech_stack), JSON.stringify(lead.website_problems), lead.last_updated, lead.has_ssl, lead.has_analytics, lead.owner_name, lead.owner_role, JSON.stringify(lead.business_signals), lead.social_active, lead.website_quality_score, lead.judge_reason, lead.owner_name, lead.contact_email, lead.contact_confidence, lead.contact_source, lead.email_status, lead.icp_score, lead.icp_priority, lead.icp_reason, extractCost + icpCost);
        leadsSkipped++; continue;
      }

      bumpMetric('leads_icp_ab');

      // Stages 10–11 skipped (Anthropic credits needed — will generate at send time)
      const geminiCost = extractCost + icpCost;

      // DB insert — lead stored as 'queued' (email body to be generated later)
      db.prepare(`INSERT INTO leads (business_name, website_url, category, city, country, search_query, tech_stack, website_problems, last_updated, has_ssl, has_analytics, owner_name, owner_role, business_signals, social_active, website_quality_score, judge_reason, contact_name, contact_email, contact_confidence, contact_source, email_status, email_verified_at, icp_score, icp_priority, icp_reason, status, gemini_cost_usd, discovery_model, extraction_model) VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, 'ready', ?, 'gemini-2.5-flash', 'gemini-2.5-flash')`)
        .run(lead.business_name, lead.website_url, lead.category, lead.city, NICHE.query, JSON.stringify(lead.tech_stack), JSON.stringify(lead.website_problems), lead.last_updated, lead.has_ssl, lead.has_analytics, lead.owner_name, lead.owner_role, JSON.stringify(lead.business_signals), lead.social_active, lead.website_quality_score, lead.judge_reason, lead.owner_name, lead.contact_email, lead.contact_confidence, lead.contact_source, lead.email_status, lead.icp_score, lead.icp_priority, lead.icp_reason, geminiCost);

      bumpMetric('leads_ready');
      leadsReady++;
      process.stdout.write(`✅ READY | ICP ${icp.icp_priority}(${icp.icp_score}) | ${lead.contact_email}\n`);

    } catch (err) {
      logError('findLeads.lead', err, { jobName: 'findLeads' });
      process.stdout.write(`ERROR: ${err.message}\n`);
      leadsSkipped++;
    }
  }

  finishCron(cronId, { status: 'success', recordsProcessed: leadsProcessed, recordsSkipped: leadsSkipped, costUsd: totalCost });

  console.log('\n' + '═'.repeat(50));
  console.log(`TEST RUN COMPLETE`);
  console.log(`  Discovered:  ${rawLeads.length}`);
  console.log(`  Processed:   ${leadsProcessed}`);
  console.log(`  Ready (A/B): ${leadsReady}`);
  console.log(`  Skipped:     ${leadsSkipped}`);
  console.log(`  Total cost:  $${totalCost.toFixed(4)}`);
  console.log('═'.repeat(50));

  await sendAlert(`[TEST] findLeads: ${leadsReady} ready, ${leadsSkipped} skipped. Cost $${totalCost.toFixed(4)}`);

} catch (err) {
  logError('findLeads', err, { jobName: 'findLeads' });
  finishCron(cronId, { status: 'failed', error: err.message });
  console.error('FATAL:', err.message);
}
