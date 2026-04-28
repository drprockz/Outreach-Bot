// Redirect map for the 2026-04-21 dashboard tidy. Every pre-reshape path maps
// to its new home so bookmarks keep working. Wire-up is in App.jsx.
export const REDIRECTS = {
  '/':                     '/',                     // Today lives at root
  '/run':                  '/outreach/engines',
  '/leads':                '/outreach/leads',
  '/funnel':               '/outreach/funnel',
  '/send-log':             '/outreach/sent',
  '/replies':              '/outreach/replies',
  '/sequences':            '/outreach/followups',
  '/cron':                 '/system/logs',
  '/health':               '/system/email-health',
  '/costs':                '/system/spend',
  '/errors':               '/system/errors',
  '/settings/niches':      '/setup/niches',
  '/settings/engines':     '/outreach/engines',
  '/settings/offer':       '/setup/offer-icp',
  '/settings/icp-profile': '/setup/offer-icp',
  '/settings/persona':     '/setup/voice',
};
