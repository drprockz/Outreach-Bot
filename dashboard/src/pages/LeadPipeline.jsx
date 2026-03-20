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
  marginBottom: '20px',
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

const tableContainer = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  overflow: 'auto',
  maxHeight: 'calc(100vh - 220px)',
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
  maxWidth: '200px',
};

const badgeBase = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '10px',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
};

const priorityColors = {
  A: { background: '#4ade8030', color: '#4ade80' },
  B: { background: '#60a5fa30', color: '#60a5fa' },
  C: { background: '#88888830', color: '#888' },
};

const statusColors = {
  discovered: '#888',
  extracted: '#60a5fa',
  judge_skipped: '#555',
  email_not_found: '#f87171',
  email_invalid: '#f87171',
  ready: '#4ade80',
  queued: '#facc15',
  sent: '#4ade80',
  replied: '#f87171',
  nurture: '#888',
  contacted: '#4ade80',
  bounced: '#f87171',
  unsubscribed: '#555',
};

const paginationStyle = {
  display: 'flex',
  gap: '8px',
  justifyContent: 'center',
  alignItems: 'center',
  padding: '16px',
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: '12px',
  color: '#888',
};

const pageBtnStyle = {
  padding: '6px 14px',
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: '4px',
  color: '#e0e0e0',
  fontSize: '12px',
  fontFamily: 'IBM Plex Mono, monospace',
  cursor: 'pointer',
};

const statusOptions = ['', 'discovered', 'extracted', 'ready', 'queued', 'sent', 'contacted', 'replied', 'nurture', 'bounced', 'email_not_found', 'email_invalid', 'judge_skipped', 'unsubscribed'];
const priorityOptions = ['', 'A', 'B', 'C'];

export default function LeadPipeline() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [loading, setLoading] = useState(true);
  const limit = 25;

  function buildParams() {
    const parts = [`?page=${page}&limit=${limit}`];
    if (status) parts.push(`status=${status}`);
    if (priority) parts.push(`priority=${priority}`);
    return parts.join('&');
  }

  function fetchLeads() {
    setLoading(true);
    api.leads(buildParams()).then(d => {
      setLeads(d?.leads || []);
      setTotal(d?.total || 0);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { fetchLeads(); }, [page, status, priority]);

  const totalPages = Math.ceil(total / limit) || 1;

  function parseTechStack(ts) {
    if (!ts) return [];
    try { return JSON.parse(ts); } catch { return []; }
  }

  return (
    <div>
      <h1 style={pageTitle}>Lead Pipeline</h1>

      <div style={filterRow}>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All Statuses</option>
          {statusOptions.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={priority} onChange={e => { setPriority(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All Priorities</option>
          {priorityOptions.filter(Boolean).map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span style={{ color: '#555', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace' }}>{total} leads</span>
      </div>

      <div style={tableContainer}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Company</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Priority</th>
              <th style={thStyle}>ICP</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>CMS / Stack</th>
              <th style={thStyle}>City</th>
              <th style={thStyle}>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#555' }}>Loading...</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#555' }}>No leads found.</td></tr>
            ) : leads.map((lead, i) => {
              const techStack = parseTechStack(lead.tech_stack);
              return (
                <tr key={lead.id} style={{ background: i % 2 === 0 ? 'transparent' : '#1f1f1f' }}>
                  <td style={tdStyle}>
                    {lead.website_url ? (
                      <a href={lead.website_url} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'none' }}>
                        {lead.business_name || lead.company || '-'}
                      </a>
                    ) : (lead.business_name || lead.company || '-')}
                  </td>
                  <td style={{ ...tdStyle, color: '#888' }}>{lead.contact_email || '-'}</td>
                  <td style={tdStyle}>
                    {lead.icp_priority ? (
                      <span style={{ ...badgeBase, ...(priorityColors[lead.icp_priority] || {}) }}>
                        {lead.icp_priority}
                      </span>
                    ) : '-'}
                  </td>
                  <td style={{ ...tdStyle, color: '#facc15' }}>{lead.icp_score ?? '-'}</td>
                  <td style={tdStyle}>
                    <span style={{ ...badgeBase, background: `${statusColors[lead.status] || '#888'}20`, color: statusColors[lead.status] || '#888' }}>
                      {lead.status || 'unknown'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {techStack.length > 0 ? techStack.slice(0, 3).map((t, idx) => (
                      <span key={idx} style={{ ...badgeBase, background: '#33333380', color: '#aaa', marginRight: '4px' }}>{t}</span>
                    )) : '-'}
                  </td>
                  <td style={{ ...tdStyle, color: '#888' }}>{lead.city || '-'}</td>
                  <td style={{ ...tdStyle, color: '#555', fontSize: '10px' }}>
                    {lead.discovered_at ? new Date(lead.discovered_at).toLocaleDateString() : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={paginationStyle}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{ ...pageBtnStyle, opacity: page <= 1 ? 0.3 : 1 }}
          >
            Prev
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={{ ...pageBtnStyle, opacity: page >= totalPages ? 0.3 : 1 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
