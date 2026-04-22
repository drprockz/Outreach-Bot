import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api';

const SECTIONS = [
  {
    label: 'Home',
    tooltip: 'Your daily starting point.',
    items: [
      { path: '/', label: 'Today', icon: '⌂' },
    ],
  },
  {
    label: 'Outreach',
    tooltip: 'Active leads, sends, replies, funnel.',
    items: [
      { path: '/outreach/engines',   label: 'Engines',     icon: '⚡' },
      { path: '/outreach/leads',     label: 'Leads',       icon: '◎' },
      { path: '/outreach/sent',      label: 'Sent Emails', icon: '✉' },
      { path: '/outreach/followups', label: 'Follow-ups',  icon: '→' },
      { path: '/outreach/replies',   label: 'Replies',     icon: '↩' },
      { path: '/outreach/funnel',    label: 'Funnel',      icon: '▽' },
    ],
  },
  {
    label: 'Setup',
    tooltip: 'Who you target, what you sell, how you sound.',
    items: [
      { path: '/setup/niches',    label: 'Niches & Schedule', icon: '🏷' },
      { path: '/setup/offer-icp', label: 'Offer & ICP',       icon: '🎯' },
      { path: '/setup/voice',     label: 'Email Voice',       icon: '✍' },
    ],
  },
  {
    label: 'System',
    tooltip: 'Spend, deliverability, errors, schedule.',
    items: [
      { path: '/system/spend',        label: 'Spend',           icon: '¤' },
      { path: '/system/email-health', label: 'Email Health',    icon: '♥' },
      { path: '/system/errors',       label: 'Errors',          icon: '⚠', showBadge: true },
      { path: '/system/logs',         label: 'Schedule & Logs', icon: '⏱' },
    ],
  },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const [unresolvedErrors, setUnresolvedErrors] = useState(0);

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
        {SECTIONS.map(section => (
          <div className="sidebar-section" key={section.label}>
            <div className="sidebar-section-label" title={section.tooltip}>{section.label}</div>
            {section.items.map(item => (
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
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-logout" onClick={handleLogout}>Logout</button>
      </div>
    </aside>
  );
}
