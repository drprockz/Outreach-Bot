import { describe, it, expect } from 'vitest';
import { REDIRECTS } from './redirects.js';

const OLD_PATHS = [
  '/', '/run', '/leads', '/funnel', '/send-log', '/replies',
  '/sequences', '/cron', '/health', '/costs', '/errors',
  '/settings/niches', '/settings/engines', '/settings/offer',
  '/settings/icp-profile', '/settings/persona',
];

const VALID_TARGETS = new Set([
  '/', '/outreach/engines', '/outreach/leads', '/outreach/sent',
  '/outreach/followups', '/outreach/replies', '/outreach/funnel',
  '/setup/niches', '/setup/offer-icp', '/setup/voice',
  '/system/spend', '/system/email-health', '/system/errors', '/system/logs',
]);

describe('REDIRECTS', () => {
  it('covers every pre-existing top-level path', () => {
    for (const p of OLD_PATHS) {
      expect(REDIRECTS[p], `missing redirect for ${p}`).toBeDefined();
    }
  });

  it('every redirect target matches a known current route', () => {
    for (const [from, to] of Object.entries(REDIRECTS)) {
      expect(VALID_TARGETS.has(to), `unknown target "${to}" for ${from}`).toBe(true);
    }
  });

  it('unsetup/offer-icp absorbs both /settings/offer and /settings/icp-profile', () => {
    expect(REDIRECTS['/settings/offer']).toBe('/setup/offer-icp');
    expect(REDIRECTS['/settings/icp-profile']).toBe('/setup/offer-icp');
  });
});
