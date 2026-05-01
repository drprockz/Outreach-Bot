# Radar Trace

Radar Trace is the structured digital-footprint collection layer for the Radar pipeline. It runs up to 40 parallel data adapters across 9 signal modules — hiring activity, product velocity, customer proof, founder voice, operational health, market positioning, social presence, ad intelligence, and directory listings — and emits a single typed JSON dossier per company. Phase 1A scope is data collection only; AI synthesis (Phase 2) and temporal change monitoring (Phase 1.5) are separate, deferred layers.

**Spec:** [docs/superpowers/specs/2026-05-01-radar-trace-design.md](../../docs/superpowers/specs/2026-05-01-radar-trace-design.md)

---

## Quick start

```bash
cd tools/radar-trace
npm install
cp .env.example .env
# Fill in keys for the modules you plan to run (see .env.example for details)

# Validation run — free + Serper + Brave only (~₹2/lead)
npm run trace -- --company "Acme Corp" --domain acme.com --skip-paid

# Full trace — all modules including paid Apify (~₹500-620/lead)
npm run trace -- --company "Acme Corp" --domain acme.com

# Write output to file
npm run trace -- --company "Acme Corp" --domain acme.com --out profiles/acme.json
```

---

## Modules and adapters

| Module | Adapter | Description | Paid? |
|---|---|---|---|
| **hiring** | `hiring.adzuna` | Open roles from Adzuna API | No |
| **hiring** | `hiring.careers` | Careers page scrape (headcount signal) | No |
| **product** | `product.github_org` | GitHub org — repo count, stars, forks | No |
| **product** | `product.github_events` | Recent push/release events (activity) | No |
| **product** | `product.github_releases` | Latest release tags and release notes | No |
| **product** | `product.changelog` | `/changelog` page scrape | No |
| **product** | `product.rss` | Blog/update RSS feed | No |
| **product** | `product.sitemap` | Sitemap page count (surface area proxy) | No |
| **customer** | `customer.logos_current` | Logos on `/customers` or homepage | No |
| **customer** | `customer.wayback_diff` | Wayback Machine logo set diff (churn signal) | No |
| **voice** | `voice.founder_linkedin_url` | Founder LinkedIn profile URL (Serper) | No |
| **voice** | `voice.founder_github_url` | Founder GitHub profile URL (Serper) | No |
| **voice** | `voice.linkedin_pulse` | Founder LinkedIn article count (Serper) | No |
| **voice** | `voice.podcast_appearances` | Podcast appearances via Listen Notes | No |
| **voice** | `voice.youtube_channel` | Company YouTube channel stats | No |
| **voice** | `voice.linkedin_posts_apify` | Founder LinkedIn post history (Apify scraper) | **Yes** |
| **operational** | `operational.tech_stack` | Tech stack fingerprint (Wappalyzer-style) | No |
| **operational** | `operational.crtsh` | Certificate Transparency log (domain history) | No |
| **operational** | `operational.dns` | DNS records — MX, SPF, DMARC, NS | No |
| **operational** | `operational.pagespeed` | PageSpeed Insights score + CWV | No |
| **operational** | `operational.http_headers` | Security headers, server fingerprint | No |
| **operational** | `operational.robots_txt` | robots.txt — blocked paths, crawl policy | No |
| **operational** | `operational.whois` | WHOIS — registrar, creation date, expiry | No |
| **positioning** | `positioning.crunchbase_snippet` | Crunchbase description + tags (Serper) | No |
| **positioning** | `positioning.brave_news` | Recent news mentions (Brave Search API) | No |
| **positioning** | `positioning.serper_news` | Recent news mentions (Serper) | No |
| **social** | `social.links` | Social profile URLs from homepage | No |
| **social** | `social.twitter_posts_apify` | Recent tweets (Apify scraper) | **Yes** |
| **social** | `social.instagram_posts_apify` | Recent Instagram posts (Apify scraper) | **Yes** |
| **social** | `social.facebook_posts_apify` | Recent Facebook posts (Apify scraper) | **Yes** |
| **ads** | `ads.meta_library_url` | Meta Ad Library profile URL | No |
| **ads** | `ads.google_transparency_url` | Google Transparency Report URL | No |
| **ads** | `ads.meta_creatives_apify` | Active Meta ad creatives (Apify scraper) | **Yes** |
| **ads** | `ads.google_creatives_apify` | Active Google Search ad creatives (Apify scraper) | **Yes** |
| **directories** | `directories.zaubacorp` | Zaubacorp company filing data (India) | No |
| **directories** | `directories.ambitionbox` | AmbitionBox employee count + rating | No |
| **directories** | `directories.crunchbase_url` | Crunchbase profile URL | No |
| **directories** | `directories.linkedin_company_apify` | LinkedIn company page data (Apify scraper) | **Yes** |
| **directories** | `directories.g2_capterra` | G2/Capterra listing check (gated — Wave 2) | No |
| **directories** | `directories.glassdoor_apify` | Glassdoor reviews snapshot (Apify, gated — Wave 2) | **Yes** |

Adapters marked **Yes** require `APIFY_TOKEN` and incur per-run costs. Use `--skip-paid` to exclude them.

---

## CLI reference

```
npm run trace -- [options]
  (or: npx tsx src/cli.ts [options])

Input:
  -c, --company <name>         Company name (required)
  -d, --domain <domain>        Primary domain, e.g. acme.com (required)
  -l, --location <location>    "City, Country" — improves Adzuna + news results
  -f, --founder <name>         Founder/CEO name — improves voice.* adapter accuracy
      --linkedin <url>         Skip Serper resolution; supply founder LinkedIn URL directly

Adapter selection:
  -m, --modules <list>         Comma-separated module subset (default: all 9)
                               Valid: hiring,product,customer,voice,operational,
                                      positioning,social,ads,directories
  -a, --adapters <list>        Override --modules; run only these adapters
                               e.g. "hiring.adzuna,operational.crtsh"
                               (overrides --modules when set)
      --skip-paid              Skip all Apify-paid adapters (~₹2/lead validation mode)
                               Apify slots still appear in the dossier as status:'empty'
      --max-cost-inr <n>       Abort if pre-flight worst-case cost exceeds this INR cap
                               Pre-flight assumes all gates fire (conservative upper bound)

Output:
  -o, --out <path>             Write JSON dossier to file (default: stdout)

Cache:
      --no-cache               Skip cache reads; writes still happen
      --clear-cache            Wipe ./cache/ directory then exit

Performance:
      --concurrency <n>        Adapter parallelism (default: 4)
      --timeout <ms>           Per-adapter timeout in ms (default: 30000)

Logging:
  -v, --verbose                Per-adapter timing and cost summary on stderr
```

### Flag notes

- `--adapters` overrides `--modules` when set. Use it for surgical re-runs of a single source.
- `--linkedin <url>` bypasses the Serper-based founder URL resolution in `voice.founder_linkedin_url` and `voice.linkedin_posts_apify`. Use it when you already know the founder's LinkedIn profile — saves one Serper credit and runs faster.
- `--max-cost-inr` is a **pre-flight ceiling** computed before any adapter runs. It uses each adapter's `estimatedCostInr` field (worst-case, assumes all gates fire). Actual cost is always logged after the run and may be lower if gated adapters are skipped.
- `--skip-paid` and `--max-cost-inr` compose: `--skip-paid --max-cost-inr 5` caps free-tier spend.

---

## Cost economics

All numbers are per fully-traced lead. Apify costs are converted at `USD_INR_RATE` (default 84).

| Scale | Leads/day | Cost/lead | Monthly cost |
|---|---|---|---|
| Validation (skip-paid) | any | ~₹2 | Negligible |
| Production — free modules only | 34 | ~₹2 | ~₹2,040 |
| Production — full trace | 5 | ~₹500-620 | ~₹7,500-9,300 |
| Production — full trace | 34 | ~₹500-620 | ~₹51k-63k |
| Production — full trace | 150 | ~₹500-620 | ~₹225k-280k |

Per-module breakdown (full trace, always-on):

| Module | Cost/lead |
|---|---|
| Voice (Apify LinkedIn posts) | ~₹101 |
| Social (3x Apify social scrapers) | ~₹300 |
| Ads (Meta + Google Apify) | ~₹30-65 |
| Directories (LinkedIn Company Apify) | ~₹50 |
| Positioning (Serper + Brave) | ~₹1.10 |
| Hiring, Product, Customer, Operational | ₹0 |
| **Total (always-on)** | **~₹482-517** |

Wave 2 gated adapters add up to ₹100 (Glassdoor) if their gate fires, bringing the ceiling to ~₹617.

Validation cost for 5 real leads with full paid adapters: ~₹2,500-3,000.

---

## Troubleshooting

### Status meanings

| Status | Meaning |
|---|---|
| `ok` | Adapter ran successfully, payload populated |
| `partial` | Adapter ran but returned incomplete data (e.g. some fields missing) |
| `empty` | No data found — domain has no matching signal for this source |
| `error` | Adapter threw or timed out; `errors[]` field has the message |

### Common failure modes

**`status:'error'` with `APIFY_TOKEN` errors** — your Apify token is missing or expired. Set `APIFY_TOKEN=` in `.env`. Each Apify actor has its own pricing; check the Apify console for run usage.

**`status:'error'` with timeout** — increase `--timeout` (default 30000ms). Wayback Machine and Apify runs can take 20-60s each. Try `--timeout 90000`.

**`status:'empty'` for all voice adapters** — `SERPER_API_KEY` is missing or quota is exhausted. The free Serper tier allows 100 queries/month.

**`status:'error'` for `hiring.adzuna`** — `ADZUNA_APP_ID` or `ADZUNA_APP_KEY` is missing. Register at https://developer.adzuna.com/.

**`status:'error'` for `product.github_*`** — `GITHUB_TOKEN` is missing or rate-limited. Generate a token at https://github.com/settings/tokens (public_repo scope is sufficient).

**Apify anti-bot blocks** — some actors get blocked intermittently. Re-run the affected adapter using `--adapters <name>` after a brief delay. If consistently blocked, the actor may need a proxy upgrade in Apify settings.

### Validation-cost mode

To validate the system without spending on Apify:

```bash
npm run trace -- \
  --company "Acme Corp" \
  --domain acme.com \
  --location "Mumbai, India" \
  --founder "Jane Smith" \
  --skip-paid \
  --verbose \
  --out profiles/acme-validation.json
```

This runs all 33 free adapters (Serper, Brave, Listen Notes, GitHub, Adzuna, all scraper-free sources) and populates the remaining 7 Apify slots with `status:'empty'`. Total cost ~₹2.

---

## Promotion path

**Phase 1A (current):** data collection only. 40 adapters produce a raw JSON dossier. No AI interpretation, no historical comparison.

**Phase 1.5 (temporal monitoring):** add a Postgres store + daily diff engine. Detect when a company adds a hiring spike, drops social activity, or changes their tech stack week-over-week. Invest in this when 5+ real dossiers confirm the raw signals are informative.

**Phase 2 (AI synthesis):** Sonnet layer reads the Phase 1A dossier and writes a structured profile — pain point hypothesis, personalization hooks, ICP verdict. Replaces Stage 10 (hook generation) and Stage 11 (email body) in the current find-leads pipeline. Invest in this after Phase 1.5 confirms the signal quality is high enough to trust for automated hook generation.

**Promote to `apps/trace/`** once Phase 1.5 + Phase 2 are validated — move `tools/radar-trace/` into the monorepo workspace and wire it as a BullMQ worker alongside the existing `findLeads.worker.ts`.
