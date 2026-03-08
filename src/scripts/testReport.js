import 'dotenv/config';
import { generateDailyReport } from '../lib/claude.js';
import { wrapReportHtml } from '../utils/templateBuilder.js';
import { writeFileSync } from 'fs';

const dryRun = process.argv.includes('--dry-run');
const dateStr = new Date().toISOString().split('T')[0];

// Mock stats for testing
const stats = {
  date: dateStr,
  day: 'Friday',
  sent: 45,
  bounced: 2,
  followups: 8,
  replies: 5,
  hot: 2,
  schedule: 1,
  unsub: 1,
  hotLeads: [
    { name: 'Test User', company: 'Test Corp', email: 'test@testcorp.com', raw_body: 'Sounds great, what are your rates?' },
  ],
  scheduleLeads: [
    { name: 'Schedule User', company: 'Schedule Co', email: 'schedule@example.com', raw_body: 'Can we schedule a call this week?' },
  ],
  softLeads: [
    { name: 'Soft User', company: 'Maybe Inc', email: 'soft@maybe.com', raw_body: 'Not right now, reach out next quarter.' },
  ],
  pipeline: { cold: 120, contacted: 85, hot: 5, schedule: 3, soft: 12, closed: 1, rejected: 8, dormant: 45 },
  mtd: { sent: 450, replies: 35, hot: 8, closed: 1, replyRate: '7.8' },
  tomorrowCategory: 'Real estate / finance',
  tomorrowFollowups: 12,
};

console.log('Testing daily report generation...\n');

try {
  const reportBody = await generateDailyReport(stats);

  if (dryRun) {
    const html = wrapReportHtml(reportBody, dateStr);
    const outPath = `/tmp/outreach-report-${dateStr}.html`;
    writeFileSync(outPath, html);
    console.log(`Report saved to: ${outPath}`);
    console.log('Open in browser to preview.');
  } else {
    console.log('Report HTML body:\n');
    console.log(reportBody.substring(0, 2000));
    console.log('\n... (truncated)');
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
}
