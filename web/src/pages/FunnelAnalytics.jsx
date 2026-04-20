import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, LineChart, Line, Cell
} from 'recharts';
import { api } from '../api';

const STAGE_COLOR = {
  discovered:  '#3b82f6',
  extracted:   '#6366f1',
  judge_passed:'#8b5cf6',
  email_found: '#f59e0b',
  email_valid: '#f97316',
  icp_ab:      '#10b981',
  ready:       '#22c55e',
  sent:        '#84cc16',
  replied:     '#ef4444',
};

const DROP_LABELS = {
  extraction_failed: 'Extraction failed (404 / parse error)',
  gate1_modern_stack: 'Gate 1: Modern stack + no signals + quality ≥7',
  no_email: 'No contact email found',
  email_invalid: 'Email invalid / disposable',
  email_not_found: 'Email not found',
  deduped: 'Dedup: already contacted / cooldown',
  icp_c_nurture: 'ICP C-priority → nurture',
};

function pct(a, b) {
  if (!b || b === 0) return '—';
  return `${((a / b) * 100).toFixed(1)}%`;
}

function dropPct(current, previous) {
  if (!previous || previous === 0) return null;
  const drop = ((1 - current / previous) * 100).toFixed(0);
  return drop > 0 ? `-${drop}%` : null;
}

function StatPill({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minWidth: 100,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
    </div>
  );
}

export default function FunnelAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.funnel().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading funnel data...</div>;
  if (!data) return <div className="error-state">Failed to load funnel data.</div>;

  const { stages, dropReasons, dailyTrend, byCategory, byCity, icpDistribution, emailStatusBreakdown, confidenceBreakdown } = data;

  const funnelStages = [
    { key: 'discovered',   label: 'Discovered',   value: stages.discovered,   desc: 'Raw leads from Gemini web search' },
    { key: 'extracted',    label: 'Extracted',     value: stages.extracted,    desc: 'Stages 2–6: tech, signals, email, quality' },
    { key: 'judge_passed', label: 'Gate 1 Passed', value: stages.judge_passed, desc: 'Not modern stack / has signals / quality <7' },
    { key: 'email_found',  label: 'Email Found',   value: stages.email_found,  desc: 'Stage 6: DM finder — pattern or page scrape' },
    { key: 'email_valid',  label: 'Email Valid',   value: stages.email_valid,  desc: 'Stage 7: MEV verification passed' },
    { key: 'icp_ab',       label: 'ICP A/B',       value: stages.icp_ab,       desc: 'Stage 9: Score ≥40, priority A or B' },
    { key: 'ready',        label: 'Ready',         value: stages.ready,        desc: 'Hook + email generated, pending send' },
    { key: 'sent',         label: 'Sent',          value: stages.sent,         desc: 'Delivered via SMTP' },
    { key: 'replied',      label: 'Replied',       value: stages.replied,      desc: 'Inbound reply received and classified' },
  ];

  const maxVal = Math.max(...funnelStages.map(s => s.value), 1);

  const totalDropped = stages.discovered - stages.replied;
  const conversionRate = pct(stages.replied, stages.discovered);

  return (
    <div>
      <h1 className="page-title">Pipeline Funnel</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, marginTop: -8, fontSize: 13 }}>
        End-to-end view of how leads flow through all 11 pipeline stages and where they drop off.
      </p>

      {/* Top KPIs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 32 }}>
        <StatPill label="Total Discovered" value={stages.discovered} color="var(--blue)" />
        <StatPill label="Reached Ready" value={stages.ready} color="var(--green)" />
        <StatPill label="Sent" value={stages.sent} color="#84cc16" />
        <StatPill label="Replied" value={stages.replied} color="var(--red)" />
        <StatPill label="Nurture (ICP C)" value={stages.nurture} color="var(--amber)" />
        <StatPill label="Unsubscribed" value={stages.unsubscribed} color="var(--text-muted)" />
        <StatPill label="Reply Rate" value={pct(stages.replied, stages.sent)} color="var(--green)" />
        <StatPill label="Overall Conversion" value={conversionRate} color="var(--blue)" />
      </div>

      {/* Waterfall funnel */}
      <div className="section-title">Stage-by-Stage Waterfall</div>
      <div className="card mb-xl">
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, minWidth: 700, height: 220, paddingBottom: 0 }}>
            {funnelStages.map((stage, i) => {
              const barH = Math.max((stage.value / maxVal) * 180, 4);
              const drop = i > 0 ? dropPct(stage.value, funnelStages[i - 1].value) : null;
              return (
                <div key={stage.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                  {drop && (
                    <div style={{
                      position: 'absolute', top: 180 - barH - 22,
                      fontSize: 10, color: 'var(--red)', fontWeight: 600,
                    }}>{drop}</div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                    {stage.value.toLocaleString()}
                  </div>
                  <div
                    style={{
                      width: '70%',
                      height: barH,
                      background: STAGE_COLOR[stage.key] || 'var(--blue)',
                      borderRadius: '4px 4px 0 0',
                      opacity: 0.85,
                      transition: 'height 0.4s ease',
                    }}
                    title={stage.desc}
                  />
                </div>
              );
            })}
          </div>
          {/* Labels */}
          <div style={{ display: 'flex', gap: 0, minWidth: 700, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            {funnelStages.map(stage => (
              <div key={stage.key} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>{stage.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{pct(stage.value, stages.discovered)} of total</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stage detail table */}
      <div className="section-title">Stage Detail</div>
      <div className="card mb-xl">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Stage</th>
              <th>Count</th>
              <th>Drop from prev</th>
              <th>% of total</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {funnelStages.map((stage, i) => {
              const prev = i > 0 ? funnelStages[i - 1].value : null;
              const dropped = prev !== null ? prev - stage.value : 0;
              const dp = dropPct(stage.value, prev);
              return (
                <tr key={stage.key}>
                  <td className="td-muted">{i + 1}</td>
                  <td style={{ fontWeight: 600, color: STAGE_COLOR[stage.key] }}>{stage.label}</td>
                  <td style={{ fontWeight: 700 }}>{stage.value.toLocaleString()}</td>
                  <td>
                    {prev !== null && dropped > 0 ? (
                      <span style={{ color: 'var(--red)' }}>−{dropped.toLocaleString()} <span className="td-muted">({dp})</span></span>
                    ) : <span className="td-muted">—</span>}
                  </td>
                  <td className="td-muted">{pct(stage.value, stages.discovered)}</td>
                  <td className="td-dim">{stage.desc}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Drop reasons */}
      <div className="section-title">Where Leads Drop — Breakdown</div>
      <div className="card mb-xl">
        <table className="table">
          <thead>
            <tr>
              <th>Drop Reason</th>
              <th>Count</th>
              <th>% of discovered</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(dropReasons)
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([key, count]) => (
                <tr key={key}>
                  <td style={{ color: 'var(--amber)' }}>{DROP_LABELS[key] || key}</td>
                  <td style={{ fontWeight: 700, color: 'var(--red)' }}>{count}</td>
                  <td className="td-muted">{pct(count, stages.discovered)}</td>
                </tr>
              ))}
            {Object.values(dropReasons).every(v => v === 0) && (
              <tr><td colSpan={3} className="td-muted" style={{ padding: '20px', textAlign: 'center' }}>No drop data yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ICP breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
        <div>
          <div className="section-title">ICP Priority Split</div>
          <div className="card">
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              <StatPill label="Priority A" value={stages.icp_a} color="var(--green)" />
              <StatPill label="Priority B" value={stages.icp_b} color="var(--amber)" />
              <StatPill label="Priority C" value={stages.icp_c} color="var(--text-muted)" />
            </div>
            {icpDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={icpDistribution} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="icp_score" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} label={{ value: 'ICP Score', position: 'insideBottom', offset: -2, fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <Tooltip contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6 }} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {icpDistribution.map((entry) => (
                      <Cell key={entry.icp_score} fill={entry.icp_score >= 70 ? 'var(--green)' : entry.icp_score >= 40 ? 'var(--amber)' : 'var(--text-muted)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="empty-state">No ICP data yet.</div>}
          </div>
        </div>

        <div>
          <div className="section-title">Email Verification Status</div>
          <div className="card">
            <table className="table">
              <thead><tr><th>Status</th><th>Count</th><th>%</th></tr></thead>
              <tbody>
                {emailStatusBreakdown.map(row => (
                  <tr key={row.status}>
                    <td style={{ color: row.status === 'valid' ? 'var(--green)' : row.status === 'catch-all' ? 'var(--amber)' : 'var(--red)' }}>
                      {row.status}
                    </td>
                    <td style={{ fontWeight: 700 }}>{row.count}</td>
                    <td className="td-muted">{pct(row.count, stages.email_found)}</td>
                  </tr>
                ))}
                {emailStatusBreakdown.length === 0 && <tr><td colSpan={3} className="td-muted" style={{ padding: 16, textAlign: 'center' }}>No data yet.</td></tr>}
              </tbody>
            </table>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Contact confidence</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {confidenceBreakdown.map(row => (
                  <div key={row.confidence} style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 6, padding: '4px 10px', fontSize: 12,
                    color: row.confidence === 'high' ? 'var(--green)' : row.confidence === 'medium' ? 'var(--amber)' : 'var(--text-muted)'
                  }}>
                    {row.confidence}: <strong>{row.count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 30-day daily trend */}
      <div className="section-title">30-Day Daily Trend</div>
      <div className="card mb-xl">
        {dailyTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dailyTrend} margin={{ top: 8, right: 16, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }} labelFormatter={d => `Date: ${d}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="discovered" stroke="#3b82f6" dot={false} strokeWidth={2} name="Discovered" />
              <Line type="monotone" dataKey="extracted" stroke="#8b5cf6" dot={false} strokeWidth={2} name="Extracted" />
              <Line type="monotone" dataKey="icp_ab" stroke="#10b981" dot={false} strokeWidth={2} name="ICP A/B" />
              <Line type="monotone" dataKey="ready" stroke="#22c55e" dot={false} strokeWidth={2} name="Ready" />
              <Line type="monotone" dataKey="sent" stroke="#ef4444" dot={false} strokeWidth={2} name="Sent" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state">No daily trend data yet. Run the pipeline to populate daily_metrics.</div>
        )}
      </div>

      {/* Category + City split */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
        <div>
          <div className="section-title">By Category</div>
          <div className="card">
            <table className="table">
              <thead><tr><th>Category</th><th>Total</th><th>A</th><th>B</th><th>C</th><th>Ready/Sent</th></tr></thead>
              <tbody>
                {byCategory.map(row => (
                  <tr key={row.category}>
                    <td style={{ fontWeight: 600 }}>{row.category}</td>
                    <td>{row.total}</td>
                    <td style={{ color: 'var(--green)' }}>{row.icp_a}</td>
                    <td style={{ color: 'var(--amber)' }}>{row.icp_b}</td>
                    <td className="td-muted">{row.icp_c}</td>
                    <td style={{ color: 'var(--blue)', fontWeight: 700 }}>{row.ready_or_sent}</td>
                  </tr>
                ))}
                {byCategory.length === 0 && <tr><td colSpan={6} className="td-muted" style={{ padding: 16, textAlign: 'center' }}>No data yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="section-title">By City</div>
          <div className="card">
            <table className="table">
              <thead><tr><th>City</th><th>Total</th><th>Ready/Sent</th><th>Conversion</th></tr></thead>
              <tbody>
                {byCity.map(row => (
                  <tr key={row.city}>
                    <td style={{ fontWeight: 600 }}>{row.city}</td>
                    <td>{row.total}</td>
                    <td style={{ color: 'var(--green)', fontWeight: 700 }}>{row.ready_or_sent}</td>
                    <td className="td-muted">{pct(row.ready_or_sent, row.total)}</td>
                  </tr>
                ))}
                {byCity.length === 0 && <tr><td colSpan={4} className="td-muted" style={{ padding: 16, textAlign: 'center' }}>No data yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
