import { generateDailyReport } from '../lib/claude.js';
import { sendHtmlEmail } from '../lib/mailer.js';
import {
  getTodaysStats,
  getMonthToDateStats,
  getPipelineStats,
  getTodaysHotLeads,
  getTodaysScheduleLeads,
  getTodaysSoftLeads,
  getTomorrowFollowupCount,
  insertDailyReport,
} from '../../db/database.js';
import { wrapReportHtml } from '../utils/templateBuilder.js';
import logger from '../lib/logger.js';

const CATEGORIES = {
  1: 'Mumbai local businesses',
  2: 'Indian startups',
  3: 'Small digital agencies',
  4: 'International clients',
  5: 'E-commerce brands',
  6: 'Real estate / finance',
  0: 'Healthcare / education',
};

export async function runDailyReport() {
  logger.info('Generating daily report...');

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = days[now.getDay()];
  const tomorrowDay = (now.getDay() + 1) % 7;

  const todayStats = getTodaysStats();
  const mtdStats = getMonthToDateStats();
  const pipelineRows = getPipelineStats();
  const hotLeads = getTodaysHotLeads();
  const scheduleLeads = getTodaysScheduleLeads();
  const softLeads = getTodaysSoftLeads();
  const tomorrowFollowups = getTomorrowFollowupCount();

  const pipeline = {};
  for (const row of pipelineRows) {
    pipeline[row.status] = row.count;
  }

  const stats = {
    date: dateStr,
    day: dayName,
    sent: todayStats.sent,
    bounced: todayStats.bounced,
    followups: todayStats.followups,
    replies: todayStats.replies,
    hot: todayStats.hot,
    schedule: todayStats.schedule,
    unsub: todayStats.unsub,
    hotLeads,
    scheduleLeads,
    softLeads,
    pipeline,
    mtd: mtdStats,
    tomorrowCategory: CATEGORIES[tomorrowDay],
    tomorrowFollowups,
  };

  try {
    const reportBody = await generateDailyReport(stats);
    const fullHtml = wrapReportHtml(reportBody, dateStr);

    // Save to daily_reports table for dashboard
    insertDailyReport({
      report_date: dateStr,
      sent_count: todayStats.sent,
      bounce_count: todayStats.bounced,
      reply_count: todayStats.replies,
      hot_count: todayStats.hot,
      schedule_count: todayStats.schedule,
      followup_count: todayStats.followups,
      html_body: fullHtml,
    });

    const subject = `Outreach Report — ${dateStr} | ${todayStats.sent} sent | ${todayStats.replies} replies | ${todayStats.hot} hot`;

    const result = await sendHtmlEmail({
      to: process.env.REPORT_EMAIL,
      subject,
      html: fullHtml,
    });

    if (result.success) {
      logger.info('Daily report sent successfully');
    } else {
      logger.error(`Failed to send daily report: ${result.error}`);
    }
  } catch (err) {
    logger.error(`Daily report generation failed: ${err.message}`);
  }
}
