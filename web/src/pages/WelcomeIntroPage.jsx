import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function typeLines(lines, onTick, onDone) {
  let lineIdx = 0;
  let charIdx = 0;
  let cancelled = false;
  let timer = null;

  const tick = () => {
    if (cancelled) return;
    if (lineIdx >= lines.length) {
      onDone?.();
      return;
    }
    const line = lines[lineIdx];
    charIdx += 1;
    onTick(lines.slice(0, lineIdx).concat(line.slice(0, charIdx)));
    if (charIdx >= line.length) {
      lineIdx += 1;
      charIdx = 0;
      timer = setTimeout(tick, 420);
    } else {
      const ch = line[charIdx - 1];
      const delay = ch === ' ' ? 28 : ch === ',' ? 90 : 18 + Math.random() * 22;
      timer = setTimeout(tick, delay);
    }
  };

  if (lines[0]) {
    charIdx = 1;
    onTick([lines[0].slice(0, 1)]);
  }
  timer = setTimeout(tick, 16);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

export function WelcomeIntroPage() {
  const { user, isAuthenticated, bootstrapping, welcomePending, consumeWelcome } = useAuth();
  const navigate = useNavigate();
  const finished = useRef(false);
  const [done, setDone] = useState(false);

  const name = useMemo(() => {
    const raw = (user?.display_name || user?.username || 'friend').trim();
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [user]);

  const lines = useMemo(
    () => [
      '$ eyra session --boot',
      `> Hi, ${name}`,
      '> Loading your workspace…',
      '> Ready.',
    ],
    [name],
  );

  const [visible, setVisible] = useState(() => [lines[0].slice(0, 1)]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    if (!welcomePending()) {
      if (!bootstrapping) navigate('/', { replace: true });
      return undefined;
    }
    if (finished.current) {
      if (bootstrapping) return undefined;
      consumeWelcome();
      const leaveTimer = setTimeout(() => navigate('/', { replace: true }), 900);
      return () => clearTimeout(leaveTimer);
    }

    let leaveTimer = null;
    const cancel = typeLines(lines, setVisible, () => {
      finished.current = true;
      setDone(true);
      if (bootstrapping) return;
      consumeWelcome();
      leaveTimer = setTimeout(() => navigate('/', { replace: true }), 900);
    });
    return () => {
      cancel();
      if (leaveTimer) clearTimeout(leaveTimer);
    };
  }, [bootstrapping, isAuthenticated, welcomePending, consumeWelcome, lines, navigate]);

  if (!bootstrapping && !isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="eyra-welcome-screen" aria-live="polite">
      <pre className="eyra-welcome-code">
        {visible.map((line, i) => (
          <div key={`${i}-${line.slice(0, 12)}`} className="eyra-welcome-line">
            <span className={line.startsWith('$') ? 'eyra-welcome-prompt' : 'eyra-welcome-out'}>
              {line}
            </span>
            {i === visible.length - 1 && !done ? <span className="eyra-welcome-caret" /> : null}
          </div>
        ))}
      </pre>
    </div>
  );
}
