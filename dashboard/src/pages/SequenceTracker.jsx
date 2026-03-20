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

const tableContainer = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  overflow: 'auto',
  maxHeight: 'calc(100vh - 280px)',
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
};

const badgeBase = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '10px',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
};

const seqStatusColors = {
  active:       { bg: '#4ade8020', color: '#4ade80' },
  paused:       { bg: '#facc1520', color: '#facc15' },
  completed:    { bg: '#60a5fa20', color: '#60a5fa' },
  replied:      { bg: '#f8717120', color: '#f87171' },
  unsubscribed: { bg: '#88888820', color: '#888' },
};

const stepLabels = ['Cold', 'Day 3', 'Day 7', 'Day 14', 'Day 90'];

export default function SequenceTracker() {
  const [data, setData] = useState({ sequences: [], aggregates: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.sequences().then(d => {
      setData(d || { sequences: [], aggregates: {} });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const agg = data.aggregates || {};

  return (
    <div>
      <h1 style={pageTitle}>Sequence Tracker</h1>

      <div style={gridStyle}>
        <StatCard label="Active" value={agg.active || 0} color="#4ade80" />
        <StatCard label="Paused" value={agg.paused || 0} color="#facc15" />
        <StatCard label="Completed" value={agg.completed || 0} color="#60a5fa" />
        <StatCard label="Replied" value={agg.replied || 0} color="#f87171" />
        <StatCard label="Unsubscribed" value={agg.unsubscribed || 0} color="#888" />
      </div>

      <div style={tableContainer}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Company</th>
              <th style={thStyle}>Contact</th>
              <th style={thStyle}>Step</th>
              <th style={thStyle}>Next Send</th>
              <th style={thStyle}>Last Sent</th>
              <th style={thStyle}>Subject</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#555' }}>Loading...</td></tr>
            ) : (data.sequences || []).length === 0 ? (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#555' }}>No sequences found.</td></tr>
            ) : data.sequences.map((seq, i) => {
              const sc = seqStatusColors[seq.status] || { bg: '#88888820', color: '#888' };
              return (
                <tr key={seq.id} style={{ background: i % 2 === 0 ? 'transparent' : '#1f1f1f' }}>
                  <td style={tdStyle}>{seq.company || '-'}</td>
                  <td style={{ ...tdStyle, color: '#888' }}>{seq.contact_email || seq.contact_name || '-'}</td>
                  <td style={tdStyle}>
                    <span style={{ ...badgeBase, background: '#60a5fa20', color: '#60a5fa' }}>
                      {stepLabels[seq.current_step] || `Step ${seq.current_step}`}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: '#facc15', fontSize: '11px' }}>
                    {seq.next_send_date ? new Date(seq.next_send_date).toLocaleDateString() : '-'}
                  </td>
                  <td style={{ ...tdStyle, color: '#555', fontSize: '10px' }}>
                    {seq.last_sent_at ? new Date(seq.last_sent_at).toLocaleString() : '-'}
                  </td>
                  <td style={{ ...tdStyle, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {seq.last_subject || '-'}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ ...badgeBase, background: sc.bg, color: sc.color }}>{seq.status}</span>
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
