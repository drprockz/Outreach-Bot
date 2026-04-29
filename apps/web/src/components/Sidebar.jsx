import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { logout } from '../lib/auth';
import { useAuth } from './AuthGate';
import Icon from './radar/Icon';
import { RadarLogo, PlanBadge } from './radar/RadarUI';

const NAV = [
  {
    section: 'HOME',
    items: [{ to: '/', label: 'Today', icon: 'home', end: true }],
  },
  {
    section: 'OUTREACH',
    items: [
      { to: '/outreach/engines',   label: 'Engines',     icon: 'radar',   liveDot: true },
      { to: '/outreach/leads',     label: 'Leads',       icon: 'leads' },
      { to: '/outreach/sent',      label: 'Sent Emails', icon: 'mail' },
      { to: '/outreach/followups', label: 'Follow-ups',  icon: 'refresh' },
      { to: '/outreach/replies',   label: 'Replies',     icon: 'reply' },
      { to: '/outreach/funnel',    label: 'Funnel',      icon: 'funnel' },
    ],
  },
  {
    section: 'SETUP',
    items: [
      { to: '/setup/niches',    label: 'Niches & Schedule', icon: 'calendar' },
      { to: '/setup/offer-icp', label: 'Offer & ICP',       icon: 'target' },
      { to: '/setup/voice',     label: 'Email Voice',       icon: 'voice' },
    ],
  },
  {
    section: 'SYSTEM',
    items: [
      { to: '/system/spend',        label: 'Spend',           icon: 'spend' },
      { to: '/system/email-health', label: 'Email Health',    icon: 'health' },
      { to: '/system/errors',       label: 'Errors',          icon: 'error', errorBadge: true },
      { to: '/system/logs',         label: 'Schedule & Logs', icon: 'log' },
    ],
  },
  {
    section: 'ACCOUNT',
    items: [
      { to: '/settings/profile', label: 'Profile', icon: 'users' },
      { to: '/settings/team',    label: 'Team',    icon: 'users' },
      { to: '/settings/billing', label: 'Billing', icon: 'spend' },
      { to: '/settings/org',     label: 'Org',     icon: 'shield' },
    ],
  },
];

const SUPERADMIN = {
  section: 'SUPERADMIN',
  items: [
    { to: '/superadmin/orgs',    label: 'Orgs',    icon: 'shield' },
    { to: '/superadmin/users',   label: 'Users',   icon: 'users' },
    { to: '/superadmin/metrics', label: 'Metrics', icon: 'metrics' },
  ],
};

export default function Sidebar() {
  const [unresolvedErrors, setUnresolvedErrors] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const auth = useAuth();
  const isSuperadmin = !!auth?.user?.isSuperadmin;
  const orgName = auth?.org?.name || 'Workspace';
  const orgSlug = auth?.org?.slug || '';
  const initials = (orgName || 'WS').split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  const planName = auth?.plan?.name || 'Trial';
  const userEmail = auth?.user?.email || '';

  useEffect(() => {
    api.errors('?resolved=0').then((d) => {
      setUnresolvedErrors(d?.unresolvedCount || 0);
    }).catch(() => {});
  }, []);

  const sections = isSuperadmin ? [...NAV, SUPERADMIN] : NAV;

  return (
    <aside
      style={{
        width: collapsed ? 56 : 224,
        flexShrink: 0,
        background: 'var(--bg-base)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        transition: 'width 0.18s',
      }}
    >
      {/* Brand row */}
      <div style={{
        height: 56, display: 'flex', alignItems: 'center',
        padding: collapsed ? 0 : '0 16px',
        justifyContent: collapsed ? 'center' : 'space-between',
        borderBottom: '1px solid var(--border)',
      }}>
        {collapsed ? (
          <RadarLogo size={20} sweep />
        ) : (
          <>
            <RadarLogo size={18} withTagline sweep />
            <button
              onClick={() => setCollapsed((c) => !c)}
              title="Collapse sidebar"
              style={{ background: 'transparent', border: 0, color: 'var(--text-3)', cursor: 'pointer', padding: 4, borderRadius: 4 }}
            >
              <Icon name="sidebar" size={14} />
            </button>
          </>
        )}
      </div>

      {/* Nav sections */}
      <nav className="rdr-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }}>
        {sections.map((sec) => (
          <div key={sec.section} style={{ marginBottom: 18 }}>
            {!collapsed && (
              <div style={{
                padding: '0 8px 6px',
                fontSize: 9.5,
                color: 'var(--text-3)',
                letterSpacing: '0.14em',
                fontFamily: 'var(--font-mono)',
              }}>
                {sec.section}
              </div>
            )}
            {sec.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={collapsed ? item.label : undefined}
                style={({ isActive }) => ({
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: collapsed ? '8px 0' : '7px 10px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  background: isActive ? 'var(--green-dim)' : 'transparent',
                  border: 0,
                  borderLeft: `2px solid ${isActive ? 'var(--green)' : 'transparent'}`,
                  color: isActive ? 'var(--green-bright)' : 'var(--text-2)',
                  fontSize: 12.5,
                  fontFamily: 'var(--font-display)',
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  borderRadius: 0,
                  textAlign: 'left',
                  marginBottom: 1,
                  position: 'relative',
                  textDecoration: 'none',
                })}
              >
                {({ isActive }) => (
                  <>
                    <span style={{ position: 'relative', display: 'flex' }}>
                      <Icon
                        name={item.icon}
                        size={15}
                        color={isActive ? 'var(--green-bright)' : 'currentColor'}
                      />
                      {item.liveDot && (
                        <span style={{
                          position: 'absolute', top: -2, right: -2,
                          width: 6, height: 6, borderRadius: '50%',
                          background: 'var(--blue)', animation: 'rdr-pulse 1.4s infinite',
                        }} />
                      )}
                    </span>
                    {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
                    {!collapsed && item.errorBadge && unresolvedErrors > 0 && (
                      <span style={{
                        minWidth: 16, height: 16, padding: '0 4px',
                        borderRadius: 8, background: 'var(--red)', color: '#fff',
                        fontSize: 9.5, fontWeight: 600,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {unresolvedErrors}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Account block */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding: collapsed ? 8 : '10px 8px',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <button
          onClick={() => navigate('/settings/billing')}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: collapsed ? '8px 0' : '7px 10px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            background: 'transparent', border: 0, color: 'var(--text-2)',
            cursor: 'pointer',
            fontSize: 12.5, fontFamily: 'var(--font-display)', textAlign: 'left',
          }}
        >
          <Icon name="settings" size={15} />
          {!collapsed && <span style={{ flex: 1 }}>Settings</span>}
        </button>

        {!collapsed && (
          <div style={{
            margin: '6px 4px 0',
            padding: 10,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'linear-gradient(135deg, var(--green), var(--cyan))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-mono)',
            }}>
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11.5, color: 'var(--text-1)', fontWeight: 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {orgName}
              </div>
              <div style={{ marginTop: 3 }}><PlanBadge plan={planName} size="sm" /></div>
            </div>
          </div>
        )}

        {!collapsed && (
          <div style={{ marginTop: 6, padding: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1, #ec4899)',
              flexShrink: 0,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11, color: 'var(--text-1)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {userEmail || (orgSlug ? `@${orgSlug}` : 'Your account')}
              </div>
              <div style={{
                fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {isSuperadmin ? 'Superadmin' : 'Owner'}
              </div>
            </div>
            <button
              onClick={logout}
              title="Log out"
              style={{ background: 'transparent', border: 0, color: 'var(--text-3)', cursor: 'pointer', padding: 4 }}
            >
              <Icon name="external" size={13} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
