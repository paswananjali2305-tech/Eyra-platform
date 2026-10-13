import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppShell } from './layout/AppShell.jsx';
import { OverviewPage } from './pages/OverviewPage.jsx';
import { WorkspacePage } from './pages/WorkspacePage.jsx';
import { AnalysisPage } from './pages/AnalysisPage.jsx';
import { HistoryPage } from './pages/HistoryPage.jsx';
import { MemoryPage } from './pages/MemoryPage.jsx';
import { ConfigPage } from './pages/ConfigPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { SignupPage } from './pages/SignupPage.jsx';
import { WelcomeIntroPage } from './pages/WelcomeIntroPage.jsx';

function BootSplash() {
  return (
    <div className="eyra-auth-screen">
      <div className="eyra-auth-panel eyra-auth-panel--slim">
        <span className="eyra-auth-mark">EYRA</span>
        <p className="eyra-auth-sub">Checking session…</p>
      </div>
    </div>
  );
}

function RequireAuth() {
  const { isAuthenticated, bootstrapping, welcomePending } = useAuth();
  if (bootstrapping) return <BootSplash />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (welcomePending()) return <Navigate to="/welcome" replace />;
  return <Outlet />;
}

function PublicOnly({ children }) {
  const { isAuthenticated, bootstrapping, welcomePending } = useAuth();
  if (bootstrapping) return <BootSplash />;
  if (isAuthenticated) {
    return <Navigate to={welcomePending() ? '/welcome' : '/'} replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicOnly>
            <SignupPage />
          </PublicOnly>
        }
      />
      <Route path="/welcome" element={<WelcomeIntroPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="workspace" element={<WorkspacePage />} />
          <Route path="analysis" element={<AnalysisPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="config" element={<ConfigPage />} />
          {/* Legacy audit URLs — AppShell flips mode and replace-navigates home */}
          <Route path="audit/*" element={null} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
