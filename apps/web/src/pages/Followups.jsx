import React, { useEffect, useState } from 'react';
import { api } from '../api';
import StatCard from '../components/StatCard';
import PageHeader from '../components/radar/PageHeader';

const seqBadge = {
  active: 'badge-green', paused: 'badge-amber', completed: 'badge-blue',
  replied: 'badge-red', unsubscribed: 'badge-muted',
};

const stepLabels = ['Cold', 'Day 3', 'Day 7', 'Day 14', 'Day 90'];

export default function Followups() {
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
      <PageHeader title="Follow-ups" subtitle="Cold + D+3 / D+7 / D+14 / D+90 sequences" />

      <div className="stat-grid">
        <StatCard label="Active" value={agg.active || 0} color="var(--green)" className="fade-in stagger-1" />
        <StatCard label="Paused" value={agg.paused || 0} color="var(--amber)" className="fade-in stagger-2" />
        <StatCard label="Completed" value={agg.completed || 0} color="var(--blue)" className="fade-in stagger-3" />
        <StatCard label="Replied" value={agg.replied || 0} color="var(--red)" className="fade-in stagger-4" />
        <StatCard label="Unsubscribed" value={agg.unsubscribed || 0} color="var(--text-3)" className="fade-in stagger-5" />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Contact</th>
              <th>Step</th>
              <th>Next Send</th>
              <th>Last Sent</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Paused Reason</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="td-muted text-center" style={{ padding: '40px' }}>Loading...</td></tr>
            ) : (data.sequences || []).length === 0 ? (
              <tr><td colSpan={8} className="td-muted text-center" style={{ padding: '40px' }}>No sequences found.</td></tr>
            ) : data.sequences.map((seq) => (
              <tr key={seq.id}>
                <td>{seq.business_name || '-'}</td>
                <td className="td-muted">{seq.contact_email || seq.contact_name || '-'}</td>
                <td>
                  <span className="badge badge-blue">{stepLabels[seq.current_step] || `Step ${seq.current_step}`}</span>
                </td>
                <td style={{ color: 'var(--amber)', fontSize: '11px' }}>
                  {seq.next_send_date ? new Date(seq.next_send_date).toLocaleDateString() : '-'}
                </td>
                <td className="td-dim">{seq.last_sent_at ? new Date(seq.last_sent_at).toLocaleString() : '-'}</td>
                <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{seq.last_subject || '-'}</td>
                <td><span className={`badge ${seqBadge[seq.status] || 'badge-muted'}`}>{seq.status}</span></td>
                <td className="td-dim">{seq.paused_reason || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
