import React, { useEffect, useState } from 'react';
import { api } from '../api';

const ENGINE_CARDS = [
  {
    key: 'findLeads',
    enabledKey: 'find_leads_enabled',
    title: 'findLeads.js',
    schedule: 'Runs: 09:00 AM daily (Mon–Sat)',
    fields: [
      { key: 'find_leads_batches',   label: 'Batches per run',  type: 'int' },
      { key: 'find_leads_per_batch', label: 'Leads per batch',  type: 'int' },
    ]
  },
  {
    key: 'sendEmails',
    enabledKey: 'send_emails_enabled',
    title: 'sendEmails.js',
    schedule: 'Runs: 09:30 AM daily (Mon–Sat)',
    fields: [
      { key: 'daily_send_limit',     label: 'Daily send limit',      type: 'int' },
      { key: 'max_per_inbox',        label: 'Max per inbox',         type: 'int' },
      { key: 'send_delay_min_ms',    label: 'Delay min (ms)',        type: 'int' },
      { key: 'send_delay_max_ms',    label: 'Delay max (ms)',        type: 'int' },
      { key: 'send_window_start',    label: 'Window start (IST hr)', type: 'int' },
      { key: 'send_window_end',      label: 'Window end (IST hr)',   type: 'int' },
      { key: 'bounce_rate_hard_stop',label: 'Bounce hard stop',      type: 'float' },
      { key: 'claude_daily_spend_cap', label: 'Claude spend cap (USD)', type: 'float', readonly: true },
    ]
  },
  {
    key: 'sendFollowups',
    enabledKey: 'send_followups_enabled',
    title: 'sendFollowups.js',
    schedule: 'Runs: 06:00 PM daily (Mon–Sat)',
    fields: []
  },
  {
    key: 'checkReplies',
    enabledKey: 'check_replies_enabled',
    title: 'checkReplies.js',
    schedule: 'Runs: 2PM / 4PM / 8PM daily',
    fields: []
  },
];

function EngineCard({ card, cfg, onSaved }) {
  const [values, setValues] = useState({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const initial = {};
    card.fields.forEach(f => { initial[f.key] = cfg[f.key] ?? ''; });
    setValues(initial);
  }, [cfg, card.fields]);

  const enabled = cfg[card.enabledKey] !== '0';

  async function handleToggle() {
    await api.updateConfig({ [card.enabledKey]: enabled ? '0' : '1' });
    onSaved();
  }

  async function handleSave() {
    await api.updateConfig(values);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSaved();
  }

  const sendLimitZeroWarning = card.key === 'sendEmails' && enabled && parseInt(values.daily_send_limit) === 0;

  return (
    <div className="engine-card">
      <div className="engine-card-header">
        <span className="engine-card-title">{card.title}</span>
        <button
          className={`engine-toggle ${enabled ? 'on' : 'off'}`}
          onClick={handleToggle}
        >
          {enabled ? '🟢 ON' : '⚫ OFF'}
        </button>
      </div>
      <div className="engine-card-schedule">{card.schedule}</div>

      {sendLimitZeroWarning && (
        <div className="engine-warning">⚠ Send limit is 0 — no emails will be sent. Increase to activate.</div>
      )}

      {card.fields.map(f => (
        <div key={f.key} className="engine-field-row">
          <label className="engine-field-label">{f.label}</label>
          {f.readonly ? (
            <span className="engine-field-readonly">{values[f.key]} <span className="td-dim">(enforcement Phase 2)</span></span>
          ) : (
            <input
              className="input"
              style={{ width: '110px' }}
              value={values[f.key] ?? ''}
              onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
            />
          )}
        </div>
      ))}

      {card.fields.some(f => !f.readonly) && (
        <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn-primary" onClick={handleSave}>Save Changes</button>
          {saved && <span className="saved-confirm">Saved ✓</span>}
        </div>
      )}
    </div>
  );
}

export default function EngineConfig() {
  const [cfg, setCfg] = useState(null);

  function load() { api.getConfig().then(d => setCfg(d)); }
  useEffect(load, []);

  if (!cfg) return <div><h1 className="page-title">Engine Config</h1><div className="td-muted">Loading…</div></div>;

  return (
    <div>
      <h1 className="page-title">Engine Config</h1>
      <div className="engine-grid">
        {ENGINE_CARDS.map(card => (
          <EngineCard key={card.key} card={card} cfg={cfg} onSaved={load} />
        ))}
      </div>
    </div>
  );
}
