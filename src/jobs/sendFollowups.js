import { generateEmail } from '../lib/claude.js';
import { sendEmail } from '../lib/mailer.js';
import {
  getDueFollowups,
  getLastEmailForLead,
  insertEmail,
  updateEmailStatus,
  upsertPipeline,
  getTodaysSentCount,
} from '../../db/database.js';
import { randomDelay } from '../utils/delay.js';
import logger from '../lib/logger.js';

function isWithinSendWindow() {
  // Get current time in IST properly
  const now = new Date();
  const istOffset = 5.5 * 60; // IST is UTC+5:30
  const istTime = new Date(now.getTime() + istOffset * 60 * 1000);
  const istHour = istTime.getUTCHours();
  const istDay = istTime.getUTCDay();
  if (istDay === 0) return false;
  if (istHour < 9 || istHour >= 18) return false;
  return true;
}

export async function runSendFollowups() {
  if (!isWithinSendWindow()) {
    logger.info('Outside send window. Skipping follow-ups.');
    return;
  }

  const dailyLimit = parseInt(process.env.DAILY_SEND_LIMIT, 10) || 50;
  if (getTodaysSentCount() >= dailyLimit) {
    logger.info('Daily send limit reached. Skipping follow-ups.');
    return;
  }

  const dueFollowups = getDueFollowups();
  if (dueFollowups.length === 0) {
    logger.info('No follow-ups due');
    return;
  }

  logger.info(`Processing ${dueFollowups.length} due follow-ups`);

  for (const followup of dueFollowups) {
    if (!isWithinSendWindow() || getTodaysSentCount() >= dailyLimit) {
      logger.info('Send window closed or daily limit reached. Stopping follow-ups.');
      break;
    }

    try {
      const sequence = followup.next_followup_sequence;
      const lastEmail = getLastEmailForLead(followup.lead_id);
      const originalSubject = lastEmail?.subject?.replace(/^(Re:\s*)+/i, '') || '';

      const lead = {
        id: followup.lead_id,
        name: followup.name,
        company: followup.company,
        email: followup.email,
        website: followup.website,
        pain_point: followup.pain_point,
        type: followup.type,
      };

      // Generate follow-up email via Claude
      const email = await generateEmail(lead, sequence, originalSubject);
      if (!email) {
        logger.warn(`Failed to generate follow-up ${sequence} for ${lead.name}`);
        continue;
      }

      // Insert email record
      const emailResult = insertEmail({
        lead_id: lead.id,
        sequence,
        subject: email.subject,
        body: email.body,
      });
      const emailId = emailResult.lastInsertRowid;

      // Send via SES (thread the reply using In-Reply-To)
      const sendResult = await sendEmail({
        to: lead.email,
        subject: email.subject,
        body: email.body,
        inReplyTo: lastEmail?.ses_message_id || null,
      });

      if (sendResult.success) {
        updateEmailStatus(emailId, 'sent', sendResult.messageId);

        // Determine next follow-up
        let nextSequence = sequence + 1;
        let nextFollowupAt = null;
        let newStatus = 'contacted';

        if (nextSequence === 3) {
          // Day 7 follow-up (4 days after Day 3)
          const next = new Date();
          next.setDate(next.getDate() + 4);
          nextFollowupAt = next.toISOString();
        } else if (nextSequence === 4) {
          // Day 14 follow-up (7 days after Day 7)
          const next = new Date();
          next.setDate(next.getDate() + 7);
          nextFollowupAt = next.toISOString();
        } else if (nextSequence > 4) {
          // All sequences exhausted — mark dormant
          newStatus = 'dormant';
          nextSequence = null;
          nextFollowupAt = null;
        }

        upsertPipeline({
          lead_id: lead.id,
          status: newStatus,
          last_contacted_at: new Date().toISOString(),
          next_followup_at: nextFollowupAt,
          next_followup_sequence: nextSequence,
          notes: newStatus === 'dormant' ? 'All 4 sequences completed — no reply' : null,
        });

        logger.info(`Sent follow-up ${sequence} to ${lead.name} (${lead.email})`);
      } else {
        updateEmailStatus(emailId, 'failed');
        logger.warn(`Failed to send follow-up to ${lead.email}: ${sendResult.error}`);
      }

      // Random delay between sends
      if (dueFollowups.indexOf(followup) < dueFollowups.length - 1) {
        await randomDelay(90, 180);
      }
    } catch (err) {
      logger.error(`Error sending follow-up to ${followup.name}: ${err.message}`);
    }
  }

  logger.info('Follow-up job complete');
}
