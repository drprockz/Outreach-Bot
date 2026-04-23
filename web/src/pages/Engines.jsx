import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import EngineStatusPill from '../components/EngineStatusPill';
import StatCard from '../components/StatCard';

const GUARDRAIL_ENGINES = new Set(['findLeads', 'sendEmails']);
const CONFIG_ENGINES    = new Set(['findLeads', 'sendEmails', 'checkReplies', 'sendFollowups']);
const TAB_ORDER = ['status', 'config', 'guardrails', 'history'];

const ENABLED_KEY = {
  findLeads:     'find_leads_enabled',
  sendEmails:    'send_emails_enabled',
  checkReplies:  'check_replies_enabled',
  sendFollowups: 'send_followups_enabled',
};

// Per-engine config fields. Lifted from the old EngineConfig.jsx; single
// source of truth for which config keys each engine's Config tab exposes.
const CONFIG_FIELDS = {
  findLeads: [
    { key: 'find_leads_count',     label: 'Lead count (total per run)', type: 'int' },
    { key: 'find_leads_per_batch', label: 'Leads per batch',            type: 'int' },
  ],
  sendEmails: [
    { key: 'daily_send_limit',       label: 'Daily send limit',      type: 'int' },
    { key: 'max_per_inbox',          label: 'Max per inbox',         type: 'int' },
    { key: 'send_delay_min_ms',      label: 'Delay min (ms)',        type: 'int' },
    { key: 'send_delay_max_ms',      label: 'Delay max (ms)',        type: 'int' },
    { key: 'send_window_start',      label: 'Window start (IST hr)', type: 'int' },
    { key: 'send_window_end',        label: 'Window end (IST hr)',   type: 'int' },
    { key: 'bounce_rate_hard_stop',  label: 'Bounce hard stop',      type: 'float' },
    { key: 'claude_daily_spend_cap', label: 'Claude spend cap (USD)', type: 'float', readonly: true },
  ],
  checkReplies:  [],
  sendFollowups: [],
};

function fmtDuration(ms) {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export default function Engines() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const [engines, setEngines] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const activeTab = (hash.replace('#', '') || 'status');

  async function refresh() {
    try {
      const d = await api.getEngines();
      setEngines(d.items);
      if (!selected && d.items?.[0]) setSelected(d.items[0].name);
    } catch (e) {
      setError(`Failed to load engines: ${e.message}`);
    }
  }

  useEffect(() => { refresh(); }, []); // eslint-disable-line

  const engine = useMemo(
    () => engines?.find(e => e.name === selected),
    [engines, selected],
  );

  function setTab(tab) {
    navigate({ hash: tab }, { replace: true });
  }

  if (error)   return <div className="page"><h1 className="page-title">Engines</h1><div className="msg error">{error}</div></div>;
  if (!engines) return <div className="page"><h1 className="page-title">Engines</h1><div className="td-muted">Loading…</div></div>;
  if (!engine)  return <div className="page"><h1 className="page-title">Engines</h1><div className="td-muted">No engine selected.</div></div>;

  const availableTabs = TAB_ORDER.filter(t =>
    t === 'status' || t === 'history'
      || (t === 'config'     && CONFIG_ENGINES.has(engine.name))
      || (t === 'guardrails' && GUARDRAIL_ENGINES.has(engine.name))
  );

  return (
    <div className="engines-page">
      <aside className="engines-master">
        <div className="sidebar-section-label">Engines</div>
        {engines.map(e => (
          <EngineStatusPill
            key={e.name}
            engine={e}
            selected={e.name === selected}
            onSelect={setSelected}
          />
        ))}
      </aside>
      <section className="engines-detail">
        <EngineHeader engine={engine} onRefresh={refresh} />
        <div className="engines-tabs">
          {availableTabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`engines-tab ${activeTab === t ? 'active' : ''}`}
              type="button"
            >
              {tabLabel(t)}
            </button>
          ))}
        </div>
        <div className="engines-tabpanel">
          {activeTab === 'status'     && <StatusTab engine={engine} />}
          {activeTab === 'config'     && CONFIG_ENGINES.has(engine.name) && <ConfigTab engine={engine} onSaved={refresh} />}
          {activeTab === 'guardrails' && GUARDRAIL_ENGINES.has(engine.name) && <GuardrailsTab engine={engine} />}
          {activeTab === 'history'    && <HistoryTab engine={engine} />}
        </div>
      </section>
    </div>
  );
}

function tabLabel(t) {
  return { status: 'Status', config: 'Config', guardrails: 'Guardrails', history: 'History' }[t];
}

function EngineHeader({ engine, onRefresh }) {
  const [toggling, setToggling] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState('');         // '' | 'info' | 'error' | 'conflict'
  const [conflictId, setConflictId] = useState(null); // running cronLogId from 409
  const [activeRun, setActiveRun] = useState(null);   // { cronLogId, target } | null

  const enabledKey = ENABLED_KEY[engine.name];

  // On mount + on engine switch: detect an in-flight run so the progress UI
  // resumes if the user just refreshed the dashboard mid-run.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [latest, cfg] = await Promise.all([
          api.engineLatest(engine.name),
          api.getConfig().catch(() => ({})),
        ]);
        if (cancelled) return;
        const target = engine.name === 'findLeads'
          ? parseInt(cfg?.find_leads_count, 10) || null
          : null;
        if (latest?.cron_log?.status === 'running') {
          setActiveRun({ cronLogId: latest.cron_log.id, target });
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [engine.name]);

  async function handleToggle() {
    if (!enabledKey || toggling) return;
    setToggling(true);
    try {
      await api.updateConfig({ [enabledKey]: engine.enabled ? '0' : '1' });
      await onRefresh();
    } finally { setToggling(false); }
  }

  async function handleRun() {
    setMsg(''); setMsgKind(''); setConflictId(null);
    setTriggering(true);
    try {
      const res = await api.runEngine(engine.name);
      if (res.ok) {
        // Look up target lead count for findLeads so the progress bar can scale.
        let target = null;
        if (engine.name === 'findLeads') {
          try {
            const cfg = await api.getConfig();
            target = res.body.override?.leadsCount || parseInt(cfg?.find_leads_count, 10) || null;
          } catch { /* non-fatal */ }
        }
        setActiveRun({ cronLogId: res.body.cronLogId, target });
        setMsg(`Started (cronLogId=${res.body.cronLogId}).`); setMsgKind('info');
      } else if (res.status === 409) {
        setConflictId(res.body.runningCronLogId);
        setMsg(res.body.hint
          ? `Already running (cronLogId=${res.body.runningCronLogId}). ${res.body.hint}`
          : `Already running (cronLogId=${res.body.runningCronLogId}).`);
        setMsgKind('conflict');
      } else {
        setMsg(res.body?.error || `Failed: HTTP ${res.status}`); setMsgKind('error');
      }
    } catch (e) {
      setMsg(`Failed: ${e.message}`); setMsgKind('error');
    } finally {
      setTriggering(false);
      setTimeout(onRefresh, 500);
    }
  }

  async function handleUnlock() {
    if (unlocking) return;
    setUnlocking(true);
    try {
      const res = await api.unlockEngine(engine.name);
      if (res.ok) {
        setMsg(`Unlocked ${res.body.unlocked} stuck row(s) — try Run now again.`);
        setMsgKind('info');
        setConflictId(null);
      } else {
        setMsg(res.body?.error || `Unlock failed: HTTP ${res.status}`); setMsgKind('error');
      }
    } catch (e) {
      setMsg(`Unlock failed: ${e.message}`); setMsgKind('error');
    } finally {
      setUnlocking(false);
      setTimeout(onRefresh, 300);
    }
  }

  return (
    <header className="engines-header">
      <h1 className="page-title">{engine.name}</h1>
      <div className="engines-header-actions">
        <span className="muted" style={{ fontSize: 12 }}>schedule: <code>{engine.schedule}</code></span>
        {enabledKey && (
          <button
            type="button"
            className={`engine-toggle ${engine.enabled ? 'on' : 'off'}`}
            onClick={handleToggle}
            disabled={toggling}
          >
            {engine.enabled ? '🟢 ON' : '⚫ OFF'}
          </button>
        )}
        <button type="button" className="btn-primary" onClick={handleRun} disabled={triggering}>
          {triggering ? 'Starting…' : 'Run now'}
        </button>
      </div>
      {msg && (
        <div className={`msg ${msgKind === 'error' ? 'error' : ''}`} style={{ marginTop: 8 }}>
          {msg}
          {msgKind === 'conflict' && (
            <button
              type="button"
              className="btn-secondary"
              style={{ marginLeft: 12 }}
              onClick={handleUnlock}
              disabled={unlocking}
            >
              {unlocking ? 'Unlocking…' : 'Force unlock'}
            </button>
          )}
        </div>
      )}
      {activeRun && (
        <RunProgress
          key={activeRun.cronLogId}
          engineName={engine.name}
          cronLogId={activeRun.cronLogId}
          target={activeRun.target}
          onClose={() => setActiveRun(null)}
          onFinish={() => setTimeout(onRefresh, 500)}
        />
      )}
    </header>
  );
}

// Stage rows for findLeads — keys map to today_costs response fields.
// For other engines we only show top-line progress (records_processed/skipped).
const FIND_LEADS_STAGES = [
  { key: 'leads_discovered',   label: 'Stage 1 · Discovered' },
  { key: 'leads_extracted',    label: 'Stages 2-6 · Extracted' },
  { key: 'leads_judge_passed', label: 'Gate 1 · Passed' },
  { key: 'leads_email_found',  label: 'Email found' },
  { key: 'leads_email_valid',  label: 'Stage 7 · MEV verified' },
  { key: 'leads_icp_ready',    label: 'Stage 9 · ICP A/B' },
  { key: 'leads_ready',        label: 'Stage 11 · Ready to send' },
];

function RunProgress({ engineName, cronLogId, target, onClose, onFinish }) {
  const [data, setData] = useState(null);
  const [start, setStart] = useState(null);   // snapshot of today_costs at run start (delta baseline)
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now()); // ticks elapsed-time when running

  useEffect(() => {
    let cancelled = false;
    let timer;
    let finishedNotified = false;
    async function poll() {
      try {
        const d = await api.engineStatus(cronLogId);
        if (cancelled) return;
        if (!start && d?.today_costs) setStart(d.today_costs);
        setData(d);
        setError('');
        if (d?.cron_log?.status === 'running') {
          timer = setTimeout(poll, 2000);
        } else if (!finishedNotified) {
          finishedNotified = true;
          if (onFinish) onFinish();
        }
      } catch (e) {
        if (cancelled) return;
        setError(e.message);
        timer = setTimeout(poll, 5000); // back off on transient errors
      }
    }
    poll();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(tick); };
  }, [cronLogId]); // eslint-disable-line

  if (!data && !error) {
    return <div className="run-progress"><div className="td-muted">Loading run #{cronLogId}…</div></div>;
  }

  const cl = data?.cron_log;
  const tc = data?.today_costs;
  const delta = (k) => Math.max(0, (tc?.[k] ?? 0) - (start?.[k] ?? 0));

  const statusColor = cl?.status === 'success' ? 'green' : cl?.status === 'failed' ? 'red' : 'blue';
  const elapsedMs = cl?.completed_at
    ? new Date(cl.completed_at).getTime() - new Date(cl.started_at).getTime()
    : (cl?.started_at ? now - new Date(cl.started_at).getTime() : 0);

  // For findLeads, baseline target for bars = configured leadsCount; once Stage 1
  // has produced more than that (rare; usually less due to dedup), grow the bar.
  const stageTarget = engineName === 'findLeads'
    ? Math.max(target || 0, delta('leads_discovered'), 1)
    : null;

  return (
    <div className="run-progress">
      <div className="run-progress-header">
        <span className={`badge badge-${statusColor}`}>{cl?.status || 'pending'}</span>
        <span className="muted">cronLogId={cronLogId}</span>
        <span className="muted">·</span>
        <span>elapsed <strong>{fmtDuration(elapsedMs)}</strong></span>
        <span className="muted">·</span>
        <span>cost <strong>${(cl?.cost_usd || 0).toFixed(4)}</strong></span>
        <span className="muted">·</span>
        <span>processed <strong>{cl?.records_processed ?? 0}</strong></span>
        <span className="muted">/ skipped {cl?.records_skipped ?? 0}</span>
        <span style={{ flex: 1 }} />
        {cl?.status !== 'running' && (
          <button type="button" className="btn-secondary" onClick={onClose}>Dismiss</button>
        )}
      </div>

      {error && <div className="msg error" style={{ marginTop: 8 }}>poll error: {error}</div>}
      {cl?.error_message && <div className="msg error" style={{ marginTop: 8 }}>{cl.error_message}</div>}

      {engineName === 'findLeads' && tc && (
        <div className="run-progress-stages">
          {FIND_LEADS_STAGES.map(s => {
            const v = delta(s.key);
            const pct = Math.min(100, (v / stageTarget) * 100);
            const barClass = s.key === 'leads_ready' ? 'fill ready' : 'fill';
            return (
              <div key={s.key} className="run-progress-stage">
                <div className="run-progress-stage-row">
                  <span className="muted">{s.label}</span>
                  <span className="mono">
                    {v}{s.key === 'leads_discovered' && target ? ` / ${target}` : ''}
                  </span>
                </div>
                <div className="run-progress-bar">
                  <div className={`run-progress-bar-${barClass}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {engineName !== 'findLeads' && (
        <div className="td-muted" style={{ marginTop: 8, fontSize: 12 }}>
          Live per-stage breakdown is only wired for findLeads today. Polling for completion…
        </div>
      )}
    </div>
  );
}

function StatusTab({ engine }) {
  return (
    <div>
      <div className="stat-grid">
        <StatCard
          label="Last run status"
          value={engine.lastRun?.status || 'never'}
          color={engine.lastRun?.status === 'success' ? 'var(--green)' : engine.lastRun?.status === 'failed' ? 'var(--red)' : 'var(--text-3)'}
        />
        <StatCard
          label="Last run duration"
          value={fmtDuration(engine.lastRun?.durationMs)}
          color="var(--blue)"
        />
        <StatCard
          label="Processed (last run)"
          value={engine.lastRun?.primaryCount ?? 0}
          color="var(--green-bright)"
        />
        <StatCard
          label="Cost today"
          value={`$${(engine.costToday || 0).toFixed(4)}`}
          color="var(--amber)"
        />
      </div>
      <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
        Started: {fmtWhen(engine.lastRun?.startedAt)}
      </p>
    </div>
  );
}

function ConfigTab({ engine, onSaved }) {
  const [cfg, setCfg] = useState(null);
  const [values, setValues] = useState({});
  const [saved, setSaved] = useState(false);
  const fields = CONFIG_FIELDS[engine.name] || [];

  useEffect(() => { api.getConfig().then(setCfg); }, []);
  useEffect(() => {
    if (!cfg) return;
    const initial = {};
    for (const f of fields) initial[f.key] = cfg[f.key] ?? '';
    setValues(initial);
  }, [cfg, engine.name]);

  if (!cfg) return <div className="td-muted">Loading…</div>;
  if (fields.length === 0) return <div className="td-muted">This engine has no editable config.</div>;

  async function handleSave() {
    await api.updateConfig(values);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    if (onSaved) onSaved();
  }

  const sendLimitZeroWarning = engine.name === 'sendEmails' && parseInt(values.daily_send_limit) === 0;

  return (
    <div>
      {sendLimitZeroWarning && (
        <div className="engine-warning">⚠ Send limit is 0 — no emails will be sent. Increase to activate.</div>
      )}
      {fields.map(f => (
        <div key={f.key} className="engine-field-row">
          <label className="engine-field-label">{f.label}</label>
          {f.readonly ? (
            <span className="engine-field-readonly">
              {values[f.key]} <span className="td-dim">(enforcement Phase 2)</span>
            </span>
          ) : (
            <input
              className="input"
              style={{ width: 110 }}
              value={values[f.key] ?? ''}
              onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button type="button" className="btn-primary" onClick={handleSave}>Save</button>
        {saved && <span className="saved-confirm">Saved ✓</span>}
      </div>
    </div>
  );
}

function GuardrailsTab({ engine }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState('');
  const [field, setField] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getGuardrails(engine.name).then(d => { setData(d); setDraft(d); });
  }, [engine.name]);

  if (!data) return <div className="td-muted">Loading…</div>;

  function set(k, v) { setDraft(d => ({ ...d, [k]: v })); }

  async function handleSave() {
    setError(''); setField(''); setSaving(true);
    try {
      const res = await api.saveGuardrails(engine.name, draft);
      if (res?.ok) {
        setData(res.data); setDraft(res.data);
        setSaved(true); setTimeout(() => setSaved(false), 2000);
      } else {
        setError(res?.error || 'Unknown error'); setField(res?.field || '');
      }
    } catch (e) {
      setError(e.message);
    } finally { setSaving(false); }
  }

  return (
    <div>
      {error && <div className="msg error" style={{ marginBottom: 12 }}>{error}{field && ` (${field})`}</div>}

      {engine.name === 'sendEmails' && (
        <>
          <GuardrailField label="Min words" k="email_min_words" errField={field}>
            <input className="input" style={{ width: 110 }} type="number"
              value={draft.email_min_words ?? ''}
              onChange={e => set('email_min_words', parseInt(e.target.value, 10))} />
          </GuardrailField>
          <GuardrailField label="Max words" k="email_max_words" errField={field}>
            <input className="input" style={{ width: 110 }} type="number"
              value={draft.email_max_words ?? ''}
              onChange={e => set('email_max_words', parseInt(e.target.value, 10))} />
          </GuardrailField>
          <GuardrailField label="Spam words (comma-separated)" k="spam_words" errField={field}>
            <textarea className="input" rows={3} style={{ width: '100%', minWidth: 320 }}
              value={(draft.spam_words || []).join(', ')}
              onChange={e => set('spam_words', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
          </GuardrailField>
          <GuardrailField label="Send holidays (MM-DD, one per line)" k="send_holidays" errField={field}>
            <textarea className="input" rows={5} style={{ width: 180 }}
              value={(draft.send_holidays || []).join('\n')}
              onChange={e => set('send_holidays', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))} />
          </GuardrailField>
        </>
      )}

      {engine.name === 'findLeads' && (
        <GuardrailField label="Size prompts (JSON: msme/sme/both)" k="findleads_size_prompts" errField={field}>
          <textarea className="input" rows={10} style={{ width: '100%', minWidth: 420, fontFamily: 'var(--font-mono)' }}
            value={JSON.stringify(draft.findleads_size_prompts || {}, null, 2)}
            onChange={e => {
              try { set('findleads_size_prompts', JSON.parse(e.target.value)); }
              catch { /* ignore invalid JSON while typing */ }
            }} />
        </GuardrailField>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="saved-confirm">Saved ✓</span>}
      </div>
    </div>
  );
}

function GuardrailField({ label, k, errField, children }) {
  const highlighted = errField === k;
  return (
    <div className="engine-field-row" style={highlighted ? { outline: '1px solid var(--red)' } : undefined}>
      <label className="engine-field-label" style={{ alignSelf: 'start', paddingTop: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function HistoryTab({ engine }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.cronHistory(engine.name).then(r => setRows(r?.history || []));
  }, [engine.name]);

  if (!rows) return <div className="td-muted">Loading…</div>;
  if (rows.length === 0) return <div className="td-muted">No runs yet.</div>;

  return (
    <table className="radar-table">
      <thead><tr><th>Started</th><th>Status</th><th>Duration</th><th>Processed</th><th>Skipped</th><th>Cost</th></tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td>{fmtWhen(r.started_at)}</td>
            <td>
              <span className={`badge ${r.status === 'success' ? 'badge-green' : r.status === 'failed' ? 'badge-red' : 'badge-muted'}`}>
                {r.status}
              </span>
            </td>
            <td>{fmtDuration(r.duration_ms)}</td>
            <td>{r.records_processed ?? 0}</td>
            <td className="td-muted">{r.records_skipped ?? 0}</td>
            <td>${(r.cost_usd || 0).toFixed(4)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
