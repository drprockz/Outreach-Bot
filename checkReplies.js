import 'dotenv/config';
import { getDb, logCron, finishCron, logError, bumpMetric, addToRejectList, today } from './utils/db.js';
import { fetchUnseen } from './utils/imap.js';
import { callClaude } from './utils/claude.js';
import { sendAlert } from './utils/telegram.js';

// ── Classification prompt ────────────────────────────────
function classifyPrompt(text, subject) {
  return `Classify this email reply into exactly one category. Reply with ONLY the category word, nothing else.

Categories:
- hot (interested, wants to learn more, asks about pricing/services)
- schedule (wants to schedule a call/meeting)
- soft_no (not interested right now but polite, "maybe later")
- unsubscribe (wants to be removed, angry, "stop emailing me")
- ooo (out of office auto-reply)
- other (irrelevant, spam, or cannot determine)

Subject: ${subject}
Reply text:
${text}

Category:`;
}

// ── Actions per classification ───────────────────────────
async function handleClassification(db, classification, lead, reply) {
  switch (classification) {
    case 'hot':
    case 'schedule': {
      // Update lead status
      db.prepare(`UPDATE leads SET status='replied', updated_at=datetime('now') WHERE id=?`).run(lead.id);
      // Stop sequence
      db.prepare(`UPDATE sequence_state SET status='replied', updated_at=datetime('now') WHERE lead_id=?`).run(lead.id);
      // Telegram alert
      const emoji = classification === 'hot' ? 'Hot lead' : 'Wants to schedule';
      await sendAlert(`${emoji}: ${lead.contact_name || lead.company} — ${lead.company} (${lead.contact_email})`);
      bumpMetric('hot_replies');
      break;
    }
    case 'soft_no': {
      // Pause sequence, re-queue +14 days
      db.prepare(`UPDATE leads SET status='replied', updated_at=datetime('now') WHERE id=?`).run(lead.id);
      db.prepare(`
        UPDATE sequence_state SET status='paused', next_send_at=date('now', '+14 days'), updated_at=datetime('now') WHERE lead_id=?
      `).run(lead.id);
      break;
    }
    case 'unsubscribe': {
      // Add to reject list permanently
      addToRejectList(lead.contact_email, 'unsubscribe');
      db.prepare(`UPDATE leads SET status='unsubscribed', updated_at=datetime('now') WHERE id=?`).run(lead.id);
      db.prepare(`UPDATE sequence_state SET status='unsubscribed', updated_at=datetime('now') WHERE lead_id=?`).run(lead.id);
      await sendAlert(`Unsubscribed: ${lead.contact_email} (${lead.company})`);
      break;
    }
    case 'ooo': {
      // Re-queue +5 days
      db.prepare(`
        UPDATE sequence_state SET next_send_at=date('now', '+5 days'), updated_at=datetime('now') WHERE lead_id=?
      `).run(lead.id);
      break;
    }
    default: {
      // 'other' — log only, no action
      break;
    }
  }
}

export default async function checkReplies() {
  const cronId = logCron('checkReplies');
  let repliesProcessed = 0;
  let totalCost = 0;

  try {
    const db = getDb();

    // Check both inboxes
    for (const inboxNumber of [1, 2]) {
      let messages;
      try {
        messages = await fetchUnseen(inboxNumber);
      } catch (imapErr) {
        logError(`checkReplies.imap.inbox${inboxNumber}`, imapErr);
        continue;
      }

      const inboxUser = inboxNumber === 1 ? process.env.INBOX_1_USER : process.env.INBOX_2_USER;

      for (const msg of messages) {
        try {
          // Match sender to a lead
          const lead = db.prepare(`SELECT * FROM leads WHERE contact_email = ?`).get(msg.from);
          if (!lead) continue; // Not from a known lead — skip

          // Skip already-processed replies (by messageId)
          const existing = db.prepare(`SELECT id FROM replies WHERE lead_id=? AND subject=? AND body=?`).get(lead.id, msg.subject, msg.text);
          if (existing) continue;

          // Classify via Claude Haiku
          const { text: rawCategory, costUsd } = await callClaude('haiku', classifyPrompt(msg.text, msg.subject), { maxTokens: 10 });
          totalCost += costUsd;

          // Normalize classification
          const classification = rawCategory.trim().toLowerCase().replace(/[^a-z_]/g, '');
          const validCategories = ['hot', 'schedule', 'soft_no', 'unsubscribe', 'ooo', 'other'];
          const finalClassification = validCategories.includes(classification) ? classification : 'other';

          // Insert reply record
          db.prepare(`
            INSERT INTO replies (lead_id, inbox, subject, body, classification, classify_cost_usd, received_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(lead.id, inboxUser, msg.subject, msg.text, finalClassification, costUsd);

          // Bump metrics
          bumpMetric('replies');

          // Handle classification actions
          await handleClassification(db, finalClassification, lead, msg);

          repliesProcessed++;
        } catch (msgErr) {
          logError('checkReplies.message', msgErr);
        }
      }
    }

    finishCron(cronId, { status: 'ok', emailsSent: repliesProcessed, costUsd: totalCost });
    if (repliesProcessed > 0) {
      await sendAlert(`checkReplies: ${repliesProcessed} replies processed (cost $${totalCost.toFixed(4)})`);
    }
  } catch (err) {
    logError('checkReplies', err);
    finishCron(cronId, { status: 'error', error: err.message });
    await sendAlert(`checkReplies failed: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  checkReplies().catch(console.error);
}
