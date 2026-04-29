import React, { useEffect, useState } from 'react';
import { api } from '../api';
import PageHeader from '../components/radar/PageHeader';

const sourceBadge = {
  findLeads: 'badge-blue', sendEmails: 'badge-green', sendFollowups: 'badge-amber',
  checkReplies: 'badge-orange', dailyReport: 'badge-purple', healthCheck: 'badge-red', backup: 'badge-muted',
};

const typeBadge = {
  smtp_error: 'badge-red', api_error: 'badge-orange', db_error: 'badge-amber', validation_error: 'badge-blue',
};

export default function Errors() {
  const [data, setData] = useState({ errors: [], unresolvedCount: 0 });
  const [sourceFilter, setSourceFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [resolvedFilter, setResolvedFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);

  function fetchErrors() {
    setLoading(true);
    const params = new URLSearchParams();
    if (sourceFilter) params.set('source', sourceFilter);
    if (typeFilter) params.set('error_type', typeFilter);
    if (resolvedFilter !== '') params.set('resolved', resolvedFilter);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    const qs = params.toString() ? `?${params.toString()}` : '';
    api.errors(qs).then(d => {
      setData(d || { errors: [], unresolvedCount: 0 });
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { fetchErrors(); }, [sourceFilter, typeFilter, resolvedFilter, dateFrom, dateTo]);

  async function handleResolve(id) {
    await api.resolveError(id);
    fetchErrors();
  }

  return (
    <div>
      <PageHeader title="Errors" subtitle="System errors across all engines · last 24h" />

      {data.unresolvedCount > 0 && (
        <div className="alert alert-red mb-md">
          {data.unresolvedCount} unresolved error{data.unresolvedCount !== 1 ? 's' : ''}
        </div>
      )}

      <div className="filter-row">
        <select className="select" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
          <option value="">All Sources</option>
          <option value="findLeads">findLeads</option>
          <option value="sendEmails">sendEmails</option>
          <option value="sendFollowups">sendFollowups</option>
          <option value="checkReplies">checkReplies</option>
          <option value="dailyReport">dailyReport</option>
          <option value="healthCheck">healthCheck</option>
          <option value="backup">backup</option>
        </select>
        <select className="select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="smtp_error">SMTP Error</option>
          <option value="api_error">API Error</option>
          <option value="db_error">DB Error</option>
          <option value="validation_error">Validation Error</option>
        </select>
        <select className="select" value={resolvedFilter} onChange={e => setResolvedFilter(e.target.value)}>
          <option value="">All</option>
          <option value="0">Unresolved</option>
          <option value="1">Resolved</option>
        </select>
        <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From date" style={{ width: '140px' }} />
        <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To date" style={{ width: '140px' }} />
        <span className="filter-count">{(data.errors || []).length} errors shown</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Job</th>
              <th>Type</th>
              <th>Code</th>
              <th>Message</th>
              <th>Lead/Email</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="td-muted text-center" style={{ padding: '40px' }}>Loading...</td></tr>
            ) : (data.errors || []).length === 0 ? (
              <tr><td colSpan={9} className="td-muted text-center" style={{ padding: '40px' }}>No errors found.</td></tr>
            ) : data.errors.map((err) => (
              <tr key={err.id}>
                <td className="td-dim">{err.occurred_at ? new Date(err.occurred_at).toLocaleString() : '-'}</td>
                <td><span className={`badge ${sourceBadge[err.source] || 'badge-muted'}`}>{err.source || '-'}</span></td>
                <td className="td-dim">{err.job_name || '-'}</td>
                <td><span className={`badge ${typeBadge[err.error_type] || 'badge-muted'}`}>{err.error_type || '-'}</span></td>
                <td className="td-dim">{err.error_code || '-'}</td>
                <td className="td-wide" style={{ lineHeight: 1.4 }}>
                  {err.error_message || '-'}
                  {err.stack_trace && (
                    <details style={{ marginTop: '4px' }}>
                      <summary className="td-dim cursor-pointer" style={{ fontSize: '10px' }}>Stack trace</summary>
                      <pre className="td-dim" style={{ fontSize: '9px', whiteSpace: 'pre-wrap', marginTop: '4px', maxHeight: '100px', overflow: 'auto' }}>
                        {err.stack_trace}
                      </pre>
                    </details>
                  )}
                </td>
                <td className="td-dim">
                  {err.lead_id ? `L:${err.lead_id}` : ''}{err.lead_id && err.email_id ? ' / ' : ''}{err.email_id ? `E:${err.email_id}` : ''}
                  {!err.lead_id && !err.email_id ? '-' : ''}
                </td>
                <td>
                  {err.resolved ? (
                    <span className="badge badge-green">RESOLVED{err.resolved_at ? ` ${new Date(err.resolved_at).toLocaleDateString()}` : ''}</span>
                  ) : (
                    <span className="badge badge-red">OPEN</span>
                  )}
                </td>
                <td>
                  {!err.resolved && (
                    <button className="btn btn-green" onClick={() => handleResolve(err.id)}>Resolve</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
