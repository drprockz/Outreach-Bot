import 'dotenv/config';
import { prisma, logCron, finishCron, logError, bumpMetric, bumpCostMetric, isRejected, todaySentCount, todayBounceRate, addToRejectList,
         getConfigMap, getConfigInt, getConfigFloat } from '../core/db/index.js';
import { verifyConnections, sendMail } from '../core/email/mailer.js';
import { validate } from '../core/email/contentValidator.js';
import { callClaude } from '../core/ai/claude.js';
import { callGemini } from '../core/ai/gemini.js';

const ANTHROPIC_DISABLED = process.env.ANTHROPIC_DISABLED === 'true';
import { sendAlert } from '../core/integrations/telegram.js';
import { sleep } from '../core/lib/sleep.js';

// ── Indian holidays (MM-DD) ──────────────────────────────
// Fallback used when the send_holidays config key is missing or malformed.
// Includes Republic Day, Holi (~mid-Mar), Independence Day, Gandhi Jayanti, Diwali week.
const HARDCODED_HOLIDAYS = [
  '01-26',
  '03-14', '03-15',
  '08-15',
  '10-02',
  '10-20', '10-21', '10-22', '10-23', '10-24',
  '10-25', '10-26',
];

let _fellBackHolidays = false;
export function didFallbackHolidays() { return _fellBackHolidays; }

async function loadHolidays() {
  try {
    const cfg = await getConfigMap();
    if (cfg.send_holidays) {
      const parsed = JSON.parse(cfg.send_holidays);
      if (Array.isArray(parsed) && parsed.every(d => /^\d{2}-\d{2}$/.test(d))) {
        _fellBackHolidays = false;
        return parsed;
      }
    }
  } catch { /* fall through to hardcoded */ }
  _fellBackHolidays = true;
  return HARDCODED_HOLIDAYS;
}

function isHoliday(istDate, holidays) {
  const mmdd = String(istDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
               String(istDate.getUTCDate()).padStart(2, '0');
  return holidays.includes(mmdd);
}

export async function inSendWindow(windowStart, windowEnd, now = new Date()) {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const day = ist.getUTCDay();
  if (day === 0) return false; // No Sunday
  const holidays = await loadHolidays();
  if (isHoliday(ist, holidays)) return false;
  const hour = ist.getUTCHours();
  const minute = ist.getUTCMinutes();
  const currentTime = hour + minute / 60;
  const wStart = windowStart + 0.5;
  const wEnd   = windowEnd   + 0.5;
  return currentTime >= wStart && currentTime < wEnd;
}

function getInboxUser(inboxNumber) {
  return inboxNumber === 1 ? process.env.INBOX_1_USER : process.env.INBOX_2_USER;
}

export default async function sendEmails() {
  const cronId = await logCron('sendEmails');
  let emailsSent = 0;
  let totalCost = 0;

  try {
    // ── Read config from DB (process.env as fallback) ────
    const cfg = await getConfigMap();

    if (!getConfigInt(cfg, 'send_emails_enabled', 1)) {
      await finishCron(cronId, { status: 'skipped' });
      return;
    }

    const dailyLimit  = getConfigInt(cfg,   'daily_send_limit',    parseInt(process.env.DAILY_SEND_LIMIT    || '0'));
    const maxPerInbox = getConfigInt(cfg,   'max_per_inbox',       parseInt(process.env.MAX_PER_INBOX       || '17'));
    const delayMin    = getConfigInt(cfg,   'send_delay_min_ms',   parseInt(process.env.SEND_DELAY_MIN_MS   || '180000'));
    const delayMax    = getConfigInt(cfg,   'send_delay_max_ms',   parseInt(process.env.SEND_DELAY_MAX_MS   || '420000'));
    const windowStart = getConfigInt(cfg,   'send_window_start',   parseInt(process.env.SEND_WINDOW_START_IST || '9'));
    const windowEnd   = getConfigInt(cfg,   'send_window_end',     parseInt(process.env.SEND_WINDOW_END_IST   || '17'));
    const bounceStop  = getConfigFloat(cfg, 'bounce_rate_hard_stop', parseFloat(process.env.BOUNCE_RATE_HARD_STOP || '0.02'));

    // ── Pre-flight checks ────────────────────────────────
    if (dailyLimit === 0) {
      await finishCron(cronId, { status: 'skipped' });
      return;
    }

    if (!(await inSendWindow(windowStart, windowEnd))) {
      await finishCron(cronId, { status: 'skipped' });
      return;
    }

    // Verify SMTP connections
    await verifyConnections();

    // Check bounce rate before sending (Non-negotiable Rule 5)
    const bounceThreshold = bounceStop;
    if ((await todayBounceRate()) > bounceThreshold) {
      await sendAlert('BOUNCE RATE exceeded threshold - sending paused');
      await finishCron(cronId, { status: 'skipped' });
      return;
    }

    // ── Pull ready leads with pre-generated emails ─────
    const alreadySent = await todaySentCount();
    const remaining = dailyLimit - alreadySent;
    if (remaining <= 0) {
      await finishCron(cronId, { status: 'skipped' });
      return;
    }

    // Join leads with their pending step-0 emails.
    // status='ready' already implies score >= icp_threshold_b (set by findLeads),
    // so no additional score filter needed here.
    const queue = await prisma.lead.findMany({
      where: {
        status: 'ready',
        emails: { some: { sequenceStep: 0, status: 'pending' } },
      },
      include: {
        emails: { where: { sequenceStep: 0, status: 'pending' }, take: 1 },
      },
      orderBy: [{ icpScore: 'desc' }, { id: 'asc' }],
      take: remaining,
    });

    for (let i = 0; i < queue.length; i++) {
      const lead = queue[i];
      const email = lead.emails[0];
      if (!email) continue;

      // Re-check bounce rate before every send (Non-negotiable Rule 5)
      if ((await todayBounceRate()) > bounceThreshold) {
        await sendAlert('BOUNCE RATE exceeded threshold mid-session - aborting');
        break;
      }

      // Re-check daily limit
      if ((await todaySentCount()) >= dailyLimit) break;

      // Skip leads in reject list
      if (await isRejected(lead.contactEmail)) continue;

      await bumpMetric('emailsAttempted');

      // Non-negotiable Rule 4: contentValidator runs before every sendMail call
      let emailSubject = email.subject;
      let emailBody = email.body;
      let regenerated = false;

      const validation = await validate(emailSubject, emailBody, 0);
      if (!validation.valid) {
        // Regenerate once on content validation failure
        try {
          const regenPrompt = `Write a cold email from Darshan Parmar (Full-Stack Developer, Simple Inc) to ${lead.contactName || lead.ownerName || 'the owner'} at ${lead.businessName}.

Hook to open with: "${email.hook}"

Rules:
- Plain text only, no HTML
- 50-90 words total
- No links, no URLs
- CTA: ask to reply
- Professional but direct tone
- Do not mention price

Return only the email body, no subject line.`;
          let newBody, costUsd;
          if (ANTHROPIC_DISABLED) {
            const result = await callGemini(regenPrompt);
            newBody = result.text; costUsd = result.costUsd;
            // callGemini doesn't write to daily_metrics — do it here
            await bumpCostMetric('geminiCostUsd', costUsd);
          } else {
            const result = await callClaude('haiku', regenPrompt, { maxTokens: 200 });
            newBody = result.text; costUsd = result.costUsd;
            // callClaude already writes haikuCostUsd to daily_metrics — no bumpMetric needed
          }
          totalCost += costUsd;

          const retryValidation = await validate(emailSubject, newBody, 0);
          if (!retryValidation.valid) {
            // Second fail → skip lead, log content_rejected
            await logError('sendEmails.validation', new Error(`Content rejected for lead ${lead.id}: ${retryValidation.reason}`), { jobName: 'sendEmails', errorType: 'validation_error', leadId: lead.id });
            await prisma.email.update({
              where: { id: email.id },
              data: { status: 'content_rejected', contentValid: false, validationFailReason: retryValidation.reason },
            });
            await prisma.lead.update({ where: { id: lead.id }, data: { status: 'content_rejected' } });
            await bumpMetric('emailsContentRejected');
            continue;
          }
          emailBody = newBody;
          regenerated = true;
        } catch (regenErr) {
          await logError('sendEmails.regenerate', regenErr, { jobName: 'sendEmails', leadId: lead.id });
          await prisma.email.update({
            where: { id: email.id },
            data: { status: 'content_rejected', contentValid: false, validationFailReason: validation.reason },
          });
          await bumpMetric('emailsContentRejected');
          continue;
        }
      }

      // Round-robin inbox
      const currentSent = await todaySentCount();
      const inboxNumber = (currentSent % 2) + 1;
      const inboxUser = getInboxUser(inboxNumber);

      // Non-negotiable Rule 13: assert outreach domain
      const domain = process.env.OUTREACH_DOMAIN || 'trysimpleinc.com';
      if (!inboxUser?.endsWith(`@${domain}`)) {
        await logError('sendEmails.domainAssert', new Error(`Inbox ${inboxNumber} not on ${domain}`), { jobName: 'sendEmails', errorType: 'validation_error' });
        break;
      }

      try {
        const sendStart = Date.now();
        const { messageId } = await sendMail(inboxNumber, {
          to: lead.contactEmail,
          subject: emailSubject,
          text: emailBody
        });
        const sendDuration = Date.now() - sendStart;

        // Update the pre-generated email record
        await prisma.email.update({
          where: { id: email.id },
          data: {
            inboxUsed: inboxUser,
            fromDomain: domain,
            fromName: 'Darshan Parmar',
            body: emailBody,
            wordCount: emailBody.trim().split(/\s+/).filter(Boolean).length,
            contentValid: true,
            regenerated,
            status: 'sent',
            sentAt: new Date(),
            messageId,
            sendDurationMs: sendDuration,
          },
        });

        // Update lead status + domainLastContacted
        await prisma.lead.update({
          where: { id: lead.id },
          data: { status: 'sent', domainLastContacted: new Date() },
        });

        // Initialise sequence_state for follow-ups
        const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        await prisma.sequenceState.upsert({
          where: { leadId: lead.id },
          create: {
            leadId: lead.id,
            currentStep: 0,
            nextSendDate: threeDaysFromNow,
            lastSentAt: new Date(),
            lastMessageId: messageId,
            lastSubject: emailSubject,
            status: 'active',
          },
          update: {
            currentStep: 0,
            nextSendDate: threeDaysFromNow,
            lastSentAt: new Date(),
            lastMessageId: messageId,
            lastSubject: emailSubject,
            status: 'active',
          },
        });

        // Bump daily metrics
        await bumpMetric('emailsSent');
        if (inboxNumber === 1) await bumpMetric('sentInbox1');
        else await bumpMetric('sentInbox2');

        emailsSent++;
        totalCost += Number(email.totalCostUsd || 0);

        // Delay between sends (except after the last one)
        if (i < queue.length - 1) {
          await sleep(delayMin, delayMax);
        }
      } catch (sendErr) {
        await logError('sendEmails.send', sendErr, { jobName: 'sendEmails', errorType: 'smtp_error', leadId: lead.id, emailId: email.id });

        const smtpCode = sendErr.responseCode || 0;
        if (smtpCode >= 500 && smtpCode < 600) {
          await prisma.email.update({
            where: { id: email.id },
            data: {
              status: 'hard_bounce',
              smtpCode,
              smtpResponse: sendErr.message,
              sentAt: new Date(),
              inboxUsed: inboxUser,
              fromDomain: domain,
            },
          });

          await prisma.bounce.create({
            data: {
              emailId: email.id,
              leadId: lead.id,
              bounceType: 'hard',
              smtpCode,
              smtpMessage: sendErr.message,
            },
          });

          await addToRejectList(lead.contactEmail, 'hard_bounce');
          await prisma.lead.update({ where: { id: lead.id }, data: { status: 'bounced' } });
          await bumpMetric('emailsHardBounced');
        } else if (smtpCode >= 400 && smtpCode < 500) {
          await prisma.email.update({
            where: { id: email.id },
            data: { status: 'soft_bounce', smtpCode, smtpResponse: sendErr.message },
          });

          await prisma.bounce.create({
            data: {
              emailId: email.id,
              leadId: lead.id,
              bounceType: 'soft',
              smtpCode,
              smtpMessage: sendErr.message,
              retryAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });

          await bumpMetric('emailsSoftBounced');
        }
      }
    }

    await finishCron(cronId, { status: 'success', recordsProcessed: emailsSent, costUsd: totalCost });
    if (emailsSent > 0) {
      await sendAlert(`sendEmails: ${emailsSent} emails sent (cost $${totalCost.toFixed(4)})`);
    }
  } catch (err) {
    await logError('sendEmails', err, { jobName: 'sendEmails' });
    await finishCron(cronId, { status: 'failed', error: err.message });
    await sendAlert(`sendEmails failed: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  sendEmails().catch(console.error);
}
