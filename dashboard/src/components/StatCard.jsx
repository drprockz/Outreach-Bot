import React from 'react';

const cardStyle = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  padding: '20px',
  minWidth: '180px',
  flex: '1 1 180px',
};

const labelStyle = {
  fontSize: '11px',
  fontWeight: 500,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  marginBottom: '8px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const valueStyle = {
  fontSize: '28px',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
  lineHeight: 1.2,
};

const subStyle = {
  fontSize: '11px',
  color: '#555',
  marginTop: '6px',
  fontFamily: 'IBM Plex Mono, monospace',
};

export default function StatCard({ label, value, sub, color = '#e0e0e0' }) {
  return (
    <div style={cardStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={{ ...valueStyle, color }}>{value}</div>
      {sub && <div style={subStyle}>{sub}</div>}
    </div>
  );
}
