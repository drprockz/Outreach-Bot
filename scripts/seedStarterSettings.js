// One-off seeder: fills the Offer + ICP Profile singletons with realistic
// starter content based on CLAUDE.md (Simple Inc / Radar). Idempotent — only
// writes when the target field is currently empty/null, so it will NEVER
// overwrite data a human has already filled via the dashboard.
//
// Usage:   node scripts/seedStarterSettings.js
//   or:    node scripts/seedStarterSettings.js --force   (overwrite existing)
//
// Also verifies Persona config keys are seeded.

import 'dotenv/config';
import { getPrisma, seedConfigDefaults, seedNichesAndDefaults, resetDb } from '../src/core/db/index.js';

const FORCE = process.argv.includes('--force');

const OFFER_STARTER = {
  problem: 'Indian MSME/SMB businesses lose leads and bookings every day because their websites are slow, dated, and broken on mobile — driving customers to faster-loading competitors.',
  outcome: 'Modern, fast, conversion-optimized website that loads under 2s, works flawlessly on mobile, and captures 2-3x more inquiries within 90 days of launch.',
  category: 'Web development / conversion-focused website redesigns',
  useCases: [
    'Complete website redesign',
    'Performance optimization (Core Web Vitals)',
    'Mobile responsiveness fix',
    'Custom booking / ordering / lead-capture flow',
    'SEO foundation rebuild',
  ],
  triggers: [
    'Losing leads to faster competitors',
    'Google Search Console warnings / Core Web Vitals penalty',
    'Website over 3 years old with no recent updates',
    'Owner embarrassed to share URL in meetings',
    'Recent rebrand that needs digital refresh',
    'Current freelancer ghosted / gone unresponsive',
  ],
  alternatives: [
    'Freelancers (cheaper but unreliable, no process)',
    'Fiverr / template shops (generic look, no custom logic)',
    'DIY on Wix / Squarespace (limited, non-extensible)',
    'Large agencies (₹10L+ retainers, overkill for MSME)',
    'Do nothing (status quo)',
  ],
  differentiation: 'Founder-built, not an agency middleman. Direct communication with the developer writing the code, 2-6 week delivery, fixed-price quotes, no project-manager-as-phone-tree. You talk to the person who ships.',
  priceRange: '₹40,000 to ₹2,00,000 one-time (most land at ₹60k-80k). Fixed price, no hourly surprises.',
  salesCycle: '2-6 weeks from first email to signed contract. Most close within 3 weeks.',
  criticality: 'optional',
  inactionCost: 'Continued lead leakage estimated at ₹50k-5L/year in lost revenue for a typical MSME, scaling with customer acquisition volume.',
  requiredInputs: [
    'Existing hosting credentials',
    'Domain registrar access (for DNS if migrating)',
    'Brand assets (logo, colors — or willingness to create them)',
    'Admin access to current CMS / platform',
    'One decision-maker available for 30-min calls',
  ],
  proofPoints: [
    'Portfolio of similar businesses across restaurants, real estate, D2C, healthcare',
    'Before/after Core Web Vitals comparisons shareable on request',
    'Fixed-price contracts — no hourly billing mid-project',
    'Client testimonials available on request',
    '90-day post-launch support included',
  ],
};

const ICP_PROFILE_STARTER = {
  industries: [
    'Restaurants & cafes',
    'Real estate agencies',
    'D2C brands (Shopify/WooCommerce)',
    'Healthcare clinics & salons',
    'Digital agencies (overflow work)',
    'Funded B2B startups',
  ],
  companySize: '1-200 employees (sweet spot: 5-50)',
  revenueRange: '₹50L to ₹25Cr annual revenue',
  geography: ['Mumbai', 'Bangalore', 'Delhi NCR', 'Pune', 'Hyderabad', 'Ahmedabad'],
  stage: ['owner-operated', 'growing', 'established'],
  techStack: [
    'WordPress (Elementor, Divi, Astra themes)',
    'Wix',
    'Squarespace',
    'Custom PHP from 2015-2018',
    'HTML + jQuery legacy sites',
  ],
  internalCapabilities: [
    'Owner/founder involved in tech decisions',
    'Marketing person (not a developer)',
    'May have an agency on retainer for social/ads',
    'No in-house developer',
  ],
  budgetRange: '₹40,000 to ₹2,00,000 one-time for website redesign projects',
  problemFrequency: 'Daily lost leads from slow mobile experience; quarterly complaints from customers about bookings or navigation',
  problemCost: '₹50,000 to ₹5,00,000 per year in lost conversions depending on traffic volume',
  impactedKpis: [
    'Website conversion rate',
    'Mobile bounce rate',
    'Organic lead volume (monthly)',
    'Cost per acquisition (paid + organic)',
    'Time on page / pages per session',
  ],
  initiatorRoles: ['Founder/Owner', 'Managing Director', 'Head of Marketing', 'Operations Manager'],
  decisionRoles: ['Founder/Owner', 'Managing Director', 'CMO'],
  objections: [
    'We already have a freelancer',
    'Too expensive vs Fiverr / template shops',
    'Our website is fine',
    "We're planning to rebrand next year",
    'Need to discuss internally',
    'SEO will tank if we migrate',
  ],
  buyingProcess: 'Direct negotiation with founder/owner. 1-3 decision calls typical. Contract signed + 50% advance upfront, 50% on delivery.',
  intentSignals: [
    'Recent Google reviews mentioning "slow site" or "couldn\'t book"',
    'Job post for web developer or marketing manager',
    'Competitor visibly relaunched website in last 90 days',
    'LinkedIn post about growth goals or funding raise',
    'Google Business Profile recently updated (active operator)',
    'WhatsApp Business catalog exists (digital-curious)',
  ],
  currentTools: [
    'WordPress + Elementor',
    'Shopify basic plan',
    'Wix',
    'Squarespace',
    'GoDaddy website builder',
    'Custom PHP from 2015-2018',
    'Static HTML built by a cousin',
  ],
  workarounds: [
    'WhatsApp Business for bookings (no online form)',
    'Google Form for quote requests',
    'Phone-only lead capture',
    'Manual booking via Instagram DM',
    'Email-to-owner-direct inquiry flow',
  ],
  frustrations: [
    'Dashboard too complex for non-tech owner',
    'Plugins conflicting after WordPress updates',
    'Slow to load especially on 3G/4G',
    'Not mobile-responsive — text overlapping images',
    'Breaks after every auto-update',
    'No one responds when I request a simple edit',
    'Freelancer charges ₹5k per tiny change',
  ],
  switchingBarriers: [
    'SEO domain authority risk from migration',
    'Current content/blog posts migration fear',
    'Hosting lock-in with annual prepay',
    'Already paid for a 3-year plan',
    'Fear of downtime during cutover',
    'Loss of admin customizations / custom fields',
  ],
  hardDisqualifiers: [
    'Already on Next.js/React/Astro/modern stack with an active in-house dev team',
    'Agency retainer with a locked multi-year contract',
    'Enterprise with formal procurement department (>500 employees)',
    'Not headquartered in India (geo mismatch for Phase 1)',
    'Freelancer/solo consultant with no operational team (not ICP)',
    'Recently launched a new website in last 6 months',
  ],
};

async function main() {
  const prisma = getPrisma();

  // 1. Make sure base config + niches + empty offer/profile singletons exist
  await seedConfigDefaults();
  await seedNichesAndDefaults();

  // 2. Offer
  const offerExisting = await prisma.offer.findUnique({ where: { id: 1 } });
  if (!offerExisting) {
    // Shouldn't happen (seedNichesAndDefaults upserts an empty row), but handle it
    await prisma.offer.create({ data: { id: 1, ...OFFER_STARTER } });
    console.log('✅ Offer row created + seeded');
  } else if (FORCE || !offerExisting.problem) {
    await prisma.offer.update({ where: { id: 1 }, data: OFFER_STARTER });
    console.log(FORCE ? '✅ Offer overwritten (--force)' : '✅ Offer seeded (was empty)');
  } else {
    console.log('⊙ Offer already populated — skipping (pass --force to overwrite)');
  }

  // 3. ICP Profile
  const icpExisting = await prisma.icpProfile.findUnique({ where: { id: 1 } });
  const hasIndustries = Array.isArray(icpExisting?.industries) && icpExisting.industries.length > 0;
  if (!icpExisting) {
    await prisma.icpProfile.create({ data: { id: 1, ...ICP_PROFILE_STARTER } });
    console.log('✅ ICP Profile row created + seeded');
  } else if (FORCE || !hasIndustries) {
    await prisma.icpProfile.update({ where: { id: 1 }, data: ICP_PROFILE_STARTER });
    console.log(FORCE ? '✅ ICP Profile overwritten (--force)' : '✅ ICP Profile seeded (was empty)');
  } else {
    console.log('⊙ ICP Profile already populated — skipping (pass --force to overwrite)');
  }

  // 4. Verify Persona keys exist in config (seedConfigDefaults should have done this)
  const personaKeys = ['persona_name', 'persona_role', 'persona_company', 'persona_website', 'persona_tone', 'persona_services'];
  const personaRows = await prisma.config.findMany({ where: { key: { in: personaKeys } } });
  const missing = personaKeys.filter(k => !personaRows.find(r => r.key === k));
  if (missing.length === 0) {
    console.log(`✅ Persona config keys all present (${personaKeys.length}/${personaKeys.length})`);
  } else {
    console.log(`⚠️  Persona config keys missing: ${missing.join(', ')} — re-running seedConfigDefaults`);
    await seedConfigDefaults();
  }

  // 5. Final state summary
  const offerRow = await prisma.offer.findUnique({ where: { id: 1 } });
  const profileRow = await prisma.icpProfile.findUnique({ where: { id: 1 } });
  console.log('\n=== Final state ===');
  console.log(`Offer.problem:          ${offerRow?.problem ? '✓ configured' : '✗ EMPTY'}`);
  console.log(`ICP_Profile.industries: ${Array.isArray(profileRow?.industries) && profileRow.industries.length > 0 ? `✓ ${profileRow.industries.length} industries` : '✗ EMPTY'}`);
  console.log(`Persona config keys:    ${personaRows.length}/${personaKeys.length}`);
  console.log('\nfindLeads can now run without the fail-fast gate. Visit /settings/offer + /settings/icp-profile in the dashboard to review + tweak.');

  await resetDb();
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
