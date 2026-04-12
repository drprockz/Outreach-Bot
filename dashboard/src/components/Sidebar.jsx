import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api';

const navItems = [
  { path: '/',          label: 'Overview',   icon: '◉' },
  { path: '/leads',     label: 'Leads',      icon: '◎' },
  { path: '/funnel',    label: 'Funnel',     icon: '▽' },
  { path: '/send-log',  label: 'Send Log',   icon: '✉' },
  { path: '/replies',   label: 'Replies',    icon: '↩' },
  { path: '/sequences', label: 'Sequences',  icon: '→' },
  { path: '/cron',      label: 'Cron Jobs',  icon: '⏱' },
  { path: '/health',    label: 'Health',      icon: '♥' },
  { path: '/costs',     label: 'Costs',       icon: '¤' },
  { path: '/errors',    label: 'Errors',      icon: '⚠', showBadge: true },
];

const settingsItems = [
  { path: '/settings/niches',  label: 'Niches' },
  { path: '/settings/engines', label: 'Engines' },
  { path: '/settings/icp',     label: 'ICP Rubric' },
  { path: '/settings/persona', label: 'Persona' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [unresolvedErrors, setUnresolvedErrors] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(location.pathname.startsWith('/settings'));

  useEffect(() => {
    api.errors('?resolved=0').then(d => {
      setUnresolvedErrors(d?.unresolvedCount || 0);
    }).catch(() => {});
  }, []);

  function handleLogout() {
    localStorage.removeItem('radar_token');
    navigate('/login');
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <h1>RADAR</h1>
        <span>by Simple Inc</span>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <span className="icon">{item.icon}</span>
            {item.label}
            {item.showBadge && unresolvedErrors > 0 && (
              <span className="sidebar-badge">{unresolvedErrors}</span>
            )}
          </NavLink>
        ))}
        <div className="sidebar-section">
          <button
            className={`sidebar-link sidebar-section-toggle ${location.pathname.startsWith('/settings') ? 'active' : ''}`}
            onClick={() => setSettingsOpen(o => !o)}
          >
            <span className="icon">⚙</span>
            Settings
            <span className="sidebar-chevron">{settingsOpen ? '▾' : '▸'}</span>
          </button>
          {settingsOpen && settingsItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `sidebar-link sidebar-sublink ${isActive ? 'active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-logout" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </aside>
  );
}
