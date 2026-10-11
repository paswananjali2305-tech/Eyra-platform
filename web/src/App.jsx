import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell.jsx';
import { OverviewPage } from './pages/OverviewPage.jsx';
import { WorkspacePage } from './pages/WorkspacePage.jsx';
import { AnalysisPage } from './pages/AnalysisPage.jsx';
import { HistoryPage } from './pages/HistoryPage.jsx';
import { MemoryPage } from './pages/MemoryPage.jsx';
import { ConfigPage } from './pages/ConfigPage.jsx';

export default function App() {
  return (
    <Routes>
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
    </Routes>
  );
}
