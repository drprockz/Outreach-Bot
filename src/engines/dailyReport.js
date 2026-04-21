import 'dotenv/config';
import { prisma, logCron, finishCron, logError, today } from '../core/db/index.js';
import { sendAlert } from '../core/integrations/telegram.js';
import nodemailer from 'nodemailer';

async function getMetrics() {
  const d = today();
  await prisma.dailyMetrics.upsert({
    where: { date: d },
    create: { date: d },
    update: {},
  });
  return prisma.dailyMetrics.findUnique({ where: { date: d } });
}

async function getReplyBreakdown() {
  const d = today();
  // received_at >= date(today) → compare against start of today
  const startOfDay = new Date(`${d}T00:00:00.000Z`);
  const rows = await prisma.reply.groupBy({
    by: ['category'],
    where: { receivedAt: { gte: startOfDay } },
    _count: { _all: true },
  });
  const breakdown = { hot: 0, schedule: 0, soft_no: 0, unsubscribe: 0, ooo: 0, other: 0 };
  for (const row of rows) {
    if (row.category && breakdown.hasOwnProperty(row.category)) {
      breakdown[row.category] = row._count._all;
    }
  }
  return breakdown;
}

async function get7dReplyRate() {
  // Sum emails_sent + replies_total over last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await prisma.dailyMetrics.findMany({
    where: { date: { gte: sevenDaysAgo } },
    select: { emailsSent: true, repliesTotal: true },
  });
  const sent = rows.reduce((a, r) => a + (r.emailsSent || 0), 0);
  const replied = rows.reduce((a, r) => a + (r.repliesTotal || 0), 0);
  if (sent === 0) return 0;
  return (replied / sent) * 100;
}

async function getCronStatus() {
  const d = today();
  const startOfDay = new Date(`${d}T00:00:00.000Z`);
  return prisma.cronLog.findMany({
    where: { startedAt: { gte: startOfDay } },
    orderBy: { startedAt: 'desc' },
    select: {
      jobName: true,
      status: true,
      startedAt: true,
      completedAt: true,
      durationMs: true,
      errorMessage: true,
    },
  });
}

async function getErrorCount() {
  const d = today();
  const startOfDay = new Date(`${d}T00:00:00.000Z`);
  return prisma.errorLog.count({
    where: { occurredAt: { gte: startOfDay }, resolved: false },
  });
}

function formatInr(usd) {
  return (Number(usd) * 85).toFixed(0);
}

function buildTelegramSummary(metrics, replyBreakdown, replyRate7d) {
  const bounceRate = metrics.emailsSent > 0
    ? ((metrics.emailsHardBounced / metrics.emailsSent) * 100).toFixed(1)
    : '0.0';
  const replyRate = replyRate7d.toFixed(1);
  const costInr = formatInr(metrics.totalApiCostUsd || 0);

  const d = today();
  const dateStr = new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  return [
    `📊 Radar — ${dateStr}`,
    `🔍 Found: ${metrics.leadsDiscovered} → ✉️ Sent: ${metrics.emailsSent} → 💬 Replied: ${metrics.repliesTotal}`,
    `🔥 Hot: ${replyBreakdown.hot} | 📅 Schedule: ${replyBreakdown.schedule} | 🚫 Unsub: ${replyBreakdown.unsubscribe}`,
    `📈 Reply rate: ${replyRate}% | Bounce: ${bounceRate}% | Cost: ₹${costInr}`
  ].join('\n');
}

function buildHtmlReport(metrics, replyBreakdown, cronJobs, errorCount, replyRate7d) {
  const bounceRate = metrics.emailsSent > 0
    ? ((metrics.emailsHardBounced / metrics.emailsSent) * 100).toFixed(2)
    : '0.00';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Radar Daily Report — ${today()}</title>
<style>
body{font-family:-apple-system,sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#333}
h1{color:#1a1a2e;border-bottom:2px solid #e94560;padding-bottom:8px}
h2{color:#16213e;margin-top:24px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #eee}
th{background:#f5f5f5;font-weight:600}
.metric{font-size:24px;font-weight:700;color:#e94560}
.green{color:#27ae60}.red{color:#e74c3c}.amber{color:#f39c12}
.card{display:inline-block;background:#f8f9fa;border-radius:8px;padding:16px;margin:6px;min-width:120px;text-align:center}
.card label{display:block;font-size:12px;color:#666;text-transform:uppercase}
</style></head>
<body>
<h1>Radar Daily Report &mdash; ${today()}</h1>

<h2>Lead Funnel</h2>
<div>
  <div class="card"><label>Discovered</label><div class="metric">${metrics.leadsDiscovered}</div></div>
  <div class="card"><label>Extracted</label><div class="metric">${metrics.leadsExtracted}</div></div>
  <div class="card"><label>Judge Passed</label><div class="metric">${metrics.leadsJudgePassed}</div></div>
  <div class="card"><label>Email Found</label><div class="metric">${metrics.leadsEmailFound}</div></div>
  <div class="card"><label>Email Valid</label><div class="metric">${metrics.leadsEmailValid}</div></div>
  <div class="card"><label>ICP Ready</label><div class="metric">${metrics.leadsIcpAb}</div></div>
  <div class="card"><label>Ready</label><div class="metric">${metrics.leadsReady}</div></div>
</div>

<h2>Send Funnel</h2>
<div>
  <div class="card"><label>Attempted</label><div class="metric">${metrics.emailsAttempted}</div></div>
  <div class="card"><label>Sent</label><div class="metric">${metrics.emailsSent}</div></div>
  <div class="card"><label>Hard Bounced</label><div class="metric ${metrics.emailsHardBounced > 0 ? 'red' : ''}">${metrics.emailsHardBounced}</div></div>
  <div class="card"><label>Soft Bounced</label><div class="metric ${metrics.emailsSoftBounced > 0 ? 'amber' : ''}">${metrics.emailsSoftBounced}</div></div>
  <div class="card"><label>Rejected</label><div class="metric">${metrics.emailsContentRejected}</div></div>
  <div class="card"><label>Follow-ups</label><div class="metric">${metrics.followupsSent}</div></div>
</div>

<h2>Inbox Breakdown</h2>
<table>
<tr><th>Inbox</th><th>Sent</th></tr>
<tr><td>darshan@trysimpleinc.com</td><td>${metrics.sentInbox1}</td></tr>
<tr><td>hello@trysimpleinc.com</td><td>${metrics.sentInbox2}</td></tr>
</table>

<h2>Reply Breakdown</h2>
<table>
<tr><th>Category</th><th>Count</th></tr>
<tr><td>Hot</td><td>${replyBreakdown.hot}</td></tr>
<tr><td>Schedule</td><td>${replyBreakdown.schedule}</td></tr>
<tr><td>Soft No</td><td>${replyBreakdown.soft_no}</td></tr>
<tr><td>Unsubscribe</td><td>${replyBreakdown.unsubscribe}</td></tr>
<tr><td>OOO</td><td>${replyBreakdown.ooo}</td></tr>
<tr><td>Other</td><td>${replyBreakdown.other}</td></tr>
<tr><th>Total</th><th>${metrics.repliesTotal}</th></tr>
</table>

<h2>Health</h2>
<table>
<tr><th>Metric</th><th>Value</th><th>Status</th></tr>
<tr><td>Bounce Rate (today)</td><td>${bounceRate}%</td><td class="${parseFloat(bounceRate) > 2 ? 'red' : 'green'}">${parseFloat(bounceRate) > 2 ? 'PAUSED' : 'OK'}</td></tr>
<tr><td>Reply Rate (7-day)</td><td>${replyRate7d.toFixed(1)}%</td><td>${replyRate7d > 1 ? 'Good' : 'Low'}</td></tr>
<tr><td>Unresolved Errors</td><td>${errorCount}</td><td class="${errorCount > 0 ? 'amber' : 'green'}">${errorCount > 0 ? 'Review' : 'Clean'}</td></tr>
</table>

<h2>API Costs</h2>
<table>
<tr><th>Service</th><th>Cost (USD)</th><th>Cost (INR)</th></tr>
<tr><td>Gemini Flash</td><td>$${Number(metrics.geminiCostUsd || 0).toFixed(4)}</td><td>Rs ${formatInr(metrics.geminiCostUsd || 0)}</td></tr>
<tr><td>Claude Sonnet</td><td>$${Number(metrics.sonnetCostUsd || 0).toFixed(4)}</td><td>Rs ${formatInr(metrics.sonnetCostUsd || 0)}</td></tr>
<tr><td>Claude Haiku</td><td>$${Number(metrics.haikuCostUsd || 0).toFixed(4)}</td><td>Rs ${formatInr(metrics.haikuCostUsd || 0)}</td></tr>
<tr><td>MEV</td><td>$${Number(metrics.mevCostUsd || 0).toFixed(4)}</td><td>Rs ${formatInr(metrics.mevCostUsd || 0)}</td></tr>
<tr><th>Total</th><th>$${Number(metrics.totalApiCostUsd || 0).toFixed(4)}</th><th>Rs ${formatInr(metrics.totalApiCostUsd || 0)}</th></tr>
</table>

<h2>Cron Jobs Today</h2>
<table>
<tr><th>Job</th><th>Status</th><th>Started</th><th>Completed</th><th>Duration</th><th>Error</th></tr>
${cronJobs.map(j => {
  const dur = j.durationMs ? `${(j.durationMs / 1000).toFixed(1)}s` : '-';
  return `<tr><td>${j.jobName}</td><td>${j.status}</td><td>${j.startedAt ? j.startedAt.toISOString() : '-'}</td><td>${j.completedAt ? j.completedAt.toISOString() : '-'}</td><td>${dur}</td><td>${j.errorMessage || '-'}</td></tr>`;
}).join('\n')}
</table>

<p style="color:#999;font-size:12px;margin-top:24px">Generated by Radar &mdash; Simple Inc</p>
</body></html>`;
}

export default async function dailyReport() {
  const cronId = await logCron('dailyReport');

  try {
    const metrics = await getMetrics();
    const replyBreakdown = await getReplyBreakdown();
    const replyRate7d = await get7dReplyRate();
    const cronJobs = await getCronStatus();
    const errorCount = await getErrorCount();

    // Update rolling rates in daily_metrics
    const bounceRate = metrics.emailsSent > 0 ? metrics.emailsHardBounced / metrics.emailsSent : 0;
    const unsubRate = metrics.emailsSent > 0 ? metrics.repliesUnsubscribe / metrics.emailsSent : 0;
    const totalCostUsd = Number(metrics.totalApiCostUsd || 0);
    await prisma.dailyMetrics.update({
      where: { date: today() },
      data: {
        bounceRate,
        replyRate: replyRate7d / 100,
        unsubscribeRate: unsubRate,
        totalApiCostInr: totalCostUsd * 85,
      },
    });

    // Send Telegram one-liner (spec §10)
    const telegramMsg = buildTelegramSummary(metrics, replyBreakdown, replyRate7d);
    await sendAlert(telegramMsg);

    // Send HTML email digest to darshan@simpleinc.in
    const htmlReport = buildHtmlReport(metrics, replyBreakdown, cronJobs, errorCount, replyRate7d);
    try {
      // Use nodemailer directly for HTML report (not via sendMail which is outreach-only)
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: {
          user: process.env.INBOX_1_USER,
          pass: process.env.INBOX_1_PASS
        }
      });

      await transport.sendMail({
        from: `Radar <${process.env.INBOX_1_USER}>`,
        to: 'darshan@simpleinc.in',
        subject: `Radar Report — ${today()}`,
        text: telegramMsg,
        html: htmlReport
      });
    } catch (mailErr) {
      await logError('dailyReport.email', mailErr, { jobName: 'dailyReport' });
    }

    await finishCron(cronId, { status: 'success' });
  } catch (err) {
    await logError('dailyReport', err, { jobName: 'dailyReport' });
    await finishCron(cronId, { status: 'failed', error: err.message });
    await sendAlert(`dailyReport failed: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  dailyReport().catch(console.error);
}
