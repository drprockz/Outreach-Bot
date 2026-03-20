import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
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
  gap: '16px',
  marginBottom: '32px',
};

const sectionTitle = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#888',
  marginBottom: '16px',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const cardStyle = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '32px',
};

const funnelBarContainerStyle = {
  display: 'flex',
  gap: '4px',
  alignItems: 'flex-end',
  height: '120px',
  marginBottom: '12px',
};

const funnelLabelRow = {
  display: 'flex',
  gap: '4px',
};

const funnelLabelStyle = {
  fontSize: '9px',
  color: '#888',
  textAlign: 'center',
  fontFamily: 'IBM Plex Mono, monospace',
};

const funnelCountStyle = {
  fontSize: '11px',
  color: '#e0e0e0',
  textAlign: 'center',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
  marginBottom: '4px',
};

const tooltipStyle = {
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '11px',
  fontFamily: 'IBM Plex Mono, monospace',
};

export default function Overview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.overview().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ color: '#555', padding: '40px', fontFamily: 'IBM Plex Mono, monospace' }}>Loading overview...</div>;
  }

  if (!data) {
    return <div style={{ color: '#f87171', padding: '40px', fontFamily: 'IBM Plex Mono, monospace' }}>Failed to load overview data.</div>;
  }

  const { metrics, funnel, sendActivity } = data;
  const usdToInr = 85;

  const funnelSteps = [
    { label: 'Discovered', value: funnel?.total || 0, color: '#60a5fa' },
    { label: 'Extracted', value: funnel?.extracted || 0, color: '#60a5fa' },
    { label: 'Judged', value: funnel?.judged || 0, color: '#facc15' },
    { label: 'Email Found', value: funnel?.email_found || 0, color: '#facc15' },
    { label: 'Email Valid', value: funnel?.email_valid || 0, color: '#facc15' },
    { label: 'ICP A/B', value: funnel?.icp_ab || 0, color: '#4ade80' },
    { label: 'Sent', value: funnel?.sent || 0, color: '#4ade80' },
    { label: 'Replied', value: funnel?.replied || 0, color: '#f87171' },
  ];

  const maxFunnel = Math.max(...funnelSteps.map(s => s.value), 1);

  return (
    <div>
      <h1 style={pageTitle}>Overview</h1>

      <div style={gridStyle}>
        <StatCard label="Leads Discovered (7d)" value={metrics.week?.leads_discovered || 0} sub="This week" color="#60a5fa" />
        <StatCard label="Emails Sent (7d)" value={metrics.week?.emails_sent || 0} sub="This week" color="#4ade80" />
        <StatCard label="Replies (7d)" value={metrics.week?.replies_total || 0} sub="This week" color="#facc15" />
        <StatCard label="Hot Leads (7d)" value={metrics.week?.replies_hot || 0} sub="Interested" color="#f87171" />
        <StatCard label="Reply Rate (7d)" value={`${metrics.replyRate7d || 0}%`} sub="7-day rolling" color="#4ade80" />
        <StatCard label="Bounce Rate" value={`${metrics.bounceRateToday || 0}%`} sub="Today" color={metrics.bounceRateToday > 2 ? '#f87171' : '#4ade80'} />
        <StatCard label="Active Sequences" value={metrics.activeSequences || 0} sub="In progress" color="#60a5fa" />
        <StatCard
          label="API Cost (30d)"
          value={`$${(metrics.month?.total_api_cost_usd || 0).toFixed(2)}`}
          sub={`~INR ${((metrics.month?.total_api_cost_usd || 0) * usdToInr).toFixed(0)}`}
          color="#facc15"
        />
      </div>

      <div style={sectionTitle}>Lead Funnel (All Time)</div>
      <div style={cardStyle}>
        <div style={funnelBarContainerStyle}>
          {funnelSteps.map((step, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <div style={funnelCountStyle}>{step.value}</div>
              <div style={{
                width: '100%',
                maxWidth: '60px',
                height: `${Math.max((step.value / maxFunnel) * 100, 4)}%`,
                background: step.color,
                borderRadius: '4px 4px 0 0',
                opacity: 0.8,
                transition: 'height 0.3s',
              }} />
            </div>
          ))}
        </div>
        <div style={funnelLabelRow}>
          {funnelSteps.map((step, i) => (
            <div key={i} style={{ flex: 1, ...funnelLabelStyle }}>{step.label}</div>
          ))}
        </div>
      </div>

      <div style={sectionTitle}>Send Activity (90 Days)</div>
      <div style={cardStyle}>
        {sendActivity && sendActivity.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={sendActivity}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#555', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                tickFormatter={(d) => d.slice(5)}
                interval={6}
              />
              <YAxis tick={{ fill: '#555', fontSize: 10, fontFamily: 'IBM Plex Mono' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="emails_sent" stroke="#4ade80" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ color: '#555', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', textAlign: 'center', padding: '40px' }}>
            No send activity data yet.
          </div>
        )}
      </div>
    </div>
  );
}
