import React, { useEffect, useState } from 'react';
import { api } from '../api';
import StatCard from '../components/StatCard';

const deliveryBadge = {
  sent: 'badge-green', pending: 'badge-amber', hard_bounce: 'badge-red',
  soft_bounce: 'badge-orange', content_rejected: 'badge-muted',
};

const USD_TO_INR = 85;

export default function SendLog() {
  const [data, setData] = useState({ emails: [], total: 0, aggregates: {} });
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [inboxFilter, setInboxFilter] = useState('');
  const [stepFilter, setStepFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const limit = 25;

  function buildParams() {
    const p = new URLSearchParams();
    p.set('page', page);
    p.set('limit', limit);
    if (statusFilter) p.set('status', statusFilter);
    if (inboxFilter) p.set('inbox', inboxFilter);
    if (stepFilter !== '') p.set('step', stepFilter);
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    return `?${p.toString()}`;
  }

  function fetchData() {
    setLoading(true);
    api.sendLog(buildParams()).then(d => {
      setData(d || { emails: [], total: 0, aggregates: {} });
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, [page, statusFilter, inboxFilter, stepFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil((data.total || 0) / limit) || 1;
  const agg = data.aggregates || {};

  return (
    <div>
      <h1 className="page-title">Send Log</h1>

      <div className="stat-grid">
        <StatCard label="Total Sent" value={agg.total_sent || 0} color="var(--green)" className="fade-in stagger-1" />
        <StatCard label="Hard Bounces" value={agg.hard_bounces || 0} color="var(--red)" className="fade-in stagger-2" />
        <StatCard label="Soft Bounces" value={agg.soft_bounces || 0} color="var(--orange)" className="fade-in stagger-3" />
        <StatCard label="Content Rejected" value={agg.content_rejected || 0} color="var(--text-3)" className="fade-in stagger-4" />
        <StatCard label="Avg Duration" value={agg.avg_duration_ms ? `${(agg.avg_duration_ms / 1000).toFixed(1)}s` : '-'} color="var(--blue)" className="fade-in stagger-5" />
        <StatCard label="Total Cost" value={`$${(agg.total_cost || 0).toFixed(2)}`} sub={`~INR ${((agg.total_cost || 0) * USD_TO_INR).toFixed(0)}`} color="var(--amber)" className="fade-in stagger-6" />
      </div>

      <div className="filter-row">
        <select className="select" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="hard_bounce">Hard Bounce</option>
          <option value="soft_bounce">Soft Bounce</option>
          <option value="content_rejected">Content Rejected</option>
        </select>
        <select className="select" value={inboxFilter} onChange={e => { setInboxFilter(e.target.value); setPage(1); }}>
          <option value="">All Inboxes</option>
          <option value="darshan@trysimpleinc.com">darshan@</option>
          <option value="hello@trysimpleinc.com">hello@</option>
        </select>
        <select className="select" value={stepFilter} onChange={e => { setStepFilter(e.target.value); setPage(1); }}>
          <option value="">All Steps</option>
          <option value="0">Cold (Step 0)</option>
          <option value="1">Day 3 (Step 1)</option>
          <option value="2">Day 7 (Step 2)</option>
          <option value="3">Day 14 (Step 3)</option>
          <option value="4">Day 90 (Step 4)</option>
        </select>
        <input type="date" className="input" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} style={{ width: '130px' }} />
        <input type="date" className="input" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} style={{ width: '130px' }} />
        <span className="filter-count">{data.total || 0} emails</span>
      </div>

      <div className="table-wrap table-wrap-short">
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Subject</th>
              <th>Inbox</th>
              <th>Domain</th>
              <th>Step</th>
              <th>Status</th>
              <th>SMTP</th>
              <th>Words</th>
              <th>Duration</th>
              <th>Hook Model</th>
              <th>Body Model</th>
              <th>Cost</th>
              <th>Sent At</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13} className="td-muted text-center" style={{ padding: '40px' }}>Loading...</td></tr>
            ) : (data.emails || []).length === 0 ? (
              <tr><td colSpan={13} className="td-muted text-center" style={{ padding: '40px' }}>No emails found.</td></tr>
            ) : data.emails.map((email) => (
              <tr key={email.id}>
                <td>{email.business_name || '-'}</td>
                <td style={{ maxWidth: '220px' }}>{email.subject || '-'}</td>
                <td className="td-dim">{email.inbox_used || '-'}</td>
                <td className="td-dim">{email.from_domain || '-'}</td>
                <td className="td-center">{email.sequence_step ?? 0}</td>
                <td><span className={`badge ${deliveryBadge[email.status] || 'badge-muted'}`}>{email.status}</span></td>
                <td className="td-dim td-center">{email.smtp_code || '-'}</td>
                <td className="td-muted td-center">{email.word_count || '-'}</td>
                <td className="td-dim td-center">{email.send_duration_ms ? `${(email.send_duration_ms / 1000).toFixed(1)}s` : '-'}</td>
                <td className="td-dim">{email.hook_model ? email.hook_model.split('-').slice(0, 2).join('-') : '-'}</td>
                <td className="td-dim">{email.body_model ? email.body_model.split('-').slice(0, 2).join('-') : '-'}</td>
                <td style={{ color: 'var(--amber)', fontSize: '10px' }}>{email.total_cost_usd != null ? `$${(email.total_cost_usd || 0).toFixed(4)}` : '-'}</td>
                <td className="td-dim">{email.sent_at ? new Date(email.sent_at).toLocaleString() : '-'}</td>
              </tr>
            ))}
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
    </div>
  );
}
