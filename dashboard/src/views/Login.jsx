import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, isLoggedIn } from '../api.js';

export default function Login() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [btnHover, setBtnHover] = useState(false);

  if (isLoggedIn()) { navigate('/'); return null; }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(password);
      navigate('/');
    } catch {
      setError('Invalid password');
    }
    setLoading(false);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#050505',
      backgroundImage: `
        radial-gradient(ellipse at 20% 50%, #6366f115 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, #6366f10a 0%, transparent 50%),
        radial-gradient(ellipse at 50% 80%, #22c55e08 0%, transparent 50%)
      `,
    }}>
      <form onSubmit={handleSubmit} style={{
        background: 'linear-gradient(135deg, #0f0f0f 0%, #0a0a0a 100%)',
        border: '1px solid #ffffff10',
        borderRadius: 16, padding: 48, width: 380,
        boxShadow: '0 0 0 1px #ffffff05, 0 8px 40px #00000060, 0 0 80px #6366f108',
        animation: 'fadeIn 0.4s ease',
      }}>
        <div style={{
          fontSize: 13, fontWeight: 700, letterSpacing: 4, marginBottom: 8,
          fontFamily: "'IBM Plex Mono', monospace",
          background: 'linear-gradient(135deg, #6366f1, #a5b4fc)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>OUTREACH</div>
        <div style={{ fontSize: 13, color: '#52525b', marginBottom: 40 }}>
          outreach.simpleinc.in
        </div>
        <input
          style={{
            width: '100%', padding: '14px 18px', background: '#0a0a0a',
            border: `1px solid ${focused ? '#6366f180' : '#ffffff10'}`,
            borderRadius: 10, color: '#fafafa', fontSize: 14,
            fontFamily: "'Inter', sans-serif", outline: 'none',
            transition: 'all 0.2s ease',
            boxShadow: focused ? '0 0 0 3px #6366f120' : 'none',
          }}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus
        />
        <button
          onMouseEnter={() => setBtnHover(true)}
          onMouseLeave={() => setBtnHover(false)}
          style={{
            width: '100%', padding: '14px 0', marginTop: 20,
            background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
            border: 'none', borderRadius: 10, color: '#fff',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'Inter', sans-serif", letterSpacing: 0.3,
            boxShadow: btnHover ? '0 6px 24px #6366f160' : '0 4px 16px #6366f140',
            transform: btnHover && !loading ? 'translateY(-1px)' : 'translateY(0)',
            transition: 'all 0.2s ease',
            opacity: loading ? 0.7 : 1,
          }}
          disabled={loading}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
        {error && (
          <div style={{
            color: '#fca5a5', fontSize: 12, marginTop: 16,
            padding: '8px 12px', background: '#450a0a30',
            border: '1px solid #fca5a520', borderRadius: 8,
          }}>{error}</div>
        )}
      </form>
    </div>
  );
}
