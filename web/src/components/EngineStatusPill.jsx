import React from 'react';

function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)     return `${s}s ago`;
  if (s < 3600)   return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function EngineStatusPill({ engine, selected, onSelect }) {
  const dot = !engine.enabled
    ? '⚪'
    : engine.lastRun?.status === 'success' ? '🟢'
    : engine.lastRun?.status === 'failed'  ? '🔴'
    : engine.lastRun?.status === 'running' ? '🟡'
    : '⚫';

  const meta = engine.lastRun
    ? `${timeAgo(engine.lastRun.startedAt)} · ${engine.lastRun.primaryCount ?? 0}`
    : 'no runs yet';

  return (
    <button
      type="button"
      onClick={() => onSelect(engine.name)}
      className={`engine-pill ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
    >
      <div className="engine-pill-name">{engine.name}</div>
      <div className="engine-pill-meta">
        {dot} {engine.enabled ? 'on' : 'off'} · {meta}
      </div>
    </button>
  );
}
