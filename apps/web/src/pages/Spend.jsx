import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { api } from '../api';
import StatCard from '../components/StatCard';

const USD_TO_INR = 85;

const CHART_COLORS = {
  gemini: '#3b82f6',
  sonnet: '#ef4444',
  haiku: '#f59e0b',
  mev: '#8b5cf6',
};

const LIVE_POLL_MS = 5000;  // refresh "today live" card every 5s

export default function Spend() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(null);  // today's running totals

  useEffect(() => {
    api.costs().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  // Live poll today's costs — gives the user a real-time view while findLeads runs
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const t = await api.todayCosts();
        if (!cancelled) setLive(t);
      } catch { /* non-fatal */ }
      if (!cancelled) setTimeout(tick, LIVE_POLL_MS);
    }
    tick();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div><h1 className="page-title">Cost Tracker</h1><div className="loading">Loading cost data...</div></div>;
  if (!data) return <div><h1 className="page-title">Cost Tracker</h1><div className="error-state">Failed to load cost data.</div></div>;

  const monthly = data.monthly || {};
  const totalCost = monthly.total_api_cost_usd || 0;
  const daily = (data.daily || []).map(d => ({
    ...d,
    date: d.date ? d.date.slice(5) : '',
    gemini: d.gemini_cost_usd || 0,
    sonnet: d.sonnet_cost_usd || 0,
    haiku: d.haiku_cost_usd || 0,
    mev: d.mev_cost_usd || 0,
  }));

  const costTable = [
    { service: 'Gemini Flash', cost: monthly.gemini_cost_usd || 0, color: CHART_COLORS.gemini },
    { service: 'Claude Sonnet', cost: monthly.sonnet_cost_usd || 0, color: CHART_COLORS.sonnet },
    { service: 'Claude Haiku', cost: monthly.haiku_cost_usd || 0, color: CHART_COLORS.haiku },
    { service: 'MyEmailVerifier', cost: monthly.mev_cost_usd || 0, color: CHART_COLORS.mev },
  ];

  const todayTotal = Number(live?.total_api_cost_usd || 0);

  return (
    <div>
      <h1 className="page-title">Cost Tracker</h1>

      <div className="stat-grid">
        <StatCard label="Monthly Total" value={`$${totalCost.toFixed(2)}`} sub={`~INR ${(totalCost * USD_TO_INR).toFixed(0)}`} color="var(--amber)" className="fade-in stagger-1" />
        <StatCard label="Emails Sent (30d)" value={monthly.emails_sent || 0} color="var(--green)" className="fade-in stagger-2" />
        <StatCard label="Per-Email Cost" value={`$${(monthly.perEmailCost || 0).toFixed(4)}`} sub={`~INR ${((monthly.perEmailCost || 0) * USD_TO_INR).toFixed(2)}`} color="var(--blue)" className="fade-in stagger-3" />
      </div>

      <div className="section-title">Today (live — refreshes every 5s)</div>
      <div className="stat-grid mb-xl">
        <StatCard label="Today's total" value={`$${todayTotal.toFixed(4)}`} sub={`~₹${(todayTotal * USD_TO_INR).toFixed(2)}`} color="var(--green-bright)" />
        <StatCard label="Gemini" value={`$${Number(live?.gemini_cost_usd || 0).toFixed(4)}`} color="var(--blue)" />
        <StatCard label="Sonnet" value={`$${Number(live?.sonnet_cost_usd || 0).toFixed(4)}`} color="var(--red)" />
        <StatCard label="Haiku" value={`$${Number(live?.haiku_cost_usd || 0).toFixed(4)}`} color="var(--amber)" />
        <StatCard label="MEV" value={`$${Number(live?.mev_cost_usd || 0).toFixed(4)}`} color="var(--purple)" />
        <StatCard label="Leads ready today" value={live?.leads_ready ?? 0} color="var(--green)" />
        <StatCard label="Emails sent today" value={live?.emails_sent ?? 0} color="var(--green)" />
      </div>

      <div className="section-title">Daily Costs (30 Days)</div>
      <div className="card mb-xl fade-in">
        {daily.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-4)', fontSize: 9, fontFamily: 'JetBrains Mono' }} interval={2} />
              <YAxis tick={{ fill: 'var(--text-4)', fontSize: 10, fontFamily: 'JetBrains Mono' }} tickFormatter={(v) => `$${v.toFixed(2)}`} />
              <Tooltip contentStyle={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '11px', fontFamily: 'JetBrains Mono' }} formatter={(value) => [`$${value.toFixed(4)}`, '']} />
              <Legend wrapperStyle={{ fontSize: '10px', fontFamily: 'JetBrains Mono' }} />
              <Bar dataKey="gemini" name="Gemini" stackId="costs" fill={CHART_COLORS.gemini} radius={[0, 0, 0, 0]} />
              <Bar dataKey="sonnet" name="Sonnet" stackId="costs" fill={CHART_COLORS.sonnet} />
              <Bar dataKey="haiku" name="Haiku" stackId="costs" fill={CHART_COLORS.haiku} />
              <Bar dataKey="mev" name="MEV" stackId="costs" fill={CHART_COLORS.mev} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state">No cost data available yet.</div>
        )}
      </div>

      <div className="section-title">Monthly Breakdown</div>
      <div className="card mb-xl">
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Cost (USD)</th>
              <th>Cost (INR)</th>
              <th>% of Total</th>
            </tr>
          </thead>
          <tbody>
            {costTable.map((item) => {
              const pct = totalCost > 0 ? ((item.cost / totalCost) * 100).toFixed(1) : '0.0';
              return (
                <tr key={item.service}>
                  <td>
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: item.color, marginRight: '8px' }} />
                    {item.service}
                  </td>
                  <td style={{ color: 'var(--amber)' }}>${item.cost.toFixed(4)}</td>
                  <td className="td-muted">INR {(item.cost * USD_TO_INR).toFixed(2)}</td>
                  <td className="td-muted">{pct}%</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: '1px solid var(--border-light)' }}>
              <td style={{ fontWeight: 600 }}>Total</td>
              <td style={{ fontWeight: 600, color: 'var(--amber)' }}>${totalCost.toFixed(4)}</td>
              <td style={{ fontWeight: 600 }} className="td-muted">INR {(totalCost * USD_TO_INR).toFixed(2)}</td>
              <td className="td-muted">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
