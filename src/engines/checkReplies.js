import 'dotenv/config';
import { prisma, runWithOrg, logCron, finishCron, logError, bumpMetric, bumpCostMetric, addToRejectList, getConfigMap, getConfigInt } from '../core/db/index.js';
import { fetchUnseen } from '../core/email/imap.js';
import { callClaude } from '../core/ai/claude.js';
import { callGemini } from '../core/ai/gemini.js';

const ANTHROPIC_DISABLED = process.env.ANTHROPIC_DISABLED === 'true';
import { sendAlert } from '../core/integrations/telegram.js';

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
async function handleClassification(category, lead, replyId) {
  let alerted = false;

  switch (category) {
    case 'hot': {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'replied' } });
      await prisma.sequenceState.updateMany({
        where: { leadId: lead.id },
        data: { status: 'replied' },
      });
      await sendAlert(`🔥 Hot lead: ${lead.contactName || lead.businessName} — ${lead.businessName} (${lead.contactEmail})`);
      alerted = true;
      await bumpMetric('repliesHot');
      break;
    }
    case 'schedule': {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'replied' } });
      await prisma.sequenceState.updateMany({
        where: { leadId: lead.id },
        data: { status: 'replied' },
      });
      await sendAlert(`📅 Wants to schedule: ${lead.contactName || lead.businessName} — ${lead.businessName} (${lead.contactEmail})`);
      alerted = true;
      await bumpMetric('repliesSchedule');
      break;
    }
    case 'soft_no': {
      // Do NOT set lead status='replied' — keep current status so lead remains actionable
      // Keep status='active' but push next_send_date +14 days — sendFollowups date gate handles delay naturally
      const plus14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await prisma.sequenceState.updateMany({
        where: { leadId: lead.id },
        data: { status: 'active', nextSendDate: plus14 },
      });
      await prisma.reply.update({ where: { id: replyId }, data: { requeueDate: plus14 } });
      await bumpMetric('repliesSoftNo');
      break;
    }
    case 'unsubscribe': {
      await addToRejectList(lead.contactEmail, 'unsubscribe');
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'unsubscribed' } });
      await prisma.sequenceState.updateMany({
        where: { leadId: lead.id },
        data: { status: 'unsubscribed' },
      });
      await sendAlert(`🚫 Unsubscribed: ${lead.contactEmail} (${lead.businessName})`);
      alerted = true;
      await bumpMetric('repliesUnsubscribe');
      break;
    }
    case 'ooo': {
      const plus5 = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      await prisma.sequenceState.updateMany({
        where: { leadId: lead.id },
        data: { nextSendDate: plus5 },
      });
      await prisma.reply.update({ where: { id: replyId }, data: { requeueDate: plus5 } });
      await bumpMetric('repliesOoo');
      break;
    }
    default: {
      await bumpMetric('repliesOther');
      break;
    }
  }

  // Set telegram_alerted flag on the reply
  if (alerted) {
    await prisma.reply.update({ where: { id: replyId }, data: { telegramAlerted: true } });
  }
}

export default async function checkReplies(orgId) {
  return runWithOrg(orgId, async () => {
  const cronId = await logCron('checkReplies');
  let repliesProcessed = 0;
  let totalCost = 0;

  try {
    const cfg = await getConfigMap();
    if (!getConfigInt(cfg, 'check_replies_enabled', 1)) {
      await finishCron(cronId, { status: 'skipped' });
      return;
    }

    // Check both inboxes
    for (const inboxNumber of [1, 2]) {
      let messages;
      try {
        messages = await fetchUnseen(inboxNumber);
      } catch (imapErr) {
        await logError(`checkReplies.imap.inbox${inboxNumber}`, imapErr, { jobName: 'checkReplies', errorType: 'api_error' });
        continue;
      }

      for (const msg of messages) {
        try {
          // Match sender to a lead
          const lead = await prisma.lead.findFirst({ where: { contactEmail: msg.from } });
          if (!lead) continue; // Not from a known lead — skip

          // Find matching email we sent (for email_id reference)
          const sentEmail = await prisma.email.findFirst({
            where: { leadId: lead.id, status: 'sent' },
            orderBy: { sentAt: 'desc' },
            select: { id: true },
          });

          // Skip already-processed replies (dedup by lead_id + raw_text)
          const existing = await prisma.reply.findFirst({
            where: { leadId: lead.id, rawText: msg.text },
            select: { id: true },
          });
          if (existing) continue;

          // Classify via Gemini (or Claude Haiku when ANTHROPIC_DISABLED=false)
          let rawJson, costUsd, model;
          if (ANTHROPIC_DISABLED) {
            const result = await callGemini(classifyPrompt(msg.text, msg.subject));
            rawJson = result.text; costUsd = result.costUsd; model = 'gemini-2.5-flash';
            // callGemini doesn't write to daily_metrics — do it here
            await bumpCostMetric('geminiCostUsd', costUsd);
          } else {
            const result = await callClaude('classify', classifyPrompt(msg.text, msg.subject), { maxTokens: 30 });
            rawJson = result.text; costUsd = result.costUsd; model = result.model;
            // callClaude already writes haikuCostUsd to daily_metrics — no bumpMetric needed
          }
          totalCost += costUsd;

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
          // inbox_received_at = timestamp from the email, not the inbox user address
          const replyRow = await prisma.reply.create({
            data: {
              leadId: lead.id,
              emailId: sentEmail?.id || null,
              inboxReceivedAt: msg.date ? msg.date.toISOString() : new Date().toISOString(),
              category,
              rawText: msg.text,
              classificationModel: model || 'claude-haiku-4-5',
              classificationCostUsd: costUsd,
              sentimentScore,
              telegramAlerted: false,
            },
            select: { id: true },
          });

          // Bump metrics
          await bumpMetric('repliesTotal');

          // Handle classification actions (includes telegram_alerted update)
          await handleClassification(category, lead, replyRow.id);

          repliesProcessed++;
        } catch (msgErr) {
          await logError('checkReplies.message', msgErr, { jobName: 'checkReplies' });
        }
      }
    }

    await finishCron(cronId, { status: 'success', recordsProcessed: repliesProcessed, costUsd: totalCost });
    if (repliesProcessed > 0) {
      await sendAlert(`checkReplies: ${repliesProcessed} replies processed (cost $${totalCost.toFixed(4)})`);
    }
  } catch (err) {
    await logError('checkReplies', err, { jobName: 'checkReplies' });
    await finishCron(cronId, { status: 'failed', error: err.message });
    await sendAlert(`checkReplies failed: ${err.message}`);
  }
  });
}

// Run directly if executed as script (single-tenant, falls back to raw client)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  checkReplies(null).catch(console.error);
}
