import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

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
    <div className="login-container">
      <form className="login-form" onSubmit={handleSubmit}>
        <div className="login-title">RADAR</div>
        <div className="login-subtitle">Dashboard Login</div>
        {error && <div className="login-error">{error}</div>}
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="login-input"
          autoFocus
        />
        <button type="submit" className="login-btn" disabled={loading}>
          {loading ? 'AUTHENTICATING...' : 'LOGIN'}
        </button>
      </form>
    </div>
  );
}
