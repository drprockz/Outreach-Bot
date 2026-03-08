import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { logout, fetchOverview } from '../api.js';

const links = [
  { to: '/', label: 'Overview', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { to: '/pipeline', label: 'Pipeline', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { to: '/analytics', label: 'Analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { to: '/costs', label: 'Costs', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { to: '/reports', label: 'Reports', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { to: '/emails', label: 'Emails', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
];

const s = {
  sidebar: {
    width: 240,
    background: 'linear-gradient(180deg, #0f0f0f 0%, #0a0a0a 100%)',
    borderRight: '1px solid #ffffff0a',
    display: 'flex', flexDirection: 'column', padding: '24px 0',
  },
  logo: {
    fontSize: 11, fontWeight: 700, letterSpacing: 3,
    padding: '0 24px 24px',
    borderBottom: '1px solid #ffffff08',
    fontFamily: "'IBM Plex Mono', monospace",
    background: 'linear-gradient(135deg, #6366f1, #a5b4fc)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  nav: { flex: 1, padding: '16px 0' },
  link: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 20px', margin: '2px 12px',
    color: '#71717a', textDecoration: 'none',
    fontSize: 13, fontWeight: 500, borderRadius: 8,
    transition: 'all 0.15s ease',
  },
  activeLink: {
    color: '#fafafa', background: '#ffffff0a',
    boxShadow: 'inset 0 0 0 1px #ffffff08',
  },
  hoverLink: {
    color: '#a1a1aa', background: '#ffffff06',
  },
  badge: {
    background: 'linear-gradient(135deg, #14532d, #166534)',
    color: '#86efac', fontSize: 10, fontWeight: 700,
    padding: '2px 8px', borderRadius: 10,
    minWidth: 20, textAlign: 'center',
    boxShadow: '0 0 8px #22c55e30',
    fontFamily: "'IBM Plex Mono', monospace",
    marginLeft: 'auto',
  },
  logout: {
    padding: '12px 24px', color: '#52525b', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', border: 'none', background: 'none',
    textAlign: 'left', fontFamily: "'Inter', sans-serif",
    borderTop: '1px solid #ffffff08', marginTop: 'auto',
    transition: 'color 0.15s ease',
  },
};

export default function Sidebar() {
  const [hotCount, setHotCount] = useState(0);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    fetchOverview()
      .then((data) => setHotCount(data?.hotLeads?.length || 0))
      .catch(() => {});
  }, []);

  return (
    <div style={s.sidebar}>
      <div style={s.logo}>OUTREACH</div>
      <nav style={s.nav}>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            onMouseEnter={() => setHovered(l.to)}
            onMouseLeave={() => setHovered(null)}
            style={({ isActive }) => ({
              ...s.link,
              ...(isActive ? s.activeLink : {}),
              ...(!isActive && hovered === l.to ? s.hoverLink : {}),
            })}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d={l.icon} />
            </svg>
            <span>{l.label}</span>
            {l.to === '/' && hotCount > 0 && (
              <span style={s.badge}>{hotCount}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <button
        style={s.logout}
        onClick={logout}
        onMouseEnter={(e) => e.target.style.color = '#a1a1aa'}
        onMouseLeave={(e) => e.target.style.color = '#52525b'}
      >
        Logout
      </button>
    </div>
  );
}
