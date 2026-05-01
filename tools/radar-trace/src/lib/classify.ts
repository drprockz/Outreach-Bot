export type FunctionTag = 'eng' | 'sales' | 'marketing' | 'ops' | 'finance' | 'product' | 'design' | 'cs' | 'legal' | 'hr' | 'other';
export type SeniorityTag = 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | 'director' | 'vp' | 'c-level';

// Rules are evaluated in order — more specific tokens come first so e.g. "Sales Engineer"
// matches `sales` before falling through to `eng`. Tokens are matched against a
// space-padded lowercased title so short tokens like ` sre ` don't false-match inside
// longer words ("presreal").
const FUNCTION_RULES: Array<{ tag: FunctionTag; tokens: string[] }> = [
  { tag: 'sales',     tokens: ['sales', 'account executive', 'business development', ' bdr ', ' sdr '] },
  { tag: 'cs',        tokens: ['customer success', 'customer support', 'account manager'] },
  { tag: 'marketing', tokens: ['marketing', 'brand strat', 'growth', 'content strategist', 'demand gen', ' seo '] },
  { tag: 'design',    tokens: ['designer', ' design ', ' ux ', ' ui ', 'researcher'] },
  { tag: 'product',   tokens: ['product manager', 'product owner', ' pm '] },
  { tag: 'ops',       tokens: ['operations', ' ops ', 'supply chain', 'logistics'] },
  { tag: 'finance',   tokens: ['finance', 'accountant', 'controller', ' cfo'] },
  { tag: 'legal',     tokens: [' legal ', 'counsel', 'paralegal'] },
  { tag: 'hr',        tokens: ['recruiter', 'human resources', 'people ops', 'talent ', ' hr '] },
  { tag: 'eng',       tokens: ['engineer', 'developer', 'sdet', 'devops', ' sre ', 'infra', 'backend', 'frontend', 'fullstack'] },
];

const SENIORITY_RULES: Array<{ tag: SeniorityTag; tokens: string[] }> = [
  { tag: 'c-level',   tokens: [' ceo ', ' cto ', ' cfo ', ' coo ', ' cmo ', ' cpo ', 'chief '] },
  { tag: 'vp',        tokens: [' vp ', 'vice president'] },
  { tag: 'director',  tokens: ['director', 'head of'] },
  { tag: 'principal', tokens: ['principal'] },
  { tag: 'staff',     tokens: [' staff '] },
  { tag: 'senior',    tokens: ['senior', ' sr.'] },
  { tag: 'junior',    tokens: ['junior', ' jr.'] },
  { tag: 'intern',    tokens: ['intern'] },
];

export function classifyFunction(title: string): FunctionTag {
  const padded = ` ${title.toLowerCase()} `;
  for (const rule of FUNCTION_RULES) {
    if (rule.tokens.some((t) => padded.includes(t))) return rule.tag;
  }
  return 'other';
}

export function classifySeniority(title: string): SeniorityTag {
  const padded = ` ${title.toLowerCase()} `;
  for (const rule of SENIORITY_RULES) {
    if (rule.tokens.some((t) => padded.includes(t))) return rule.tag;
  }
  return 'mid';
}
