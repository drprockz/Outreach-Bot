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
  extraction_failed: '#f87171',
  judge_skipped: '#555',
  email_not_found: '#f87171',
  email_invalid: '#f87171',
  icp_c: '#888',
  deduped: '#555',
  ready: '#4ade80',
  queued: '#facc15',
  sent: '#4ade80',
  replied: '#f87171',
  nurture: '#888',
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

const statusOptions = ['', 'discovered', 'extracted', 'ready', 'queued', 'sent', 'replied', 'nurture', 'bounced', 'email_not_found', 'email_invalid', 'judge_skipped', 'extraction_failed', 'icp_c', 'deduped', 'unsubscribed'];
const priorityOptions = ['', 'A', 'B', 'C'];

const detailPanelStyle = {
  position: 'fixed',
  top: 0,
  right: 0,
  width: '420px',
  height: '100vh',
  background: '#141414',
  borderLeft: '1px solid #2a2a2a',
  zIndex: 100,
  overflowY: 'auto',
  padding: '24px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const detailOverlay = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: '100vh',
  background: 'rgba(0,0,0,0.5)',
  zIndex: 99,
};

const detailLabelStyle = {
  fontSize: '10px',
  color: '#555',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '2px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const detailValueStyle = {
  fontSize: '12px',
  color: '#e0e0e0',
  marginBottom: '12px',
  fontFamily: 'IBM Plex Mono, monospace',
  wordBreak: 'break-word',
};

const closeBtnStyle = {
  position: 'absolute',
  top: '16px',
  right: '16px',
  background: 'transparent',
  border: '1px solid #333',
  borderRadius: '4px',
  color: '#888',
  fontSize: '14px',
  cursor: 'pointer',
  padding: '4px 10px',
  fontFamily: 'IBM Plex Mono, monospace',
};

export default function LeadPipeline() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState(null);
  const [detailData, setDetailData] = useState(null);
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

  function openDetail(lead) {
    setSelectedLead(lead);
    api.lead(lead.id).then(d => setDetailData(d)).catch(() => setDetailData(null));
  }

  function closeDetail() {
    setSelectedLead(null);
    setDetailData(null);
  }

  const totalPages = Math.ceil(total / limit) || 1;

  function parseTechStack(ts) {
    if (!ts) return [];
    try { return JSON.parse(ts); } catch { return []; }
  }

  function parseJsonField(val) {
    if (!val) return [];
    try { return JSON.parse(val); } catch { return []; }
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
              <th style={thStyle}>Business</th>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Priority</th>
              <th style={thStyle}>ICP</th>
              <th style={thStyle}>Quality</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Tech Stack</th>
              <th style={thStyle}>City</th>
              <th style={thStyle}>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ ...tdStyle, textAlign: 'center', color: '#555' }}>Loading...</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={10} style={{ ...tdStyle, textAlign: 'center', color: '#555' }}>No leads found.</td></tr>
            ) : leads.map((lead, i) => {
              const techStack = parseTechStack(lead.tech_stack);
              return (
                <tr key={lead.id} style={{ background: i % 2 === 0 ? 'transparent' : '#1f1f1f', cursor: 'pointer' }} onClick={() => openDetail(lead)}>
                  <td style={tdStyle}>
                    {lead.website_url ? (
                      <a href={lead.website_url} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>
                        {lead.business_name || '-'}
                      </a>
                    ) : (lead.business_name || '-')}
                  </td>
                  <td style={{ ...tdStyle, color: '#888' }}>{lead.category || '-'}</td>
                  <td style={{ ...tdStyle, color: '#888' }}>{lead.contact_email || '-'}</td>
                  <td style={tdStyle}>
                    {lead.icp_priority ? (
                      <span style={{ ...badgeBase, ...(priorityColors[lead.icp_priority] || {}) }}>
                        {lead.icp_priority}
                      </span>
                    ) : '-'}
                  </td>
                  <td style={{ ...tdStyle, color: '#facc15' }}>{lead.icp_score ?? '-'}</td>
                  <td style={{ ...tdStyle, color: '#888', textAlign: 'center' }}>{lead.website_quality_score ?? '-'}</td>
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

      {selectedLead && (
        <>
          <div style={detailOverlay} onClick={closeDetail} />
          <div style={detailPanelStyle}>
            <button style={closeBtnStyle} onClick={closeDetail}>X</button>
            <h2 style={{ fontSize: '16px', color: '#e0e0e0', fontFamily: 'IBM Plex Mono, monospace', marginBottom: '20px', marginTop: '0' }}>
              {selectedLead.business_name || 'Lead Detail'}
            </h2>

            <div style={detailLabelStyle}>Website</div>
            <div style={detailValueStyle}>
              {selectedLead.website_url ? (
                <a href={selectedLead.website_url} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'none' }}>
                  {selectedLead.website_url}
                </a>
              ) : '-'}
            </div>

            <div style={detailLabelStyle}>Category</div>
            <div style={detailValueStyle}>{selectedLead.category || '-'}</div>

            <div style={detailLabelStyle}>City / Country</div>
            <div style={detailValueStyle}>{selectedLead.city || '-'}{selectedLead.country ? `, ${selectedLead.country}` : ''}</div>

            <div style={detailLabelStyle}>Owner</div>
            <div style={detailValueStyle}>{selectedLead.owner_name || '-'}{selectedLead.owner_role ? ` (${selectedLead.owner_role})` : ''}</div>

            <div style={detailLabelStyle}>Contact</div>
            <div style={detailValueStyle}>
              {selectedLead.contact_name || '-'} &mdash; {selectedLead.contact_email || '-'}
              {selectedLead.contact_confidence && <span style={{ color: '#555', marginLeft: '8px' }}>({selectedLead.contact_confidence})</span>}
            </div>

            <div style={detailLabelStyle}>Email Status</div>
            <div style={detailValueStyle}>{selectedLead.email_status || '-'}</div>

            <div style={detailLabelStyle}>Tech Stack</div>
            <div style={detailValueStyle}>
              {parseTechStack(selectedLead.tech_stack).map((t, i) => (
                <span key={i} style={{ ...badgeBase, background: '#33333380', color: '#aaa', marginRight: '4px', marginBottom: '4px' }}>{t}</span>
              ))}
              {parseTechStack(selectedLead.tech_stack).length === 0 && '-'}
            </div>

            <div style={detailLabelStyle}>Website Quality Score</div>
            <div style={detailValueStyle}>{selectedLead.website_quality_score ?? '-'} / 10</div>

            <div style={detailLabelStyle}>Judge Reason</div>
            <div style={detailValueStyle}>{selectedLead.judge_reason || '-'}</div>

            <div style={detailLabelStyle}>Website Problems</div>
            <div style={detailValueStyle}>
              {parseJsonField(selectedLead.website_problems).length > 0
                ? parseJsonField(selectedLead.website_problems).map((p, i) => <div key={i} style={{ color: '#aaa', marginBottom: '2px' }}>- {p}</div>)
                : '-'}
            </div>

            <div style={detailLabelStyle}>Business Signals</div>
            <div style={detailValueStyle}>
              {parseJsonField(selectedLead.business_signals).length > 0
                ? parseJsonField(selectedLead.business_signals).map((s, i) => <div key={i} style={{ color: '#aaa', marginBottom: '2px' }}>- {s}</div>)
                : '-'}
            </div>

            <div style={detailLabelStyle}>ICP Score / Priority</div>
            <div style={detailValueStyle}>
              {selectedLead.icp_score ?? '-'} / {selectedLead.icp_priority || '-'}
              {selectedLead.icp_reason && <div style={{ color: '#555', fontSize: '11px', marginTop: '4px' }}>{selectedLead.icp_reason}</div>}
            </div>

            <div style={detailLabelStyle}>Status</div>
            <div style={detailValueStyle}>
              <span style={{ ...badgeBase, background: `${statusColors[selectedLead.status] || '#888'}20`, color: statusColors[selectedLead.status] || '#888' }}>
                {selectedLead.status}
              </span>
            </div>

            {detailData?.emails && detailData.emails.length > 0 && (
              <>
                <div style={{ ...detailLabelStyle, marginTop: '16px', fontSize: '11px', color: '#888' }}>Emails Sent</div>
                {detailData.emails.map((em, i) => (
                  <div key={i} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '10px', marginBottom: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#60a5fa', marginBottom: '4px' }}>Step {em.sequence_step}: {em.subject || '(no subject)'}</div>
                    <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>{em.sent_at ? new Date(em.sent_at).toLocaleString() : 'pending'} via {em.inbox_used || '-'}</div>
                    <div style={{ fontSize: '11px', color: '#aaa', whiteSpace: 'pre-wrap', maxHeight: '80px', overflow: 'hidden' }}>{em.body || ''}</div>
                  </div>
                ))}
              </>
            )}

            {detailData?.replies && detailData.replies.length > 0 && (
              <>
                <div style={{ ...detailLabelStyle, marginTop: '16px', fontSize: '11px', color: '#888' }}>Replies</div>
                {detailData.replies.map((r, i) => (
                  <div key={i} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '10px', marginBottom: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#f87171', marginBottom: '4px' }}>{r.category || 'other'} &mdash; {r.received_at ? new Date(r.received_at).toLocaleString() : '-'}</div>
                    <div style={{ fontSize: '11px', color: '#aaa', whiteSpace: 'pre-wrap', maxHeight: '80px', overflow: 'hidden' }}>{r.raw_text || ''}</div>
                  </div>
                ))}
              </>
            )}

            {detailData?.sequence && (
              <>
                <div style={{ ...detailLabelStyle, marginTop: '16px', fontSize: '11px', color: '#888' }}>Sequence State</div>
                <div style={detailValueStyle}>
                  Step: {detailData.sequence.current_step} | Status: {detailData.sequence.status} | Next: {detailData.sequence.next_send_date || '-'}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
