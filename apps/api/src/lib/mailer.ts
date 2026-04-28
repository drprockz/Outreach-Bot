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
