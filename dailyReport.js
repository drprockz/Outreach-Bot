import 'dotenv/config';
import { getDb, logCron, finishCron, logError, bumpMetric, today } from './utils/db.js';
import { sendAlert } from './utils/telegram.js';
import { sendMail } from './utils/mailer.js';
import nodemailer from 'nodemailer';

function getMetrics(db) {
  const d = today();
  db.prepare(`INSERT INTO daily_metrics (date) VALUES (?) ON CONFLICT(date) DO NOTHING`).run(d);
  return db.prepare(`SELECT * FROM daily_metrics WHERE date=?`).get(d);
}

function getReplyBreakdown(db) {
  const d = today();
  const rows = db.prepare(`
    SELECT category, COUNT(*) as cnt
    FROM replies
    WHERE received_at >= date(?)
    GROUP BY category
  `).all(d);
  const breakdown = { hot: 0, schedule: 0, soft_no: 0, unsubscribe: 0, ooo: 0, other: 0 };
  for (const row of rows) {
    if (breakdown.hasOwnProperty(row.category)) {
      breakdown[row.category] = row.cnt;
    }
  }
  return breakdown;
}

function get7dReplyRate(db) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(emails_sent), 0) as sent,
      COALESCE(SUM(replies_total), 0) as replied
    FROM daily_metrics
    WHERE date >= date('now', '-7 days')
  `).get();
  if (!row || row.sent === 0) return 0;
  return ((row.replied / row.sent) * 100);
}

function getCronStatus(db) {
  const d = today();
  return db.prepare(`
    SELECT job_name, status, started_at, completed_at, duration_ms, error_message
    FROM cron_log
    WHERE started_at >= date(?)
    ORDER BY started_at DESC
  `).all(d);
}

function getErrorCount(db) {
  const d = today();
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM error_log WHERE occurred_at >= date(?) AND resolved=0`).get(d);
  return row?.cnt || 0;
}

function formatInr(usd) {
  return (usd * 85).toFixed(0);
}

function buildTelegramSummary(metrics, replyBreakdown) {
  const bounceRate = metrics.emails_sent > 0
    ? ((metrics.emails_hard_bounced / metrics.emails_sent) * 100).toFixed(1)
    : '0.0';
  const replyRate = metrics.emails_sent > 0
    ? ((metrics.replies_total / metrics.emails_sent) * 100).toFixed(1)
    : '0.0';
  const costInr = formatInr(metrics.total_api_cost_usd || 0);

  const d = today();
  const dateStr = new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  return [
    `Radar -- ${dateStr}`,
    `Found: ${metrics.leads_discovered} | Sent: ${metrics.emails_sent} | Replied: ${metrics.replies_total}`,
    `Hot: ${replyBreakdown.hot} | Schedule: ${replyBreakdown.schedule} | Unsub: ${replyBreakdown.unsubscribe}`,
    `Reply rate: ${replyRate}% | Bounce: ${bounceRate}% | Cost: Rs ${costInr}`
  ].join('\n');
}

function buildHtmlReport(metrics, replyBreakdown, cronJobs, errorCount, replyRate7d) {
  const bounceRate = metrics.emails_sent > 0
    ? ((metrics.emails_hard_bounced / metrics.emails_sent) * 100).toFixed(2)
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
  <div class="card"><label>Discovered</label><div class="metric">${metrics.leads_discovered}</div></div>
  <div class="card"><label>Extracted</label><div class="metric">${metrics.leads_extracted}</div></div>
  <div class="card"><label>Judge Passed</label><div class="metric">${metrics.leads_judge_passed}</div></div>
  <div class="card"><label>Email Found</label><div class="metric">${metrics.leads_email_found}</div></div>
  <div class="card"><label>Email Valid</label><div class="metric">${metrics.leads_email_valid}</div></div>
  <div class="card"><label>ICP A+B</label><div class="metric">${metrics.leads_icp_ab}</div></div>
  <div class="card"><label>Ready</label><div class="metric">${metrics.leads_ready}</div></div>
</div>

<h2>Send Funnel</h2>
<div>
  <div class="card"><label>Attempted</label><div class="metric">${metrics.emails_attempted}</div></div>
  <div class="card"><label>Sent</label><div class="metric">${metrics.emails_sent}</div></div>
  <div class="card"><label>Hard Bounced</label><div class="metric ${metrics.emails_hard_bounced > 0 ? 'red' : ''}">${metrics.emails_hard_bounced}</div></div>
  <div class="card"><label>Soft Bounced</label><div class="metric ${metrics.emails_soft_bounced > 0 ? 'amber' : ''}">${metrics.emails_soft_bounced}</div></div>
  <div class="card"><label>Rejected</label><div class="metric">${metrics.emails_content_rejected}</div></div>
  <div class="card"><label>Follow-ups</label><div class="metric">${metrics.followups_sent}</div></div>
</div>

<h2>Inbox Breakdown</h2>
<table>
<tr><th>Inbox</th><th>Sent</th></tr>
<tr><td>darshan@trysimpleinc.com</td><td>${metrics.sent_inbox_1}</td></tr>
<tr><td>hello@trysimpleinc.com</td><td>${metrics.sent_inbox_2}</td></tr>
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
<tr><th>Total</th><th>${metrics.replies_total}</th></tr>
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
<tr><td>Gemini Flash</td><td>$${(metrics.gemini_cost_usd || 0).toFixed(4)}</td><td>Rs ${formatInr(metrics.gemini_cost_usd || 0)}</td></tr>
<tr><td>Claude Sonnet</td><td>$${(metrics.sonnet_cost_usd || 0).toFixed(4)}</td><td>Rs ${formatInr(metrics.sonnet_cost_usd || 0)}</td></tr>
<tr><td>Claude Haiku</td><td>$${(metrics.haiku_cost_usd || 0).toFixed(4)}</td><td>Rs ${formatInr(metrics.haiku_cost_usd || 0)}</td></tr>
<tr><td>MEV</td><td>$${(metrics.mev_cost_usd || 0).toFixed(4)}</td><td>Rs ${formatInr(metrics.mev_cost_usd || 0)}</td></tr>
<tr><th>Total</th><th>$${(metrics.total_api_cost_usd || 0).toFixed(4)}</th><th>Rs ${formatInr(metrics.total_api_cost_usd || 0)}</th></tr>
</table>

<h2>Cron Jobs Today</h2>
<table>
<tr><th>Job</th><th>Status</th><th>Started</th><th>Completed</th><th>Duration</th><th>Error</th></tr>
${cronJobs.map(j => {
  const dur = j.duration_ms ? `${(j.duration_ms / 1000).toFixed(1)}s` : '-';
  return `<tr><td>${j.job_name}</td><td>${j.status}</td><td>${j.started_at || '-'}</td><td>${j.completed_at || '-'}</td><td>${dur}</td><td>${j.error_message || '-'}</td></tr>`;
}).join('\n')}
</table>

<p style="color:#999;font-size:12px;margin-top:24px">Generated by Radar &mdash; Simple Inc</p>
</body></html>`;
}

export default async function dailyReport() {
  const cronId = logCron('dailyReport');

  try {
    const db = getDb();
    const metrics = getMetrics(db);
    const replyBreakdown = getReplyBreakdown(db);
    const replyRate7d = get7dReplyRate(db);
    const cronJobs = getCronStatus(db);
    const errorCount = getErrorCount(db);

    // Update rolling rates in daily_metrics
    const bounceRate = metrics.emails_sent > 0 ? metrics.emails_hard_bounced / metrics.emails_sent : 0;
    const unsubRate = metrics.emails_sent > 0 ? metrics.replies_unsubscribe / metrics.emails_sent : 0;
    db.prepare(`UPDATE daily_metrics SET bounce_rate=?, reply_rate=?, unsubscribe_rate=?, total_api_cost_inr=total_api_cost_usd*85 WHERE date=?`).run(
      bounceRate, replyRate7d / 100, unsubRate, today()
    );

    // Send Telegram one-liner (spec §10)
    const telegramMsg = buildTelegramSummary(metrics, replyBreakdown);
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
      logError('dailyReport.email', mailErr, { jobName: 'dailyReport' });
    }

    finishCron(cronId, { status: 'success' });
  } catch (err) {
    logError('dailyReport', err, { jobName: 'dailyReport' });
    finishCron(cronId, { status: 'failed', error: err.message });
    await sendAlert(`dailyReport failed: ${err.message}`);
  }
}

// Run directly if executed as script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[/\\]/, ''))) {
  dailyReport().catch(console.error);
}
