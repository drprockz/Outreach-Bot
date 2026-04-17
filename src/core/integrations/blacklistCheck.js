import dns from 'dns';

const BLACKLISTS = [
  'dbl.spamhaus.org',
  'b.barracudacentral.org',
  'multi.surbl.org'
];

/**
 * @param {string} domain  e.g. 'trysimpleinc.com'
 * @returns {Promise<{ clean: boolean, zones: string[] }>}
 */
export async function checkDomain(domain) {
  const listed = [];

  await Promise.all(BLACKLISTS.map(async (bl) => {
    const query = `${domain}.${bl}`;
    try {
      await dns.promises.resolve(query);
      listed.push(bl); // if resolves, domain IS listed
    } catch {
      // ENOTFOUND = not listed — expected and OK
    }
  }));

  return { clean: listed.length === 0, zones: listed };
}
