import { generateEmail } from '../lib/claude.js';
import { sendEmail } from '../lib/mailer.js';
import {
  getLeadsToContact,
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

  // Never send on Sunday (day 0)
  if (istDay === 0) return false;
  // Only send between 9 AM and 6 PM IST
  if (istHour < 9 || istHour >= 18) return false;

  return true;
}

export async function runSendEmails() {
  if (!isWithinSendWindow()) {
    logger.info('Outside send window (9AM-6PM IST, Mon-Sat). Skipping.');
    return;
  }

  const dailyLimit = parseInt(process.env.DAILY_SEND_LIMIT, 10) || 50;
  const alreadySent = getTodaysSentCount();

  if (alreadySent >= dailyLimit) {
    logger.info(`Daily send limit reached: ${alreadySent}/${dailyLimit}`);
    return;
  }

  const remaining = dailyLimit - alreadySent;
  const leads = getLeadsToContact(remaining);

  if (leads.length === 0) {
    logger.info('No leads to contact');
    return;
  }

  logger.info(`Sending emails to ${leads.length} leads (${alreadySent} already sent today)`);

  for (const lead of leads) {
    // Re-check send window and daily limit before each send
    if (!isWithinSendWindow()) {
      logger.info('Send window closed during batch. Stopping.');
      break;
    }

    if (getTodaysSentCount() >= dailyLimit) {
      logger.info('Daily limit reached during batch. Stopping.');
      break;
    }

    try {
      // Generate email via Claude
      const email = await generateEmail(lead, 1);
      if (!email) {
        logger.warn(`Failed to generate email for ${lead.name}`);
        continue;
      }

      // Insert email record
      const emailResult = insertEmail({
        lead_id: lead.id,
        sequence: 1,
        subject: email.subject,
        body: email.body,
      });
      const emailId = emailResult.lastInsertRowid;

      // Send via SES
      const sendResult = await sendEmail({
        to: lead.email,
        subject: email.subject,
        body: email.body,
      });

      if (sendResult.success) {
        updateEmailStatus(emailId, 'sent', sendResult.messageId);

        // Calculate Day 3 follow-up date
        const followupDate = new Date();
        followupDate.setDate(followupDate.getDate() + 3);

        upsertPipeline({
          lead_id: lead.id,
          status: 'contacted',
          last_contacted_at: new Date().toISOString(),
          next_followup_at: followupDate.toISOString(),
          next_followup_sequence: 2,
          notes: null,
        });

        logger.info(`Sent cold email to ${lead.name} (${lead.email})`);
      } else {
        updateEmailStatus(emailId, 'failed');
        logger.warn(`Failed to send to ${lead.email}: ${sendResult.error}`);
      }

      // Random delay between sends (90-180 seconds)
      if (leads.indexOf(lead) < leads.length - 1) {
        const delaySeconds = Math.floor(Math.random() * 91) + 90;
        logger.info(`Waiting ${delaySeconds}s before next send...`);
        await randomDelay(90, 180);
      }
    } catch (err) {
      logger.error(`Error processing lead ${lead.name}: ${err.message}`);
    }
  }

  logger.info(`Send emails job complete. Total sent today: ${getTodaysSentCount()}`);
}
