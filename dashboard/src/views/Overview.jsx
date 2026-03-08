import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { fetchOverview } from '../api.js';
import StatCard from '../components/StatCard.jsx';
import Badge from '../components/Badge.jsx';
import CustomTooltip from '../components/CustomTooltip.jsx';

export default function Overview() {
  const [data, setData] = useState(null);

  useEffect(() => { fetchOverview().then(setData); }, []);

  if (!data) return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div className="skeleton" style={{ width: 120, height: 24, marginBottom: 24 }} />
      <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
        {[1,2,3,4].map(i => (
          <div key={i} className="skeleton" style={{ flex: 1, height: 88, borderRadius: 12 }} />
        ))}
      </div>
      <div className="skeleton" style={{ width: '100%', height: 280, borderRadius: 12 }} />
    </div>
  );

  const { today, hotLeads, chartData, replyChart } = data;

  const merged = chartData.map((d) => {
    const r = replyChart.find((x) => x.day === d.day);
    return { day: d.day.slice(5), sent: d.sent, replies: r?.replies || 0 };
  });

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>Overview</h1>
        <p style={{ fontSize: 13, color: '#52525b', marginTop: 4 }}>
          Today's outreach performance at a glance
        </p>
      </div>

      {hotLeads.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #14532d15 0%, #0f0f0f 100%)',
          border: '1px solid #22c55e20', borderRadius: 12,
          padding: 20, marginBottom: 28,
          boxShadow: '0 0 24px #22c55e08',
        }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: '#86efac', marginBottom: 14,
            display: 'flex', alignItems: 'center', gap: 8,
            textTransform: 'uppercase', letterSpacing: 1,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#22c55e', display: 'inline-block',
              animation: 'pulse 2s infinite',
            }} />
            Active Hot Leads
          </div>
          {hotLeads.map((l, i) => (
            <div key={i} style={{
              padding: '10px 0',
              borderBottom: i < hotLeads.length - 1 ? '1px solid #ffffff08' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <strong style={{ color: '#fafafa' }}>{l.name}</strong>
                <span style={{ color: '#71717a' }}>{l.company}</span>
                <Badge status={l.pipeline_status} />
              </div>
              {l.summary && <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 6 }}>{l.summary}</div>}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        {[
          { label: 'Sent Today', value: today.sent },
          { label: 'Replies', value: today.replies, color: '#a5b4fc' },
          { label: 'Hot Leads', value: today.hot, color: '#86efac' },
          { label: 'Schedule', value: today.schedule, color: '#93c5fd' },
        ].map((card, i) => (
          <div key={i} style={{ flex: 1, minWidth: 160, animation: `fadeIn 0.4s ease ${i * 0.05}s both` }}>
            <StatCard {...card} />
          </div>
        ))}
      </div>

      <div style={{
        background: 'linear-gradient(135deg, #141414 0%, #0f0f0f 100%)',
        border: '1px solid #ffffff0f', borderRadius: 12,
        padding: 28,
        boxShadow: '0 0 0 1px #ffffff05, 0 2px 8px #00000040',
      }}>
        <div style={{
          fontSize: 12, fontWeight: 600, marginBottom: 20,
          color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: 1,
        }}>Last 7 Days</div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={merged}>
            <defs>
              <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="repliesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#ffffff08" strokeDasharray="3 3" />
            <XAxis dataKey="day" stroke="#ffffff20" fontSize={11}
              fontFamily="'IBM Plex Mono', monospace" tickLine={false} axisLine={false} />
            <YAxis stroke="#ffffff20" fontSize={11}
              fontFamily="'IBM Plex Mono', monospace" tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="sent" stroke="#6366f1" strokeWidth={2}
              fill="url(#sentGrad)" dot={false} name="Sent" />
            <Area type="monotone" dataKey="replies" stroke="#22c55e" strokeWidth={2}
              fill="url(#repliesGrad)" dot={false} name="Replies" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
