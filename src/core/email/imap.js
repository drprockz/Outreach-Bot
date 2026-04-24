import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import 'dotenv/config';

function buildClient(user, pass) {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.IMAP_PORT || '993'),
    secure: true,
    auth: { user, pass },
    logger: false
  });
  // ImapFlow is an EventEmitter. Socket timeouts / connection drops emit an
  // 'error' event on the instance itself — outside any promise chain. Without
  // a listener, Node's EventEmitter throws synchronously and crashes the
  // whole process. Attach a no-op so the in-flight op promise (connect/fetch/
  // logout) is the one that rejects, and our try/catch in fetchUnseen can
  // handle it cleanly.
  client.on('error', () => {});
  return client;
}

/**
 * Fetch all unseen messages from one inbox.
 * @param {1|2} inboxNumber
 * @returns {Promise<Array<{ uid, from, subject, text, date, messageId }>>}
 */
export async function fetchUnseen(inboxNumber) {
  const user = inboxNumber === 1 ? process.env.INBOX_1_USER : process.env.INBOX_2_USER;
  const pass = inboxNumber === 1 ? process.env.INBOX_1_PASS : process.env.INBOX_2_PASS;

  const client = buildClient(user, pass);
  const messages = [];

  try {
    await client.connect();
    await client.mailboxOpen('INBOX');

    for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
      const parsed = await simpleParser(msg.source);
      messages.push({
        uid: msg.uid,
        from: parsed.from?.value?.[0]?.address || '',
        subject: parsed.subject || '',
        text: parsed.text || '',
        date: parsed.date,
        messageId: parsed.messageId || ''
      });

      // Mark as seen so we don't re-process on next run (prevents 3x Haiku calls/day)
      await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
    }
  } finally {
    // logout() on a timed-out/errored client can reject — don't let that mask
    // the original error or crash the caller. Best-effort close.
    try { await client.logout(); } catch { /* already disconnected */ }
  }

  return messages;
}
