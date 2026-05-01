import type { AdapterResult, CompanyInput } from '../types.js';
import type { HiringPayload } from '../adapters/hiring.js';
import type { ProductPayload } from '../adapters/product.js';
import type { CustomerPayload } from '../adapters/customer.js';
import type { OperationalPayload } from '../adapters/operational.js';

export interface RealModulePayloads {
  hiring: AdapterResult<unknown>;
  product: AdapterResult<unknown>;
  customer: AdapterResult<unknown>;
  operational: AdapterResult<unknown>;
}

export interface InternalSignal {
  signalType: string;
  headline: string;
  url?: string;
  confidence: number;   // internal — drives top-3 selection in Stage 10's prompt
}

export interface SynthesizedContext {
  lead: { business_name: string; website_url: string; manual_hook_note: string | null };
  persona: { role: string };
  signals: InternalSignal[];   // sorted by confidence desc
}

export function mapContext(input: CompanyInput, modules: RealModulePayloads): SynthesizedContext {
  const lead = {
    business_name: input.name,
    website_url: input.domain,
    manual_hook_note: null,
  };

  const operational = modules.operational.status === 'ok' || modules.operational.status === 'partial'
    ? (modules.operational.payload as OperationalPayload | null)
    : null;
  const persona = { role: inferPersonaRole(operational) };

  const signals: InternalSignal[] = [];
  if (modules.hiring.status === 'ok' || modules.hiring.status === 'partial') {
    pushHiringSignals(signals, modules.hiring.payload as HiringPayload | null);
  }
  if (modules.product.status === 'ok' || modules.product.status === 'partial') {
    pushProductSignals(signals, modules.product.payload as ProductPayload | null);
  }
  if (modules.customer.status === 'ok' || modules.customer.status === 'partial') {
    pushCustomerSignals(signals, modules.customer.payload as CustomerPayload | null);
  }
  if (operational) pushOperationalSignals(signals, operational);

  signals.sort((a, b) => b.confidence - a.confidence);
  return { lead, persona, signals };
}

/**
 * Strip the internal `confidence` field for the shape Stage 10's `regenerateHook`
 * actually consumes (`{signalType, headline, url}`).
 */
export function toStage10Signals(signals: InternalSignal[]): Array<{ signalType: string; headline: string; url?: string }> {
  return signals.map(({ confidence: _c, ...rest }) => rest);
}

function inferPersonaRole(op: OperationalPayload | null): string {
  if (!op) return 'founder';
  const techNames = new Set(op.techStack.map((t) => t.name.toLowerCase()));
  const hasDashboardSubdomain = op.subdomains.some((s) => /^(app|dashboard|admin|portal|console)\./i.test(s));
  if ((techNames.has('stripe') || techNames.has('razorpay')) && techNames.has('segment') && hasDashboardSubdomain) {
    return 'B2B SaaS founder';
  }
  if (techNames.has('shopify') || techNames.has('woocommerce') || techNames.has('bigcommerce')) {
    return 'ecommerce operator';
  }
  return 'founder';
}

function pushHiringSignals(out: InternalSignal[], h: HiringPayload | null): void {
  if (!h) return;
  for (const job of h.rawJobs) {
    if (!job.date) continue;
    const ageDays = (Date.now() - Date.parse(job.date)) / 86400000;
    if (ageDays > 30 || isNaN(ageDays)) continue;
    if (['senior', 'staff', 'principal', 'director', 'vp', 'c-level'].includes(job.seniority)) {
      out.push({
        signalType: 'hiring_senior',
        headline: `Opened ${job.title}${job.location ? ` in ${job.location}` : ''} (${job.date})`,
        url: job.url ?? undefined,
        confidence: 0.85,
      });
    }
  }
  for (const fn of h.newRoleTypes) {
    out.push({
      signalType: 'hiring_new_function',
      headline: `First ${fn} hire in 90d`,
      confidence: 0.9,
    });
  }
}

function pushProductSignals(out: InternalSignal[], p: ProductPayload | null): void {
  if (!p) return;
  for (const repo of p.recentNewRepos) {
    out.push({
      signalType: 'product_repo_new',
      headline: `New public repo: ${repo.name}${repo.createdAt ? ` (${repo.createdAt.slice(0, 10)})` : ''}`,
      url: repo.url,
      confidence: 0.7,
    });
  }
  for (const rel of p.recentReleases) {
    out.push({
      signalType: 'product_release',
      headline: `Released ${rel.tag}${rel.title ? `: ${rel.title}` : ''}`,
      url: rel.url,
      confidence: 0.85,
    });
  }
  for (const e of p.changelogEntries.slice(0, 5)) {
    out.push({
      signalType: 'product_changelog',
      headline: `Shipped: ${e.title}`,
      url: e.url ?? undefined,
      confidence: 0.8,
    });
  }
}

function pushCustomerSignals(out: InternalSignal[], c: CustomerPayload | null): void {
  if (!c) return;
  for (const logo of c.addedLogosLast90d) {
    out.push({ signalType: 'customer_added', headline: `Added logo: ${logo}`, confidence: 0.9 });
  }
  for (const pc of c.pricingChanges) {
    out.push({ signalType: 'pricing_change', headline: `Pricing changed on ${pc.detectedAt.slice(0, 10)}`, url: pc.currentSnapshotUrl, confidence: 0.75 });
  }
  for (const h of c.heroChanges) {
    out.push({ signalType: 'positioning_change', headline: `Homepage hero changed on ${h.detectedAt.slice(0, 10)}`, confidence: 0.7 });
  }
}

function pushOperationalSignals(out: InternalSignal[], op: OperationalPayload): void {
  for (const tool of op.techStack) {
    out.push({ signalType: 'tech_added', headline: `Added ${tool.name} to stack`, confidence: 0.6 });
  }
  for (const sub of op.notableSubdomains) {
    out.push({ signalType: 'subdomain_notable', headline: `Subdomain ${sub} is live`, confidence: 0.75 });
  }
}
