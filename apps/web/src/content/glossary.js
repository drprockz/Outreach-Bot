// Central glossary for the dashboard. Keyed by id (stable) so labels can change
// without breaking tooltips. Each entry: { label, short, long? }.
// - short: shown in the ⓘ tooltip (under 12 words, a statement)
// - long (optional): anchor/docs link for the eventual help page

export const GLOSSARY = {
  bounceRate:     { label: 'bounce rate',     short: 'Emails that could not be delivered. Keep under 2% or sending auto-pauses.' },
  spamRate:       { label: 'spam rate',       short: 'Recipients marking your mail as junk. Under 0.1% is healthy.' },
  dmarc:          { label: 'DMARC',           short: 'Email authentication policy — who can send on your behalf.' },
  spf:            { label: 'SPF',             short: 'DNS record listing servers allowed to send mail for your domain.' },
  dkim:           { label: 'DKIM',            short: 'Cryptographic signature that proves mail came from your domain.' },
  icp:            { label: 'ICP',             short: 'Ideal Customer Profile — the kind of lead you want most.' },
  warmup:         { label: 'warmup',          short: "Gradual ramp of daily sends to build a new domain's reputation." },
  imap:           { label: 'IMAP',            short: 'Protocol used to read replies from an inbox.' },
  grounding:      { label: 'grounding',       short: 'Gemini feature that pulls live search results into prompts.' },
  mev:            { label: 'MEV',             short: 'MyEmailVerifier — paid service that checks email deliverability.' },
  rblZone:        { label: 'RBL zone',        short: 'Public blocklist. If your IP is listed, mail gets rejected.' },
  cron:           { label: 'cron',            short: 'Scheduled job that runs on a fixed clock.' },
  throttle:       { label: 'throttle',        short: 'Deliberate slowdown between sends to look human.' },
  deliverability: { label: 'deliverability',  short: 'How often your mail lands in the primary inbox (vs. spam).' },
};
