import React from 'react';

export const statusBadge = {
  discovered: 'badge-muted', extracted: 'badge-blue', ready: 'badge-green', queued: 'badge-amber',
  sent: 'badge-green', replied: 'badge-red', nurture: 'badge-muted', bounced: 'badge-red',
  email_not_found: 'badge-red', email_invalid: 'badge-red', judge_skipped: 'badge-muted',
  extraction_failed: 'badge-red', deduped: 'badge-muted', unsubscribed: 'badge-muted',
};

export function parseJson(val) {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function LinkedInLinks({ lead, compact = false }) {
  const items = [
    { url: lead.dm_linkedin_url, label: 'DM' },
    { url: lead.company_linkedin_url, label: 'Co' },
    { url: lead.founder_linkedin_url, label: 'Fo' },
  ].filter(x => x.url);
  if (items.length === 0) return null;
  return (
    <span className={compact ? 'li-icons-compact' : 'li-icons'}>
      {items.map((it, i) => (
        <a
          key={i}
          href={it.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          title={`LinkedIn (${it.label})`}
          className="li-icon"
        >
          in:{it.label}
        </a>
      ))}
    </span>
  );
}
