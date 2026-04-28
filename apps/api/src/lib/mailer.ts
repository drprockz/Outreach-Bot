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

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:5173'
const FROM_NAME = 'Radar by Simple Inc'

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function shellHtml(content: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Radar</title></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f7fa;padding:40px 16px">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.06);max-width:480px">
        <tr><td style="padding:32px">
          <div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:24px">📡 Radar</div>
          ${content}
          <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;line-height:1.5">
            Radar by <a href="https://simpleinc.in" style="color:#64748b;text-decoration:none">Simple Inc</a>.<br>
            If you didn't request this email, you can safely ignore it.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const html = shellHtml(`
    <h1 style="font-size:24px;font-weight:700;margin:0 0 16px 0">Your sign-in code</h1>
    <p style="font-size:14px;color:#475569;margin:0 0 16px 0">
      Enter this code on the Radar sign-in page to continue:
    </p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;background:#f1f5f9;border-radius:8px;padding:24px;margin:0 0 16px 0;font-family:'SF Mono',Menlo,Consolas,monospace">${escapeHtml(code)}</div>
    <p style="font-size:13px;color:#64748b;margin:0">
      This code expires in 5 minutes.
    </p>
  `)
  await transport.sendMail({
    from: { name: FROM_NAME, address: process.env.INBOX_1_USER ?? '' },
    to,
    subject: `Your Radar sign-in code: ${code}`,
    text: `Your Radar sign-in code is: ${code}\n\nThis code expires in 5 minutes. If you didn't request it, ignore this email.`,
    html,
  })
}

export async function sendInviteEmail(to: string, orgName: string, inviterEmail: string): Promise<void> {
  const acceptUrl = `${DASHBOARD_URL}/login?invited=1&email=${encodeURIComponent(to)}`
  const html = shellHtml(`
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px 0">You've been invited to ${escapeHtml(orgName)}</h1>
    <p style="font-size:14px;color:#475569;margin:0 0 24px 0;line-height:1.5">
      <strong>${escapeHtml(inviterEmail)}</strong> has invited you to join the <strong>${escapeHtml(orgName)}</strong> workspace on Radar.
    </p>
    <a href="${acceptUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px;padding:12px 24px;border-radius:8px;margin-bottom:16px">Accept invitation →</a>
    <p style="font-size:13px;color:#64748b;margin:24px 0 0 0;line-height:1.5">
      Or copy and paste this link into your browser:<br>
      <a href="${acceptUrl}" style="color:#3b82f6;word-break:break-all">${acceptUrl}</a>
    </p>
  `)
  await transport.sendMail({
    from: { name: FROM_NAME, address: process.env.INBOX_1_USER ?? '' },
    to,
    subject: `${inviterEmail} invited you to ${orgName} on Radar`,
    text: `${inviterEmail} has invited you to join ${orgName} on Radar.\n\nAccept your invitation:\n${acceptUrl}\n\nIf you didn't expect this invitation, you can ignore this email.`,
    html,
  })
}
