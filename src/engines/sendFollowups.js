import 'dotenv/config';
import { getDb, logCron, finishCron, logError, bumpMetric, isRejected, todaySentCount, todayBounceRate, today, getConfigMap, getConfigInt, getConfigFloat, getConfigStr } from '../core/db/index.js';
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
      `Write a very short follow-up email (2-3 sentences, 40-60 words) from ${personaName} to ${lead.contact_name || 'the owner'} at ${lead.business_name}. This is a "just checking if my last email landed" bump. Do not repeat the original pitch. Be casual and human. Plain text only. No links.`,
    2: (lead) =>
      `Write a follow-up email (50-80 words) from ${personaName} to ${lead.contact_name || 'the owner'} at ${lead.business_name}. Share a brief value angle — mention a relevant result like "helped a ${lead.category || 'similar'} business increase bookings by 40% after redesigning their site." Make it conversational, not salesy. Plain text only. A single relevant link is OK if natural.`,
    3: (lead) =>
      `Write a final breakup email (40-50 words) from ${personaName} to ${lead.contact_name || 'the owner'} at ${lead.business_name}. This is the "I'll leave you alone after this" email. Be respectful and brief. Leave the door open. Plain text only. No links.`,
    4: (lead) =>
      `Write a quarterly check-in email (50-80 words) from ${personaName} to ${lead.contact_name || 'the owner'} at ${lead.business_name}. It has been ~3 months since last contact. Reference something seasonal or timely. Reintroduce yourself briefly. Plain text only. No links.`
  };
}

// Days until next step after current step
const NEXT_STEP_DAYS = {
  1: '+4 days',   // step 1 sent at +3d, next is step 2 at +7d total (4 more days)
  2: '+7 days',   // step 2 sent at +7d, next is step 3 at +14d total (7 more days)
  3: '+76 days',  // step 3 sent at +14d, next is step 4 at +90d total (76 more days)
  4: null         // step 4 is the final step — sequence complete
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

export default async function sendFollowups() {
  const cronId = logCron('sendFollowups');
  let emailsSent = 0;
  let totalCost = 0;

  try {
    const cfg = getConfigMap();

    if (!getConfigInt(cfg, 'send_followups_enabled', 1)) {
      finishCron(cronId, { status: 'skipped' });
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
      finishCron(cronId, { status: 'skipped' });
      return;
    }

    // Non-negotiable Rule 6: enforce send window for follow-ups too
    if (!inSendWindow(windowStart, windowEnd)) {
      finishCron(cronId, { status: 'skipped' });
      return;
    }

    if (todayBounceRate() > bounceStop) {
      await sendAlert('sendFollowups: bounce rate exceeded — skipping');
      finishCron(cronId, { status: 'skipped' });
      return;
    }

    const db = getDb();

    // Pull sequences that are due today — use correct column names
    const dueSequences = db.prepare(`
      SELECT ss.*, l.business_name, l.contact_name, l.contact_email, l.category
      FROM sequence_state ss
      JOIN leads l ON l.id = ss.lead_id
      WHERE ss.status = 'active'
        AND ss.next_send_date <= date('now')
        AND ss.current_step < 4
      ORDER BY ss.next_send_date ASC
    `).all();

    for (let i = 0; i < dueSequences.length; i++) {
      const seq = dueSequences[i];
      const nextStep = seq.current_step + 1;

      // Check limits
      if (todaySentCount() >= dailyLimit) break;
      if (todayBounceRate() > bounceStop) break;

      // Skip rejected leads
      if (isRejected(seq.contact_email)) {
        db.prepare(`UPDATE sequence_state SET status='unsubscribed', updated_at=datetime('now') WHERE id=?`).run(seq.id);
        continue;
      }

      // Stop condition: 2+ hard bounces from this domain
      const bounceDomain = seq.contact_email?.split('@')[1];
      if (bounceDomain) {
        const domainBounces = db.prepare(`
          SELECT COUNT(*) AS cnt FROM bounces b
          JOIN leads l ON l.id = b.lead_id
          WHERE b.bounce_type = 'hard' AND l.contact_email LIKE ?
        `).get(`%@${bounceDomain}`);
        if (domainBounces.cnt >= 2) {
          db.prepare(`UPDATE sequence_state SET status='paused', paused_reason='domain_bounces', updated_at=datetime('now') WHERE id=?`).run(seq.id);
          continue;
        }
      }

      try {
        // Generate follow-up body via Claude Haiku
        const promptFn = STEP_PROMPTS[nextStep];
        if (!promptFn) continue;

        const { text: body, costUsd, model: bodyModelId } = await callClaude('haiku', promptFn(seq), { maxTokens: 200 });
        totalCost += costUsd;
        // Note: callClaude already writes haiku_cost_usd to daily_metrics — no bumpMetric needed

        // Determine subject and threading (Non-negotiable Rule 9)
        let subject;
        let inReplyTo = null;
        let referencesHeader = null;

        if (nextStep <= 3) {
          // Steps 1-3: thread reply — "Re: {original subject}"
          subject = `Re: ${seq.last_subject}`;
          inReplyTo = seq.last_message_id;
          // Build references chain from previous emails
          const prevEmails = db.prepare(`
            SELECT message_id FROM emails
            WHERE lead_id = ? AND sequence_step < ? AND message_id IS NOT NULL
            ORDER BY sequence_step ASC
          `).all(seq.lead_id, nextStep);
          referencesHeader = prevEmails.map(e => e.message_id).join(' ');
        } else {
          // Step 4: new thread — fresh subject
          subject = `Checking in — ${seq.business_name}`;
        }

        // Non-negotiable Rule 4: validate content before send
        let finalBody = body;
        const validation = validate(subject, body, nextStep);
        if (!validation.valid) {
          // Try regenerating once
          const { text: retryBody, costUsd: retryCost } = await callClaude('haiku', promptFn(seq), { maxTokens: 200 });
          totalCost += retryCost;
          // Note: callClaude already writes haiku_cost_usd to daily_metrics
          const retryValidation = validate(subject, retryBody, nextStep);
          if (!retryValidation.valid) {
            logError('sendFollowups.validation', new Error(`Content rejected for lead ${seq.lead_id} step ${nextStep}: ${retryValidation.reason}`), { jobName: 'sendFollowups', errorType: 'validation_error', leadId: seq.lead_id });
            continue;
          }
          finalBody = retryBody;
        }

        // Round-robin inbox
        const currentSent = todaySentCount();
        const inboxNumber = (currentSent % 2) + 1;
        const inboxUser = inboxNumber === 1 ? process.env.INBOX_1_USER : process.env.INBOX_2_USER;
        const domain = process.env.OUTREACH_DOMAIN || 'trysimpleinc.com';

        // Non-negotiable Rule 13: assert outreach domain before send
        if (!inboxUser?.endsWith(`@${domain}`)) {
          logError('sendFollowups.domainAssert', new Error(`Inbox ${inboxNumber} not on ${domain}`), { jobName: 'sendFollowups', errorType: 'validation_error' });
          break;
        }

        const sendStart = Date.now();
        const { messageId } = await sendMail(inboxNumber, {
          to: seq.contact_email,
          subject,
          text: finalBody,
          ...(inReplyTo ? { inReplyTo, references: referencesHeader } : {})
        });
        const sendDuration = Date.now() - sendStart;

        // Insert email record with full spec columns
        db.prepare(`
          INSERT INTO emails (
            lead_id, sequence_step, inbox_used, from_domain, from_name,
            subject, body, word_count, contains_link, is_html, is_plain_text,
            content_valid, status, sent_at, message_id, send_duration_ms,
            in_reply_to, references_header,
            body_model, body_cost_usd, total_cost_usd
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, 'sent', datetime('now'), ?, ?, ?, ?, ?, ?, ?)
        `).run(
          seq.lead_id, nextStep, inboxUser, domain, personaName,
          subject, finalBody, finalBody.trim().split(/\s+/).filter(Boolean).length,
          /https?:\/\//i.test(finalBody) ? 1 : 0,
          messageId, sendDuration, inReplyTo, referencesHeader,
          bodyModelId, costUsd, costUsd
        );

        // Update sequence_state with correct column names
        const nextDays = NEXT_STEP_DAYS[nextStep];
        if (nextDays) {
          db.prepare(`
            UPDATE sequence_state
            SET current_step=?, next_send_date=date('now', ?), last_sent_at=datetime('now'), last_message_id=?, last_subject=?, updated_at=datetime('now')
            WHERE id=?
          `).run(nextStep, nextDays, messageId, nextStep <= 3 ? seq.last_subject : subject, seq.id);
        } else {
          // Sequence complete
          db.prepare(`
            UPDATE sequence_state
            SET current_step=?, status='completed', last_sent_at=datetime('now'), updated_at=datetime('now')
            WHERE id=?
          `).run(nextStep, seq.id);
        }

        bumpMetric('emails_sent');
        bumpMetric('followups_sent');
        if (inboxNumber === 1) bumpMetric('sent_inbox_1');
        else bumpMetric('sent_inbox_2');
        emailsSent++;

        // Delay between sends
        if (i < dueSequences.length - 1) {
          await sleep(delayMin, delayMax);
        }
      } catch (sendErr) {
        logError('sendFollowups.send', sendErr, { jobName: 'sendFollowups', errorType: 'smtp_error', leadId: seq.lead_id });
      }
    }

    finishCron(cronId, { status: 'success', recordsProcessed: emailsSent, costUsd: totalCost });
    if (emailsSent > 0) {
      await sendAlert(`sendFollowups: ${emailsSent} follow-ups sent (cost $${totalCost.toFixed(4)})`);
    }
  } catch (err) {
    logError('sendFollowups', err, { jobName: 'sendFollowups' });
    finishCron(cronId, { status: 'failed', error: err.message });
    await sendAlert(`sendFollowups failed: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  sendFollowups().catch(console.error);
}
