import React, { useState, useEffect } from 'react';
import { parseJson, statusBadge, LinkedInLinks } from './leadsTableHelpers';

const SORTABLE_COLS = {
  icp: 'icp_score',
  quality: 'website_quality_score',
  date: 'discovered_at',
};

export default function LeadsTable({
  leads,
  loading,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  sort,
  onSort,
  onOpenDetail,
}) {
  const [density, setDensity] = useState(
    () => localStorage.getItem('leads-density') || 'comfortable'
  );
  useEffect(() => {
    localStorage.setItem('leads-density', density);
  }, [density]);

  function handleHeader(col) {
    const key = SORTABLE_COLS[col];
    const [field, dir] = (sort || '').split(':');
    if (field !== key) return onSort(`${key}:desc`);
    if (dir === 'desc') return onSort(`${key}:asc`);
    return onSort('');
  }

  function sortIndicator(col) {
    const key = SORTABLE_COLS[col];
    const [field, dir] = (sort || '').split(':');
    if (field !== key) return '';
    return dir === 'desc' ? ' ▼' : ' ▲';
  }

  const allSelected = leads.length > 0 && leads.every(l => selectedIds.includes(l.id));

  return (
    <div className={`table-wrap ${density === 'dense' ? 'dense' : ''}`}>
      <div className="table-toolbar">
        <button
          className="btn"
          onClick={() => setDensity(d => (d === 'dense' ? 'comfortable' : 'dense'))}
        >
          {density === 'dense' ? 'Comfortable' : 'Dense'}
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                title="Select all on page"
              />
            </th>
            <th>Business</th>
            <th>Category</th>
            <th>Contact</th>
            <th>Email</th>
            <th>Email Status</th>
            <th onClick={() => handleHeader('icp')} style={{ cursor: 'pointer' }}>
              ICP{sortIndicator('icp')}
            </th>
            <th onClick={() => handleHeader('quality')} style={{ cursor: 'pointer' }}>
              Quality{sortIndicator('quality')}
            </th>
            <th>Status</th>
            <th>Signals</th>
            <th>Tech Stack</th>
            <th>City</th>
            <th onClick={() => handleHeader('date')} style={{ cursor: 'pointer' }}>
              Date{sortIndicator('date')}
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={13} className="td-muted text-center" style={{ padding: '40px' }}>
                Loading...
              </td>
            </tr>
          ) : leads.length === 0 ? (
            <tr>
              <td colSpan={13} className="td-muted text-center" style={{ padding: '40px' }}>
                No leads found.
              </td>
            </tr>
          ) : leads.map((lead) => {
            const tech = parseJson(lead.tech_stack);
            const signals = parseJson(lead.business_signals);
            const checked = selectedIds.includes(lead.id);
            return (
              <tr key={lead.id} className="cursor-pointer" onClick={() => onOpenDetail(lead)}>
                <td onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleSelect(lead.id)}
                  />
                </td>
                <td>
                  {lead.website_url ? (
                    <a
                      href={lead.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                    >
                      {lead.business_name || '-'}
                    </a>
                  ) : (
                    lead.business_name || '-'
                  )}
                  <LinkedInLinks lead={lead} compact />
                </td>
                <td className="td-muted">{lead.category || '-'}</td>
                <td className="td-muted">{lead.contact_name || '-'}</td>
                <td className="td-muted">{lead.contact_email || '-'}</td>
                <td>
                  {lead.email_status ? (
                    <span className={`badge ${lead.email_status === 'valid' ? 'badge-green' : lead.email_status === 'invalid' ? 'badge-red' : 'badge-amber'}`}>
                      {lead.email_status}
                    </span>
                  ) : '-'}
                </td>
                <td style={{ color: 'var(--amber)' }}>
                  {lead.icp_score ?? '-'}
                  {lead.icp_priority_v2 && (
                    <span
                      className={`badge badge-${lead.icp_bucket === 'high' ? 'green' : lead.icp_bucket === 'medium' ? 'amber' : 'muted'}`}
                      style={{ marginLeft: '6px' }}
                    >
                      {lead.icp_priority_v2}
                    </span>
                  )}
                </td>
                <td className="td-muted td-center">{lead.website_quality_score ?? '-'}</td>
                <td>
                  <span className={`badge ${statusBadge[lead.status] || 'badge-muted'}`}>
                    {lead.status || 'unknown'}
                  </span>
                </td>
                <td className="td-dim">
                  {signals.length > 0 ? signals.slice(0, 2).join(', ') : '-'}
                  {lead.signal_count > 0 && (
                    <span
                      className="badge badge-blue"
                      style={{ marginLeft: '6px' }}
                      title={`${lead.signal_count} aggregator signals — open detail to view`}
                    >
                      +{lead.signal_count}
                    </span>
                  )}
                </td>
                <td>
                  {tech.length > 0
                    ? tech.slice(0, 3).map((t, i) => (
                      <span key={i} className="badge badge-outline" style={{ marginRight: '3px' }}>{t}</span>
                    ))
                    : '-'}
                </td>
                <td className="td-muted">{lead.city || '-'}</td>
                <td className="td-dim">
                  {lead.discovered_at ? new Date(lead.discovered_at).toLocaleDateString() : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
