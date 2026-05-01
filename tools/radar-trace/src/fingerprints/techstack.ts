export interface Fingerprint {
  name: string;
  category: 'analytics' | 'payments' | 'crm' | 'support' | 'cdp' | 'ecommerce' | 'cms' | 'auth' | 'monitoring' | 'search' | 'ads' | 'email' | 'experimentation' | 'other';
  scriptPatterns?: string[];   // substrings to match in <script src="...">
  linkPatterns?: string[];     // substrings to match in <link href="...">
  htmlPatterns?: string[];     // substrings to match anywhere in raw HTML
}

export interface DetectedTech {
  name: string;
  category: string;
  confidence: number;          // 0..1
}

export const TECHSTACK_FINGERPRINTS: Fingerprint[] = [
  // Analytics
  { name: 'Google Analytics 4', category: 'analytics', scriptPatterns: ['googletagmanager.com/gtag/js', 'google-analytics.com/analytics.js'] },
  { name: 'Google Tag Manager', category: 'analytics', scriptPatterns: ['googletagmanager.com/gtm.js'] },
  { name: 'Mixpanel',           category: 'analytics', scriptPatterns: ['cdn.mxpnl.com', 'mixpanel.com'] },
  { name: 'Amplitude',          category: 'analytics', scriptPatterns: ['cdn.amplitude.com', 'amplitude-analytics'] },
  { name: 'Heap',               category: 'analytics', scriptPatterns: ['cdn.heapanalytics.com', 'heap.io'] },
  { name: 'Plausible',          category: 'analytics', scriptPatterns: ['plausible.io/js'] },
  { name: 'Fathom',             category: 'analytics', scriptPatterns: ['cdn.usefathom.com'] },
  { name: 'PostHog',            category: 'analytics', scriptPatterns: ['posthog.com', 'app.posthog.com'] },
  // Payments
  { name: 'Stripe',             category: 'payments', scriptPatterns: ['js.stripe.com'] },
  { name: 'Razorpay',           category: 'payments', scriptPatterns: ['checkout.razorpay.com'] },
  { name: 'PayPal',             category: 'payments', scriptPatterns: ['paypal.com/sdk/js', 'paypalobjects.com'] },
  { name: 'Paddle',             category: 'payments', scriptPatterns: ['cdn.paddle.com', 'paddle.js'] },
  // CDP
  { name: 'Segment',            category: 'cdp', scriptPatterns: ['cdn.segment.com', 'segment.io'] },
  { name: 'Rudderstack',        category: 'cdp', scriptPatterns: ['rudderstack.com'] },
  // CRM / sales
  { name: 'HubSpot',            category: 'crm', scriptPatterns: ['hs-scripts.com', 'hubspot.com', 'hs-analytics.net'] },
  { name: 'Salesforce',         category: 'crm', scriptPatterns: ['salesforceliveagent.com', 'pardot.com', 'force.com'] },
  { name: 'Pipedrive',          category: 'crm', scriptPatterns: ['pipedrive.com'] },
  // Support
  { name: 'Intercom',           category: 'support', scriptPatterns: ['widget.intercom.io', 'js.intercomcdn.com'] },
  { name: 'Zendesk',            category: 'support', scriptPatterns: ['zdassets.com', 'zendesk.com'] },
  { name: 'Drift',              category: 'support', scriptPatterns: ['js.driftt.com'] },
  { name: 'Crisp',              category: 'support', scriptPatterns: ['client.crisp.chat'] },
  { name: 'Front',              category: 'support', scriptPatterns: ['frontapp.com'] },
  // Search
  { name: 'Algolia',            category: 'search', scriptPatterns: ['cdn.jsdelivr.net/npm/algoliasearch', 'algolianet.com'] },
  { name: 'Meilisearch',        category: 'search', scriptPatterns: ['meilisearch.com'] },
  // Auth
  { name: 'Auth0',              category: 'auth', scriptPatterns: ['cdn.auth0.com'] },
  { name: 'Clerk',              category: 'auth', scriptPatterns: ['clerk.dev', 'clerk.com'] },
  { name: 'WorkOS',             category: 'auth', scriptPatterns: ['workos.com'] },
  // Monitoring
  { name: 'Sentry',             category: 'monitoring', scriptPatterns: ['browser.sentry-cdn.com', 'sentry.io'] },
  { name: 'Datadog',            category: 'monitoring', scriptPatterns: ['datadoghq.com', 'datadog-rum'] },
  { name: 'LogRocket',          category: 'monitoring', scriptPatterns: ['cdn.logrocket.io'] },
  { name: 'FullStory',          category: 'monitoring', scriptPatterns: ['fullstory.com', 'fs.js'] },
  { name: 'Hotjar',             category: 'monitoring', scriptPatterns: ['static.hotjar.com'] },
  // CMS
  { name: 'WordPress',          category: 'cms', htmlPatterns: ['wp-content/', 'wp-includes/'] },
  { name: 'Webflow',            category: 'cms', htmlPatterns: ['data-wf-site=', 'webflow.com'] },
  { name: 'Framer',             category: 'cms', htmlPatterns: ['framerusercontent.com'] },
  { name: 'Sanity',             category: 'cms', scriptPatterns: ['sanity.io'] },
  // Ecommerce
  { name: 'Shopify',            category: 'ecommerce', htmlPatterns: ['cdn.shopify.com', 'shopify.com/s/'] },
  { name: 'WooCommerce',        category: 'ecommerce', htmlPatterns: ['woocommerce'] },
  { name: 'BigCommerce',        category: 'ecommerce', htmlPatterns: ['bigcommerce.com'] },
  // Ads
  { name: 'Facebook Pixel',     category: 'ads', scriptPatterns: ['connect.facebook.net'] },
  { name: 'LinkedIn Insight',   category: 'ads', scriptPatterns: ['snap.licdn.com'] },
  { name: 'Twitter Pixel',      category: 'ads', scriptPatterns: ['static.ads-twitter.com'] },
  { name: 'Reddit Pixel',       category: 'ads', scriptPatterns: ['redditstatic.com'] },
  // Email
  { name: 'Mailchimp',          category: 'email', scriptPatterns: ['mailchimp.com', 'mc.us'] },
  { name: 'ConvertKit',         category: 'email', scriptPatterns: ['convertkit.com'] },
  // Experimentation
  { name: 'GrowthBook',         category: 'experimentation', scriptPatterns: ['growthbook.io'] },
  { name: 'Optimizely',         category: 'experimentation', scriptPatterns: ['cdn.optimizely.com'] },
  { name: 'VWO',                category: 'experimentation', scriptPatterns: ['dev.visualwebsiteoptimizer.com'] },
];

export function detectTechStack(html: string): DetectedTech[] {
  const found = new Map<string, DetectedTech>();
  for (const fp of TECHSTACK_FINGERPRINTS) {
    let matched = false;
    if (fp.scriptPatterns?.some((p) => html.includes(p))) matched = true;
    if (!matched && fp.linkPatterns?.some((p) => html.includes(p))) matched = true;
    if (!matched && fp.htmlPatterns?.some((p) => html.includes(p))) matched = true;
    if (matched) {
      found.set(fp.name, { name: fp.name, category: fp.category, confidence: 1 });
    }
  }
  return [...found.values()];
}
