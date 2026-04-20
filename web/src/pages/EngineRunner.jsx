import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import StatCard from '../components/StatCard';

const USD_TO_INR = 85;
const POLL_MS = 2000;

function fmtUsd(n) { return `$${(Number(n) || 0).toFixed(4)}`; }
function fmtInr(n) { return `~₹${((Number(n) || 0) * USD_TO_INR).toFixed(2)}`; }
function fmtDuration(ms) {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function EngineRunner() {
  const [leadsCount, setLeadsCount] = useState(3);
  const [activeRun, setActiveRun] = useState(null);  // { cronLogId, startedAt }
  const [status, setStatus] = useState(null);        // response from engineStatus
  const [latest, setLatest] = useState(null);        // last completed run
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);

  async function loadLatest() {
    try {
      const r = await api.engineLatest('findLeads');
      setLatest(r?.cron_log || null);
    } catch (e) { /* non-fatal */ }
  }

  useEffect(() => { loadLatest(); }, []);

  // Polling loop when a run is active
  useEffect(() => {
    if (!activeRun?.cronLogId) return;
    let cancelled = false;

    async function tick() {
      try {
        const s = await api.engineStatus(activeRun.cronLogId);
        if (cancelled) return;
        setStatus(s);
        if (s?.cron_log?.status && s.cron_log.status !== 'running') {
          // Run finished — stop polling, refresh the "latest" card too
          setActiveRun(null);
          await loadLatest();
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setError(`Polling failed: ${e.message}`);
        setActiveRun(null);
        return;
      }
      if (!cancelled) pollRef.current = setTimeout(tick, POLL_MS);
    }

    tick();
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [activeRun?.cronLogId]);

  async function startRun() {
    setError('');
    setStarting(true);
    setStatus(null);
    try {
      const res = await api.runEngine('findLeads', { leadsCount: Number(leadsCount) });
      if (!res.ok) {
        if (res.status === 409) {
          // Another run is already in flight — adopt it rather than erroring
          setActiveRun({ cronLogId: res.body.runningCronLogId, startedAt: res.body.startedAt });
          setError(`A findLeads run was already running — watching it instead (id=${res.body.runningCronLogId}).`);
        } else {
          setError(res.body?.error || `HTTP ${res.status}`);
        }
      } else {
        setActiveRun({ cronLogId: res.body.cronLogId, startedAt: res.body.startedAt });
      }
    } catch (e) {
      setError(`Failed to start: ${e.message}`);
    } finally {
      setStarting(false);
    }
  }

  const running = !!activeRun;
  const costs = status?.today_costs;
  const log = status?.cron_log;

  const statusBadge = log?.status === 'running'
    ? <span className="badge badge-amber">running</span>
    : log?.status === 'success'
      ? <span className="badge badge-green">success</span>
      : log?.status === 'failed'
        ? <span className="badge badge-red">failed</span>
        : log?.status
          ? <span className="badge">{log.status}</span>
          : null;

  return (
    <div className="page engine-runner-page">
      <h1 className="page-title">Generate Leads</h1>
      <p className="muted mb-lg">
        Run the <code>findLeads</code> pipeline on demand. Full pipeline runs
        (discovery → extraction → scoring → hook/body drafting) and stops at
        pending email drafts — <strong>no emails sent</strong> (that's a
        separate engine, currently gated by <code>daily_send_limit=0</code>).
      </p>

      <div className="card mb-lg">
        <h3>Trigger a run</h3>
        <div className="runner-controls">
          <label>
            Leads to generate
            <input
              type="number"
              min="1"
              max="500"
              value={leadsCount}
              onChange={e => setLeadsCount(e.target.value)}
              disabled={running || starting}
            />
          </label>
          <small className="muted">
            Dashboard-triggered runs bypass the cron's 50-lead minimum floor.
            Gemini-grounded discovery costs ~$0.0003/lead; extraction ~$0.0008/lead;
            scoring ~$0.0005/lead. A run of 3 costs roughly $0.005.
          </small>
          <button
            className="btn-primary"
            onClick={startRun}
            disabled={running || starting || Number(leadsCount) < 1}
          >
            {starting ? 'Starting…' : running ? 'Running…' : `Generate ${leadsCount} leads`}
          </button>
          {error && <div className="msg error">{error}</div>}
        </div>
      </div>

      {(log || running) && (
        <div className="card mb-lg">
          <h3>Current run {statusBadge}</h3>
          <div className="stat-grid">
            <StatCard label="Duration" value={fmtDuration(log?.duration_ms ?? (log?.started_at ? Date.now() - new Date(log.started_at).getTime() : 0))} color="var(--blue)" />
            <StatCard label="Processed" value={log?.records_processed ?? 0} color="var(--green)" />
            <StatCard label="Skipped" value={log?.records_skipped ?? 0} color="var(--text-3)" />
            <StatCard label="Run cost" value={fmtUsd(log?.cost_usd)} sub={fmtInr(log?.cost_usd)} color="var(--amber)" />
          </div>
          {log?.error_message && (
            <div className="msg error mt-md">{log.error_message}</div>
          )}
        </div>
      )}

      {costs && (
        <div className="card mb-lg">
          <h3>Today's pipeline progress (live)</h3>
          <div className="stat-grid">
            <StatCard label="Discovered" value={costs.leads_discovered} color="var(--blue)" />
            <StatCard label="Extracted" value={costs.leads_extracted} color="var(--blue)" />
            <StatCard label="Email found" value={costs.leads_email_found} color="var(--blue)" />
            <StatCard label="Email valid" value={costs.leads_email_valid} color="var(--blue)" />
            <StatCard label="ICP A/B" value={costs.leads_icp_ab} color="var(--green)" />
            <StatCard label="Ready (draft)" value={costs.leads_ready} color="var(--green-bright)" />
            <StatCard label="Disqualified" value={costs.leads_disqualified} color="var(--red)" />
            <StatCard label="Parse errors" value={costs.icp_parse_errors} color="var(--amber)" />
          </div>
          <h3 className="mt-lg">Credits burned today (live)</h3>
          <div className="stat-grid">
            <StatCard label="Gemini" value={fmtUsd(costs.gemini_cost_usd)} sub={fmtInr(costs.gemini_cost_usd)} color="var(--blue)" />
            <StatCard label="Claude Sonnet" value={fmtUsd(costs.sonnet_cost_usd)} sub={fmtInr(costs.sonnet_cost_usd)} color="var(--red)" />
            <StatCard label="Claude Haiku" value={fmtUsd(costs.haiku_cost_usd)} sub={fmtInr(costs.haiku_cost_usd)} color="var(--amber)" />
            <StatCard label="MEV" value={fmtUsd(costs.mev_cost_usd)} sub={fmtInr(costs.mev_cost_usd)} color="var(--purple)" />
            <StatCard label="Total today" value={fmtUsd(costs.total_api_cost_usd)} sub={fmtInr(costs.total_api_cost_usd)} color="var(--green-bright)" />
          </div>
        </div>
      )}

      {latest && !running && (
        <div className="card">
          <h3>Last run {latest.status === 'success' ? <span className="badge badge-green">success</span> : latest.status === 'failed' ? <span className="badge badge-red">failed</span> : <span className="badge">{latest.status}</span>}</h3>
          <table className="radar-table">
            <tbody>
              <tr><th>Started</th><td>{latest.started_at ? new Date(latest.started_at).toLocaleString() : '—'}</td></tr>
              <tr><th>Completed</th><td>{latest.completed_at ? new Date(latest.completed_at).toLocaleString() : '—'}</td></tr>
              <tr><th>Duration</th><td>{fmtDuration(latest.duration_ms)}</td></tr>
              <tr><th>Processed</th><td>{latest.records_processed ?? 0}</td></tr>
              <tr><th>Skipped</th><td>{latest.records_skipped ?? 0}</td></tr>
              <tr><th>Cost</th><td>{fmtUsd(latest.cost_usd)} <span className="muted">({fmtInr(latest.cost_usd)})</span></td></tr>
              {latest.error_message && <tr><th>Error</th><td className="text-red">{latest.error_message}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
