import 'dotenv/config';
import { prisma, runWithOrg, logCron, finishCron, logError, bumpMetric, isRejected, todaySentCount, todayBounceRate,
         getConfigMap, getConfigInt, getConfigFloat, getConfigStr } from '../core/db/index.js';
import { sendMail } from '../core/email/mailer.js';
import { callClaude } from '../core/ai/claude.js';
import { validate } from '../core/email/contentValidator.js';
import { sendAlert } from '../core/integrations/telegram.js';
import { sleep } from '../core/lib/sleep.js';

// ── Sequence steps ───────────────────────────────────────
// Step 0: Day 0 — cold (already sent by sendEmails.js)
// Step 1: +3 days — short bump "just checking if this landed"
// Step 2: +7 days — value angle, mini case study
// Step 3: +14 days — breakup "I'll leave you alone after this"
// Step 4: +90 days — quarterly nurture, new thread

function buildStepPrompts(personaName) {
  return {
    1: (lead) =>
      `Write a very short follow-up email (2-3 sentences, 40-60 words) from ${personaName} to ${lead.contactName || 'the owner'} at ${lead.businessName}. This is a "just checking if my last email landed" bump. Do not repeat the original pitch. Be casual and human. Plain text only. No links.`,
    2: (lead) =>
      `Write a follow-up email (50-80 words) from ${personaName} to ${lead.contactName || 'the owner'} at ${lead.businessName}. Share a brief value angle — mention a relevant result like "helped a ${lead.category || 'similar'} business increase bookings by 40% after redesigning their site." Make it conversational, not salesy. Plain text only. A single relevant link is OK if natural.`,
    3: (lead) =>
      `Write a final breakup email (40-50 words) from ${personaName} to ${lead.contactName || 'the owner'} at ${lead.businessName}. This is the "I'll leave you alone after this" email. Be respectful and brief. Leave the door open. Plain text only. No links.`,
    4: (lead) =>
      `Write a quarterly check-in email (50-80 words) from ${personaName} to ${lead.contactName || 'the owner'} at ${lead.businessName}. It has been ~3 months since last contact. Reference something seasonal or timely. Reintroduce yourself briefly. Plain text only. No links.`
  };
}

// Days until next step after current step
const NEXT_STEP_DAYS = {
  1: 4,    // step 1 sent at +3d, next is step 2 at +7d total (4 more days)
  2: 7,    // step 2 sent at +7d, next is step 3 at +14d total (7 more days)
  3: 76,   // step 3 sent at +14d, next is step 4 at +90d total (76 more days)
  4: null  // step 4 is the final step — sequence complete
};

// ── Indian holidays (MM-DD) ──────────────────────────────
const HOLIDAYS = [
  '01-26', '03-14', '03-15', '08-15', '10-02',
  '10-20', '10-21', '10-22', '10-23', '10-24', '10-25', '10-26'
];

function isHoliday(istDate) {
  const mmdd = String(istDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
               String(istDate.getUTCDate()).padStart(2, '0');
  return HOLIDAYS.includes(mmdd);
}

// Non-negotiable Rule 6: Send window enforced
function inSendWindow(windowStart, windowEnd) {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const day = ist.getUTCDay();
  if (day === 0) return false; // No Sunday sends
  if (isHoliday(ist)) return false;
  const hour = ist.getUTCHours();
  const minute = ist.getUTCMinutes();
  const currentHour = hour + minute / 60;
  const start = windowStart + 0.5;
  const end   = windowEnd   + 0.5;
  return currentHour >= start && currentHour < end;
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export default async function sendFollowups(orgId) {
  return runWithOrg(orgId, async () => {
  const cronId = await logCron('sendFollowups');
  let emailsSent = 0;
  let totalCost = 0;

  try {
    const cfg = await getConfigMap();

    if (!getConfigInt(cfg, 'send_followups_enabled', 1)) {
      await finishCron(cronId, { status: 'skipped' });
      return;
    }

    const dailyLimit  = getConfigInt(cfg,   'daily_send_limit',     parseInt(process.env.DAILY_SEND_LIMIT    || '0'));
    const delayMin    = getConfigInt(cfg,   'send_delay_min_ms',    parseInt(process.env.SEND_DELAY_MIN_MS   || '180000'));
    const delayMax    = getConfigInt(cfg,   'send_delay_max_ms',    parseInt(process.env.SEND_DELAY_MAX_MS   || '420000'));
    const windowStart = getConfigInt(cfg,   'send_window_start',    parseInt(process.env.SEND_WINDOW_START_IST || '9'));
    const windowEnd   = getConfigInt(cfg,   'send_window_end',      parseInt(process.env.SEND_WINDOW_END_IST   || '17'));
    const bounceStop  = getConfigFloat(cfg, 'bounce_rate_hard_stop', parseFloat(process.env.BOUNCE_RATE_HARD_STOP || '0.02'));
    const personaName = getConfigStr(cfg,   'persona_name',          'Darshan Parmar');

    const STEP_PROMPTS = buildStepPrompts(personaName);

    if (dailyLimit === 0) {
      await finishCron(cronId, { status: 'skipped' });
      return;
    }

    // Non-negotiable Rule 6: enforce send window for follow-ups too
    if (!inSendWindow(windowStart, windowEnd)) {
      await finishCron(cronId, { status: 'skipped' });
      return;
    }

    if ((await todayBounceRate()) > bounceStop) {
      await sendAlert('sendFollowups: bounce rate exceeded — skipping');
      await finishCron(cronId, { status: 'skipped' });
      return;
    }

    // Pull sequences that are due today
    const today = new Date();
    const dueSequences = await prisma.sequenceState.findMany({
      where: {
        status: 'active',
        nextSendDate: { lte: today },
        currentStep: { lt: 4 },
      },
      include: { lead: true },
      orderBy: { nextSendDate: 'asc' },
    });

    for (let i = 0; i < dueSequences.length; i++) {
      const seq = dueSequences[i];
      const lead = seq.lead;
      const nextStep = seq.currentStep + 1;

      // Check limits
      if ((await todaySentCount()) >= dailyLimit) break;
      if ((await todayBounceRate()) > bounceStop) break;

      // Skip rejected leads
      if (await isRejected(lead.contactEmail)) {
        await prisma.sequenceState.update({
          where: { id: seq.id },
          data: { status: 'unsubscribed' },
        });
        continue;
      }

      // Stop condition: 2+ hard bounces from this domain
      const bounceDomain = lead.contactEmail?.split('@')[1];
      if (bounceDomain) {
        const domainBounces = await prisma.bounce.count({
          where: {
            bounceType: 'hard',
            lead: { contactEmail: { endsWith: `@${bounceDomain}` } },
          },
        });
        if (domainBounces >= 2) {
          await prisma.sequenceState.update({
            where: { id: seq.id },
            data: { status: 'paused', pausedReason: 'domain_bounces' },
          });
          continue;
        }
      }

      try {
        // Generate follow-up body via Claude Haiku
        const promptFn = STEP_PROMPTS[nextStep];
        if (!promptFn) continue;

        const { text: body, costUsd, model: bodyModelId } = await callClaude('haiku', promptFn(lead), { maxTokens: 200 });
        totalCost += costUsd;
        // Note: callClaude already writes haikuCostUsd to daily_metrics — no bumpMetric needed

        // Determine subject and threading (Non-negotiable Rule 9)
        let subject;
        let inReplyTo = null;
        let referencesHeader = null;

        if (nextStep <= 3) {
          // Steps 1-3: thread reply — "Re: {original subject}"
          subject = `Re: ${seq.lastSubject}`;
          inReplyTo = seq.lastMessageId;
          // Build references chain from previous emails
          const prevEmails = await prisma.email.findMany({
            where: {
              leadId: seq.leadId,
              sequenceStep: { lt: nextStep },
              messageId: { not: null },
            },
            orderBy: { sequenceStep: 'asc' },
            select: { messageId: true },
          });
          referencesHeader = prevEmails.map(e => e.messageId).join(' ');
        } else {
          // Step 4: new thread — fresh subject
          subject = `Checking in — ${lead.businessName}`;
        }

        // Non-negotiable Rule 4: validate content before send
        let finalBody = body;
        const validation = await validate(subject, body, nextStep);
        if (!validation.valid) {
          // Try regenerating once
          const { text: retryBody, costUsd: retryCost } = await callClaude('haiku', promptFn(lead), { maxTokens: 200 });
          totalCost += retryCost;
          // Note: callClaude already writes haikuCostUsd to daily_metrics
          const retryValidation = await validate(subject, retryBody, nextStep);
          if (!retryValidation.valid) {
            await logError('sendFollowups.validation', new Error(`Content rejected for lead ${seq.leadId} step ${nextStep}: ${retryValidation.reason}`), { jobName: 'sendFollowups', errorType: 'validation_error', leadId: seq.leadId });
            continue;
          }
          finalBody = retryBody;
        }

        // Round-robin inbox
        const currentSent = await todaySentCount();
        const inboxNumber = (currentSent % 2) + 1;
        const inboxUser = inboxNumber === 1 ? process.env.INBOX_1_USER : process.env.INBOX_2_USER;
        const domain = process.env.OUTREACH_DOMAIN || 'trysimpleinc.com';

        // Non-negotiable Rule 13: assert outreach domain before send
        if (!inboxUser?.endsWith(`@${domain}`)) {
          await logError('sendFollowups.domainAssert', new Error(`Inbox ${inboxNumber} not on ${domain}`), { jobName: 'sendFollowups', errorType: 'validation_error' });
          break;
        }

        const sendStart = Date.now();
        const { messageId } = await sendMail(inboxNumber, {
          to: lead.contactEmail,
          subject,
          text: finalBody,
          ...(inReplyTo ? { inReplyTo, references: referencesHeader } : {})
        });
        const sendDuration = Date.now() - sendStart;

        // Insert email record
        await prisma.email.create({
          data: {
            leadId: seq.leadId,
            sequenceStep: nextStep,
            inboxUsed: inboxUser,
            fromDomain: domain,
            fromName: personaName,
            subject,
            body: finalBody,
            wordCount: finalBody.trim().split(/\s+/).filter(Boolean).length,
            containsLink: /https?:\/\//i.test(finalBody),
            isHtml: false,
            isPlainText: true,
            contentValid: true,
            status: 'sent',
            sentAt: new Date(),
            messageId,
            sendDurationMs: sendDuration,
            inReplyTo,
            referencesHeader,
            bodyModel: bodyModelId,
            bodyCostUsd: costUsd,
            totalCostUsd: costUsd,
          },
        });

        // Update sequence_state
        const nextDays = NEXT_STEP_DAYS[nextStep];
        if (nextDays) {
          await prisma.sequenceState.update({
            where: { id: seq.id },
            data: {
              currentStep: nextStep,
              nextSendDate: daysFromNow(nextDays),
              lastSentAt: new Date(),
              lastMessageId: messageId,
              lastSubject: nextStep <= 3 ? seq.lastSubject : subject,
            },
          });
        } else {
          // Sequence complete
          await prisma.sequenceState.update({
            where: { id: seq.id },
            data: {
              currentStep: nextStep,
              status: 'completed',
              lastSentAt: new Date(),
            },
          });
        }

        await bumpMetric('emailsSent');
        await bumpMetric('followupsSent');
        if (inboxNumber === 1) await bumpMetric('sentInbox1');
        else await bumpMetric('sentInbox2');
        emailsSent++;

        // Delay between sends
        if (i < dueSequences.length - 1) {
          await sleep(delayMin, delayMax);
        }
      } catch (sendErr) {
        await logError('sendFollowups.send', sendErr, { jobName: 'sendFollowups', errorType: 'smtp_error', leadId: seq.leadId });
      }
    }

    await finishCron(cronId, { status: 'success', recordsProcessed: emailsSent, costUsd: totalCost });
    if (emailsSent > 0) {
      await sendAlert(`sendFollowups: ${emailsSent} follow-ups sent (cost $${totalCost.toFixed(4)})`);
    }
  } catch (err) {
    await logError('sendFollowups', err, { jobName: 'sendFollowups' });
    await finishCron(cronId, { status: 'failed', error: err.message });
    await sendAlert(`sendFollowups failed: ${err.message}`);
  }
  });
}

// Run directly if executed as script (single-tenant, falls back to raw client)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  sendFollowups(null).catch(console.error);
}
