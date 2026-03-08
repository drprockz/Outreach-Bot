import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import logger from './logger.js';

function createClient() {
  return new ImapFlow({
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT, 10),
    secure: true,
    auth: {
      user: process.env.IMAP_USER,
      pass: process.env.IMAP_PASS,
    },
    logger: false,
  });
}

/**
 * Fetch all unseen emails from the inbox.
 * Returns array of { from, subject, text, date, messageId }.
 */
export async function fetchUnseenEmails() {
  const client = createClient();
  const emails = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      const messages = client.fetch({ seen: false }, { source: true, envelope: true });

      for await (const msg of messages) {
        try {
          const parsed = await simpleParser(msg.source);
          emails.push({
            from: parsed.from?.value?.[0]?.address || '',
            subject: parsed.subject || '',
            text: parsed.text || '',
            date: parsed.date || new Date(),
            messageId: parsed.messageId || '',
          });

          // Mark as seen
          await client.messageFlagsAdd(msg.seq, ['\\Seen'], { uid: false });
        } catch (parseErr) {
          logger.error(`Failed to parse email: ${parseErr.message}`);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    logger.error(`IMAP connection error: ${err.message}`);
  } finally {
    await client.logout().catch(() => {});
  }

  logger.info(`Fetched ${emails.length} unseen emails`);
  return emails;
}
