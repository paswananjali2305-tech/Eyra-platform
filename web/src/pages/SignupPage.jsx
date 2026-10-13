import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function SignupPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register({
        email: email.trim(),
        username: username.trim(),
        password,
        display_name: displayName.trim() || undefined,
      });
      navigate('/welcome', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create account');
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
        <h1 className="eyra-auth-title">Create account</h1>
        <p className="eyra-auth-sub">Separate history and projects for each user.</p>
        <form className="eyra-auth-form" onSubmit={onSubmit}>
          <label className="eyra-auth-label">
            Email
            <input
              className="eyra-auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="eyra-auth-label">
            Username
            <input
              className="eyra-auth-input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={2}
            />
          </label>
          <label className="eyra-auth-label">
            Display name <span className="eyra-auth-optional">(optional)</span>
            <input
              className="eyra-auth-input"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Shown as Hi, {name}"
            />
          </label>
          <label className="eyra-auth-label">
            Password
            <input
              className="eyra-auth-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
          {error ? <p className="eyra-auth-error">{error}</p> : null}
          <button className="eyra-auth-btn" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className="eyra-auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
