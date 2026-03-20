import 'dotenv/config';
import { getDb, logCron, finishCron, logError, bumpMetric, addToRejectList, today } from './utils/db.js';
import { fetchUnseen } from './utils/imap.js';
import { callClaude } from './utils/claude.js';
import { sendAlert } from './utils/telegram.js';

// ── Classification prompt ────────────────────────────────
function classifyPrompt(text, subject) {
  return `Classify this email reply into exactly one category and rate sentiment 1-5 (1=very negative, 5=very positive). Reply with JSON only: {"category": "...", "sentiment": N}

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

JSON:`;
}

// ── Actions per classification ───────────────────────────
async function handleClassification(db, category, lead, replyId) {
  let alerted = false;

  switch (category) {
    case 'hot': {
      db.prepare(`UPDATE leads SET status='replied' WHERE id=?`).run(lead.id);
      db.prepare(`UPDATE sequence_state SET status='replied', updated_at=datetime('now') WHERE lead_id=?`).run(lead.id);
      await sendAlert(`Hot lead: ${lead.contact_name || lead.business_name} — ${lead.business_name} (${lead.contact_email})`);
      alerted = true;
      bumpMetric('replies_hot');
      break;
    }
    case 'schedule': {
      db.prepare(`UPDATE leads SET status='replied' WHERE id=?`).run(lead.id);
      db.prepare(`UPDATE sequence_state SET status='replied', updated_at=datetime('now') WHERE lead_id=?`).run(lead.id);
      await sendAlert(`Wants to schedule: ${lead.contact_name || lead.business_name} — ${lead.business_name} (${lead.contact_email})`);
      alerted = true;
      bumpMetric('replies_schedule');
      break;
    }
    case 'soft_no': {
      db.prepare(`UPDATE leads SET status='replied' WHERE id=?`).run(lead.id);
      db.prepare(`
        UPDATE sequence_state SET status='paused', next_send_date=date('now', '+14 days'), updated_at=datetime('now') WHERE lead_id=?
      `).run(lead.id);
      db.prepare(`UPDATE replies SET requeue_date=date('now', '+14 days') WHERE id=?`).run(replyId);
      bumpMetric('replies_soft_no');
      break;
    }
    case 'unsubscribe': {
      addToRejectList(lead.contact_email, 'unsubscribe');
      db.prepare(`UPDATE leads SET status='unsubscribed' WHERE id=?`).run(lead.id);
      db.prepare(`UPDATE sequence_state SET status='unsubscribed', updated_at=datetime('now') WHERE lead_id=?`).run(lead.id);
      await sendAlert(`Unsubscribed: ${lead.contact_email} (${lead.business_name})`);
      alerted = true;
      bumpMetric('replies_unsubscribe');
      break;
    }
    case 'ooo': {
      db.prepare(`
        UPDATE sequence_state SET next_send_date=date('now', '+5 days'), updated_at=datetime('now') WHERE lead_id=?
      `).run(lead.id);
      db.prepare(`UPDATE replies SET requeue_date=date('now', '+5 days') WHERE id=?`).run(replyId);
      bumpMetric('replies_ooo');
      break;
    }
    default: {
      bumpMetric('replies_other');
      break;
    }
  }

  // Set telegram_alerted flag on the reply
  if (alerted) {
    db.prepare(`UPDATE replies SET telegram_alerted=1 WHERE id=?`).run(replyId);
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
        logError(`checkReplies.imap.inbox${inboxNumber}`, imapErr, { jobName: 'checkReplies', errorType: 'api_error' });
        continue;
      }

      const inboxUser = inboxNumber === 1 ? process.env.INBOX_1_USER : process.env.INBOX_2_USER;

      for (const msg of messages) {
        try {
          // Match sender to a lead
          const lead = db.prepare(`SELECT * FROM leads WHERE contact_email = ?`).get(msg.from);
          if (!lead) continue; // Not from a known lead — skip

          // Find matching email we sent (for email_id reference)
          const sentEmail = db.prepare(`
            SELECT id FROM emails WHERE lead_id = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 1
          `).get(lead.id);

          // Skip already-processed replies (dedup by lead_id + raw_text)
          const existing = db.prepare(`SELECT id FROM replies WHERE lead_id=? AND raw_text=?`).get(lead.id, msg.text);
          if (existing) continue;

          // Classify via Claude Haiku
          const { text: rawJson, costUsd, model } = await callClaude('haiku', classifyPrompt(msg.text, msg.subject), { maxTokens: 30 });
          totalCost += costUsd;
          bumpMetric('haiku_cost_usd', costUsd);

          // Parse classification result
          let category = 'other';
          let sentimentScore = 3;
          try {
            const parsed = JSON.parse(rawJson.trim());
            category = parsed.category || 'other';
            sentimentScore = parsed.sentiment || 3;
          } catch {
            // Fallback: try to extract just the category word
            const cleaned = rawJson.trim().toLowerCase().replace(/[^a-z_]/g, '');
            const validCategories = ['hot', 'schedule', 'soft_no', 'unsubscribe', 'ooo', 'other'];
            category = validCategories.includes(cleaned) ? cleaned : 'other';
          }

          // Insert reply record with full spec columns
          const replyRow = db.prepare(`
            INSERT INTO replies (
              lead_id, email_id, inbox_received_at, received_at,
              category, raw_text, classification_model, classification_cost_usd,
              sentiment_score, telegram_alerted
            ) VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, 0) RETURNING id
          `).get(
            lead.id, sentEmail?.id || null, inboxUser,
            category, msg.text, model || 'claude-haiku-4-5', costUsd,
            sentimentScore
          );

          // Bump metrics
          bumpMetric('replies_total');

          // Handle classification actions (includes telegram_alerted update)
          await handleClassification(db, category, lead, replyRow.id);

          repliesProcessed++;
        } catch (msgErr) {
          logError('checkReplies.message', msgErr, { jobName: 'checkReplies' });
        }
      }
    }

    finishCron(cronId, { status: 'success', recordsProcessed: repliesProcessed, costUsd: totalCost });
    if (repliesProcessed > 0) {
      await sendAlert(`checkReplies: ${repliesProcessed} replies processed (cost $${totalCost.toFixed(4)})`);
    }
  } catch (err) {
    logError('checkReplies', err, { jobName: 'checkReplies' });
    finishCron(cronId, { status: 'failed', error: err.message });
    await sendAlert(`checkReplies failed: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  checkReplies().catch(console.error);
}
