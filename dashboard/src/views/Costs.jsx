import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { fetchCosts, fetchCostChart } from '../api.js';
import StatCard from '../components/StatCard.jsx';
import CustomTooltip from '../components/CustomTooltip.jsx';

const chartCard = {
  background: 'linear-gradient(135deg, #141414 0%, #0f0f0f 100%)',
  border: '1px solid #ffffff0f', borderRadius: 12, padding: 28,
  boxShadow: '0 0 0 1px #ffffff05, 0 2px 8px #00000040',
};

const sectionTitle = {
  fontSize: 12, fontWeight: 600, marginBottom: 20,
  color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: 1,
};

export default function Costs() {
  const [summary, setSummary] = useState(null);
  const [chart, setChart] = useState([]);
  const [hoveredRow, setHoveredRow] = useState(null);

  useEffect(() => {
    fetchCosts().then(setSummary);
    fetchCostChart().then(setChart);
  }, []);

  if (!summary) return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div className="skeleton" style={{ width: 120, height: 24, marginBottom: 24 }} />
      <div className="skeleton" style={{ width: '100%', height: 80, borderRadius: 12, marginBottom: 24 }} />
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {[1,2,3].map(i => <div key={i} className="skeleton" style={{ flex: 1, height: 88, borderRadius: 12 }} />)}
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <div className="skeleton" style={{ flex: 1, height: 260, borderRadius: 12 }} />
        <div className="skeleton" style={{ flex: 1, height: 260, borderRadius: 12 }} />
      </div>
    </div>
  );

  const monthBudget = 15;
  const pct = summary.month > 0 ? ((summary.month / monthBudget) * 100).toFixed(0) : 0;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>Costs</h1>
        <p style={{ fontSize: 13, color: '#52525b', marginTop: 4 }}>
          API usage and budget tracking
        </p>
      </div>

      <div style={{ ...chartCard, marginBottom: 24 }}>
        <div style={{ ...sectionTitle, marginBottom: 14 }}>Monthly Budget</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            flex: 1, height: 10, background: '#ffffff08',
            borderRadius: 5, overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 5,
              background: pct > 80
                ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                : 'linear-gradient(90deg, #6366f1, #818cf8)',
              boxShadow: pct > 80 ? '0 0 12px #ef444440' : '0 0 12px #6366f140',
              transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
            }} />
          </div>
          <span style={{
            fontSize: 13, color: '#a1a1aa', whiteSpace: 'nowrap',
            fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600,
          }}>
            ${summary.month.toFixed(2)} / ${monthBudget}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatCard label="Today" value={`$${summary.today.toFixed(3)}`} />
        <StatCard label="This Week" value={`$${summary.week.toFixed(2)}`} />
        <StatCard label="This Month" value={`$${summary.month.toFixed(2)}`} color="#a5b4fc" />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 300, ...chartCard }}>
          <div style={sectionTitle}>Breakdown by Job (MTD)</div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Job', 'Calls', 'Cost'].map((h, i) => (
                  <th key={h} style={{
                    textAlign: i === 0 ? 'left' : 'right',
                    padding: '10px 16px', borderBottom: '1px solid #ffffff0f',
                    color: '#71717a', fontWeight: 600, fontSize: 11,
                    textTransform: 'uppercase', letterSpacing: 1,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.breakdown.map((row) => (
                <tr key={row.job}
                  onMouseEnter={() => setHoveredRow(row.job)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{
                    background: hoveredRow === row.job ? '#ffffff04' : 'transparent',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <td style={{ padding: '10px 16px', borderBottom: '1px solid #ffffff06', color: '#a1a1aa' }}>{row.job}</td>
                  <td style={{ padding: '10px 16px', borderBottom: '1px solid #ffffff06', textAlign: 'right', color: '#71717a', fontFamily: "'IBM Plex Mono', monospace" }}>{row.calls}</td>
                  <td style={{ padding: '10px 16px', borderBottom: '1px solid #ffffff06', textAlign: 'right', color: '#fafafa', fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>${row.total.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ flex: 1, minWidth: 300, ...chartCard }}>
          <div style={sectionTitle}>Daily Cost (30 days)</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chart.map((d) => ({ ...d, day: d.day.slice(5) }))}>
              <defs>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#ffffff06" strokeDasharray="3 3" />
              <XAxis dataKey="day" stroke="#ffffff15" fontSize={10}
                fontFamily="'IBM Plex Mono', monospace" tickLine={false} axisLine={false} />
              <YAxis stroke="#ffffff15" fontSize={11}
                fontFamily="'IBM Plex Mono', monospace" tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="cost" stroke="#6366f1" strokeWidth={2}
                fill="url(#costGrad)" dot={false} name="Cost ($)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
