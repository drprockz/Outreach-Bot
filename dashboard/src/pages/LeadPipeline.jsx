import React, { useEffect, useState } from 'react';
import { api } from '../api';

const statusOptions = ['', 'discovered', 'extracted', 'ready', 'queued', 'sent', 'replied', 'nurture', 'bounced', 'email_not_found', 'email_invalid', 'judge_skipped', 'extraction_failed', 'icp_c', 'deduped', 'unsubscribed'];
const priorityOptions = ['', 'A', 'B', 'C'];

const priorityBadge = { A: 'badge-green', B: 'badge-blue', C: 'badge-muted' };
const statusBadge = {
  discovered: 'badge-muted', extracted: 'badge-blue', ready: 'badge-green', queued: 'badge-amber',
  sent: 'badge-green', replied: 'badge-red', nurture: 'badge-muted', bounced: 'badge-red',
  email_not_found: 'badge-red', email_invalid: 'badge-red', judge_skipped: 'badge-muted',
  extraction_failed: 'badge-red', icp_c: 'badge-muted', deduped: 'badge-muted', unsubscribed: 'badge-muted',
};

function parseJson(val) {
  if (!val) return [];
  try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export default function LeadPipeline() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [techStack, setTechStack] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const limit = 25;

  function buildParams() {
    const p = new URLSearchParams();
    p.set('page', page);
    p.set('limit', limit);
    if (status) p.set('status', status);
    if (priority) p.set('priority', priority);
    if (category) p.set('category', category);
    if (city) p.set('city', city);
    if (techStack) p.set('tech_stack', techStack);
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    return `?${p.toString()}`;
  }

  function fetchLeads() {
    setLoading(true);
    api.leads(buildParams()).then(d => {
      setLeads(d?.leads || []);
      setTotal(d?.total || 0);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { fetchLeads(); }, [page, status, priority, category, city, techStack, dateFrom, dateTo]);

  function openDetail(lead) {
    setSelectedLead(lead);
    api.lead(lead.id).then(d => setDetailData(d)).catch(() => setDetailData(null));
  }

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div>
      <h1 className="page-title">Lead Pipeline</h1>

      <div className="filter-row">
        <select className="select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          {statusOptions.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" value={priority} onChange={e => { setPriority(e.target.value); setPage(1); }}>
          <option value="">All Priorities</option>
          {priorityOptions.filter(Boolean).map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input className="input" placeholder="Category" value={category} onChange={e => { setCategory(e.target.value); setPage(1); }} style={{ width: '130px' }} />
        <input className="input" placeholder="City" value={city} onChange={e => { setCity(e.target.value); setPage(1); }} style={{ width: '110px' }} />
        <input className="input" placeholder="Tech Stack" value={techStack} onChange={e => { setTechStack(e.target.value); setPage(1); }} style={{ width: '130px' }} />
        <input type="date" className="input" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} style={{ width: '130px' }} />
        <input type="date" className="input" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} style={{ width: '130px' }} />
        <span className="filter-count">{total} leads</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Category</th>
              <th>Contact</th>
              <th>Email</th>
              <th>Email Status</th>
              <th>Priority</th>
              <th>ICP</th>
              <th>Quality</th>
              <th>Status</th>
              <th>Signals</th>
              <th>Tech Stack</th>
              <th>City</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13} className="td-muted text-center" style={{ padding: '40px' }}>Loading...</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={13} className="td-muted text-center" style={{ padding: '40px' }}>No leads found.</td></tr>
            ) : leads.map((lead) => {
              const tech = parseJson(lead.tech_stack);
              const signals = parseJson(lead.business_signals);
              return (
                <tr key={lead.id} className="cursor-pointer" onClick={() => openDetail(lead)}>
                  <td>
                    {lead.website_url ? (
                      <a href={lead.website_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                        {lead.business_name || '-'}
                      </a>
                    ) : (lead.business_name || '-')}
                  </td>
                  <td className="td-muted">{lead.category || '-'}</td>
                  <td className="td-muted">{lead.contact_name || '-'}</td>
                  <td className="td-muted">{lead.contact_email || '-'}</td>
                  <td>{lead.email_status ? <span className={`badge ${lead.email_status === 'valid' ? 'badge-green' : lead.email_status === 'invalid' ? 'badge-red' : 'badge-amber'}`}>{lead.email_status}</span> : '-'}</td>
                  <td>
                    {lead.icp_priority ? (
                      <span className={`badge ${priorityBadge[lead.icp_priority] || 'badge-muted'}`}>{lead.icp_priority}</span>
                    ) : '-'}
                  </td>
                  <td style={{ color: 'var(--amber)' }}>{lead.icp_score ?? '-'}</td>
                  <td className="td-muted td-center">{lead.website_quality_score ?? '-'}</td>
                  <td>
                    <span className={`badge ${statusBadge[lead.status] || 'badge-muted'}`}>{lead.status || 'unknown'}</span>
                  </td>
                  <td className="td-dim">{signals.length > 0 ? signals.slice(0, 2).join(', ') : '-'}</td>
                  <td>
                    {tech.length > 0 ? tech.slice(0, 3).map((t, i) => (
                      <span key={i} className="badge badge-outline" style={{ marginRight: '3px' }}>{t}</span>
                    )) : '-'}
                  </td>
                  <td className="td-muted">{lead.city || '-'}</td>
                  <td className="td-dim">{lead.discovered_at ? new Date(lead.discovered_at).toLocaleDateString() : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button className="page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
        </div>
      )}

      {selectedLead && (
        <>
          <div className="detail-overlay" onClick={() => { setSelectedLead(null); setDetailData(null); }} />
          <div className="detail-panel">
            <button className="detail-close" onClick={() => { setSelectedLead(null); setDetailData(null); }}>✕</button>
            <h2 className="detail-title">{selectedLead.business_name || 'Lead Detail'}</h2>

            <div className="detail-label">Website</div>
            <div className="detail-value">
              {selectedLead.website_url ? <a href={selectedLead.website_url} target="_blank" rel="noopener noreferrer">{selectedLead.website_url}</a> : '-'}
            </div>

            <div className="detail-label">Category</div>
            <div className="detail-value">{selectedLead.category || '-'}</div>

            <div className="detail-label">City / Country</div>
            <div className="detail-value">{selectedLead.city || '-'}{selectedLead.country ? `, ${selectedLead.country}` : ''}</div>

            <div className="detail-label">Owner</div>
            <div className="detail-value">{selectedLead.owner_name || '-'}{selectedLead.owner_role ? ` (${selectedLead.owner_role})` : ''}</div>

            <div className="detail-label">Contact</div>
            <div className="detail-value">
              {selectedLead.contact_name || '-'} — {selectedLead.contact_email || '-'}
              {selectedLead.contact_confidence && <span className="td-dim" style={{ marginLeft: '8px' }}>({selectedLead.contact_confidence})</span>}
            </div>

            <div className="detail-label">Email Status</div>
            <div className="detail-value">{selectedLead.email_status || '-'}</div>

            <div className="detail-label">Tech Stack</div>
            <div className="detail-value">
              {parseJson(selectedLead.tech_stack).map((t, i) => (
                <span key={i} className="badge badge-outline" style={{ marginRight: '4px', marginBottom: '4px' }}>{t}</span>
              ))}
              {parseJson(selectedLead.tech_stack).length === 0 && '-'}
            </div>

            <div className="detail-label">Website Quality Score</div>
            <div className="detail-value">{selectedLead.website_quality_score ?? '-'} / 10</div>

            <div className="detail-label">Judge Reason</div>
            <div className="detail-value">{selectedLead.judge_reason || '-'}</div>

            <div className="detail-label">Website Problems</div>
            <div className="detail-value">
              {parseJson(selectedLead.website_problems).length > 0
                ? parseJson(selectedLead.website_problems).map((p, i) => <div key={i} className="td-muted">- {p}</div>)
                : '-'}
            </div>

            <div className="detail-label">Business Signals</div>
            <div className="detail-value">
              {parseJson(selectedLead.business_signals).length > 0
                ? parseJson(selectedLead.business_signals).map((s, i) => <div key={i} className="td-muted">- {s}</div>)
                : '-'}
            </div>

            <div className="detail-label">ICP Score / Priority</div>
            <div className="detail-value">
              {selectedLead.icp_score ?? '-'} / {selectedLead.icp_priority || '-'}
              {selectedLead.icp_reason && <div className="td-dim" style={{ marginTop: '4px' }}>{selectedLead.icp_reason}</div>}
            </div>

            <div className="detail-label">Status</div>
            <div className="detail-value">
              <span className={`badge ${statusBadge[selectedLead.status] || 'badge-muted'}`}>{selectedLead.status}</span>
            </div>

            {detailData?.emails && detailData.emails.length > 0 && (
              <div className="detail-section">
                <div className="detail-section-title">Emails Sent</div>
                {detailData.emails.map((em, i) => (
                  <div key={i} className="detail-email-card">
                    <div style={{ color: 'var(--blue)', marginBottom: '4px', fontSize: '11px' }}>Step {em.sequence_step}: {em.subject || '(no subject)'}</div>
                    <div className="td-dim" style={{ marginBottom: '4px' }}>{em.sent_at ? new Date(em.sent_at).toLocaleString() : 'pending'} via {em.inbox_used || '-'}</div>
                    <div className="td-muted" style={{ fontSize: '11px', whiteSpace: 'pre-wrap', maxHeight: '80px', overflow: 'hidden' }}>{em.body || ''}</div>
                  </div>
                ))}
              </div>
            )}

            {detailData?.replies && detailData.replies.length > 0 && (
              <div className="detail-section">
                <div className="detail-section-title">Replies</div>
                {detailData.replies.map((r, i) => (
                  <div key={i} className="detail-reply-card">
                    <div style={{ color: 'var(--red)', marginBottom: '4px', fontSize: '11px' }}>{r.category || 'other'} — {r.received_at ? new Date(r.received_at).toLocaleString() : '-'}</div>
                    <div className="td-muted" style={{ fontSize: '11px', whiteSpace: 'pre-wrap', maxHeight: '80px', overflow: 'hidden' }}>{r.raw_text || ''}</div>
                  </div>
                ))}
              </div>
            )}

            {detailData?.sequence && (
              <div className="detail-section">
                <div className="detail-section-title">Sequence State</div>
                <div className="detail-value">
                  Step: {detailData.sequence.current_step} | Status: {detailData.sequence.status} | Next: {detailData.sequence.next_send_date || '-'}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
