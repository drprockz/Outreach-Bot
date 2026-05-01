export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('domain is empty');
  let s = trimmed.toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^www\./, '');
  s = s.replace(/\/.*$/, '');
  return s;
}

export function toHttpsUrl(domain: string, path = '/'): string {
  const d = normalizeDomain(domain);
  const p = path.startsWith('/') ? path : `/${path}`;
  return `https://${d}${p}`;
}

export function basePath(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}
