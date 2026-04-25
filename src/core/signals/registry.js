// Adapter registry. Chunks 2–3 will replace `null` entries with real adapter modules.
// Until then, requested adapter names resolve to a placeholder that returns no signals.

import * as googleNews from './adapters/googleNews.js';
import * as companyBlog from './adapters/companyBlog.js';
import * as indianPress from './adapters/indianPress.js';
import * as techStack from './adapters/techStack.js';
import * as careersPage from './adapters/careersPage.js';

const ALL_ADAPTERS = {
  google_news: googleNews,
  company_blog: companyBlog,
  indian_press: indianPress,
  tech_stack: techStack,
  careers_page: careersPage,
  cert_transparency: null,
  pagespeed: null,
  product_hunt: null,
  github: null,
  corp_filings: null,
};

function placeholderAdapter(name) {
  return {
    name,
    timeoutMs: 10000,
    async fetch() { return { source: name, signals: [], error: null, durationMs: 0 }; },
  };
}

export function getEnabledAdapters() {
  if (process.env.SIGNALS_ENABLED !== 'true') return [];
  const requested = (process.env.SIGNALS_ADAPTERS_ENABLED || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return requested
    .filter(n => n in ALL_ADAPTERS)
    .map(n => ALL_ADAPTERS[n] || placeholderAdapter(n));
}

export const _internal = { ALL_ADAPTERS, placeholderAdapter };
