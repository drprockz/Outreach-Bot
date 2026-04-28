import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api';
import { logout } from '../lib/auth';
import { useAuth } from './AuthGate';

const BASE_SECTIONS = [
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
  {
    label: 'Account',
    tooltip: 'Profile, team, billing, org.',
    items: [
      { path: '/settings/profile', label: 'Profile', icon: '☺' },
      { path: '/settings/team',    label: 'Team',    icon: '☷' },
      { path: '/settings/billing', label: 'Billing', icon: '$' },
      { path: '/settings/org',     label: 'Org',     icon: '◇' },
    ],
  },
];

const SUPERADMIN_SECTION = {
  label: 'Superadmin',
  tooltip: 'Cross-org administration. Visible only to superadmins.',
  items: [
    { path: '/superadmin/orgs',    label: 'Orgs',    icon: '⌘' },
    { path: '/superadmin/users',   label: 'Users',   icon: '☰' },
    { path: '/superadmin/metrics', label: 'Metrics', icon: '∑' },
  ],
};

export default function Sidebar() {
  const [unresolvedErrors, setUnresolvedErrors] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    api.errors('?resolved=0').then(d => {
      setUnresolvedErrors(d?.unresolvedCount || 0);
    }).catch(() => {});
  }, []);

  function handleLogout() {
    logout();
  }

  const sections = user.isSuperadmin ? [...BASE_SECTIONS, SUPERADMIN_SECTION] : BASE_SECTIONS;

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <h1>RADAR</h1>
        <span>by Simple Inc</span>
      </div>
      <nav className="sidebar-nav">
        {sections.map(section => (
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
