import 'dotenv/config';
import { prisma, getPrisma, logCron, finishCron, logError, bumpMetric, getConfigMap, getConfigInt, getConfigStr } from '../core/db/index.js';
import { callGemini } from '../core/ai/gemini.js';
import { callClaude } from '../core/ai/claude.js';
import { verifyEmail } from '../core/integrations/mev.js';
import { sendAlert } from '../core/integrations/telegram.js';
import { loadScoringContext, scoreLead } from '../core/ai/icpScorer.js';
import { withConcurrency } from '../core/lib/concurrency.js';

// ── Niche rotation: DB-backed ─────────────────────────────
async function getNicheForToday() {
  const dow = new Date().getDay();
  const today = await prisma.niche.findFirst({
    where: { dayOfWeek: dow, enabled: true },
    orderBy: { sortOrder: 'asc' },
  });
  if (today) return today;
  return prisma.niche.findFirst({
    where: { enabled: true },
    orderBy: { sortOrder: 'asc' },
  });
}

// Exported for unit testing
export async function insertLead(lead, niche, status) {
  return prisma.lead.create({
    data: {
      businessName: lead.business_name,
      websiteUrl: lead.website_url,
      category: lead.category,
      city: lead.city,
      country: 'IN',
      searchQuery: niche.query,
      techStack: lead.tech_stack || [],
      websiteProblems: lead.website_problems || [],
      lastUpdated: lead.last_updated,
      hasSsl: Boolean(lead.has_ssl),
      hasAnalytics: Boolean(lead.has_analytics),
      ownerName: lead.owner_name,
      ownerRole: lead.owner_role,
      businessSignals: lead.business_signals || [],
      socialActive: Boolean(lead.social_active),
      websiteQualityScore: lead.website_quality_score,
      judgeReason: lead.judge_reason,
      contactName: lead.owner_name,
      contactEmail: lead.contact_email,
      contactConfidence: lead.contact_confidence,
      contactSource: lead.contact_source,
      emailStatus: lead.email_status,
      emailVerifiedAt: status === 'ready' ? new Date() : null,
      employeesEstimate: lead.employees_estimate || 'unknown',
      businessStage: lead.business_stage || 'unknown',
      icpScore: lead.icp_score,
      icpPriority: lead.icp_priority,
      icpReason: lead.icp_reason,
      icpBreakdown: lead.icp_breakdown || null,
      icpKeyMatches: lead.icp_key_matches || [],
      icpKeyGaps: lead.icp_key_gaps || [],
      icpDisqualifiers: lead.icp_disqualifiers || [],
      status,
      geminiCostUsd: (lead.extractCost || 0) + (lead.icpCost || 0),
      discoveryModel: 'gemini-2.5-flash',
      extractionModel: 'gemini-2.5-flash',
    },
  });
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
- employees_estimate: "1-10" | "10-50" | "50-200" | "unknown" (string). Use team/about page clues.
- business_stage: "owner-operated" | "growing" | "established" | "unknown" (string).

Business: ${lead.business_name}, Website: ${lead.website_url}, City: ${lead.city}

Return only valid JSON, no markdown.`;
  const result = await callGemini(prompt, { useGrounding: true });
  try {
    return { data: JSON.parse(stripJson(result.text)), costUsd: result.costUsd };
  } catch {
    return { data: null, costUsd: result.costUsd };
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
/**
 * @param {{ leadsCount?: number, perBatch?: number }} [override]
 *   When called from an on-demand dashboard trigger (/api/run-engine/findLeads),
 *   these override the config-based count + batch size and bypass the
 *   Math.max(50, ...) floor that applies to the scheduled cron run.
 */
export default async function findLeads(override = {}) {
  const cronId = await logCron('findLeads');

  const cfg = await getConfigMap();

  if (!getConfigInt(cfg, 'find_leads_enabled', 1)) {
    await finishCron(cronId, { status: 'skipped' });
    return;
  }

  let totalCost = 0;
  let leadsReady = 0;
  let leadsProcessed = 0;
  let leadsSkipped = 0;

  try {
    const niche = await getNicheForToday();

    if (!niche) {
      await finishCron(cronId, { status: 'failed', error: 'No enabled niches configured' });
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

    // Override takes precedence (on-demand dashboard trigger); floor bypassed.
    // Cron-scheduled runs pass no override and keep the 50-lead floor.
    const leadsCount = typeof override.leadsCount === 'number' && override.leadsCount > 0
      ? Math.max(1, Math.floor(override.leadsCount))
      : Math.max(50, getConfigInt(cfg, 'find_leads_count', 150));
    const perBatch = typeof override.perBatch === 'number' && override.perBatch > 0
      ? Math.max(1, Math.floor(override.perBatch))
      : getConfigInt(cfg, 'find_leads_per_batch', 30);
    const batches = Math.ceil(leadsCount / perBatch);
    const threshA = getConfigInt(cfg, 'icp_threshold_a', 70);
    const threshB = getConfigInt(cfg, 'icp_threshold_b', 40);
    let icpWeights;
    try {
      icpWeights = JSON.parse(getConfigStr(cfg, 'icp_weights', '{}'));
    } catch {
      icpWeights = { firmographic: 20, problem: 20, intent: 15, tech: 15, economic: 15, buying: 15 };
    }
    const scoringCtx = await loadScoringContext(getPrisma());
    scoringCtx.weights = icpWeights;
    scoringCtx.threshA = threshA;
    scoringCtx.threshB = threshB;
    const persona = {
      name:     getConfigStr(cfg, 'persona_name',     'Darshan Parmar'),
      role:     getConfigStr(cfg, 'persona_role',     'Full-Stack Developer'),
      company:  getConfigStr(cfg, 'persona_company',  'Simple Inc'),
      tone:     getConfigStr(cfg, 'persona_tone',     'professional but direct'),
      services: getConfigStr(cfg, 'persona_services', ''),
    };

    // ── Dedup guards — pre-load before any concurrent work ───────────────
    // Loaded once. Workers use Set.has/add (synchronous, no await) so JS's
    // single-threaded event loop guarantees no two workers race on these.
    const knownEmailRows = await prisma.lead.findMany({
      where: { contactEmail: { not: null } },
      select: { contactEmail: true },
    });
    const knownEmails = new Set(knownEmailRows.map(r => r.contactEmail));

    const rejectedRows = await prisma.rejectList.findMany({ select: { email: true } });
    const rejectedEmails = new Set(rejectedRows.map(r => r.email));

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const cooledRows = await prisma.lead.findMany({
      where: {
        status: { in: ['sent', 'replied'] },
        // 'contacted' excluded: not a valid status in the pipeline state machine
        domainLastContacted: { gte: ninetyDaysAgo },
        contactEmail: { not: null },
      },
      select: { contactEmail: true },
    });
    const cooledDomains = new Set(
      cooledRows.map(r => r.contactEmail?.split('@')[1]).filter(Boolean)
    );

    // Stage 1: Discovery — all batches concurrent (cap=5 to stay within grounding RPM)
    const batchIndices = Array.from({ length: batches }, (_, i) => i);
    const discoveryResults = await withConcurrency(batchIndices, 5, async (batchIndex) => {
      try {
        const { leads, costUsd } = await stage1_discover(niche, batchIndex, perBatch, cities, businessSize);
        totalCost += costUsd;
        await bumpMetric('geminiCostUsd', costUsd);
        await bumpMetric('totalApiCostUsd', costUsd);
        return leads;
      } catch (err) {
        await logError('findLeads.discovery', err, { jobName: 'findLeads' });
        return [];
      }
    });
    const rawLeads = discoveryResults.flat();

    await bumpMetric('leadsDiscovered', rawLeads.length);

    // ── Stage 2-6: Extract + Gate 1 + email check + dedup ────────────────
    // 20 concurrent Gemini calls — safe on paid tier (1,000 RPM generation limit)
    const extractedLeads = await withConcurrency(rawLeads, 20, async (raw) => {
      try {
        leadsProcessed++;

        const { data: extracted, costUsd: extractCost } = await stages2to6_extract(raw);
        totalCost += extractCost;
        await bumpMetric('geminiCostUsd', extractCost);
        await bumpMetric('totalApiCostUsd', extractCost);

        if (!extracted) {
          leadsSkipped++;
          return null;
        }

        await bumpMetric('leadsExtracted');

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

        await bumpMetric('leadsJudgePassed');

        if (!lead.contact_email) {
          leadsSkipped++;
          return null;
        }

        await bumpMetric('leadsEmailFound');

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
        await logError('findLeads.lead', err, { jobName: 'findLeads' });
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
          await prisma.lead.create({
            data: {
              businessName: lead.business_name,
              websiteUrl: lead.website_url,
              category: lead.category,
              city: lead.city,
              contactEmail: lead.contact_email,
              emailStatus: verifyStatus,
              status: 'email_invalid',
            },
          });
          return null;
        }

        // Gate 2: unknown + low confidence = skip
        if (verifyStatus === 'unknown' && confidence < 0.5) {
          leadsSkipped++;
          return null;
        }

        await bumpMetric('leadsEmailValid');
        return lead;
      } catch (err) {
        await logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
        return null;
      }
    });
    const gate2Passed = verifiedLeads.filter(Boolean);

    // ── Stage 9: ICP scoring ─────────────────────────────────────────────
    const scoredLeads = await withConcurrency(gate2Passed, 20, async (lead) => {
      try {
        const icp = await scoreLead(lead, scoringCtx);
        totalCost += icp.costUsd;
        await bumpMetric('geminiCostUsd', icp.costUsd);
        await bumpMetric('totalApiCostUsd', icp.costUsd);

        Object.assign(lead, icp, { icpCost: icp.costUsd });

        // Hard disqualifiers override score
        if (icp.icp_disqualifiers.length > 0) {
          await insertLead(lead, niche, 'disqualified');
          await bumpMetric('leadsDisqualified');
          leadsSkipped++;
          return null;
        }

        // C-priority → nurture
        if (icp.icp_priority === 'C') {
          await insertLead(lead, niche, 'nurture');
          leadsSkipped++;
          return null;
        }

        await bumpMetric('leadsIcpAb');
        return lead;
      } catch (err) {
        await logError('findLeads.lead', err, { jobName: 'findLeads' });
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
    const costRow = await prisma.dailyMetrics.findUnique({
      where: { date: todayStr },
      select: { geminiCostUsd: true, sonnetCostUsd: true, haikuCostUsd: true },
    });
    const aiSpendToday = ANTHROPIC_DISABLED
      ? Number(costRow?.geminiCostUsd || 0)
      : Number(costRow?.sonnetCostUsd || 0) + Number(costRow?.haikuCostUsd || 0);
    const claudeCap = parseFloat(process.env.CLAUDE_DAILY_SPEND_CAP || '5.00');
    if (aiSpendToday >= claudeCap) {
      const provider = ANTHROPIC_DISABLED ? 'Gemini' : 'Claude';
      await sendAlert(`findLeads: ${provider} spend cap hit ($${aiSpendToday.toFixed(3)} >= $${claudeCap}) — skipping Stage 10/11 for ${abLeads.length} leads`);
      await finishCron(cronId, { status: 'success', recordsProcessed: leadsProcessed, recordsSkipped: leadsSkipped + abLeads.length, costUsd: totalCost });
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
          await bumpMetric('geminiCostUsd', hookResult.costUsd + bodyCost);
        } else {
          await bumpMetric('sonnetCostUsd', hookResult.costUsd);
          await bumpMetric('haikuCostUsd', bodyCost);
        }
        await bumpMetric('totalApiCostUsd', hookResult.costUsd + bodyCost);

        // Insert lead
        const leadInsert = await insertLead(lead, niche, 'ready');

        // Insert pre-generated email
        await prisma.email.create({
          data: {
            leadId: leadInsert.id,
            sequenceStep: 0,
            subject: subjectResult.subject,
            body: bodyResult.body,
            wordCount: bodyResult.body.trim().split(/\s+/).filter(Boolean).length,
            hook: hookResult.hook,
            containsLink: false,
            isHtml: false,
            isPlainText: true,
            contentValid: true,
            status: 'pending',
            hookModel: hookResult.model,
            bodyModel: bodyResult.model,
            hookCostUsd: hookResult.costUsd,
            bodyCostUsd: bodyCost,
            totalCostUsd: hookResult.costUsd + bodyCost,
          },
        });

        await bumpMetric('leadsReady');
        leadsReady++;
      } catch (err) {
        await logError('findLeads.lead', err, { jobName: 'findLeads' });
        leadsSkipped++;
      }
    });

    await finishCron(cronId, { status: 'success', recordsProcessed: leadsProcessed, recordsSkipped: leadsSkipped, costUsd: totalCost });
    await sendAlert(`findLeads: ${leadsReady} leads ready, ${leadsProcessed} processed, ${leadsSkipped} skipped (cost $${totalCost.toFixed(4)})`);
  } catch (err) {
    await logError('findLeads', err, { jobName: 'findLeads' });
    await finishCron(cronId, { status: 'failed', error: err.message });
    await sendAlert(`findLeads failed: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  findLeads().catch(console.error);
}
