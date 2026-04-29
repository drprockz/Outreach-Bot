import React, { useEffect, useState } from 'react';
import { api } from '../api';
import PageHeader from '../components/radar/PageHeader';

const statusConfig = {
  success:       { badge: 'badge-green', label: 'SUCCESS' },
  failed:        { badge: 'badge-red', label: 'FAILED' },
  running:       { badge: 'badge-amber', label: 'RUNNING' },
  not_triggered: { badge: 'badge-red', label: 'NOT TRIGGERED' },
  skipped:       { badge: 'badge-muted', label: 'SKIPPED' },
  pending:       { badge: 'badge-outline', label: 'PENDING' },
};

function formatDuration(ms) {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function formatTime(dt) {
  if (!dt) return '-';
  try { return new Date(dt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return dt; }
}

export default function ScheduleLogs() {
  const [data, setData] = useState({ jobs: [], date: '' });
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    api.cronStatus().then(d => {
      setData(d || { jobs: [], date: '' });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  function toggleHistory(jobKey, jobName) {
    if (expandedJob === jobKey) {
      setExpandedJob(null);
      return;
    }
    setExpandedJob(jobKey);
    setHistoryLoading(true);
    api.cronHistory(jobName).then(d => {
      setHistory(d?.history || []);
      setHistoryLoading(false);
    }).catch(() => setHistoryLoading(false));
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Schedule & Logs" subtitle="Cron jobs, run history, next-run windows" />
        <div className="loading">Loading...</div>
      </div>
    );
  }

  const notTriggered = (data.jobs || []).filter(j => j.status === 'not_triggered');
  const failed = (data.jobs || []).filter(j => j.status === 'failed');

  return (
    <div>
      <PageHeader title="Schedule & Logs" subtitle="Cron jobs, run history, next-run windows" />
      <div className="page-subtitle">Date: {data.date || 'Today'}</div>

      {notTriggered.length > 0 && (
        <div className="alert alert-red">
          ⚫ NOT TRIGGERED: {notTriggered.map(j => {
            const label = j.pass ? `${j.name} (pass ${j.pass})` : j.name;
            return `${label} at ${j.time}`;
          }).join(', ')}
        </div>
      )}

      {failed.length > 0 && (
        <div className="alert alert-red" style={{ opacity: 0.8 }}>
          🔴 FAILED: {failed.map(j => j.pass ? `${j.name} (pass ${j.pass})` : j.name).join(', ')}
        </div>
      )}

      <div className="job-grid mb-xl">
        {(data.jobs || []).map((job) => {
          const sc = statusConfig[job.status] || statusConfig.not_triggered;
          const log = job.log;
          const displayName = job.pass ? `${job.name} (pass ${job.pass})` : job.name;

          return (
            <div key={job.id} className="job-card" data-status={job.status}>
              <div className="job-header">
                <span className="job-name">{displayName}</span>
                <span className={`badge badge-lg ${sc.badge}`}>{sc.label}</span>
              </div>

              <div className="job-detail">
                <span className="job-detail-label">Scheduled</span>
                <span className="job-detail-value">{job.time} {job.day ? `(${job.day})` : ''}</span>
              </div>

              {log && (
                <>
                  <div className="job-detail">
                    <span className="job-detail-label">Started</span>
                    <span className="job-detail-value">{formatTime(log.started_at)}</span>
                  </div>
                  <div className="job-detail">
                    <span className="job-detail-label">Completed</span>
                    <span className="job-detail-value">{formatTime(log.completed_at)}</span>
                  </div>
                  <div className="job-detail">
                    <span className="job-detail-label">Duration</span>
                    <span className="job-detail-value">{formatDuration(log.duration_ms)}</span>
                  </div>
                  {log.records_processed != null && (
                    <div className="job-detail">
                      <span className="job-detail-label">Records</span>
                      <span className="job-detail-value">
                        {log.records_processed} processed{log.records_skipped ? ` / ${log.records_skipped} skipped` : ''}
                      </span>
                    </div>
                  )}
                  {log.cost_usd != null && (
                    <div className="job-detail">
                      <span className="job-detail-label">Cost</span>
                      <span className="job-detail-value" style={{ color: 'var(--amber)' }}>${log.cost_usd?.toFixed(4)}</span>
                    </div>
                  )}
                  {log.error_message && (
                    <div className="job-error">{log.error_message}</div>
                  )}
                </>
              )}

              <button
                className="btn btn-muted"
                style={{ marginTop: '10px', width: '100%', justifyContent: 'center' }}
                onClick={() => toggleHistory(`${job.name}-${job.pass || 0}`, job.name)}
              >
                {expandedJob === `${job.name}-${job.pass || 0}` ? 'Hide History' : 'View History (30 runs)'}
              </button>
            </div>
          );
        })}
      </div>

      {expandedJob && (
        <div className="fade-in">
          <div className="section-title">History: {expandedJob}</div>
          <div className="table-wrap" style={{ maxHeight: '350px' }}>
            {historyLoading ? (
              <div className="loading">Loading history...</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Records</th>
                    <th>Cost</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr><td colSpan={6} className="td-muted text-center" style={{ padding: '20px' }}>No history found.</td></tr>
                  ) : history.map((h) => {
                    const hsc = statusConfig[h.status] || statusConfig.not_triggered;
                    return (
                      <tr key={h.id}>
                        <td className="td-dim">{h.started_at ? new Date(h.started_at).toLocaleString() : '-'}</td>
                        <td><span className={`badge ${hsc.badge}`}>{hsc.label}</span></td>
                        <td className="td-muted">{formatDuration(h.duration_ms)}</td>
                        <td className="td-muted">{h.records_processed ?? '-'}{h.records_skipped ? ` / ${h.records_skipped} skipped` : ''}</td>
                        <td style={{ color: 'var(--amber)' }}>{h.cost_usd != null ? `$${h.cost_usd.toFixed(4)}` : '-'}</td>
                        <td className="td-dim td-wide">{h.error_message || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
