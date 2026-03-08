import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';
import { fetchAnalytics } from '../api.js';
import CustomTooltip from '../components/CustomTooltip.jsx';

const FUNNEL_COLORS = {
  cold: '#94a3b8', contacted: '#a5b4fc', hot: '#86efac',
  schedule: '#93c5fd', soft: '#fbbf24', closed: '#4ade80',
  rejected: '#fca5a5', dormant: '#78716c',
};

const chartCard = {
  background: 'linear-gradient(135deg, #141414 0%, #0f0f0f 100%)',
  border: '1px solid #ffffff0f', borderRadius: 12, padding: 28,
  boxShadow: '0 0 0 1px #ffffff05, 0 2px 8px #00000040',
};

const sectionTitle = {
  fontSize: 12, fontWeight: 600, marginBottom: 20,
  color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: 1,
};

export default function Analytics() {
  const [data, setData] = useState(null);

  useEffect(() => { fetchAnalytics().then(setData); }, []);

  if (!data) return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div className="skeleton" style={{ width: 120, height: 24, marginBottom: 24 }} />
      <div className="skeleton" style={{ width: '100%', height: 260, borderRadius: 12, marginBottom: 24 }} />
      <div style={{ display: 'flex', gap: 16 }}>
        <div className="skeleton" style={{ flex: 1, height: 260, borderRadius: 12 }} />
        <div className="skeleton" style={{ flex: 1, height: 260, borderRadius: 12 }} />
      </div>
    </div>
  );

  const funnelData = data.funnel.map((f) => ({ name: f.status, value: f.count }));
  const seqLabels = { 1: 'Cold', 2: 'Day 3', 3: 'Day 7', 4: 'Day 14' };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>Analytics</h1>
        <p style={{ fontSize: 13, color: '#52525b', marginTop: 4 }}>
          Pipeline performance and outreach metrics
        </p>
      </div>

      <div style={{ ...chartCard, marginBottom: 24 }}>
        <div style={sectionTitle}>Pipeline Funnel</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={funnelData} layout="vertical">
            <defs>
              {funnelData.map((d) => (
                <linearGradient key={d.name} id={`funnel-${d.name}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={FUNNEL_COLORS[d.name]} stopOpacity={0.8} />
                  <stop offset="100%" stopColor={FUNNEL_COLORS[d.name]} stopOpacity={0.3} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="#ffffff06" horizontal={false} />
            <XAxis type="number" stroke="#ffffff15" fontSize={11}
              fontFamily="'IBM Plex Mono', monospace" tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" stroke="#ffffff15" fontSize={11}
              width={80} tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff05' }} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]}>
              {funnelData.map((d) => (
                <Cell key={d.name} fill={`url(#funnel-${d.name})`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 300, ...chartCard }}>
          <div style={sectionTitle}>By Category</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.byCategory}>
              <CartesianGrid stroke="#ffffff06" />
              <XAxis dataKey="category" stroke="#ffffff15" fontSize={10}
                tickLine={false} axisLine={false} />
              <YAxis stroke="#ffffff15" fontSize={11}
                fontFamily="'IBM Plex Mono', monospace" tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff05' }} />
              <Bar dataKey="leads" fill="#4f46e580" name="Leads" radius={[4, 4, 0, 0]} />
              <Bar dataKey="emails_sent" fill="#6366f1" name="Sent" radius={[4, 4, 0, 0]} />
              <Bar dataKey="replies" fill="#22c55e" name="Replies" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ flex: 1, minWidth: 300, ...chartCard }}>
          <div style={sectionTitle}>Reply Rate by Sequence</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.bySequence.map((s) => ({ ...s, name: seqLabels[s.sequence] || `Seq ${s.sequence}` }))}>
              <CartesianGrid stroke="#ffffff06" />
              <XAxis dataKey="name" stroke="#ffffff15" fontSize={11}
                tickLine={false} axisLine={false} />
              <YAxis stroke="#ffffff15" fontSize={11} unit="%"
                fontFamily="'IBM Plex Mono', monospace" tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff05' }} />
              <Bar dataKey="reply_rate" fill="#a5b4fc" name="Reply %" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
