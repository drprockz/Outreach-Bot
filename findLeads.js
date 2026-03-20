import 'dotenv/config';
import { getDb, logCron, finishCron, logError, bumpMetric, isRejected, today } from './utils/db.js';
import { callGemini } from './utils/gemini.js';
import { callClaude } from './utils/claude.js';
import { verifyEmail } from './utils/mev.js';
import { sendAlert } from './utils/telegram.js';

// ── Niche rotation: Mon=1 through Sat=6 ──────────────────
const NICHES = {
  1: { label: 'Shopify/D2C', query: 'India D2C ecommerce brand Shopify outdated website' },
  2: { label: 'Real estate', query: 'Mumbai real estate agency property portal outdated website' },
  3: { label: 'Funded startups', query: 'India funded B2B startup outdated website developer needed' },
  4: { label: 'Restaurants/cafes', query: 'Mumbai restaurant cafe outdated website no online booking' },
  5: { label: 'Agencies', query: 'Mumbai digital agency overflow web development outsource' },
  6: { label: 'Healthcare/salons', query: 'India healthcare salon clinic outdated website no booking' }
};

function getNicheForToday() {
  const dow = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  return NICHES[dow] || NICHES[1]; // Sunday fallback to Monday niche
}

// ── Stage 1: Discovery — Gemini with grounding ───────────
async function stage1_discover(niche) {
  const prompt = `You are a B2B lead researcher. discover 20 real Indian businesses in the "${niche.label}" niche that likely have outdated websites. Search query context: "${niche.query}". Return a JSON array of objects: [{company, website, city, niche}]. Return only valid JSON, no markdown.`;
  const result = await callGemini(prompt, { useGrounding: true });
  try {
    return { leads: JSON.parse(result.text), costUsd: result.costUsd };
  } catch {
    return { leads: [], costUsd: result.costUsd };
  }
}

// ── Stages 2–6: Extraction + tech + signals + judge + DM finder ──
async function stages2to6_extract(lead) {
  const prompt = `Analyze this business website and return a JSON object with these fields:
- contact_name: owner/founder name (string or null)
- contact_email: guessed email from name + domain pattern (string or null)
- cms: CMS detected from meta/scripts (string or null)
- business_signals: comma-separated signals like "low reviews,no booking,dated design" (string)
- quality_score: 1-10 how likely they need web help (number)

Business: ${lead.company}, Website: ${lead.website}, City: ${lead.city}

Return only valid JSON, no markdown.`;
  const result = await callGemini(prompt, { useGrounding: true });
  try {
    return { data: JSON.parse(result.text), costUsd: result.costUsd };
  } catch {
    return { data: null, costUsd: result.costUsd };
  }
}

// ── Stage 9: ICP scorer — Gemini ─────────────────────────
async function stage9_icpScore(lead) {
  const prompt = `Score this lead on the ICP rubric and return JSON {icp_score: number, icp_priority: "A"|"B"|"C"}.

Rubric:
+3  India-based B2C-facing
+2  20+ Google reviews
+2  WordPress/Wix/Squarespace stack
+2  Website last updated 2+ years ago
+1  Active social but neglected website
+1  WhatsApp Business but no online booking
-2  Freelancer/solo consultant
-3  Modern stack (Next.js/Webflow/custom React)

Lead data:
Company: ${lead.company}
CMS: ${lead.cms || 'unknown'}
Business signals: ${lead.business_signals || 'none'}
City: ${lead.city}
Niche: ${lead.niche}

Return only valid JSON.`;
  const result = await callGemini(prompt);
  try {
    return { data: JSON.parse(result.text), costUsd: result.costUsd };
  } catch {
    return { data: { icp_score: 0, icp_priority: 'C' }, costUsd: result.costUsd };
  }
}

// ── Stage 10: Hook generation — Claude Sonnet ────────────
async function stage10_hook(lead) {
  const result = await callClaude('sonnet',
    `Write ONE sentence (max 20 words) that makes a hyper-specific observation about ${lead.company}'s website (${lead.website}). Focus on something concrete you'd notice as a developer — outdated tech, missing feature, design issue. No fluff, no compliments.`,
    { maxTokens: 60 }
  );
  return { hook: result.text.trim(), costUsd: result.costUsd };
}

// ── Stage 11: Email body — Claude Haiku ──────────────────
async function stage11_body(lead) {
  const result = await callClaude('haiku',
    `Write a cold email from Darshan Parmar (Full-Stack Developer, Simple Inc) to ${lead.contact_name || 'the owner'} at ${lead.company}.

Hook to open with: "${lead.hook}"

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
  return { body: result.text.trim(), costUsd: result.costUsd };
}

// ── Stage 11b: Subject line — Claude Haiku ───────────────
async function stage11_subject(lead) {
  const result = await callClaude('haiku',
    `Write a cold email subject line for ${lead.company}. Max 7 words. No ! or ? or ALL CAPS. Make it sound like a human colleague writing, not marketing. Return only the subject line text.`,
    { maxTokens: 30 }
  );
  return { subject: result.text.trim(), costUsd: result.costUsd };
}

// ── Main pipeline ────────────────────────────────────────
export default async function findLeads() {
  const cronId = logCron('findLeads');
  let totalCost = 0;
  let leadsReady = 0;
  let leadsProcessed = 0;
  let leadsSkipped = 0;

  try {
    const niche = getNicheForToday();

    // Stage 1: Discovery
    const { leads: rawLeads, costUsd: discoverCost } = await stage1_discover(niche);
    totalCost += discoverCost;
    bumpMetric('gemini_cost_usd', discoverCost);

    for (const raw of rawLeads) {
      try {
        leadsProcessed++;

        // Stages 2–6: Extract + tech fingerprint + signals + judge + DM finder
        const { data: extracted, costUsd: extractCost } = await stages2to6_extract(raw);
        totalCost += extractCost;
        bumpMetric('gemini_cost_usd', extractCost);

        if (!extracted || !extracted.contact_email) {
          leadsSkipped++;
          continue;
        }

        // Gate 1: quality_score < 6 means modern/good site — skip
        if (extracted.quality_score < 6) {
          leadsSkipped++;
          continue;
        }

        const lead = { ...raw, ...extracted };

        // Stage 7: Email verification via MEV
        const { status: verifyStatus, confidence } = await verifyEmail(lead.contact_email);
        if (verifyStatus === 'invalid' || verifyStatus === 'disposable') {
          leadsSkipped++;
          continue;
        }
        // Gate 2: unknown + low confidence = skip
        if (verifyStatus === 'unknown' && confidence < 0.5) {
          leadsSkipped++;
          continue;
        }

        // Stage 8: Dedup — reject list check
        if (isRejected(lead.contact_email)) {
          leadsSkipped++;
          continue;
        }

        // Stage 8: Dedup — already in database check
        const existing = getDb().prepare(
          `SELECT id FROM leads WHERE contact_email = ?`
        ).get(lead.contact_email);
        if (existing) {
          leadsSkipped++;
          continue;
        }

        // Stage 9: ICP scoring
        const { data: icp, costUsd: icpCost } = await stage9_icpScore(lead);
        totalCost += icpCost;
        bumpMetric('gemini_cost_usd', icpCost);

        lead.icp_score = icp.icp_score;
        lead.icp_priority = icp.icp_priority;

        // Gate 3: C-priority -> nurture, not discard
        const finalStatus = icp.icp_priority === 'C' ? 'nurture' : 'ready';

        // Stage 10: Hook generation (only for A/B priority)
        let hookCost = 0;
        let hook = null;
        if (finalStatus === 'ready') {
          const hookResult = await stage10_hook(lead);
          hook = hookResult.hook;
          hookCost = hookResult.costUsd;
          totalCost += hookCost;
          bumpMetric('sonnet_cost_usd', hookCost);
        }

        // Stage 11: Email body + subject (only for A/B priority with hook)
        let bodyCost = 0;
        let emailBody = null;
        let emailSubject = null;
        if (finalStatus === 'ready' && hook) {
          lead.hook = hook;
          const [bodyResult, subjectResult] = await Promise.all([
            stage11_body(lead),
            stage11_subject(lead)
          ]);
          emailBody = bodyResult.body;
          emailSubject = subjectResult.subject;
          bodyCost = bodyResult.costUsd + subjectResult.costUsd;
          totalCost += bodyCost;
          bumpMetric('haiku_cost_usd', bodyCost);
        }

        const geminiCost = extractCost + icpCost;

        // Insert lead into database
        getDb().prepare(`
          INSERT INTO leads (
            company, website, contact_name, contact_email, niche, city, cms,
            business_signals, quality_score, icp_score, icp_priority, hook,
            email_subject, email_body, status, gemini_cost_usd, hook_cost_usd, body_cost_usd
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          lead.company, lead.website, lead.contact_name, lead.contact_email,
          lead.niche, lead.city, lead.cms, lead.business_signals,
          lead.quality_score, lead.icp_score, lead.icp_priority, hook,
          emailSubject, emailBody, finalStatus,
          geminiCost, hookCost, bodyCost
        );

        bumpMetric('leads_found');

        if (finalStatus === 'ready') leadsReady++;
      } catch (leadErr) {
        logError('findLeads.lead', leadErr);
        leadsSkipped++;
      }
    }

    finishCron(cronId, { status: 'ok', leadsFound: leadsReady, costUsd: totalCost });
    await sendAlert(`findLeads: ${leadsReady} leads ready, ${leadsProcessed} processed, ${leadsSkipped} skipped (cost $${totalCost.toFixed(4)})`);
  } catch (err) {
    logError('findLeads', err);
    finishCron(cronId, { status: 'error', error: err.message });
    await sendAlert(`findLeads failed: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  findLeads().catch(console.error);
}
