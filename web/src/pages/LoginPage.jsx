import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login({ login: loginId.trim(), password });
      navigate('/welcome', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="eyra-auth-screen">
      <div className="eyra-auth-panel">
        <div className="eyra-auth-brand">
          <span className="eyra-auth-mark">EYRA</span>
          <p className="eyra-auth-tag">Runtime Debugger</p>
        </div>
        <h1 className="eyra-auth-title">Sign in</h1>
        <p className="eyra-auth-sub">Your sessions and history stay on your account.</p>
        <form className="eyra-auth-form" onSubmit={onSubmit}>
          <label className="eyra-auth-label">
            Email or username
            <input
              className="eyra-auth-input"
              autoComplete="username"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
            />
          </label>
          <label className="eyra-auth-label">
            Password
            <input
              className="eyra-auth-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? <p className="eyra-auth-error">{error}</p> : null}
          <button className="eyra-auth-btn" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="eyra-auth-footer">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
