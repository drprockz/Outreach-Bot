import 'dotenv/config';
import { getDb, logCron, finishCron, logError, bumpMetric, isRejected, todaySentCount, todayBounceRate, addToRejectList, today,
         getConfigMap, getConfigInt, getConfigFloat } from '../core/db/index.js';
import { verifyConnections, sendMail } from '../core/email/mailer.js';
import { validate } from '../core/email/contentValidator.js';
import { callClaude } from '../core/ai/claude.js';
import { sendAlert } from '../core/integrations/telegram.js';
import { sleep } from '../core/lib/sleep.js';

// ── Indian holidays (MM-DD) ──────────────────────────────
// Includes Republic Day, Holi (~mid-Mar), Independence Day, Gandhi Jayanti, Diwali week (~late Oct/Nov)
const HOLIDAYS = [
  '01-26',                                          // Republic Day
  '03-14', '03-15',                                 // Holi (approx — update yearly)
  '08-15',                                          // Independence Day
  '10-02',                                          // Gandhi Jayanti
  '10-20', '10-21', '10-22', '10-23', '10-24',     // Diwali week (approx — update yearly)
  '10-25', '10-26'
];

function isHoliday(istDate) {
  const mmdd = String(istDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
               String(istDate.getUTCDate()).padStart(2, '0');
  return HOLIDAYS.includes(mmdd);
}

function inSendWindow(windowStart, windowEnd) {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const day = ist.getUTCDay();
  if (day === 0) return false; // No Sunday
  if (isHoliday(ist)) return false;
  const hour = ist.getUTCHours();
  const minute = ist.getUTCMinutes();
  const currentTime = hour + minute / 60;
  const wStart = windowStart + 0.5; // env=9 → 9.5 (9:30 AM)
  const wEnd   = windowEnd   + 0.5; // env=17 → 17.5 (5:30 PM)
  return currentTime >= wStart && currentTime < wEnd;
}

function getInboxUser(inboxNumber) {
  return inboxNumber === 1 ? process.env.INBOX_1_USER : process.env.INBOX_2_USER;
}

export default async function sendEmails() {
  const cronId = logCron('sendEmails');
  let emailsSent = 0;
  let totalCost = 0;

  try {
    // ── Read config from DB (process.env as fallback) ────
    const cfg = getConfigMap();

    if (!getConfigInt(cfg, 'send_emails_enabled', 1)) {
      finishCron(cronId, { status: 'skipped' });
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
      finishCron(cronId, { status: 'skipped' });
      return;
    }

    if (!inSendWindow(windowStart, windowEnd)) {
      finishCron(cronId, { status: 'skipped' });
      return;
    }

    // Verify SMTP connections
    await verifyConnections();

    // Check bounce rate before sending (Non-negotiable Rule 5)
    const bounceThreshold = bounceStop;
    if (todayBounceRate() > bounceThreshold) {
      await sendAlert('BOUNCE RATE exceeded threshold - sending paused');
      finishCron(cronId, { status: 'skipped' });
      return;
    }

    // ── Pull ready leads with pre-generated emails ─────
    const alreadySent = todaySentCount();
    const remaining = dailyLimit - alreadySent;
    if (remaining <= 0) {
      finishCron(cronId, { status: 'skipped' });
      return;
    }

    const db = getDb();

    // Join leads with their pending step-0 emails
    const queue = db.prepare(`
      SELECT l.*, e.id AS email_id, e.subject AS email_subject, e.body AS email_body,
             e.hook, e.hook_cost_usd AS e_hook_cost, e.body_cost_usd AS e_body_cost, e.total_cost_usd AS email_cost
      FROM leads l
      JOIN emails e ON e.lead_id = l.id AND e.sequence_step = 0 AND e.status = 'pending'
      WHERE l.status = 'ready'
        AND l.icp_priority IN ('A', 'B')
      ORDER BY l.icp_priority ASC, l.icp_score DESC
      LIMIT ?
    `).all(remaining);

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];

      // Re-check bounce rate before every send (Non-negotiable Rule 5)
      if (todayBounceRate() > bounceThreshold) {
        await sendAlert('BOUNCE RATE exceeded threshold mid-session - aborting');
        break;
      }

      // Re-check daily limit
      if (todaySentCount() >= dailyLimit) break;

      // Skip leads in reject list
      if (isRejected(item.contact_email)) continue;

      bumpMetric('emails_attempted');

      // Non-negotiable Rule 4: contentValidator runs before every sendMail call
      let emailSubject = item.email_subject;
      let emailBody = item.email_body;
      let regenerated = 0;

      const validation = validate(emailSubject, emailBody, 0);
      if (!validation.valid) {
        // Regenerate once on content validation failure
        try {
          const { text: newBody, costUsd } = await callClaude('haiku',
            `Write a cold email from Darshan Parmar (Full-Stack Developer, Simple Inc) to ${item.contact_name || item.owner_name || 'the owner'} at ${item.business_name}.

Hook to open with: "${item.hook}"

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
          totalCost += costUsd;
          // Note: callClaude already writes haiku_cost_usd to daily_metrics — no bumpMetric needed

          const retryValidation = validate(emailSubject, newBody, 0);
          if (!retryValidation.valid) {
            // Second fail → skip lead, log content_rejected
            logError('sendEmails.validation', new Error(`Content rejected for lead ${item.id}: ${retryValidation.reason}`), { jobName: 'sendEmails', errorType: 'validation_error', leadId: item.id });
            db.prepare(`UPDATE emails SET status='content_rejected', content_valid=0, validation_fail_reason=? WHERE id=?`).run(retryValidation.reason, item.email_id);
            db.prepare(`UPDATE leads SET status='content_rejected' WHERE id=?`).run(item.id);
            bumpMetric('emails_content_rejected');
            continue;
          }
          emailBody = newBody;
          regenerated = 1;
        } catch (regenErr) {
          logError('sendEmails.regenerate', regenErr, { jobName: 'sendEmails', leadId: item.id });
          db.prepare(`UPDATE emails SET status='content_rejected', content_valid=0, validation_fail_reason=? WHERE id=?`).run(validation.reason, item.email_id);
          bumpMetric('emails_content_rejected');
          continue;
        }
      }

      // Round-robin inbox
      const currentSent = todaySentCount();
      const inboxNumber = (currentSent % 2) + 1;
      const inboxUser = getInboxUser(inboxNumber);

      // Non-negotiable Rule 13: assert outreach domain
      const domain = process.env.OUTREACH_DOMAIN || 'trysimpleinc.com';
      if (!inboxUser?.endsWith(`@${domain}`)) {
        logError('sendEmails.domainAssert', new Error(`Inbox ${inboxNumber} not on ${domain}`), { jobName: 'sendEmails', errorType: 'validation_error' });
        break;
      }

      try {
        const sendStart = Date.now();
        const { messageId } = await sendMail(inboxNumber, {
          to: item.contact_email,
          subject: emailSubject,
          text: emailBody
        });
        const sendDuration = Date.now() - sendStart;

        // Update the pre-generated email record
        db.prepare(`
          UPDATE emails SET
            inbox_used=?, from_domain=?, from_name='Darshan Parmar',
            body=?, word_count=?, content_valid=1, regenerated=?,
            status='sent', sent_at=datetime('now'), message_id=?, send_duration_ms=?
          WHERE id=?
        `).run(
          inboxUser, domain, emailBody,
          emailBody.trim().split(/\s+/).filter(Boolean).length,
          regenerated, messageId, sendDuration, item.email_id
        );

        // Update lead status + domain_last_contacted
        db.prepare(`UPDATE leads SET status='sent', domain_last_contacted=datetime('now') WHERE id=?`).run(item.id);

        // Initialise sequence_state for follow-ups
        db.prepare(`
          INSERT OR REPLACE INTO sequence_state (lead_id, current_step, next_send_date, last_sent_at, last_message_id, last_subject, status, updated_at)
          VALUES (?, 0, date('now', '+3 days'), datetime('now'), ?, ?, 'active', datetime('now'))
        `).run(item.id, messageId, emailSubject);

        // Bump daily metrics
        bumpMetric('emails_sent');
        if (inboxNumber === 1) bumpMetric('sent_inbox_1');
        else bumpMetric('sent_inbox_2');

        emailsSent++;
        totalCost += (item.email_cost || 0);

        // Delay between sends (except after the last one)
        if (i < queue.length - 1) {
          await sleep(delayMin, delayMax);
        }
      } catch (sendErr) {
        logError('sendEmails.send', sendErr, { jobName: 'sendEmails', errorType: 'smtp_error', leadId: item.id, emailId: item.email_id });

        const smtpCode = sendErr.responseCode || 0;
        if (smtpCode >= 500 && smtpCode < 600) {
          db.prepare(`
            UPDATE emails SET status='hard_bounce', smtp_code=?, smtp_response=?, sent_at=datetime('now'), inbox_used=?, from_domain=?
            WHERE id=?
          `).run(smtpCode, sendErr.message, inboxUser, domain, item.email_id);

          db.prepare(`
            INSERT INTO bounces (email_id, lead_id, bounce_type, smtp_code, smtp_message)
            VALUES (?, ?, 'hard', ?, ?)
          `).run(item.email_id, item.id, smtpCode, sendErr.message);

          addToRejectList(item.contact_email, 'hard_bounce');
          db.prepare(`UPDATE leads SET status='bounced' WHERE id=?`).run(item.id);
          bumpMetric('emails_hard_bounced');
        } else if (smtpCode >= 400 && smtpCode < 500) {
          db.prepare(`
            UPDATE emails SET status='soft_bounce', smtp_code=?, smtp_response=?
            WHERE id=?
          `).run(smtpCode, sendErr.message, item.email_id);

          db.prepare(`
            INSERT INTO bounces (email_id, lead_id, bounce_type, smtp_code, smtp_message, retry_after)
            VALUES (?, ?, 'soft', ?, ?, datetime('now', '+1 day'))
          `).run(item.email_id, item.id, smtpCode, sendErr.message);

          bumpMetric('emails_soft_bounced');
        }
      }
    }

    finishCron(cronId, { status: 'success', recordsProcessed: emailsSent, costUsd: totalCost });
    if (emailsSent > 0) {
      await sendAlert(`sendEmails: ${emailsSent} emails sent (cost $${totalCost.toFixed(4)})`);
    }
  } catch (err) {
    logError('sendEmails', err, { jobName: 'sendEmails' });
    finishCron(cronId, { status: 'failed', error: err.message });
    await sendAlert(`sendEmails failed: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  sendEmails().catch(console.error);
}
