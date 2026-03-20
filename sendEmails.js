import 'dotenv/config';
import { getDb, logCron, finishCron, logError, bumpMetric, isRejected, todaySentCount, todayBounceRate, today } from './utils/db.js';
import { verifyConnections, sendMail } from './utils/mailer.js';
import { validate } from './utils/contentValidator.js';
import { sendAlert } from './utils/telegram.js';
import { sleep } from './utils/sleep.js';

// ── Indian holidays (MM-DD) ──────────────────────────────
const HOLIDAYS = ['01-26', '08-15', '10-02'];

function isHoliday(istDate) {
  const mmdd = String(istDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
               String(istDate.getUTCDate()).padStart(2, '0');
  return HOLIDAYS.includes(mmdd);
}

function inSendWindow() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const day = ist.getUTCDay();
  if (day === 0) return false; // No Sunday
  if (isHoliday(ist)) return false;
  const hour = ist.getUTCHours();
  const start = parseInt(process.env.SEND_WINDOW_START_IST || '9');
  const end = parseInt(process.env.SEND_WINDOW_END_IST || '17');
  return hour >= start && hour < end;
}

function getInboxUser(inboxNumber) {
  return inboxNumber === 1 ? process.env.INBOX_1_USER : process.env.INBOX_2_USER;
}

export default async function sendEmails() {
  const cronId = logCron('sendEmails');
  let emailsSent = 0;
  let totalCost = 0;

  try {
    // ── Pre-flight checks ────────────────────────────────
    const dailyLimit = parseInt(process.env.DAILY_SEND_LIMIT || '0');
    if (dailyLimit === 0) {
      finishCron(cronId, { status: 'ok', emailsSent: 0 });
      return;
    }

    if (!inSendWindow()) {
      finishCron(cronId, { status: 'ok', emailsSent: 0 });
      return;
    }

    // Verify SMTP connections
    await verifyConnections();

    // Check bounce rate before sending
    const bounceThreshold = parseFloat(process.env.BOUNCE_RATE_HARD_STOP || '0.02');
    if (todayBounceRate() > bounceThreshold) {
      await sendAlert('BOUNCE RATE exceeded threshold - sending paused');
      finishCron(cronId, { status: 'ok', emailsSent: 0 });
      return;
    }

    // ── Pull ready leads ─────────────────────────────────
    const alreadySent = todaySentCount();
    const remaining = dailyLimit - alreadySent;
    if (remaining <= 0) {
      finishCron(cronId, { status: 'ok', emailsSent: 0 });
      return;
    }

    const db = getDb();
    const leads = db.prepare(`
      SELECT * FROM leads
      WHERE status = 'ready'
        AND icp_priority IN ('A', 'B')
      ORDER BY icp_priority ASC, icp_score DESC
      LIMIT ?
    `).all(remaining);

    const delayMin = parseInt(process.env.SEND_DELAY_MIN_MS || '180000');
    const delayMax = parseInt(process.env.SEND_DELAY_MAX_MS || '420000');

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];

      // Re-check bounce rate before every send
      if (todayBounceRate() > bounceThreshold) {
        await sendAlert('BOUNCE RATE exceeded threshold mid-session - aborting');
        break;
      }

      // Re-check daily limit (in case another process also sent)
      if (todaySentCount() >= dailyLimit) break;

      // Skip leads in reject list
      if (isRejected(lead.contact_email)) continue;

      // Validate content before send
      const validation = validate(lead.email_subject, lead.email_body, 0);
      if (!validation.valid) {
        logError('sendEmails.validation', new Error(`Content rejected for lead ${lead.id}: ${validation.reason}`));
        db.prepare(`UPDATE leads SET status='content_rejected' WHERE id=?`).run(lead.id);
        continue;
      }

      // Round-robin inbox: alternate based on today's total sent count
      const currentSent = todaySentCount();
      const inboxNumber = (currentSent % 2) + 1;
      const inboxUser = getInboxUser(inboxNumber);

      // Non-negotiable: assert outreach domain
      const domain = process.env.OUTREACH_DOMAIN || 'trysimpleinc.com';
      if (!inboxUser?.endsWith(`@${domain}`)) {
        logError('sendEmails.domainAssert', new Error(`Inbox ${inboxNumber} not on ${domain}`));
        break;
      }

      try {
        const sendStart = Date.now();
        const { messageId } = await sendMail(inboxNumber, {
          to: lead.contact_email,
          subject: lead.email_subject,
          text: lead.email_body
        });
        const sendDuration = Date.now() - sendStart;

        // Insert into emails table
        db.prepare(`
          INSERT INTO emails (lead_id, sequence_step, inbox, subject, body, message_id, status, sent_at, ai_cost_usd)
          VALUES (?, 0, ?, ?, ?, ?, 'sent', datetime('now'), ?)
        `).run(lead.id, inboxUser, lead.email_subject, lead.email_body, messageId, lead.hook_cost_usd + lead.body_cost_usd);

        // Update lead status
        db.prepare(`UPDATE leads SET status='contacted', updated_at=datetime('now') WHERE id=?`).run(lead.id);

        // Initialise sequence_state for follow-ups
        // next_send_at = 3 days from now (step 1: +3d bump)
        db.prepare(`
          INSERT OR REPLACE INTO sequence_state (lead_id, current_step, next_send_at, last_message_id, status, updated_at)
          VALUES (?, 0, date('now', '+3 days'), ?, 'active', datetime('now'))
        `).run(lead.id, messageId);

        // Bump daily metrics
        bumpMetric('emails_sent');

        emailsSent++;
        totalCost += (lead.hook_cost_usd || 0) + (lead.body_cost_usd || 0);

        // Delay between sends (except after the last one)
        if (i < leads.length - 1) {
          await sleep(delayMin, delayMax);
        }
      } catch (sendErr) {
        logError('sendEmails.send', sendErr);

        // Check for hard bounce (5xx SMTP)
        const smtpCode = sendErr.responseCode || 0;
        if (smtpCode >= 500 && smtpCode < 600) {
          // Hard bounce
          const emailRow = db.prepare(`
            INSERT INTO emails (lead_id, sequence_step, inbox, subject, body, status, sent_at)
            VALUES (?, 0, ?, ?, ?, 'hard_bounce', datetime('now')) RETURNING id
          `).get(lead.id, inboxUser, lead.email_subject, lead.email_body);

          db.prepare(`
            INSERT INTO bounces (email_id, lead_id, bounce_type, raw_error)
            VALUES (?, ?, 'hard', ?)
          `).run(emailRow.id, lead.id, sendErr.message);

          // Add to reject list
          const { addToRejectList } = await import('./utils/db.js');
          addToRejectList(lead.contact_email, 'hard_bounce');

          db.prepare(`UPDATE leads SET status='bounced' WHERE id=?`).run(lead.id);
          bumpMetric('bounces');
        } else if (smtpCode >= 400 && smtpCode < 500) {
          // Soft bounce — retry later
          db.prepare(`
            INSERT INTO emails (lead_id, sequence_step, inbox, subject, body, status)
            VALUES (?, 0, ?, ?, ?, 'soft_bounce')
          `).run(lead.id, inboxUser, lead.email_subject, lead.email_body);

          db.prepare(`
            INSERT INTO bounces (email_id, lead_id, bounce_type, raw_error)
            VALUES (last_insert_rowid(), ?, 'soft', ?)
          `).run(lead.id, sendErr.message);

          bumpMetric('bounces');
        }
      }
    }

    finishCron(cronId, { status: 'ok', emailsSent, costUsd: totalCost });
    if (emailsSent > 0) {
      await sendAlert(`sendEmails: ${emailsSent} emails sent (cost $${totalCost.toFixed(4)})`);
    }
  } catch (err) {
    logError('sendEmails', err);
    finishCron(cronId, { status: 'error', error: err.message });
    await sendAlert(`sendEmails failed: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  sendEmails().catch(console.error);
}
