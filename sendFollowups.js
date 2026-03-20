import 'dotenv/config';
import { getDb, logCron, finishCron, logError, bumpMetric, isRejected, todaySentCount, todayBounceRate, today } from './utils/db.js';
import { sendMail } from './utils/mailer.js';
import { callClaude } from './utils/claude.js';
import { validate } from './utils/contentValidator.js';
import { sendAlert } from './utils/telegram.js';
import { sleep } from './utils/sleep.js';

// ── Sequence steps ───────────────────────────────────────
// Step 0: Day 0 — cold (already sent by sendEmails.js)
// Step 1: +3 days — short bump "just checking if this landed"
// Step 2: +7 days — value angle, mini case study
// Step 3: +14 days — breakup "I'll leave you alone after this"
// Step 4: +90 days — quarterly nurture, new thread

const STEP_PROMPTS = {
  1: (lead) =>
    `Write a very short follow-up email (2-3 sentences, under 50 words) from Darshan Parmar to ${lead.contact_name || 'the owner'} at ${lead.company}. This is a "just checking if my last email landed" bump. Do not repeat the original pitch. Be casual and human. Plain text only. No links.`,
  2: (lead) =>
    `Write a follow-up email (50-80 words) from Darshan Parmar to ${lead.contact_name || 'the owner'} at ${lead.company}. Share a brief value angle — mention a relevant result like "helped a ${lead.niche || 'similar'} business increase bookings by 40% after redesigning their site." Make it conversational, not salesy. Plain text only. A single relevant link is OK if natural.`,
  3: (lead) =>
    `Write a final breakup email (30-50 words) from Darshan Parmar to ${lead.contact_name || 'the owner'} at ${lead.company}. This is the "I'll leave you alone after this" email. Be respectful and brief. Leave the door open. Plain text only. No links.`,
  4: (lead) =>
    `Write a quarterly check-in email (50-80 words) from Darshan Parmar to ${lead.contact_name || 'the owner'} at ${lead.company}. It has been ~3 months since last contact. Reference something seasonal or timely. Reintroduce yourself briefly. Plain text only. No links.`
};

// Days until next step after current step
const NEXT_STEP_DAYS = {
  1: '+4 days',   // step 1 sent at +3d, next is step 2 at +7d total (4 more days)
  2: '+7 days',   // step 2 sent at +7d, next is step 3 at +14d total (7 more days)
  3: '+76 days',  // step 3 sent at +14d, next is step 4 at +90d total (76 more days)
  4: null         // step 4 is the final step — sequence complete
};

export default async function sendFollowups() {
  const cronId = logCron('sendFollowups');
  let emailsSent = 0;
  let totalCost = 0;

  try {
    const dailyLimit = parseInt(process.env.DAILY_SEND_LIMIT || '0');
    if (dailyLimit === 0) {
      finishCron(cronId, { status: 'ok', emailsSent: 0 });
      return;
    }

    const bounceThreshold = parseFloat(process.env.BOUNCE_RATE_HARD_STOP || '0.02');
    if (todayBounceRate() > bounceThreshold) {
      await sendAlert('sendFollowups: bounce rate exceeded — skipping');
      finishCron(cronId, { status: 'ok', emailsSent: 0 });
      return;
    }

    const db = getDb();

    // Pull sequences that are due today
    const dueSequences = db.prepare(`
      SELECT ss.*, l.company, l.contact_name, l.contact_email, l.niche, l.email_subject, l.hook
      FROM sequence_state ss
      JOIN leads l ON l.id = ss.lead_id
      WHERE ss.status = 'active'
        AND ss.next_send_at <= date('now')
        AND ss.current_step < 4
      ORDER BY ss.next_send_at ASC
    `).all();

    const delayMin = parseInt(process.env.SEND_DELAY_MIN_MS || '180000');
    const delayMax = parseInt(process.env.SEND_DELAY_MAX_MS || '420000');

    for (let i = 0; i < dueSequences.length; i++) {
      const seq = dueSequences[i];
      const nextStep = seq.current_step + 1;

      // Check limits
      if (todaySentCount() >= dailyLimit) break;
      if (todayBounceRate() > bounceThreshold) break;

      // Skip rejected leads
      if (isRejected(seq.contact_email)) {
        db.prepare(`UPDATE sequence_state SET status='unsubscribed', updated_at=datetime('now') WHERE id=?`).run(seq.id);
        continue;
      }

      try {
        // Generate follow-up body via Claude Haiku
        const promptFn = STEP_PROMPTS[nextStep];
        if (!promptFn) continue;

        const { text: body, costUsd } = await callClaude('haiku', promptFn(seq), { maxTokens: 200 });
        totalCost += costUsd;

        // Determine subject and threading
        let subject;
        let inReplyTo = null;
        let references = null;

        if (nextStep <= 3) {
          // Steps 1-3: thread reply — "Re: {original subject}"
          subject = `Re: ${seq.email_subject}`;
          inReplyTo = seq.last_message_id;
          references = seq.last_references
            ? `${seq.last_references} ${seq.last_message_id}`
            : seq.last_message_id;
        } else {
          // Step 4: new thread — fresh subject
          subject = `Checking in — ${seq.company}`;
        }

        // Validate content before send
        let finalBody = body;
        const validation = validate(subject, body, nextStep);
        if (!validation.valid) {
          // Try regenerating once
          const { text: retryBody, costUsd: retryCost } = await callClaude('haiku', promptFn(seq), { maxTokens: 200 });
          totalCost += retryCost;
          const retryValidation = validate(subject, retryBody, nextStep);
          if (!retryValidation.valid) {
            logError('sendFollowups.validation', new Error(`Content rejected for lead ${seq.lead_id} step ${nextStep}: ${retryValidation.reason}`));
            continue;
          }
          finalBody = retryBody;
        }

        // Round-robin inbox
        const currentSent = todaySentCount();
        const inboxNumber = (currentSent % 2) + 1;

        const { messageId } = await sendMail(inboxNumber, {
          to: seq.contact_email,
          subject,
          text: finalBody,
          ...(inReplyTo ? { inReplyTo, references } : {})
        });

        const inboxUser = inboxNumber === 1 ? process.env.INBOX_1_USER : process.env.INBOX_2_USER;

        // Insert email record
        db.prepare(`
          INSERT INTO emails (lead_id, sequence_step, inbox, subject, body, message_id, status, sent_at, ai_cost_usd)
          VALUES (?, ?, ?, ?, ?, ?, 'sent', datetime('now'), ?)
        `).run(seq.lead_id, nextStep, inboxUser, subject, finalBody, messageId, costUsd);

        // Update sequence_state
        const nextDays = NEXT_STEP_DAYS[nextStep];
        if (nextDays) {
          // More steps to come
          const newReferences = references ? `${references} ${messageId}` : messageId;
          db.prepare(`
            UPDATE sequence_state
            SET current_step = ?, next_send_at = date('now', ?), last_message_id = ?, last_references = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(nextStep, nextDays, messageId, newReferences, seq.id);
        } else {
          // Sequence complete (step 4 was the last)
          db.prepare(`
            UPDATE sequence_state
            SET current_step = ?, status = 'completed', updated_at = datetime('now')
            WHERE id = ?
          `).run(nextStep, seq.id);
        }

        bumpMetric('emails_sent');
        emailsSent++;

        // Delay between sends
        if (i < dueSequences.length - 1) {
          await sleep(delayMin, delayMax);
        }
      } catch (sendErr) {
        logError('sendFollowups.send', sendErr);
      }
    }

    finishCron(cronId, { status: 'ok', emailsSent, costUsd: totalCost });
    if (emailsSent > 0) {
      await sendAlert(`sendFollowups: ${emailsSent} follow-ups sent (cost $${totalCost.toFixed(4)})`);
    }
  } catch (err) {
    logError('sendFollowups', err);
    finishCron(cronId, { status: 'error', error: err.message });
    await sendAlert(`sendFollowups failed: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  sendFollowups().catch(console.error);
}
