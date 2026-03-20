import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const containerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  background: '#0f0f0f',
};

const formCardStyle = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: '12px',
  padding: '48px 40px',
  width: '380px',
  maxWidth: '90vw',
};

const titleStyle = {
  fontSize: '24px',
  fontWeight: 600,
  color: '#4ade80',
  letterSpacing: '3px',
  marginBottom: '4px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const subtitleStyle = {
  fontSize: '12px',
  color: '#555',
  marginBottom: '32px',
  fontFamily: 'IBM Plex Mono, monospace',
};

const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  background: '#0f0f0f',
  border: '1px solid #333',
  borderRadius: '6px',
  color: '#e0e0e0',
  fontSize: '14px',
  fontFamily: 'IBM Plex Mono, monospace',
  outline: 'none',
  marginBottom: '16px',
};

const buttonStyle = {
  width: '100%',
  padding: '12px',
  background: '#4ade80',
  border: 'none',
  borderRadius: '6px',
  color: '#0f0f0f',
  fontSize: '13px',
  fontWeight: 600,
  fontFamily: 'IBM Plex Mono, monospace',
  cursor: 'pointer',
  letterSpacing: '1px',
};

const errorStyle = {
  color: '#f87171',
  fontSize: '12px',
  marginBottom: '12px',
  fontFamily: 'IBM Plex Mono, monospace',
};

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.login(password);
      if (data.token) {
        localStorage.setItem('radar_token', data.token);
        navigate('/');
      } else {
        setError(data.error || 'Invalid password');
      }
    } catch {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={containerStyle}>
      <form style={formCardStyle} onSubmit={handleSubmit}>
        <div style={titleStyle}>RADAR</div>
        <div style={subtitleStyle}>Dashboard Login</div>
        {error && <div style={errorStyle}>{error}</div>}
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
          autoFocus
        />
        <button type="submit" style={buttonStyle} disabled={loading}>
          {loading ? 'Authenticating...' : 'LOGIN'}
        </button>
      </form>
    </div>
  );
}
