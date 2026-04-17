import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { api } from '../api';
import StatCard from '../components/StatCard';
import RunConfig from '../components/RunConfig';

const USD_TO_INR = 85;

function Heatmap({ data }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">No send activity data yet.</div>;
  }

  // Build 90-day grid: fill in missing dates
  const end = new Date();
  const cells = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const match = data.find(r => r.date === dateStr);
    const count = match?.emails_sent || 0;
    const level = count === 0 ? 0 : count <= 5 ? 1 : count <= 15 ? 2 : count <= 30 ? 3 : 4;
    cells.push({ date: dateStr, count, level, day: d.getDay() });
  }

  // Group into weeks (columns)
  const weeks = [];
  let currentWeek = [];
  // Pad first week with empty cells
  if (cells.length > 0) {
    const firstDay = cells[0].day;
    for (let i = 0; i < firstDay; i++) {
      currentWeek.push(null);
    }
  }
  for (const cell of cells) {
    currentWeek.push(cell);
    if (cell.day === 6) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  return (
    <div>
      <div className="heatmap">
        {weeks.map((week, wi) => (
          <div className="heatmap-col" key={wi}>
            {week.map((cell, ci) =>
              cell ? (
                <div
                  key={ci}
                  className="heatmap-cell"
                  data-level={cell.level}
                  title={`${cell.date}: ${cell.count} emails`}
                />
              ) : (
                <div key={ci} className="heatmap-cell" style={{ opacity: 0 }} />
              )
            )}
          </div>
        ))}
      </div>
      <div className="heatmap-legend">
        <span>Less</span>
        <div className="heatmap-cell" data-level="0" />
        <div className="heatmap-cell" data-level="1" />
        <div className="heatmap-cell" data-level="2" />
        <div className="heatmap-cell" data-level="3" />
        <div className="heatmap-cell" data-level="4" />
        <span>More</span>
      </div>
    </div>
  );
}

export default function Overview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.overview().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading overview...</div>;
  if (!data) return <div className="error-state">Failed to load overview data.</div>;

  const { metrics, funnel, sendActivity } = data;

  const funnelSteps = [
    { label: 'Discovered', value: funnel?.total || 0, color: 'var(--blue)' },
    { label: 'Extracted', value: funnel?.extracted || 0, color: 'var(--blue)' },
    { label: 'Judge Passed', value: funnel?.judged || 0, color: 'var(--amber)' },
    { label: 'Email Found', value: funnel?.email_found || 0, color: 'var(--amber)' },
    { label: 'Email Valid', value: funnel?.email_valid || 0, color: 'var(--amber)' },
    { label: 'ICP A/B', value: funnel?.icp_ab || 0, color: 'var(--green)' },
    { label: 'Sent', value: funnel?.sent || 0, color: 'var(--green)' },
    { label: 'Replied', value: funnel?.replied || 0, color: 'var(--red)' },
  ];

  const maxFunnel = Math.max(...funnelSteps.map(s => s.value), 1);

  return (
    <div>
      <RunConfig />
      <h1 className="page-title">Overview</h1>

      <div className="stat-grid">
        <StatCard label="Leads Today" value={metrics.today?.leads_discovered || 0} sub="Discovered" color="var(--blue)" className="fade-in stagger-1" />
        <StatCard label="Emails Today" value={metrics.today?.emails_sent || 0} sub="Sent today" color="var(--green)" className="fade-in stagger-2" />
        <StatCard label="Emails (7d)" value={metrics.week?.emails_sent || 0} sub="This week" color="var(--green)" className="fade-in stagger-3" />
        <StatCard label="Hot Leads (7d)" value={metrics.week?.replies_hot || 0} sub="Interested" color="var(--red)" className="fade-in stagger-4" />
        <StatCard label="Reply Rate (7d)" value={`${metrics.replyRate7d || 0}%`} sub="7-day rolling" color="var(--green)" className="fade-in stagger-5" />
        <StatCard label="Bounce Rate" value={`${metrics.bounceRateToday || 0}%`} sub="Today" color={metrics.bounceRateToday > 2 ? 'var(--red)' : 'var(--green)'} className="fade-in stagger-6" />
        <StatCard label="Active Sequences" value={metrics.activeSequences || 0} sub="In progress" color="var(--blue)" className="fade-in stagger-7" />
        <StatCard
          label="API Cost (30d)"
          value={`$${(metrics.month?.total_api_cost_usd || 0).toFixed(2)}`}
          sub={`~INR ${((metrics.month?.total_api_cost_usd || 0) * USD_TO_INR).toFixed(0)}`}
          color="var(--amber)"
          className="fade-in stagger-8"
        />
      </div>

      <div className="section-title">Lead Funnel (All Time)</div>
      <div className="card mb-xl fade-in">
        <div className="funnel">
          {funnelSteps.map((step, i) => (
            <div className="funnel-step" key={i}>
              <div className="funnel-count">{step.value}</div>
              <div
                className="funnel-bar"
                style={{
                  height: `${Math.max((step.value / maxFunnel) * 100, 4)}%`,
                  background: step.color,
                  opacity: 0.8,
                }}
              />
            </div>
          ))}
        </div>
        <div className="funnel-labels">
          {funnelSteps.map((step, i) => {
            const dropPct = i > 0 && funnelSteps[i - 1].value > 0
              ? `-${((1 - step.value / funnelSteps[i - 1].value) * 100).toFixed(0)}%`
              : '';
            return (
              <div className="funnel-label" key={i}>
                {step.label}
                {dropPct && <div className="funnel-drop">{dropPct}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="section-title">Send Activity (90 Days)</div>
      <div className="card mb-xl fade-in">
        <Heatmap data={sendActivity} />
      </div>
    </div>
  );
}
