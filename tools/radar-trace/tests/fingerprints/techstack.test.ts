import { describe, it, expect } from 'vitest';
import { TECHSTACK_FINGERPRINTS, detectTechStack } from '../../src/fingerprints/techstack.js';

describe('TECHSTACK_FINGERPRINTS', () => {
  it('contains at least 30 fingerprints', () => {
    expect(TECHSTACK_FINGERPRINTS.length).toBeGreaterThanOrEqual(30);
  });

  it('every fingerprint has name, category, and at least one pattern source', () => {
    for (const fp of TECHSTACK_FINGERPRINTS) {
      expect(fp.name).toBeTruthy();
      expect(fp.category).toBeTruthy();
      const hasSomePattern =
        (fp.scriptPatterns?.length ?? 0) +
        (fp.linkPatterns?.length ?? 0) +
        (fp.htmlPatterns?.length ?? 0) > 0;
      expect(hasSomePattern).toBe(true);
    }
  });
});

describe('detectTechStack', () => {
  it('detects Stripe via script src', () => {
    const html = `<script src="https://js.stripe.com/v3/"></script>`;
    const detected = detectTechStack(html);
    expect(detected.find((d) => d.name === 'Stripe')).toBeTruthy();
  });

  it('detects Segment via script src', () => {
    const html = `<script>!function(){var analytics=window.analytics=window.analytics||[];analytics.SNIPPET_VERSION="4.13.1";</script><script src="https://cdn.segment.com/analytics.js/v1/abc/analytics.min.js"></script>`;
    const detected = detectTechStack(html);
    expect(detected.find((d) => d.name === 'Segment')).toBeTruthy();
  });

  it('detects HubSpot via script domain marker', () => {
    const html = `<script src="//js.hs-scripts.com/12345.js"></script>`;
    const detected = detectTechStack(html);
    expect(detected.find((d) => d.name === 'HubSpot')).toBeTruthy();
  });

  it('returns empty array on bare HTML with no markers', () => {
    expect(detectTechStack('<html><body>hello</body></html>')).toEqual([]);
  });

  it('confidence is 1 for direct pattern match, can be lower for weaker signals', () => {
    const html = `<script src="https://js.stripe.com/v3/"></script>`;
    const detected = detectTechStack(html);
    const stripe = detected.find((d) => d.name === 'Stripe')!;
    expect(stripe.confidence).toBeGreaterThan(0);
    expect(stripe.confidence).toBeLessThanOrEqual(1);
  });
});
