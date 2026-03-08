import React from 'react';

export default function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a1a1a 0%, #141414 100%)',
      border: '1px solid #ffffff15',
      borderRadius: 10,
      padding: '12px 16px',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 8px 32px #00000060, 0 0 0 1px #ffffff08',
    }}>
      <div style={{
        color: '#71717a', marginBottom: 8, fontSize: 11, fontWeight: 500,
        textTransform: 'uppercase', letterSpacing: 1,
      }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16, padding: '2px 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: p.color, display: 'inline-block',
            }} />
            <span style={{ color: '#a1a1aa', fontSize: 12 }}>{p.name}</span>
          </div>
          <span style={{
            color: '#fafafa', fontWeight: 600, fontSize: 13,
            fontFamily: "'IBM Plex Mono', monospace",
          }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}
