# Radar Strategy & Research — 2026-04-24

Complete record of the strategic conversation that produced Move #1 (Signal Aggregator). Preserves reasoning, not just conclusions, so decisions can be revisited.

---

## Table of Contents

1. [Is Radar an agentic AI project?](#1-is-radar-an-agentic-ai-project)
2. [Would making it agentic improve the idea?](#2-would-making-it-agentic-improve-the-idea)
3. [AiSDR competitive teardown](#3-aisdr-competitive-teardown)
4. [LinkedIn scraping landscape — post-Proxycurl](#4-linkedin-scraping-landscape--post-proxycurl)
5. [How commercial scrapers actually work](#5-how-commercial-scrapers-actually-work)
6. [The manual-URL approach (ToS-safe)](#6-the-manual-url-approach-tos-safe)
7. [Signal sources catalog — full taxonomy](#7-signal-sources-catalog--full-taxonomy)
8. [Verified 2026 pricing](#8-verified-2026-pricing)
9. [Strategic moves for Radar — ranked](#9-strategic-moves-for-radar--ranked)
10. [Implementation phases](#10-implementation-phases)

---

## 1. Is Radar an agentic AI project?

**Answer: No — it's an AI-augmented pipeline, not agentic.**

Distinction:
- **Agentic AI** = LLM decides actions, loops, plans, uses tools autonomously (e.g., Claude Code, AutoGPT).
- **Radar** = deterministic cron pipelines that *call* LLMs at specific stages for narrow tasks (extract data, score ICP, write hook, classify reply). Control flow is hardcoded in `src/engines/*.js` + `src/scheduler/cron.js`.

In `findLeads.js`, the 11 stages run in fixed order. Gemini and Claude are used as "smart functions" (extract, score, generate copy, classify). No model chooses what to do next or loops until a goal is met. Same with `checkReplies.js` — Haiku classifies, code routes.

Better label: **AI-augmented workflow / LLM pipeline.**

---

## 2. Would making it agentic improve the idea?

**Short answer: No for the core pipeline, maybe yes for one narrow slice.**

### Why not for the main engine

Radar's value is *deterministic guardrails* — the non-negotiables in CLAUDE.md §7 (send window, word caps, bounce thresholds, no-links-in-step-0, reject_list). These are what keep `trysimpleinc.com` out of spam jail.

An agent that "decides" how to send is exactly what blows up domain reputation. You'd also lose:
- **Cost predictability** — your `CLAUDE_DAILY_SPEND_CAP=$3` assumes fixed calls per lead. Agentic loops burn tokens unpredictably.
- **Debuggability** — solo dev + nondeterministic loops = pain. When a cron pipeline breaks you know which stage; agent loops are much harder to audit.
- **Risk posture** — the bottlenecks are deliverability, volume, ICP targeting. None of these are fixed by "more agency."

### Where agentic could help narrowly

**Multi-turn reply conversations** once a prospect engages (step 2+). That's genuinely open-ended — qualifying, answering objections, booking a call — and today `checkReplies.js` just classifies and hands off.

A small reply-handling agent with tight tool scope (read thread, draft reply, schedule call, escalate to Darshan) is a defensible addition in **Move #2**. Not Move #1.

### Recommendation

Keep the pipeline deterministic, ship the ₹1L/mo goal first. Revisit agents when reply volume is worth automating.

---

## 3. AiSDR competitive teardown

### What AiSDR is

Full-stack AI SDR SaaS at ~$750–$3k/mo. Peers: 11x.ai Alice, Artisan Ava, Regie.ai, Reply.io Jason.

Core stack:
- **Prospect DB** — reseller of Apollo/ZoomInfo/Clearbit (~250M contacts, mostly US/EU)
- **Signal layer** — LinkedIn activity, funding, job changes, tech stack, intent data (Bombora/G2)
- **Personalization engine** — GPT-4-class + "writes in your voice" (few-shot on past emails)
- **Multi-channel** — email + LinkedIn DMs + SMS orchestrated
- **Autonomous replies** — qualifies, handles objections, books meetings via Calendly
- **CRM sync** — HubSpot/Salesforce, bi-directional
- **Deliverability** — bundled inbox warming, domain rotation
- **Reporting** — team dashboards

Pitch: "Replace a $70k/yr SDR."

### Head-to-head

| Dimension | AiSDR | Radar |
|---|---|---|
| Prospect data | Stale Apollo/ZoomInfo DB | **Live Gemini grounding** — fresher, especially India |
| India SMB coverage | Poor | **Strong** (core moat) |
| Personalization inputs | LinkedIn + news + intent | Website + basic tech fingerprint (today) |
| Writing | Style-mimic fine-tune | Generic Sonnet prompts (today) |
| Volume posture | 500–5000/day | **34/day, quality-first** |
| Reply handling | Autonomous, books meetings | Classify only (today) |
| Multi-channel | Email + LI + SMS | Email only |
| Tracking | Pixels/clicks | **Zero tracking** (deliverability moat) |
| Meeting booking | Built-in | None (today) |
| Cost | $750+/mo (~₹62k) | ~₹5.5k (~$66)/mo — **10× cheaper** |
| Who owns the stack | Vendor | **You** |
| Lock-in | High | None |

### Where Radar wins (keep these — they're the moat)

1. **Fresh India SMB discovery via Gemini grounding.** US databases are 6–18mo stale for Indian SMBs. Nobody else does this well.
2. **No-tracking posture.** Gmail's AI triage + Apple MPP increasingly penalize tracked cold mail. AiSDR hasn't caught up.
3. **Plain text + human cadence.** 34/day with 3–7min jitter reads like a human; 500/day burst-send does not.
4. **Cost structure.** 10× cheaper. At ₹1L MRR target, margin isn't an accident — it's the business.
5. **ICP C → nurture (not discard).** More nuanced than binary qualified/not.

### Where AiSDR is genuinely ahead (copy these)

**Tier 1 — next 4–6 weeks:**
1. **Signal-based personalization** (→ Move #1, specced in this doc).
2. **Agentic reply handler + Cal.com booking** — narrow agentic slice, converts reply → booked call 3–5×.
3. **Writing-style exemplars** — few-shot Darshan's past sent+replied emails into hook/body prompts.

**Tier 2 — month 2–3:**
4. **Per-hook A/B tracking** (`hook_variant_id` on emails).
5. **Conversion attribution** (reply rate by niche × hook type × ICP score × send hour).
6. **Funding/hiring structured signals** (part of Move #1).

**Tier 3 — Phase 2+:**
7. **LinkedIn as step-3+ follow-up** — connection request referencing email thread.
8. **Postgres + multi-tenant** (already planned; Postgres already done).
9. **Mobile PWA** (already planned).

### What NOT to copy (deliberate)

- ❌ Tracking pixels / open-click tracking — deliverability moat
- ❌ Volume inflation (500–5000/day) — 34/day is a feature
- ❌ Full LinkedIn scraping — lawsuit risk + thin India data
- ❌ Enterprise CRM integrations — pre-product, Prisma+Postgres is fine
- ❌ Bloated multi-user UI — solo-first until Phase 3
- ❌ Per-seat pricing — compete on outcome when productizing

### Positioning (for Phase 1.5+ productization)

> "AiSDR for India-first service businesses. 10× cheaper, zero-tracking deliverability, fresh Indian SMB data AiSDR's stack can't see."

Moats, durability order:
1. India SMB data freshness (Gemini grounding > stale Apollo) — structural
2. Deliverability craft (no-track, plain-text, human cadence) — compounds with domain age
3. Cost structure — 10× cheaper is a feature Indian agencies will pay for
4. Opinionated pipeline (ICP C → nurture, quality-first)

### Honest punchline

Radar will never be the best general-purpose AI SDR — AiSDR/11x/Artisan will always have more data, channels, features, funding. But it can be **the best cold outreach engine for India-first service agencies sending <100/day who care about deliverability more than volume** — a real market AiSDR ignores.

---

## 4. LinkedIn scraping landscape — post-Proxycurl

### What happened to Proxycurl

- **Jan 2025:** LinkedIn + Microsoft sued Proxycurl, alleging "hundreds of thousands of fake accounts" used to scrape via LinkedIn's internal Voyager API.
- **Jul 2025:** Proxycurl completely shut down after legal settlement.
- **Impact:** Any single LinkedIn vendor you pick in 2026 could be sued out of existence in 2027. Architect for swap-ability.

### Current alternatives (user's budget constraints: "not scrapin.io, not phantombuster, both too costly")

| Vendor | Effective cost (1.5k lookups/mo) | Model | Cookie/ban risk | Data quality |
|---|---|---|---|---|
| **Apify LinkedIn actors** | **$7.50–$15** | Pay-per-result, no commit | **Varies by actor** — some need your `li_at` cookie | Variable (community actors) |
| **LinkdAPI** | ~$15 (Hobby tier: 120 credits/$1) | Credit prepay, never expire | Low (cookieless API) | Clean, Proxycurl-style JSON |
| **Scrapingdog** | $40 (Lite: 4k profiles) | Monthly plan | Low (cookieless) | Inconsistent on profile depth |

**Preferred:** LinkdAPI as primary + Apify LinkedIn Company Scraper (by apimaestro) as fallback tier.

**Skipped:** Scrapin.io ($1.50/1k + ~$99/mo min), Phantombuster ($69+/mo + cookie ban risk), Scrapingdog (data gaps), BrightData (enterprise).

### Legal landscape

- **hiQ v. LinkedIn (2022):** CFAA doesn't apply to scraping *public* data. "Scraping is legal" headline — but hiQ still lost on ToS breach and settled into bankruptcy.
- **Proxycurl (2025):** Fake accounts = clear violation. Dead.
- **Mantheos (2022):** Fake Sales Navigator accounts = CFAA violation. Sued.

For a **solo dev at ≤100 lookups/day on public pages**, civil lawsuit risk is negligible (LinkedIn targets companies). But LinkedIn can still block IP ranges, and your outreach domain reputation is on the line.

---

## 5. How commercial scrapers actually work

Three architectures, all with real tradeoffs:

### (a) Voyager API replay with fake-account farms (Proxycurl's approach — dead)

- LinkedIn's own frontend uses internal GraphQL/Play API at `/voyager/api/...`
- Scrapers reverse-engineer endpoints (`/voyager/api/identity/dash/profiles`, `/voyager/api/organization/companies/...`)
- Authenticate via `li_at` + `JSESSIONID` cookies from **thousands of burner accounts**
- Rotate through accounts; sacrifice banned ones
- Gets you *everything* — profiles, posts, employees, connections
- **Fatal flaw:** Proxycurl pattern. Lawsuit-bait.

### (b) Headless browser + residential proxies on public pages (Bright Data style)

- No login, no cookies — scrape only logged-out HTML
- Playwright/Puppeteer with **stealth plugins** (`playwright-stealth`, `undetected-chromedriver`)
- **Residential proxy pools** — IPs from real home ISPs, rotated per request
- Fingerprint rotation: UA, screen resolution, WebGL vendor, timezone, fonts, TLS fingerprint
- Request pacing: 8–25s delays, 2–5min occasional pauses
- Yields only: company name, industry, size, HQ, about blurb, website link
- **Does NOT yield:** employee lists, recent posts, founder activity — ~80% of useful data is now behind "Sign in to see more"

### (c) BYO-cookie (Phantombuster + Apify actors)

- User hands over their own `li_at` cookie
- Scraper runs as *you* against Voyager API
- Full data access, but **your personal LinkedIn gets banned in weeks at scale**
- Vendor offloads risk to user — clever business, bad for you

### DIY analysis for Radar

| Approach | Monthly cost | Data yield | Risk | Maintenance |
|---|---|---|---|---|
| Public HTML + residential proxies (hiQ-style) | ~$75–150 (Smartproxy/Oxylabs) | Thin — company overview only | Low CFAA, medium ToS | **High** — selectors break every 2–4 weeks |
| Voyager API with your personal `li_at` | $0 | Rich | **Personal LI banned in weeks** | Medium |
| Voyager API with burner accounts | $100+ phone verification + accounts | Rich | **Lawsuit — Proxycurl pattern** | Very high |
| **Don't scrape LinkedIn** | $0 | — | None | None |

LinkedIn enforces:
- Voyager endpoints change every 4–8 weeks
- Public-page data shrinks each quarter
- Detection scores TLS + IP ASN + browser fingerprint + behavior via ML — Puppeteer's default fingerprint flagged in <100ms

**Conclusion:** LinkedIn scraping is a losing game for solo devs in 2026. Don't build it.

---

## 6. The manual-URL approach (ToS-safe)

### User's insight

Instead of scraping LinkedIn, Google-search for the company/founder's LinkedIn URL and surface to a human for manual review.

### Why this works legally

- **Google searching for public URLs** → 100% clean, no LinkedIn ToS relationship
- **Human clicking a LinkedIn URL and reading** → exactly what LinkedIn wants users to do
- ToS problem arises only when *automation* scrapes LinkedIn content
- If Radar stores only **URLs** (not page content), and human does any reading → **zero LinkedIn ToS exposure**

Apollo, Lusha, Clay, SalesQL all work this way — they surface the URL, you click.

### You already have the tool

**Gemini 2.5 Flash grounding is a Google search API with citations.** You're already using it in `findLeads.js`. The URLs it cites ARE Google search results.

Modify stage 6 (DM finder) prompt to also capture LinkedIn URLs from grounding citations:

```
Find the decision-maker at {company}. Return JSON:
{
  "dm_name": "...",
  "dm_email": "...",
  "dm_linkedin_url": "<if present in search results>",
  "company_linkedin_url": "<linkedin.com/company/... if present>",
  "founder_linkedin_url": "<if different from DM>"
}
Only include LinkedIn URLs that appear in your grounded search sources.
```

No scraping. No extra cost. No new vendor. URLs come from Google's index.

### Fallback when Gemini returns no URLs

Single deterministic Google search via **Serper.dev**:
- **$50/mo for 50,000 searches** (pay-as-you-go, credits last 6 months)
- Your volume: ~34 leads/day × ~1 fallback each = ~1,000/mo = **~$20/mo**
- Query: `"{company} {founder_name}" site:linkedin.com`

### Workflow

- `leads` table gets `dm_linkedin_url`, `company_linkedin_url`, `founder_linkedin_url` columns
- Dashboard Lead Pipeline shows `[🔗 LI-co] [🔗 LI-dm]` icons per lead
- Darshan clicks, reads with own logged-in LI session, approves/rejects
- Optional: `manual_hook_note` text field — one sentence from what he read → fed into hook prompt
- At 34/day: ~2min/lead × 34 = ~68 min/day review — feasible for ₹1L MRR goal

### Why this beats automated scraping

Counterintuitive: manual-in-the-loop at low volume **outperforms** scraped-and-automated at high volume for reply rates.

- Automated scrape → Claude: "I noticed your recent post about X" → prospect senses templated copy
- Human reads post → writes one authentic line → Claude weaves it in → prospect replies "you actually read this, unlike the 50 other emails I got today"

This is Radar's positioning: **quality at low volume**, not volume at low quality. The manual click isn't a bug — it's how you win.

---

## 7. Signal sources catalog — full taxonomy

Organized by **what the signal tells you**, not source type, because that's how they're consumed in `findLeads.js`.

### 7.1 "Are they in buying mode right now?" — Timing signals

Highest-value signals for cold outreach. A lead who just raised money or is hiring is 5–10× more likely to reply.

| Signal | Source | Cost | Legal | India quality | US quality |
|---|---|---|---|---|---|
| Funding rounds | Crunchbase free, **Inc42 RSS**, **YourStory RSS**, **Entrackr**, **VCCircle**, Gemini grounding | Free | Clean | Excellent | Good |
| Hiring surges | Company careers scrape, Indeed RSS, Naukri, AngelList, Google Jobs | Free | Clean | Excellent | Good |
| Layoffs | Layoffs.fyi, Google News | Free | Clean | Limited | Excellent |
| Product launches | **Product Hunt API**, Google News, blog RSS | Free | Clean | Growing | Excellent |
| New pricing page | Wayback Machine + diff, fetch + hash | Free | Clean | — | — |
| New subdomain | **crt.sh** cert transparency | Free | Clean | — | — |
| Executive hires | Google News, press releases | Free | Clean | Good | Excellent |
| Office expansion | Google News, company blog | Free | Clean | Good | Good |
| M&A activity | Tracxn free, Crunchbase, Google News | Free | Clean | Excellent | Excellent |
| Partnership announcements | Google News, company blog | Free | Clean | Good | Good |

**India insight:** Inc42, YourStory, Entrackr, VCCircle RSS give *better* funding/news signal on Indian SMBs than Crunchbase. Parse their RSS daily, tag by company domain — structural moat.

### 7.2 "Are they qualified?" — Company-fit signals

| Signal | Source | Cost | Legal |
|---|---|---|---|
| Tech stack | **Wappalyzer CLI** (free), BuiltWith free, Whatruns | Free–$30/mo | Clean |
| Hosting / ASN | `dig`, `whois`, ASN lookup | Free | Clean |
| CDN presence | Cloudflare/Akamai header detect | Free | Clean |
| Website age | WHOIS + Wayback | Free | Clean |
| Page speed / CWV | **PageSpeed Insights API** | Free (25k/day) | Clean |
| Mobile responsive | PageSpeed | Free | Clean |
| SSL grade | crt.sh, SSL Labs API | Free | Clean |
| Email infra (M365/GSuite/custom) | MX lookup | Free | Clean |
| Email auth maturity | DNS (already in `healthCheck.js`) | Free | Clean |
| Company size proxy | Job posts + team-page + Glassdoor | Free | Clean |
| Revenue proxy | Employees × industry multiplier + Tofler | Free–paid | Clean |
| Registered business | **MCA filings** (India), OpenCorporates, SEC EDGAR | Free | Clean |
| GST validation | GSTN public API | Free | Clean |

### 7.3 "What can Claude reference in the hook?" — Personalization signals

| Signal | Source | Cost | Legal |
|---|---|---|---|
| Latest blog post | Company blog RSS (`/feed`, `/rss`) | Free | Clean |
| Latest news mention | Google News RSS | Free | Clean |
| Founder Twitter/X | Twitter/X official API OR **Apify X scraper** | $0.005/read or $0.15/1k | Grey but cheap |
| Founder podcasts | Apple Podcasts API, Listen Notes API | Free tier | Clean |
| Founder quotes in press | Gemini grounding | ~Free | Clean |
| Conference talks | Nasscom/TiE/SaaSBoomi, YouTube search | Free | Clean |
| Open-source activity | GitHub API | Free (5k/hr) | Clean |
| Medium/Substack | RSS feed | Free | Clean |
| Customer testimonials | Testimonials page, G2, Trustpilot | Free | Clean |
| Homepage UX | Fetch homepage + Claude vision | ~Free | Clean |

**Goldmine:** fetch `{domain}/feed` or `/rss` for every lead. ~40% of SMBs have WordPress/Webflow/Ghost blogs with public RSS.

### 7.4 "Who is the decision-maker?" — Contact discovery

| Signal | Source | Cost | Legal |
|---|---|---|---|
| Founder name | Gemini grounding, press, MCA directors | Free | Clean |
| Team page | `/team`, `/about`, `/people` | Free | Clean |
| Email pattern | Hunter.io free (25/mo), Snov.io free | Free | Clean |
| Email verification | **MEV** (already in use) | Paid | Clean |
| Phone number | IndiaMART/JustDial/GMB, website footer | Free | Clean |
| LinkedIn URL | Gemini grounding | Free | Clean |
| Twitter handle | Google + founder name | Free | Clean |

### 7.5 "How serious is this business?" — Trust/maturity

| Signal | Source | Cost | Legal |
|---|---|---|---|
| Google Business rating | GMB, Google Maps Places API | Free (with limits) | Clean |
| Trustpilot/G2/Capterra | Public scrape | Free | Clean |
| App Store/Play rating | Public scrape | Free | Clean |
| Glassdoor | Public scrape | Free | Grey (anti-bot) |
| Justdial/Sulekha (India) | Public scrape | Free | Clean |
| Domain age | WHOIS | Free | Clean |
| Trademark filings | USPTO TESS, IP India | Free | Clean |
| Patent filings | Google Patents, USPTO | Free | Clean |
| MCA financials (India) | MCA21, Tofler free | Free | Clean |
| Zauba import/export (India) | Zauba scrape | Free | Clean |

### 7.6 Industry-specific signals

For Radar's 6-niche rotation (Mon D2C → Sat Healthcare):

| Niche | High-value signals |
|---|---|
| **D2C brands** | Shopify/WooCommerce detection, FB Ad Library, Instagram trajectory, Meta Pixel, product count, Judge.me reviews |
| **Real estate** | **MagicBricks, 99acres, Housing.com** listings, RERA registration |
| **Funded startups** | Crunchbase + Tracxn + Inc42 + AngelList |
| **Food/restaurants** | **Zomato/Swiggy** listings, ratings, review velocity, FSSAI license |
| **Agencies** | **Clutch, DesignRush, GoodFirms** portfolios, case study count |
| **Healthcare** | **Practo, Lybrate** profiles, NMC registration, clinic locations |

### 7.7 The India-specific moat (Radar's real edge)

These are essentially invisible to US tools:

| Source | What you get |
|---|---|
| Inc42 / YourStory / Entrackr RSS | Daily funding + launch news on Indian startups |
| MCA21 | Directors, registration, paid-up capital |
| Tofler free tier | Company financials, legal status |
| Zauba | Import/export = real business volume |
| GSTN | GST validation = real registered business |
| IndiaMART / TradeIndia | B2B manufacturer presence |
| Justdial / Sulekha | Local business + ratings |
| Naukri / AngelList India | Hiring signals |
| Moneycontrol / ET / VCCircle | Business press |
| Shram Suvidha / EPFO | Employee count via PF filings |

No US tool indexes this well. Gemini grounding does because it reads Google.

### 7.8 Signals to skip (bad ROI)

- Bombora / G2 Intent / 6sense — enterprise intent data, thousands/mo, US B2B SaaS buyers
- PitchBook / CB Insights — $$$, redundant with Crunchbase/Tracxn
- SEMrush / Ahrefs API — expensive, overkill unless SEO is your offer
- Full LinkedIn scraping — ruled out
- Glassdoor at scale — strong anti-bot
- SimilarWeb API — expensive, directional traffic only

### 7.9 Top 10 for Radar (ranked by ROI)

1. **Google News RSS** per-company query — funding, hiring, mentions
2. **Company blog RSS** auto-discovery — recent post reference
3. **Wappalyzer CLI** — tech stack → Gate 1 decisions
4. **Inc42 + YourStory + Entrackr RSS** — Indian funding moat
5. **Certificate transparency (crt.sh)** — new subdomain = new product
6. **PageSpeed Insights API** — performance pain → hook angle
7. **Gemini grounding** (already have) — founder names, LI URLs, recent quotes
8. **Company careers page** fetch + parse — hiring signals
9. **Product Hunt public API** — launch signal
10. **GitHub Org API** for tech-adjacent ICPs

Total monthly cost: **₹0**. All free, legal, stable, no vendor lock-in.

---

## 8. Verified 2026 pricing

Checked from source websites during the research session.

### Signal sources — paid options (enable only if free-tier lift is insufficient)

| Vendor | 2026 pricing (verified) | When to enable | Recommended for Radar |
|---|---|---|---|
| **LinkdAPI** | Testing 100 credits/$1 → Hobby 120/$1 (100–9,999 credits) → Developer 185/$1 (10k–30k) → Strategic 400/$1 (1M+). Credits never expire. | Post-Chunk 6 if LI signals prove valuable | ~$15/mo at 1.5k lookups |
| **Serper.dev** | Pay-as-you-go: $50 / 50k queries (~$1/1k) → scales to $0.30/1k at volume. Credits last 6 months. Free tier: 2,500 queries. | If Gemini grounding returns empty LI URLs too often | ~$20/mo at 1k fallbacks |
| **Apify X/Twitter scrapers** | `xquik/x-tweet-scraper` **$0.15/1K tweets** (cheapest). Twitter Scraper PPR $0.25/1k. EPCTEX $0.18/1k. | For D2C + funded startups (Indian founders on X > LI) | ~$5/mo at Radar scale |
| **Hunter.io** | Free: 50 credits/mo. Starter $49/mo (2k credits). Growth $149/mo (10k). ~30% off annual. | Skip — MEV already covers verification | — |
| **Twitter/X official API** | Pay-per-use: $0.005/post read, $0.01/post created. 2M reads/mo cap. Legacy Basic $200/mo (existing subscribers only). | Never — Apify is simpler and cheaper | — |
| **BuiltWith API** | Basic $295/mo (2 technologies). Pro $495/mo (unlimited). Team $995/mo (API tier). | Never — Wappalyzer CLI is free and equivalent | — |
| **Crunchbase API** | Enterprise-only, custom pricing. Standard subs $29–99/user/mo. | Never — Inc42/YourStory cover Indian market better | — |
| **Scrapingdog** | Lite $40/mo (4k profiles, ~$0.01/profile). Standard $90. Pro $200. | Skip — data quality inconsistent | — |
| **PhantomBuster** | $69+/mo + requires your LI cookie | Never — ban risk on personal LI account | — |
| **Bright Data** | Enterprise, sales call, opaque pricing | Never pre-Phase 3 | — |

### Projected Radar monthly cost

| Phase | Monthly add | Signals enabled |
|---|---|---|
| Phase 0 — free-only launch | **₹0** | All 14 free sources. Works alone. |
| Phase 1 — add paid if gaps show | **~$40 (~₹3,400)** | LinkdAPI ($15) + Serper.dev ($20) + Apify X ($5) |
| Ceiling (don't exceed) | **~$60 (~₹5,000)** | + Hunter Starter if email-pattern discovery becomes bottleneck |

Even at ceiling: **15× cheaper than AiSDR** (~₹62k/mo) with better India data.

### Sources

- [Proxycurl Shutdown (Nubela)](https://nubela.co/blog/goodbye-proxycurl/)
- [2026 Proxycurl Alternatives (DEV)](https://dev.to/agenthustler/best-proxycurl-alternative-in-2026-apify-linkedin-scrapers-vs-scrapingdog-vs-linkdapi-11n7)
- [LinkdAPI Pricing](https://linkdapi.com/pricing)
- [Scrapingdog LinkedIn API](https://scrapingdog.com/linkedin-scraper-api/)
- [Hunter.io Pricing](https://hunter.io/pricing)
- [Serper.dev](https://serper.dev/)
- [Apify X Tweet Scraper $0.15/1K](https://apify.com/xquik/x-tweet-scraper)
- [Apify Cheapest Twitter Scraper](https://apify.com/kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest/api)
- [BuiltWith Plans](https://builtwith.com/plans)
- [Twitter/X API Pricing 2026](https://postproxy.dev/blog/x-api-pricing-2026/)
- [hiQ v. LinkedIn (Wikipedia)](https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn)
- [How LinkedIn Scrapers Work (Scrapfly)](https://scrapfly.io/blog/posts/how-to-scrape-linkedin)

---

## 9. Strategic moves for Radar — ranked

### Move #1 — Signal Aggregator (this implementation)

**Status:** Specced + planned + execution started (blocked on test DB — see `docs/superpowers/status/2026-04-24-resume.md`)

**Goal:** ≥20% reply-rate lift (target +30–50%) via diversified free-tier signals feeding Claude Sonnet hook generation.

**Scope:** 10 adapters in `src/core/signals/adapters/` with orchestrator, feature flag, dashboard integration, A/B framework.

**Cost:** ₹0 added at Phase 0.

**Full spec:** `docs/superpowers/specs/2026-04-24-signal-aggregator.md`
**Full plan:** `docs/superpowers/plans/2026-04-24-signal-aggregator.md`

### Move #2 — Reply Agent + Cal.com Booking

**Status:** Not yet specced. Scheduled after Move #1 ships.

**Goal:** Convert engaged reply → booked call 3–5× via narrow agentic handler.

**Scope:**
- New engine `handleReplies.js` replacing the pure-classify step in `checkReplies.js`.
- Haiku classifies (existing) → if interested → Sonnet agent with tools: `read_thread`, `draft_reply`, `propose_slots` (Cal.com API), `escalate_to_darshan`.
- Bounded tool-use loop, max 3 turns.
- Dashboard reply approval UI.

**Cost:** Cal.com free tier + existing Claude spend.

### Move #3 — Writing-Style Exemplars

**Status:** Not yet specced. Scheduled after Move #1 proves lift.

**Goal:** Make Claude write in Darshan's voice, not generic Sonnet voice.

**Scope:**
- Collect last ~50 sent+replied emails (already in `emails` + `replies` tables).
- Add `style_exemplars` table — curated subset tagged by niche + tone.
- Stage 10 hook + body prompts use 5–10 exemplars as few-shot.
- No fine-tuning needed — prompt-level few-shot is sufficient at scale.

**Cost:** Token overhead only (~$0.05/lead, $40–50/mo at Radar volume).

### Moves deferred (Tier 2–3)

- Per-hook A/B tracking (Chunk 6 of Move #1)
- Conversion attribution analytics (Chunk 6 of Move #1)
- LinkedIn as step-3+ follow-up (Phase 2)
- Postgres migration (already done — CLAUDE.md is stale on this)
- Multi-tenant (Phase 1.5)
- Mobile PWA (Phase 1.5)

---

## 10. Implementation phases

Aligning with the existing CLAUDE.md roadmap:

### Phase 1 — Warmup + Pilot (Weeks 1–8, current)

Already underway. Move #1 slots in here:
- Ship Signal Aggregator (Chunks 1–5)
- Measure reply-rate lift over 8 weeks
- Gate on evidence before Move #2/#3

### Phase 1.5 — Productization prep (next ~1 month)

From CLAUDE.md + this session:
- Self-host migration (already in progress)
- SQLite → Postgres (**already done** — CLAUDE.md is stale)
- Add `tenant_id` to every table (nullable, default=1)
- PWA polish for phone-first ops
- **No signup/billing UI yet** — manually provisioned tenants

Move #1 Chunk 6 (A/B framework) lands here. Move #2 (reply agent) likely ships here too.

### Phase 2 — Scale (Months 2–3)

- 2nd domain + 4 more inboxes → 68/day
- Postmaster API once volume allows
- US East Coast window 19:30–21:30 IST
- LinkedIn as step-3+ follow-up (Tier 3 move)

### Phase 3 — Multi-tenant SaaS (Months 4–6)

- 3 domains, 9 inboxes, 150/day
- Redis + BullMQ
- "Done-for-you outbound setup" retainer productization
- Paid tier adapters (LinkdAPI, Serper, Apify X) likely enabled here as volume justifies

---

## Open questions / follow-ups

1. **CLAUDE.md stale** — section 1 says "SQLite via better-sqlite3 WAL mode at `db/radar.sqlite`" but repo is Prisma + Postgres. Separate small PR to correct.
2. **Test-DB setup** — current blocker for Move #1 execution. `radar_test` doesn't exist on remote server. See status doc.
3. **`corpFilings.js` experimental** — MCA/Tofler/Zauba anti-bot may force demotion. Decide at Chunk 3 review.
4. **`indianPress` match strategy** — may need relaxed matching (domain tokens) if global-filter hit rate <5%.
5. **Manual review workflow** — 68 min/day for Darshan to review 34 leads. May be worth the lift, may not. Measure at Chunk 5.

---

## End of research doc
