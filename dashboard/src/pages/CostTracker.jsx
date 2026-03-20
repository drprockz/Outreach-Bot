import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { api } from '../api';
import StatCard from '../components/StatCard';

const pageTitle = {
  fontSize: '20px',
  fontWeight: 600,
  color: '#e0e0e0',
  marginBottom: '24px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const sectionTitle = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#888',
  marginBottom: '16px',
  marginTop: '32px',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const gridStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '12px',
  marginBottom: '24px',
};

const cardStyle = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '24px',
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
};

const tdStyle = {
  padding: '10px 14px',
  borderBottom: '1px solid #1f1f1f',
  color: '#e0e0e0',
};

const tooltipStyle = {
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '11px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const usdToInr = 85;

export default function CostTracker() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.costs().then(d => {
      setData(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <h1 style={pageTitle}>Cost Tracker</h1>
        <div style={{ color: '#555', fontFamily: 'IBM Plex Mono, monospace' }}>Loading cost data...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h1 style={pageTitle}>Cost Tracker</h1>
        <div style={{ color: '#f87171', fontFamily: 'IBM Plex Mono, monospace' }}>Failed to load cost data.</div>
      </div>
    );
  }

  const monthly = data.monthly || {};
  const daily = (data.daily || []).map(d => ({
    ...d,
    date: d.date ? d.date.slice(5) : '',
    gemini: d.gemini_cost_usd || 0,
    sonnet: d.sonnet_cost_usd || 0,
    haiku: d.haiku_cost_usd || 0,
  }));

  const costTable = [
    { service: 'Gemini Flash', cost: monthly.gemini_cost_usd || 0, color: '#60a5fa' },
    { service: 'Claude Sonnet', cost: monthly.sonnet_cost_usd || 0, color: '#f87171' },
    { service: 'Claude Haiku', cost: monthly.haiku_cost_usd || 0, color: '#facc15' },
  ];

  return (
    <div>
      <h1 style={pageTitle}>Cost Tracker</h1>

      <div style={gridStyle}>
        <StatCard
          label="Monthly Total"
          value={`$${(monthly.total_cost_usd || 0).toFixed(2)}`}
          sub={`~INR ${((monthly.total_cost_usd || 0) * usdToInr).toFixed(0)}`}
          color="#facc15"
        />
        <StatCard
          label="Emails Sent (30d)"
          value={monthly.emails_sent || 0}
          color="#4ade80"
        />
        <StatCard
          label="Per-Email Cost"
          value={`$${(monthly.perEmailCost || 0).toFixed(4)}`}
          sub={`~INR ${((monthly.perEmailCost || 0) * usdToInr).toFixed(2)}`}
          color="#60a5fa"
        />
      </div>

      <div style={sectionTitle}>Daily Costs (30 Days)</div>
      <div style={cardStyle}>
        {daily.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#555', fontSize: 9, fontFamily: 'IBM Plex Mono' }}
                interval={2}
              />
              <YAxis
                tick={{ fill: '#555', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                tickFormatter={(v) => `$${v.toFixed(2)}`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [`$${value.toFixed(4)}`, '']}
              />
              <Legend
                wrapperStyle={{ fontSize: '10px', fontFamily: 'IBM Plex Mono, monospace' }}
              />
              <Bar dataKey="gemini" name="Gemini" stackId="costs" fill="#60a5fa" />
              <Bar dataKey="sonnet" name="Sonnet" stackId="costs" fill="#f87171" />
              <Bar dataKey="haiku" name="Haiku" stackId="costs" fill="#facc15" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ color: '#555', fontSize: '12px', fontFamily: 'IBM Plex Mono, monospace', textAlign: 'center', padding: '40px' }}>
            No cost data available yet.
          </div>
        )}
      </div>

      <div style={sectionTitle}>Monthly Breakdown</div>
      <div style={cardStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Service</th>
              <th style={thStyle}>Cost (USD)</th>
              <th style={thStyle}>Cost (INR)</th>
              <th style={thStyle}>% of Total</th>
            </tr>
          </thead>
          <tbody>
            {costTable.map((item, i) => {
              const pct = (monthly.total_cost_usd || 0) > 0
                ? ((item.cost / monthly.total_cost_usd) * 100).toFixed(1)
                : '0.0';
              return (
                <tr key={item.service} style={{ background: i % 2 === 0 ? 'transparent' : '#1f1f1f' }}>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: item.color, marginRight: '8px' }} />
                    {item.service}
                  </td>
                  <td style={{ ...tdStyle, color: '#facc15' }}>${item.cost.toFixed(4)}</td>
                  <td style={{ ...tdStyle, color: '#888' }}>INR {(item.cost * usdToInr).toFixed(2)}</td>
                  <td style={{ ...tdStyle, color: '#888' }}>{pct}%</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: '1px solid #333' }}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>Total</td>
              <td style={{ ...tdStyle, fontWeight: 600, color: '#facc15' }}>${(monthly.total_cost_usd || 0).toFixed(4)}</td>
              <td style={{ ...tdStyle, fontWeight: 600, color: '#888' }}>INR {((monthly.total_cost_usd || 0) * usdToInr).toFixed(2)}</td>
              <td style={{ ...tdStyle, color: '#888' }}>100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
