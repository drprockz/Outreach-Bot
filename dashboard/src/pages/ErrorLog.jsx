import React, { useEffect, useState } from 'react';
import { api } from '../api';

const pageTitle = {
  fontSize: '20px',
  fontWeight: 600,
  color: '#e0e0e0',
  marginBottom: '24px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const filterRow = {
  display: 'flex',
  gap: '12px',
  marginBottom: '16px',
  flexWrap: 'wrap',
  alignItems: 'center',
};

const selectStyle = {
  padding: '8px 12px',
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: '6px',
  color: '#e0e0e0',
  fontSize: '12px',
  fontFamily: 'IBM Plex Mono, monospace',
  outline: 'none',
};

const unresolvedBadge = {
  display: 'inline-block',
  padding: '4px 12px',
  borderRadius: '4px',
  fontSize: '11px',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
  background: '#f8717120',
  color: '#f87171',
  marginBottom: '20px',
};

const tableContainer = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  overflow: 'auto',
  maxHeight: 'calc(100vh - 260px)',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '12px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const thStyle = {
  padding: '12px 14px',
  textAlign: 'left',
  background: '#222',
  color: '#888',
  fontWeight: 600,
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  borderBottom: '1px solid #333',
  position: 'sticky',
  top: 0,
  zIndex: 1,
};

const tdStyle = {
  padding: '10px 14px',
  borderBottom: '1px solid #1f1f1f',
  color: '#e0e0e0',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '300px',
};

const badgeBase = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '10px',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
};

const resolveBtn = {
  padding: '4px 10px',
  background: '#4ade8020',
  border: '1px solid #4ade8050',
  borderRadius: '4px',
  color: '#4ade80',
  fontSize: '10px',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
  cursor: 'pointer',
  transition: 'background 0.15s',
};

const sourceColors = {
  findLeads: '#60a5fa',
  sendEmails: '#4ade80',
  sendFollowups: '#facc15',
  checkReplies: '#fb923c',
  dailyReport: '#a78bfa',
  healthCheck: '#f87171',
  backup: '#888',
};

const typeColors = {
  smtp_error: '#f87171',
  api_error: '#fb923c',
  db_error: '#facc15',
  validation_error: '#60a5fa',
};

export default function ErrorLog() {
  const [data, setData] = useState({ errors: [], unresolvedCount: 0 });
  const [sourceFilter, setSourceFilter] = useState('');
  const [resolvedFilter, setResolvedFilter] = useState('');
  const [loading, setLoading] = useState(true);

  function fetchErrors() {
    setLoading(true);
    const params = new URLSearchParams();
    if (sourceFilter) params.set('source', sourceFilter);
    if (resolvedFilter !== '') params.set('resolved', resolvedFilter);
    const qs = params.toString() ? `?${params.toString()}` : '';
    api.errors(qs).then(d => {
      setData(d || { errors: [], unresolvedCount: 0 });
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { fetchErrors(); }, [sourceFilter, resolvedFilter]);

  async function handleResolve(id) {
    await api.resolveError(id);
    fetchErrors();
  }

  return (
    <div>
      <h1 style={pageTitle}>Error Log</h1>

      {data.unresolvedCount > 0 && (
        <div style={unresolvedBadge}>
          {data.unresolvedCount} unresolved error{data.unresolvedCount !== 1 ? 's' : ''}
        </div>
      )}

      <div style={filterRow}>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={selectStyle}>
          <option value="">All Sources</option>
          <option value="findLeads">findLeads</option>
          <option value="sendEmails">sendEmails</option>
          <option value="sendFollowups">sendFollowups</option>
          <option value="checkReplies">checkReplies</option>
          <option value="dailyReport">dailyReport</option>
          <option value="healthCheck">healthCheck</option>
          <option value="backup">backup</option>
        </select>
        <select value={resolvedFilter} onChange={e => setResolvedFilter(e.target.value)} style={selectStyle}>
          <option value="">All</option>
          <option value="0">Unresolved</option>
          <option value="1">Resolved</option>
        </select>
        <span style={{ color: '#555', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace' }}>
          {(data.errors || []).length} errors shown
        </span>
      </div>

      <div style={tableContainer}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Time</th>
              <th style={thStyle}>Source</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Message</th>
              <th style={thStyle}>Lead/Email</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#555' }}>Loading...</td></tr>
            ) : (data.errors || []).length === 0 ? (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#555' }}>No errors found.</td></tr>
            ) : data.errors.map((err, i) => {
              const sc = sourceColors[err.source || err.job_name] || '#888';
              const tc = typeColors[err.error_type] || '#888';
              return (
                <tr key={err.id} style={{ background: i % 2 === 0 ? 'transparent' : '#1f1f1f' }}>
                  <td style={{ ...tdStyle, color: '#555', fontSize: '10px' }}>
                    {err.occurred_at || err.created_at
                      ? new Date(err.occurred_at || err.created_at).toLocaleString()
                      : '-'}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ ...badgeBase, background: `${sc}20`, color: sc }}>
                      {err.source || err.job_name || '-'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ ...badgeBase, background: `${tc}20`, color: tc }}>
                      {err.error_type || '-'}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: '#aaa', maxWidth: '350px', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.4 }}>
                    {err.error_message || '-'}
                  </td>
                  <td style={{ ...tdStyle, color: '#555', fontSize: '10px' }}>
                    {err.lead_id ? `L:${err.lead_id}` : ''}{err.lead_id && err.email_id ? ' / ' : ''}{err.email_id ? `E:${err.email_id}` : ''}
                    {!err.lead_id && !err.email_id ? '-' : ''}
                  </td>
                  <td style={tdStyle}>
                    {err.resolved ? (
                      <span style={{ ...badgeBase, background: '#4ade8020', color: '#4ade80' }}>RESOLVED</span>
                    ) : (
                      <span style={{ ...badgeBase, background: '#f8717120', color: '#f87171' }}>OPEN</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {!err.resolved && (
                      <button
                        onClick={() => handleResolve(err.id)}
                        style={resolveBtn}
                      >
                        Resolve
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
