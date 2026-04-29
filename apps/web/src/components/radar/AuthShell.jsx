import React from 'react';
import Icon from './Icon';

export default function AuthShell({ children, width = 460 }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-deep)',
      display: 'flex',
      alignItems: 'stretch',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Left brand panel — hidden on narrow viewports */}
      <div className="rdr-auth-brand" style={{
        width: 420,
        position: 'relative',
        background: 'linear-gradient(160deg, #064e3b 0%, #047857 35%, #10b981 100%)',
        color: '#fff',
        padding: '44px 40px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <svg
          style={{ position: 'absolute', inset: 0, opacity: 0.18, pointerEvents: 'none' }}
          width="100%" height="100%" aria-hidden="true"
        >
          <defs>
            <pattern id="brand-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#fff" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#brand-grid)" />
        </svg>
        <div style={{
          position: 'absolute', top: -120, right: -120, width: 320, height: 320,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(167,243,208,0.45), transparent 70%)',
        }} />

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="none" stroke="#fff" strokeWidth="1.4" />
            <circle cx="12" cy="12" r="6" fill="none" stroke="#fff" strokeWidth="1.2" opacity="0.6" />
            <circle cx="12" cy="12" r="2" fill="#fff" />
          </svg>
          <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15,
            letterSpacing: '0.2em',
          }}>RADAR</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.7, marginLeft: 4,
          }}>by Simple Inc</span>
        </div>

        <div style={{ position: 'relative', marginTop: 'auto' }}>
          <h2 style={{
            fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em',
            lineHeight: 1.15, margin: 0, marginBottom: 14,
          }}>
            Cold outreach<br />on autopilot.
          </h2>
          <p style={{
            fontSize: 13.5, color: 'rgba(255,255,255,0.85)',
            lineHeight: 1.6, margin: 0, marginBottom: 28,
          }}>
            Find leads, score them against your ICP, send personalised emails across multiple inboxes, and triage replies — all in one place.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              ['Lead discovery', 'Maps + web scraping, scored against your ICP'],
              ['AI personalisation', 'Claude & Gemini craft each first line'],
              ['Reply triage', 'Hot replies pinged to your Telegram instantly'],
            ].map(([t, s]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 6,
                  background: 'rgba(255,255,255,0.16)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, marginTop: 1,
                }}>
                  <Icon name="check" size={12} color="#fff" style={{ strokeWidth: 2.5 }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t}</div>
                  <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.7)', marginTop: 1 }}>{s}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          position: 'relative', marginTop: 36, paddingTop: 20,
          borderTop: '1px solid rgba(255,255,255,0.18)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ display: 'flex' }}>
            {['#fbbf24', '#60a5fa', '#f472b6'].map((c, i) => (
              <div
                key={c}
                style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: c, border: '2px solid #047857',
                  marginLeft: i ? -8 : 0,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>
            Trusted by <strong>140+ Indian agencies</strong> — sending 80k emails / week
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 32, position: 'relative',
      }}>
        <div style={{
          width, maxWidth: '100%', position: 'relative',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}>
          {children}
        </div>
        <div style={{
          position: 'absolute', bottom: 18, left: 0, right: 0,
          textAlign: 'center', fontSize: 10.5, color: 'var(--text-3)',
          fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
        }}>
          RADAR · v2.4.1 · ap-south-1
        </div>
      </div>
    </div>
  );
}
