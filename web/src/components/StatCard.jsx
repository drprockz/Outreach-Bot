import React from 'react';

export default function StatCard({ label, value, sub, color = 'var(--text-1)', className = '' }) {
  return (
    <div className={`stat-card ${className}`} style={{ '--stat-accent': color }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
