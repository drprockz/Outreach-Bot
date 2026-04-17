import nodemailer from 'nodemailer';
import 'dotenv/config';

function buildTransport(user, pass) {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user, pass }
  });
}

function getTransports() {
  return [
    buildTransport(process.env.INBOX_1_USER, process.env.INBOX_1_PASS),
    buildTransport(process.env.INBOX_2_USER, process.env.INBOX_2_PASS)
  ];
}

export async function verifyConnections() {
  const transports = getTransports();
  await Promise.all(transports.map(t => t.verify()));
}

/**
 * @param {1|2} inboxNumber
 * @param {{ to, subject, text, inReplyTo?: string, references?: string }} opts
 * @returns {Promise<{ messageId: string }>}
 */
export async function sendMail(inboxNumber, { to, subject, text, inReplyTo, references }) {
  const domain = process.env.OUTREACH_DOMAIN || 'trysimpleinc.com';
  const user = inboxNumber === 1 ? process.env.INBOX_1_USER : process.env.INBOX_2_USER;
  const pass = inboxNumber === 1 ? process.env.INBOX_1_PASS : process.env.INBOX_2_PASS;

  // Non-negotiable: assert outreach domain before every send
  if (!user?.endsWith(`@${domain}`)) {
    throw new Error(`Inbox ${inboxNumber} user ${user} is not on outreach domain ${domain}`);
  }

  const transport = buildTransport(user, pass);
  const mailOpts = {
    from: `Darshan Parmar <${user}>`,
    to,
    subject,
    text,
    ...(inReplyTo ? { inReplyTo, references: references || inReplyTo } : {})
  };

  const info = await transport.sendMail(mailOpts);
  return { messageId: info.messageId };
}
