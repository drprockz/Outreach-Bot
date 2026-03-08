import { fetchUnseenEmails } from '../lib/imap.js';
import { classifyReply, generateAlert } from '../lib/claude.js';
import { sendHtmlEmail } from '../lib/mailer.js';
import {
  findEmailBySenderSubject,
  getLeadByEmail,
  insertReply,
  markReplyAlerted,
  updatePipelineStatus,
  upsertPipeline,
} from '../../db/database.js';
import logger from '../lib/logger.js';

export async function runCheckReplies() {
  logger.info('Starting reply check...');

  let emails;
  try {
    emails = await fetchUnseenEmails();
  } catch (err) {
    logger.error(`Failed to fetch emails: ${err.message}`);
    return;
  }

  if (emails.length === 0) {
    logger.info('No new replies found');
    return;
  }

  for (const email of emails) {
    try {
      const lead = getLeadByEmail(email.from);
      if (!lead) {
        logger.info(`Reply from unknown sender: ${email.from} — skipping`);
        continue;
      }

      const originalEmail = findEmailBySenderSubject(email.from, email.subject);
      const classification = await classifyReply(email.from, email.subject, email.text);
      logger.info(`Reply from ${email.from} classified as: ${classification.classification}`);

      // Store reply with summary
      const replyResult = insertReply({
        email_id: originalEmail?.id || null,
        lead_id: lead.id,
        received_at: email.date.toISOString(),
        raw_subject: email.subject,
        raw_body: email.text,
        classification: classification.classification,
        summary: classification.summary || null,
      });
      const replyId = replyResult.lastInsertRowid;

      switch (classification.classification) {
        case 'hot':
          updatePipelineStatus(lead.id, 'hot', classification.summary);
          await sendAlertEmail(classification, lead, email, originalEmail, replyId);
          break;

        case 'schedule':
          updatePipelineStatus(lead.id, 'schedule', classification.summary);
          await sendAlertEmail(classification, lead, email, originalEmail, replyId);
          break;

        case 'soft': {
          const softFollowup = new Date();
          softFollowup.setDate(softFollowup.getDate() + 14);
          upsertPipeline({
            lead_id: lead.id,
            status: 'soft',
            last_contacted_at: null,
            next_followup_at: softFollowup.toISOString(),
            next_followup_sequence: 3,
            notes: classification.summary,
          });
          break;
        }

        case 'unsubscribe':
          updatePipelineStatus(lead.id, 'rejected', 'Unsubscribe request');
          logger.info(`Lead ${lead.name} unsubscribed — marked as rejected`);
          break;

        case 'ooo': {
          // Re-queue original sequence +5 days — preserve the sequence number
          const oooFollowup = new Date();
          oooFollowup.setDate(oooFollowup.getDate() + 5);
          const currentSequence = originalEmail?.sequence || 1;
          upsertPipeline({
            lead_id: lead.id,
            status: 'contacted',
            last_contacted_at: null,
            next_followup_at: oooFollowup.toISOString(),
            next_followup_sequence: currentSequence,
            notes: `OOO — re-queued seq ${currentSequence} for 5 days`,
          });
          break;
        }

        default:
          logger.info(`Reply from ${lead.name} classified as 'other' — no action`);
          break;
      }
    } catch (err) {
      logger.error(`Error processing reply from ${email.from}: ${err.message}`);
    }
  }

  logger.info(`Reply check complete. Processed ${emails.length} emails.`);
}

async function sendAlertEmail(classification, lead, incomingEmail, originalEmail, replyId) {
  try {
    const sentDate = originalEmail?.sent_at || 'unknown';
    const sequence = originalEmail?.sequence || 1;

    const alert = await generateAlert(
      classification.classification,
      lead,
      { summary: classification.summary, raw_body: incomingEmail.text },
      sentDate,
      sequence
    );

    if (!alert) {
      logger.warn('Failed to generate alert email');
      return;
    }

    const result = await sendHtmlEmail({
      to: process.env.REPORT_EMAIL,
      subject: alert.subject,
      html: `<pre style="font-family:sans-serif;white-space:pre-wrap;">${alert.body}</pre>`,
    });

    if (result.success) {
      markReplyAlerted(replyId);
      logger.info(`Alert sent for ${classification.classification} lead: ${lead.name}`);
    }
  } catch (err) {
    logger.error(`Failed to send alert for ${lead.name}: ${err.message}`);
  }
}
