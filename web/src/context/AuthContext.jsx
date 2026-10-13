import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearAuthToken, getAuthToken, setAuthToken } from '../api/client';

const AuthContext = createContext(null);

const USER_KEY = 'eyra.authUser';
const WELCOME_KEY = 'eyra.welcomePending';

function persistUser(user) {
  try {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      const label = user.display_name || user.username || '';
      localStorage.setItem('eyra.userName', label);
      localStorage.setItem('eyra.displayName', label);
      localStorage.setItem('eyra.loginName', user.username || label);
      const initial = (label.trim()[0] || user.username?.[0] || 'E').toUpperCase();
      localStorage.setItem('eyra.userInitial', initial);
    } else {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem('eyra.userName');
      localStorage.removeItem('eyra.displayName');
      localStorage.removeItem('eyra.loginName');
      localStorage.removeItem('eyra.userInitial');
    }
  } catch {
    /* ignore */
  }
}

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.id && parsed?.username) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => (getAuthToken() ? readStoredUser() : null));
  const [bootstrapping, setBootstrapping] = useState(() => Boolean(getAuthToken()));

  const applySession = useCallback((token, nextUser, { welcome = false } = {}) => {
    setAuthToken(token);
    persistUser(nextUser);
    setUser(nextUser);
    try {
      if (welcome) sessionStorage.setItem(WELCOME_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  const clearSession = useCallback(() => {
    clearAuthToken();
    persistUser(null);
    setUser(null);
    try {
      sessionStorage.removeItem(WELCOME_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const token = getAuthToken();
    if (!token) {
      setBootstrapping(false);
      return undefined;
    }

    api
      .me()
      .then((me) => {
        if (cancelled) return;
        persistUser(me);
        setUser(me);
      })
      .catch(() => {
        if (cancelled) return;
        clearSession();
      })
      .finally(() => {
        if (!cancelled) setBootstrapping(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = useCallback(
    async ({ login: loginId, password }) => {
      const data = await api.login({ login: loginId, password });
      applySession(data.access_token, data.user, { welcome: true });
      return data.user;
    },
    [applySession],
  );

  const register = useCallback(
    async ({ email, username, password, display_name }) => {
      const data = await api.register({ email, username, password, display_name });
      applySession(data.access_token, data.user, { welcome: true });
      return data.user;
    },
    [applySession],
  );

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const consumeWelcome = useCallback(() => {
    try {
      const pending = sessionStorage.getItem(WELCOME_KEY) === '1';
      sessionStorage.removeItem(WELCOME_KEY);
      return pending;
    } catch {
      return false;
    }
  }, []);

  const welcomePending = useCallback(() => {
    try {
      return sessionStorage.getItem(WELCOME_KEY) === '1';
    } catch {
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      bootstrapping,
      isAuthenticated: Boolean(user && getAuthToken()),
      login,
      register,
      logout,
      consumeWelcome,
      welcomePending,
      displayName: user?.display_name || user?.username || '',
      initials: ((user?.display_name || user?.username || 'E').trim()[0] || 'E').toUpperCase(),
    }),
    [user, bootstrapping, login, register, logout, consumeWelcome, welcomePending],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
