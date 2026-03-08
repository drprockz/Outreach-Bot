import React, { useState } from 'react';

export default function StatCard({ label, value, color, trend }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'linear-gradient(135deg, #141414 0%, #0f0f0f 100%)',
        border: '1px solid #ffffff0f',
        borderRadius: 12,
        padding: '24px 28px',
        minWidth: 180,
        flex: 1,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: hovered
          ? '0 0 0 1px #6366f120, 0 4px 16px #00000060, 0 0 32px #6366f108'
          : '0 0 0 1px #ffffff05, 0 2px 8px #00000040',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        cursor: 'default',
      }}
    >
      <div style={{
        fontSize: 11, color: '#71717a', textTransform: 'uppercase',
        letterSpacing: 1.5, fontWeight: 500,
      }}>{label}</div>
      <div style={{
        fontSize: 32, fontWeight: 700, marginTop: 8,
        color: color || '#fafafa',
        fontFamily: "'IBM Plex Mono', monospace",
        letterSpacing: -1,
      }}>{value}</div>
      {trend && (
        <div style={{
          fontSize: 11, fontWeight: 600, marginTop: 6,
          color: trend.startsWith('+') ? '#22c55e' : trend.startsWith('-') ? '#ef4444' : '#71717a',
          fontFamily: "'IBM Plex Mono', monospace",
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {trend.startsWith('+') ? '\u2191' : trend.startsWith('-') ? '\u2193' : ''} {trend}
        </div>
      )}
    </div>
  );
}
