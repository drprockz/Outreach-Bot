import nodemailer from 'nodemailer';
import logger from './logger.js';

const transporter = nodemailer.createTransport({
  host: process.env.SES_SMTP_HOST,
  port: parseInt(process.env.SES_SMTP_PORT, 10),
  secure: false,
  auth: {
    user: process.env.SES_SMTP_USER,
    pass: process.env.SES_SMTP_PASS,
  },
});

/**
 * Send a plain text email via AWS SES.
 */
export async function sendEmail({ to, subject, body, inReplyTo = null }) {
  const mailOptions = {
    from: `"${process.env.SES_FROM_NAME}" <${process.env.SES_FROM_EMAIL}>`,
    to,
    subject,
    text: body,
  };

  if (inReplyTo) {
    mailOptions.headers = {
      'In-Reply-To': inReplyTo,
      References: inReplyTo,
    };
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`Failed to send email to ${to}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Send an HTML email (used for reports and alerts).
 */
export async function sendHtmlEmail({ to, subject, html }) {
  const mailOptions = {
    from: `"${process.env.SES_FROM_NAME}" <${process.env.SES_FROM_EMAIL}>`,
    to,
    subject,
    html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`HTML email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error(`Failed to send HTML email to ${to}: ${err.message}`);
    return { success: false, error: err.message };
  }
}
