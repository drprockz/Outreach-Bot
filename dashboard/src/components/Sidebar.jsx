import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

const navItems = [
  { path: '/',          label: 'Overview',   icon: '\u25C9' },
  { path: '/leads',     label: 'Leads',      icon: '\u25CB' },
  { path: '/send-log',  label: 'Send Log',   icon: '\u2709' },
  { path: '/replies',   label: 'Replies',    icon: '\u21A9' },
  { path: '/sequences', label: 'Sequences',  icon: '\u2192' },
  { path: '/cron',      label: 'Cron Jobs',  icon: '\u29D7' },
  { path: '/health',    label: 'Health',      icon: '\u2665' },
  { path: '/costs',     label: 'Costs',       icon: '\u00A4' },
  { path: '/errors',    label: 'Errors',      icon: '\u26A0' },
];

const sidebarStyle = {
  width: '220px',
  minHeight: '100vh',
  background: '#1a1a1a',
  borderRight: '1px solid #2a2a2a',
  display: 'flex',
  flexDirection: 'column',
  padding: '0',
  flexShrink: 0,
};

const logoStyle = {
  padding: '24px 20px 20px',
  borderBottom: '1px solid #2a2a2a',
  marginBottom: '8px',
};

const logoTextStyle = {
  fontSize: '18px',
  fontWeight: 600,
  color: '#4ade80',
  letterSpacing: '2px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const logoSubStyle = {
  fontSize: '10px',
  color: '#555',
  marginTop: '2px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const navStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  padding: '8px 12px',
};

const linkBaseStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '10px 12px',
  borderRadius: '6px',
  textDecoration: 'none',
  fontSize: '13px',
  fontWeight: 500,
  fontFamily: 'IBM Plex Mono, monospace',
  transition: 'background 0.15s, color 0.15s',
};

const logoutContainerStyle = {
  padding: '16px 12px',
  borderTop: '1px solid #2a2a2a',
};

const logoutButtonStyle = {
  width: '100%',
  padding: '10px 12px',
  background: 'transparent',
  border: '1px solid #333',
  borderRadius: '6px',
  color: '#888',
  fontSize: '12px',
  fontFamily: 'IBM Plex Mono, monospace',
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s',
};

export default function Sidebar() {
  const navigate = useNavigate();

  function handleLogout() {
    localStorage.removeItem('radar_token');
    navigate('/login');
  }

  return (
    <aside style={sidebarStyle}>
      <div style={logoStyle}>
        <div style={logoTextStyle}>RADAR</div>
        <div style={logoSubStyle}>by Simple Inc</div>
      </div>
      <nav style={navStyle}>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            style={({ isActive }) => ({
              ...linkBaseStyle,
              background: isActive ? '#4ade8018' : 'transparent',
              color: isActive ? '#4ade80' : '#888',
            })}
          >
            <span style={{ fontSize: '15px', width: '20px', textAlign: 'center' }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div style={logoutContainerStyle}>
        <button
          onClick={handleLogout}
          style={logoutButtonStyle}
          onMouseEnter={(e) => { e.target.style.background = '#f8717118'; e.target.style.color = '#f87171'; }}
          onMouseLeave={(e) => { e.target.style.background = 'transparent'; e.target.style.color = '#888'; }}
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
