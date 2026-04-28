import nodemailer from 'nodemailer'

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT ?? '587', 10),
  secure: false,
  auth: {
    user: process.env.INBOX_1_USER ?? '',
    pass: process.env.INBOX_1_PASS ?? '',
  },
})

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  await transport.sendMail({
    from: process.env.INBOX_1_USER,
    to,
    subject: 'Your Radar login code',
    text: `Your one-time login code is: ${code}\n\nThis code expires in 5 minutes. If you didn't request it, ignore this email.`,
  })
}

export async function sendInviteEmail(to: string, orgName: string, inviterEmail: string): Promise<void> {
  const dashboardUrl = process.env.DASHBOARD_URL ?? 'https://radar.simpleinc.cloud'
  await transport.sendMail({
    from: process.env.INBOX_1_USER,
    to,
    subject: `You've been invited to ${orgName} on Radar`,
    text: `${inviterEmail} has invited you to join ${orgName} on Radar.\n\nSign in at: ${dashboardUrl}\n\nIf you didn't expect this invitation, you can ignore this email.`,
  })
}
