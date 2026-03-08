import React from 'react';

const COLORS = {
  cold:      { bg: '#1e293b20', text: '#94a3b8', border: '#94a3b830' },
  contacted: { bg: '#1e1b4b30', text: '#a5b4fc', border: '#a5b4fc30' },
  hot:       { bg: '#14532d30', text: '#86efac', border: '#86efac30' },
  schedule:  { bg: '#1e3a5f30', text: '#93c5fd', border: '#93c5fd30' },
  soft:      { bg: '#42200630', text: '#fbbf24', border: '#fbbf2430' },
  closed:    { bg: '#14532d30', text: '#4ade80', border: '#4ade8030' },
  rejected:  { bg: '#450a0a30', text: '#fca5a5', border: '#fca5a530' },
  dormant:   { bg: '#1c191730', text: '#78716c', border: '#78716c30' },
  sent:      { bg: '#1e1b4b30', text: '#a5b4fc', border: '#a5b4fc30' },
  pending:   { bg: '#42200630', text: '#fbbf24', border: '#fbbf2430' },
  bounced:   { bg: '#450a0a30', text: '#fca5a5', border: '#fca5a530' },
  failed:    { bg: '#450a0a30', text: '#fca5a5', border: '#fca5a530' },
};

export default function Badge({ status }) {
  const c = COLORS[status] || COLORS.cold;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px 3px 8px', borderRadius: 100,
      fontSize: 11, fontWeight: 500, background: c.bg, color: c.text,
      border: `1px solid ${c.border}`,
      textTransform: 'capitalize', letterSpacing: 0.3,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: c.text,
        opacity: 0.8, flexShrink: 0,
        ...(status === 'hot' ? { animation: 'pulse 2s infinite' } : {}),
      }} />
      {status}
    </span>
  );
}
