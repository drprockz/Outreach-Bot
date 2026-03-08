import dns from 'dns/promises';

const BLOCKED_PREFIXES = ['info', 'admin', 'support', 'hello', 'contact', 'team', 'no-reply', 'noreply', 'mail', 'office'];

export async function verifyEmail(email) {
  const [prefix, domain] = email.toLowerCase().split('@');
  if (!domain) return false;
  if (BLOCKED_PREFIXES.some(p => prefix === p)) return false;
  try {
    const records = await dns.resolveMx(domain);
    return records && records.length > 0;
  } catch {
    return false;
  }
}
