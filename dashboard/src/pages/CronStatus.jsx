import React, { useEffect, useState } from 'react';
import { api } from '../api';

const pageTitle = {
  fontSize: '20px',
  fontWeight: 600,
  color: '#e0e0e0',
  marginBottom: '24px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const alertBanner = {
  background: '#f8717118',
  border: '1px solid #f87171',
  borderRadius: '8px',
  padding: '12px 20px',
  marginBottom: '20px',
  color: '#f87171',
  fontSize: '12px',
  fontFamily: 'IBM Plex Mono, monospace',
  fontWeight: 600,
};

const jobGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: '16px',
  marginBottom: '32px',
};

const jobCardStyle = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  padding: '18px 20px',
};

const jobHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '12px',
};

const jobNameStyle = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#e0e0e0',
  fontFamily: 'IBM Plex Mono, monospace',
};

const badgeBase = {
  display: 'inline-block',
  padding: '3px 10px',
  borderRadius: '4px',
  fontSize: '10px',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
  textTransform: 'uppercase',
};

const statusConfig = {
  success:       { bg: '#4ade8020', color: '#4ade80', label: 'SUCCESS', dot: '#4ade80' },
  failed:        { bg: '#f8717120', color: '#f87171', label: 'FAILED', dot: '#f87171' },
  running:       { bg: '#facc1520', color: '#facc15', label: 'RUNNING', dot: '#facc15' },
  not_triggered: { bg: '#33333380', color: '#888',    label: 'NOT TRIGGERED', dot: '#555' },
  skipped:       { bg: '#55555520', color: '#555',    label: 'SKIPPED', dot: '#555' },
};

const detailRow = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '11px',
  fontFamily: 'IBM Plex Mono, monospace',
  marginBottom: '4px',
};

const detailLabel = { color: '#555' };
const detailValue = { color: '#aaa' };

const dateStyle = {
  fontSize: '12px',
  color: '#555',
  marginBottom: '20px',
  fontFamily: 'IBM Plex Mono, monospace',
};

function formatDuration(ms) {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  return `${min}m ${remainSec}s`;
}

function formatTime(datetime) {
  if (!datetime) return '-';
  try {
    return new Date(datetime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return datetime;
  }
}

export default function CronStatus() {
  const [data, setData] = useState({ jobs: [], date: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.cronStatus().then(d => {
      setData(d || { jobs: [], date: '' });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <h1 style={pageTitle}>Cron Job Status</h1>
        <div style={{ color: '#555', fontFamily: 'IBM Plex Mono, monospace' }}>Loading...</div>
      </div>
    );
  }

  const notTriggered = (data.jobs || []).filter(j => j.status === 'not_triggered');
  const failed = (data.jobs || []).filter(j => j.status === 'failed');

  return (
    <div>
      <h1 style={pageTitle}>Cron Job Status</h1>
      <div style={dateStyle}>Date: {data.date || 'Today'}</div>

      {notTriggered.length > 0 && (
        <div style={alertBanner}>
          NOT TRIGGERED: {notTriggered.map(j => {
            const label = j.pass ? `${j.name} (pass ${j.pass})` : j.name;
            return `${label} at ${j.time}`;
          }).join(', ')}
        </div>
      )}

      {failed.length > 0 && (
        <div style={{ ...alertBanner, background: '#f8717110', borderColor: '#f8717180' }}>
          FAILED: {failed.map(j => {
            const label = j.pass ? `${j.name} (pass ${j.pass})` : j.name;
            return label;
          }).join(', ')}
        </div>
      )}

      <div style={jobGridStyle}>
        {(data.jobs || []).map((job) => {
          const sc = statusConfig[job.status] || statusConfig.not_triggered;
          const log = job.log;
          const displayName = job.pass ? `${job.name} (pass ${job.pass})` : job.name;

          return (
            <div key={job.id} style={{ ...jobCardStyle, borderLeft: `3px solid ${sc.dot}` }}>
              <div style={jobHeaderStyle}>
                <span style={jobNameStyle}>{displayName}</span>
                <span style={{ ...badgeBase, background: sc.bg, color: sc.color }}>{sc.label}</span>
              </div>

              <div style={detailRow}>
                <span style={detailLabel}>Scheduled</span>
                <span style={detailValue}>{job.time} {job.day ? `(${job.day})` : ''}</span>
              </div>

              {log && (
                <>
                  <div style={detailRow}>
                    <span style={detailLabel}>Started</span>
                    <span style={detailValue}>{formatTime(log.started_at)}</span>
                  </div>
                  <div style={detailRow}>
                    <span style={detailLabel}>Completed</span>
                    <span style={detailValue}>{formatTime(log.completed_at)}</span>
                  </div>
                  <div style={detailRow}>
                    <span style={detailLabel}>Duration</span>
                    <span style={detailValue}>{formatDuration(log.duration_ms)}</span>
                  </div>
                  {(log.records_processed != null) && (
                    <div style={detailRow}>
                      <span style={detailLabel}>Records</span>
                      <span style={detailValue}>
                        {log.records_processed} processed{log.records_skipped ? ` / ${log.records_skipped} skipped` : ''}
                      </span>
                    </div>
                  )}
                  {log.cost_usd != null && (
                    <div style={detailRow}>
                      <span style={detailLabel}>Cost</span>
                      <span style={{ ...detailValue, color: '#facc15' }}>${log.cost_usd?.toFixed(4)}</span>
                    </div>
                  )}
                  {log.error_message && (
                    <div style={{ marginTop: '8px', padding: '8px', background: '#f8717110', borderRadius: '4px', fontSize: '10px', color: '#f87171', fontFamily: 'IBM Plex Mono, monospace', wordBreak: 'break-word' }}>
                      {log.error_message}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
