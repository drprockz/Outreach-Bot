import dns from 'dns';

const BLACKLISTS = [
  'dbl.spamhaus.org',
  'b.barracudacentral.org',
  'multi.surbl.org'
];

// Spamhaus sentinel responses that mean "query error / rate limited", NOT a real listing.
// https://www.spamhaus.org/news/article/807/public-mirrors-and-dnsbl-query-status
//   127.255.255.254  — public DNSBL query blocked; free DQS subscription required
//   127.255.255.255  — query source blocked (e.g. from a commercial IP / too many queries)
// Real listings live in 127.0.x.x (e.g. Spamhaus DBL uses 127.0.1.x).
const SENTINEL_RESPONSES = new Set(['127.255.255.254', '127.255.255.255']);

function isRealListing(addresses) {
  if (!addresses || addresses.length === 0) return false;
  return addresses.some(a => !SENTINEL_RESPONSES.has(a));
}

/**
 * @param {string} domain  e.g. 'trysimpleinc.com'
 * @returns {Promise<{ clean: boolean, zones: string[], unknown: string[] }>}
 *   - clean: true if no real listings confirmed
 *   - zones: zones that returned a real listing code (127.0.x.x range)
 *   - unknown: zones whose query was rate-limited or blocked (sentinel responses).
 *     Treated as "clean" for sending decisions — we won't pause on ambiguity.
 */
export async function checkDomain(domain) {
  const listed = [];
  const unknown = [];

  await Promise.all(BLACKLISTS.map(async (bl) => {
    const query = `${domain}.${bl}`;
    try {
      const addresses = await dns.promises.resolve(query);
      if (isRealListing(addresses)) {
        listed.push(bl);
      } else {
        // Sentinel response — query blocked/rate-limited. Don't pause on this alone.
        unknown.push(bl);
      }
    } catch {
      // ENOTFOUND = not listed. Expected for a clean domain.
    }
  }));

  return { clean: listed.length === 0, zones: listed, unknown };
}
