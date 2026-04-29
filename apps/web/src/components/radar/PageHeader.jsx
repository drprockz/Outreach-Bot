import React from 'react';
import Icon from './Icon';
import { Kbd } from './RadarUI';

export default function PageHeader({ title, subtitle, breadcrumb, action, hideBell, hideKbd }) {
  return (
    <div data-radar-header style={{
      height: 56,
      flexShrink: 0,
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      background: 'var(--bg-base)',
    }}>
      <div>
        {breadcrumb && breadcrumb.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 11, color: 'var(--text-3)',
            marginBottom: 2, fontFamily: 'var(--font-mono)',
          }}>
            {breadcrumb.map((b, i) => (
              <React.Fragment key={i}>
                {i > 0 && <Icon name="chevron" size={11} />}
                <span style={{ color: i === breadcrumb.length - 1 ? 'var(--text-2)' : 'var(--text-3)' }}>{b}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 1, fontFamily: 'var(--font-mono)' }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {action}
        {!hideBell && (
          <button
            type="button"
            aria-label="Notifications"
            style={{
              position: 'relative',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
              width: 34, height: 34, borderRadius: 6,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="bell" size={15} />
          </button>
        )}
        {!hideKbd && <Kbd>⌘K</Kbd>}
      </div>
    </div>
  );
}
