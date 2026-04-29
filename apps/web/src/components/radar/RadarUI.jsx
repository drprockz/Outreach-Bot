/* eslint-disable react-refresh/only-export-components */
import React, { useState, useEffect, useRef } from 'react';
import Icon from './Icon';

export { Icon };

// ─── BUTTON ────────────────────────────────────────────────────────────
const KIND_STYLES = {
  primary: {
    background: 'var(--green)',
    color: '#ffffff',
    border: '1px solid var(--green-bright)',
    boxShadow: '0 1px 0 rgba(15,23,42,0.04), inset 0 1px 0 rgba(255,255,255,0.16)',
  },
  secondary: {
    background: 'var(--bg-surface)',
    color: 'var(--text-1)',
    border: '1px solid var(--border-light)',
    boxShadow: '0 1px 0 rgba(15,23,42,0.04)',
  },
  ghost: { background: 'transparent', color: 'var(--text-2)', border: '1px solid transparent' },
  outlineGreen: {
    background: 'var(--bg-surface)',
    color: 'var(--green-bright)',
    border: '1px solid var(--border-light)',
    boxShadow: '0 1px 0 rgba(15,23,42,0.04)',
  },
  danger: { background: 'var(--bg-surface)', color: 'var(--red)', border: '1px solid var(--red-soft)' },
  dangerSolid: { background: 'var(--red)', color: '#fff', border: '1px solid var(--red)' },
};
const SIZE_STYLES = {
  sm: { padding: '0 10px', height: 28, fontSize: 12 },
  md: { padding: '0 14px', height: 34, fontSize: 13 },
  lg: { padding: '0 18px', height: 40, fontSize: 14 },
};

export function Button({
  children, kind = 'secondary', size = 'md', icon, iconRight, full,
  onClick, disabled, style, type = 'button', ...rest
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: full ? '100%' : undefined,
        borderRadius: 6,
        fontFamily: 'var(--font-display)',
        fontWeight: 500,
        letterSpacing: '0.01em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.12s',
        whiteSpace: 'nowrap',
        ...SIZE_STYLES[size],
        ...KIND_STYLES[kind],
        ...style,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (kind === 'secondary') e.currentTarget.style.background = 'var(--bg-hover)';
        if (kind === 'ghost') e.currentTarget.style.background = 'var(--bg-tint)';
        if (kind === 'outlineGreen') e.currentTarget.style.background = 'var(--green-dim)';
      }}
      onMouseLeave={(e) => { Object.assign(e.currentTarget.style, KIND_STYLES[kind]); }}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 13 : 15} />}
    </button>
  );
}

// ─── BADGE / PILL ─────────────────────────────────────────────────────
const TONE_STYLES = {
  neutral: { bg: 'var(--bg-tint)', color: 'var(--text-2)', border: 'var(--border)' },
  green:   { bg: 'var(--green-dim)', color: 'var(--green-bright)', border: 'var(--green-line)' },
  blue:    { bg: 'var(--blue-dim)', color: 'var(--blue)', border: '#bfdbfe' },
  amber:   { bg: 'var(--amber-dim)', color: 'var(--amber)', border: '#fde68a' },
  red:     { bg: 'var(--red-dim)', color: 'var(--red)', border: '#fecaca' },
  purple:  { bg: 'var(--purple-dim)', color: 'var(--purple)', border: '#ddd6fe' },
  cyan:    { bg: 'var(--cyan-dim)', color: 'var(--cyan)', border: '#a5f3fc' },
  grey:    { bg: 'var(--bg-tint)', color: 'var(--text-3)', border: 'var(--border)' },
};
const BADGE_SIZES = {
  sm: { padding: '1px 7px', fontSize: 10, gap: 5, height: 18 },
  md: { padding: '2px 9px', fontSize: 11, gap: 6, height: 22 },
};

export function Badge({ children, tone = 'neutral', dot, pulse, size = 'md', icon, style }) {
  const t = TONE_STYLES[tone] || TONE_STYLES.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 4,
        fontFamily: 'var(--font-mono)',
        fontWeight: 500,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        background: t.bg,
        color: t.color,
        border: `1px solid ${t.border}`,
        ...BADGE_SIZES[size],
        ...style,
      }}
    >
      {dot && (
        <span style={{ position: 'relative', width: 6, height: 6, display: 'inline-block' }}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: t.color, animation: pulse ? 'rdr-pulse 1.4s infinite' : undefined }} />
          {pulse && <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: t.color, animation: 'rdr-pulse-ring 1.4s infinite' }} />}
        </span>
      )}
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

// ─── PLAN / STATUS ────────────────────────────────────────────────────
export function PlanBadge({ plan, size = 'md' }) {
  const tones = { Trial: 'amber', Starter: 'blue', Growth: 'green', Agency: 'purple' };
  return <Badge tone={tones[plan] || 'neutral'} dot size={size}>{plan}</Badge>;
}

const STATUS_MAP = {
  active: { tone: 'green', label: 'Active', dot: true },
  trial: { tone: 'amber', label: 'Trial', dot: true },
  locked: { tone: 'red', label: 'Locked', dot: true },
  suspended: { tone: 'grey', label: 'Suspended', dot: true },
  running: { tone: 'blue', label: 'Running', dot: true, pulse: true },
  idle: { tone: 'grey', label: 'Idle', dot: true },
  done: { tone: 'green', label: 'Done', dot: true },
  failed: { tone: 'red', label: 'Failed', dot: true },
  queued: { tone: 'purple', label: 'Queued', dot: true },
  paused: { tone: 'grey', label: 'Paused', dot: true },
};
export function Status({ status, size = 'md' }) {
  const c = STATUS_MAP[status] || STATUS_MAP.idle;
  return <Badge tone={c.tone} dot={c.dot} pulse={c.pulse} size={size}>{c.label}</Badge>;
}

// ─── STAT CARD ────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, tone = 'neutral', trend, sparkline, alert, onClick }) {
  const accentMap = {
    neutral: 'var(--text-3)', green: 'var(--green)', blue: 'var(--blue)',
    amber: 'var(--amber)', red: 'var(--red)', purple: 'var(--purple)', cyan: 'var(--cyan)',
  };
  const accent = accentMap[tone];
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 14px 14px 18px',
        cursor: onClick ? 'pointer' : 'default',
        overflow: 'hidden',
        transition: 'border-color 0.12s, transform 0.12s',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <span style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2, background: accent }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: 10.5, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>{label}</div>
        {alert && <Icon name="warning" size={12} color="var(--amber)" />}
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{
          fontSize: 26, fontWeight: 600, fontFamily: 'var(--font-display)',
          letterSpacing: '-0.02em', color: tone === 'neutral' ? 'var(--text-1)' : accent,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {value}
        </div>
        {trend && (
          <div style={{
            fontSize: 11,
            color: trend.startsWith('+') ? 'var(--green-bright)' : 'var(--red)',
            fontFamily: 'var(--font-mono)',
          }}>{trend}</div>
        )}
      </div>
      {sub && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{sub}</div>}
      {sparkline}
    </div>
  );
}

// ─── USAGE PROGRESS BAR ───────────────────────────────────────────────
export function UsageBar({ label, value, max, format, sub, unlimited }) {
  const pct = unlimited ? 12 : Math.min(100, (value / max) * 100);
  const color = unlimited ? 'var(--purple)' : pct >= 90 ? 'var(--red)' : pct >= 75 ? 'var(--amber)' : 'var(--green)';
  const fmt = format || ((v) => v.toLocaleString('en-IN'));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: 'var(--text-2)' }}>{label}</span>
        <span style={{ color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
          {unlimited ? '∞ unlimited' : `${fmt(value)} / ${fmt(max)}`}
        </span>
      </div>
      <div style={{ position: 'relative', height: 6, background: 'var(--bg-tint)', border: '1px solid var(--border)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', insetBlock: 0, left: 0, width: `${pct}%`, background: color, borderRadius: 999, transition: 'width 0.4s' }} />
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{sub}</div>}
    </div>
  );
}

// ─── INPUT / SELECT / CHECKBOX ────────────────────────────────────────
export function Input({
  label, value, onChange, placeholder, type = 'text', icon, suffix,
  size = 'md', error, full, style, autoFocus, readOnly, mono, name, id,
}) {
  const heights = { sm: 30, md: 36, lg: 42 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: full ? '100%' : undefined, ...style }}>
      {label && <label htmlFor={id} style={{ fontSize: 11, color: 'var(--text-2)', letterSpacing: '0.02em' }}>{label}</label>}
      <div style={{ position: 'relative' }}>
        {icon && <Icon name={icon} size={14} color="var(--text-3)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />}
        <input
          id={id}
          name={name}
          type={type}
          value={value ?? ''}
          onChange={onChange}
          placeholder={placeholder}
          autoFocus={autoFocus}
          readOnly={readOnly}
          style={{
            width: '100%',
            height: heights[size],
            padding: icon ? '0 12px 0 32px' : '0 12px',
            paddingRight: suffix ? 60 : 12,
            background: readOnly ? 'transparent' : 'var(--bg-input)',
            border: `1px solid ${error ? 'var(--red)' : 'var(--border-light)'}`,
            borderRadius: 6,
            color: 'var(--text-1)',
            fontFamily: mono ? 'var(--font-mono)' : 'var(--font-display)',
            fontSize: 13,
            outline: 'none',
            transition: 'border-color 0.12s, box-shadow 0.12s',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = error ? 'var(--red)' : 'var(--green-line)';
            e.currentTarget.style.boxShadow = error ? 'var(--ring-error)' : 'var(--ring-accent)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = error ? 'var(--red)' : 'var(--border-light)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        {suffix && (
          <span style={{
            position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)',
            fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
          }}>{suffix}</span>
        )}
      </div>
      {error && <span style={{ fontSize: 11, color: 'var(--red)' }}>{error}</span>}
    </div>
  );
}

export function Select({ value, onChange, options, label, size = 'md', full, style, id, name }) {
  const heights = { sm: 28, md: 34 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label && <label htmlFor={id} style={{ fontSize: 11, color: 'var(--text-2)' }}>{label}</label>}
      <div style={{ position: 'relative', width: full ? '100%' : undefined }}>
        <select
          id={id}
          name={name}
          value={value}
          onChange={onChange}
          style={{
            appearance: 'none',
            width: full ? '100%' : 'auto',
            height: heights[size],
            padding: '0 32px 0 12px',
            background: 'var(--bg-input)',
            border: '1px solid var(--border-light)',
            borderRadius: 6,
            color: 'var(--text-1)',
            fontFamily: 'var(--font-display)',
            fontSize: 12.5,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Icon
          name="chevronDown" size={12} color="var(--text-3)"
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
        />
      </div>
    </div>
  );
}

export function Checkbox({ checked, onChange, indeterminate, size = 14 }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onChange?.(!checked); }}
      style={{
        width: size, height: size, borderRadius: 3,
        background: checked || indeterminate ? 'var(--green)' : 'var(--bg-input)',
        border: `1px solid ${checked || indeterminate ? 'var(--green-bright)' : 'var(--border-light)'}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', padding: 0, flexShrink: 0,
      }}
    >
      {indeterminate ? (
        <span style={{ width: 7, height: 1.5, background: '#fff' }} />
      ) : checked ? (
        <Icon name="check" size={10} color="#fff" style={{ strokeWidth: 3 }} />
      ) : null}
    </button>
  );
}

// ─── TOAST / EMPTY / MODAL ────────────────────────────────────────────
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = (t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((cur) => [...cur, { id, ...t }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 4000);
  };
  return { toasts, push };
}

export function ToastStack({ toasts }) {
  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 9000 }}>
      {toasts.map((t) => {
        const tones = { success: 'green', error: 'red', info: 'blue' };
        const tone = tones[t.kind] || 'info';
        return (
          <div key={t.id} style={{
            minWidth: 280, maxWidth: 360,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
            borderLeft: `3px solid var(${tone === 'green' ? '--green' : tone === 'red' ? '--red' : '--blue'})`,
            borderRadius: 6, padding: '10px 14px',
            display: 'flex', alignItems: 'flex-start', gap: 10,
            boxShadow: 'var(--shadow-lg)', animation: 'rdr-slide-in-right 0.25s',
          }}>
            <Icon
              name={t.kind === 'success' ? 'check' : t.kind === 'error' ? 'warning' : 'info'}
              size={14}
              color={tone === 'green' ? 'var(--green-bright)' : tone === 'red' ? 'var(--red)' : 'var(--blue)'}
              style={{ marginTop: 2 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>{t.title}</div>
              {t.body && <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>{t.body}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EmptyState({ icon = 'radar', title, body, action }) {
  return (
    <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>
        <Icon name={icon} size={22} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-1)' }}>{title}</div>
      {body && <div style={{ fontSize: 12, color: 'var(--text-3)', maxWidth: 320 }}>{body}</div>}
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 440 }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 8000,
        background: 'rgba(15,23,42,0.32)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'rdr-fade-up 0.18s',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: 'calc(100vw - 40px)',
          background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
          borderRadius: 10, boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: 'var(--text-3)', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
        {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)' }}>{footer}</div>}
      </div>
    </div>
  );
}

// ─── CHARTS ───────────────────────────────────────────────────────────
export function Sparkline({ data, color = 'var(--green)', width = 80, height = 24, fill }) {
  if (!data || data.length === 0) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`)
    .join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {fill && <polygon points={`0,${height} ${pts} ${width},${height}`} fill={color} fillOpacity="0.15" />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BarChart({ data, height = 120, color = 'var(--green)' }) {
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: '100%', height: `${(d.value / max) * 100}%`, background: d.color || color, borderRadius: '3px 3px 0 0' }} />
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

export function LineChart({ data, height = 140, color = 'var(--green)', yLabel }) {
  const w = 600;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${height - ((v - min) / range) * (height - 20) - 10}`)
    .join(' ');
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
        {[0.25, 0.5, 0.75].map((p) => (
          <line key={p} x1="0" x2={w} y1={height * p} y2={height * p} stroke="var(--border)" strokeDasharray="2 4" />
        ))}
        <polygon points={`0,${height} ${pts} ${w},${height}`} fill={color} fillOpacity="0.12" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {data.map((v, i) => i === data.length - 1 && (
          <circle key={i} cx={(i / (data.length - 1)) * w} cy={height - ((v - min) / range) * (height - 20) - 10} r="3" fill={color} />
        ))}
      </svg>
      {yLabel && <div style={{ position: 'absolute', left: 8, top: 4, fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{yLabel}</div>}
    </div>
  );
}

export function Donut({ segments, size = 140 }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-tint)" strokeWidth="14" />
      {segments.map((s, i) => {
        const len = (s.value / total) * c;
        const offset = (acc / total) * c;
        acc += s.value;
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="14"
            strokeDasharray={`${len} ${c}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
      })}
    </svg>
  );
}

// ─── CARD / KBD / LOGO ────────────────────────────────────────────────
export function Card({ children, title, action, style, padding = 16, headerRight }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-sm)', ...style }}>
      {(title || action || headerRight) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-1)', letterSpacing: '0.01em' }}>{title}</div>
          <div>{headerRight || action}</div>
        </div>
      )}
      <div style={{ padding }}>{children}</div>
    </div>
  );
}

export function Kbd({ children }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, padding: '1px 5px',
      background: 'var(--bg-input)', border: '1px solid var(--border-light)',
      borderRadius: 3, color: 'var(--text-2)',
    }}>{children}</span>
  );
}

export function RadarLogo({ size = 18, withTagline, sweep, white }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg viewBox="0 0 24 24" width={size} height={size}>
          <circle cx="12" cy="12" r="10" fill="none" stroke="var(--green)" strokeWidth="1.4" />
          <circle cx="12" cy="12" r="6" fill="none" stroke="var(--green)" strokeWidth="1.2" opacity="0.6" />
          <circle cx="12" cy="12" r="2" fill="var(--green)" />
          {sweep && (
            <g style={{ transformOrigin: '12px 12px', animation: 'rdr-radar-sweep 2.4s linear infinite' }}>
              <defs>
                <linearGradient id="rdr-sw" x1="12" y1="12" x2="22" y2="12" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="var(--green-bright)" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="var(--green-bright)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M12 12 L22 12 A10 10 0 0 0 19 5 Z" fill="url(#rdr-sw)" />
            </g>
          )}
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontWeight: 700,
          fontSize: size * 0.85, letterSpacing: '0.18em',
          color: white ? '#fff' : 'var(--text-1)',
        }}>RADAR</span>
        {withTagline && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 9,
            color: white ? 'rgba(255,255,255,0.7)' : 'var(--text-3)',
            letterSpacing: '0.1em', marginTop: 3,
          }}>by Simple Inc</span>
        )}
      </div>
    </div>
  );
}

// Helper used by the Replies surface (and possibly Today)
export const replyTone = { hot: 'red', schedule: 'green', unsubscribe: 'grey', ooo: 'amber' };
export const replyLabel = { hot: '🔥 Hot', schedule: 'Schedule', unsubscribe: 'Unsubscribe', ooo: 'OOO' };
export const statusTone = { ready: 'green', sent: 'blue', replied: 'purple', queued: 'amber', skipped: 'grey', rejected: 'red', nurture: 'cyan' };
