import React, { useEffect, useState } from 'react';
import { api } from '../api';
import StatCard from '../components/StatCard';

const pageTitle = {
  fontSize: '20px',
  fontWeight: 600,
  color: '#e0e0e0',
  marginBottom: '24px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const gridStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '12px',
  marginBottom: '24px',
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

const tableContainer = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  overflow: 'auto',
  maxHeight: 'calc(100vh - 340px)',
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

const deliveryColors = {
  sent: { bg: '#4ade8020', color: '#4ade80' },
  pending: { bg: '#facc1520', color: '#facc15' },
  hard_bounce: { bg: '#f8717120', color: '#f87171' },
  soft_bounce: { bg: '#fb923c20', color: '#fb923c' },
  content_rejected: { bg: '#88888820', color: '#888' },
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

export default function SendLog() {
  const [data, setData] = useState({ emails: [], total: 0, aggregates: {} });
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [inboxFilter, setInboxFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const limit = 25;

  function buildParams() {
    const parts = [`?page=${page}&limit=${limit}`];
    if (statusFilter) parts.push(`status=${statusFilter}`);
    if (inboxFilter) parts.push(`inbox=${inboxFilter}`);
    return parts.join('&');
  }

  function fetchData() {
    setLoading(true);
    api.sendLog(buildParams()).then(d => {
      setData(d || { emails: [], total: 0, aggregates: {} });
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, [page, statusFilter, inboxFilter]);

  const totalPages = Math.ceil((data.total || 0) / limit) || 1;
  const agg = data.aggregates || {};
  const usdToInr = 85;

  return (
    <div>
      <h1 style={pageTitle}>Send Log</h1>

      <div style={gridStyle}>
        <StatCard label="Total Sent" value={agg.total_sent || 0} color="#4ade80" />
        <StatCard label="Hard Bounces" value={agg.hard_bounces || 0} color="#f87171" />
        <StatCard label="Soft Bounces" value={agg.soft_bounces || 0} color="#fb923c" />
        <StatCard label="Content Rejected" value={agg.content_rejected || 0} color="#888" />
        <StatCard label="Avg Duration" value={agg.avg_duration_ms ? `${(agg.avg_duration_ms / 1000).toFixed(1)}s` : '-'} color="#60a5fa" />
        <StatCard label="Total Cost" value={`$${(agg.total_cost || 0).toFixed(2)}`} sub={`~INR ${((agg.total_cost || 0) * usdToInr).toFixed(0)}`} color="#facc15" />
      </div>

      <div style={filterRow}>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All Statuses</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="hard_bounce">Hard Bounce</option>
          <option value="soft_bounce">Soft Bounce</option>
          <option value="content_rejected">Content Rejected</option>
        </select>
        <select value={inboxFilter} onChange={e => { setInboxFilter(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All Inboxes</option>
          <option value="darshan@trysimpleinc.com">darshan@</option>
          <option value="hello@trysimpleinc.com">hello@</option>
        </select>
        <span style={{ color: '#555', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace' }}>{data.total || 0} emails</span>
      </div>

      <div style={tableContainer}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Business</th>
              <th style={thStyle}>Subject</th>
              <th style={thStyle}>Inbox</th>
              <th style={thStyle}>Domain</th>
              <th style={thStyle}>Step</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Words</th>
              <th style={thStyle}>Duration</th>
              <th style={thStyle}>Cost</th>
              <th style={thStyle}>Sent At</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ ...tdStyle, textAlign: 'center', color: '#555' }}>Loading...</td></tr>
            ) : (data.emails || []).length === 0 ? (
              <tr><td colSpan={10} style={{ ...tdStyle, textAlign: 'center', color: '#555' }}>No emails found.</td></tr>
            ) : data.emails.map((email, i) => {
              const dc = deliveryColors[email.status] || { bg: '#88888820', color: '#888' };
              return (
                <tr key={email.id} style={{ background: i % 2 === 0 ? 'transparent' : '#1f1f1f' }}>
                  <td style={tdStyle}>{email.business_name || '-'}</td>
                  <td style={{ ...tdStyle, maxWidth: '250px' }}>{email.subject || '-'}</td>
                  <td style={{ ...tdStyle, color: '#888', fontSize: '10px' }}>{email.inbox_used || '-'}</td>
                  <td style={{ ...tdStyle, color: '#555', fontSize: '10px' }}>{email.from_domain || '-'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{email.sequence_step ?? 0}</td>
                  <td style={tdStyle}>
                    <span style={{ ...badgeBase, background: dc.bg, color: dc.color }}>{email.status}</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: '#888' }}>{email.word_count || '-'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: '#888', fontSize: '10px' }}>
                    {email.send_duration_ms ? `${(email.send_duration_ms / 1000).toFixed(1)}s` : '-'}
                  </td>
                  <td style={{ ...tdStyle, color: '#facc15', fontSize: '10px' }}>
                    {email.total_cost_usd != null
                      ? `$${(email.total_cost_usd || 0).toFixed(4)}`
                      : '-'}
                  </td>
                  <td style={{ ...tdStyle, color: '#555', fontSize: '10px' }}>
                    {email.sent_at ? new Date(email.sent_at).toLocaleString() : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={paginationStyle}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ ...pageBtnStyle, opacity: page <= 1 ? 0.3 : 1 }}>Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ ...pageBtnStyle, opacity: page >= totalPages ? 0.3 : 1 }}>Next</button>
        </div>
      )}
    </div>
  );
}
