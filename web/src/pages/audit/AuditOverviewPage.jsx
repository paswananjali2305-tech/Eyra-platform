import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useEyra } from '../../context/EyraContext';
import {
  replaceSubstring,
  setKpiByLabel,
  setText,
  shortSessionTag,
} from '../../lib/hydrateStitch.js';
import AuditOverviewStitch from '../stitch_raw/audit/AuditOverviewPage.jsx';

function hydrateAuditOverview(root, scan, scans) {
  if (!root) return;
  if (!scan && (!scans || !scans.length)) return;

  const s = scan || scans[0];
  const summary = s?.summary || {};
  const sev = summary.severity || {};

  if (summary.healthScore != null) {
    setKpiByLabel(root, 'Code Health Score', summary.healthScore);
    // common Stitch labels
    const scoreEls = Array.from(root.querySelectorAll('.font-display-lg')).slice(0, 2);
    if (scoreEls[0] && summary.healthScore != null) setText(scoreEls[0], summary.healthScore);
  }
  if (summary.grade) {
    replaceSubstring(root, 'Grade B+', `Grade ${summary.grade}`);
    replaceSubstring(root, 'B+', summary.grade);
  }
  if (summary.totalIssues != null) {
    setKpiByLabel(root, 'Open Findings', summary.totalIssues);
  }
  if (sev.Critical != null) replaceSubstring(root, '4 Crit', `${sev.Critical} Crit`);
  if (sev.High != null) replaceSubstring(root, '9 High', `${sev.High} High`);
  if (sev.Medium != null) replaceSubstring(root, '11 Med', `${sev.Medium} Med`);
  if (sev.Low != null) replaceSubstring(root, '4 Low', `${sev.Low} Low`);

  if (summary.dependencyVulnerabilities != null || (s.dependencies && s.dependencies.length)) {
    const n = summary.dependencyVulnerabilities ?? s.dependencies?.length ?? 0;
    setKpiByLabel(root, 'Security CVEs', n);
  }

  if (summary.totalFiles != null) {
    replaceSubstring(root, '342 Files', `${summary.totalFiles} Files`);
  }
  if (summary.totalLoc != null) {
    replaceSubstring(root, '42,180 total LOC', `${summary.totalLoc} total LOC`);
  }

  if (s.projectName) {
    replaceSubstring(root, 'backend-api', s.projectName);
  }
  if (s.id) {
    replaceSubstring(root, '#SC-088', shortSessionTag(s.id));
  }

  if (scans?.length) {
    replaceSubstring(root, 'View Previous Audits', `View Previous Audits (${scans.length})`);
  }
}

export function AuditOverviewPage() {
  const { setAuditView, setMode, showToast, activeScan, adoptScan, refreshScanList, scanList } =
    useEyra();
  const navigate = useNavigate();
  const hostRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const scans = await refreshScanList();
      if (cancelled) return;
      let scan = activeScan;
      if ((!scan || scan.status !== 'completed') && scans?.[0]?.id) {
        try {
          const data = await api.getScan(scans[0].id);
          scan = data?.scan || data;
          if (scan) adoptScan(scan, { notify: false });
        } catch {
          /* keep stitch sample layout */
        }
      }
      const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
      if (scan?.summary?.healthScore != null || scan?.summary?.totalIssues != null) {
        hydrateAuditOverview(root, scan, scans);
      } else if (scans?.length) {
        hydrateAuditOverview(root, scans[0], scans);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeScan?.id, activeScan?.status, refreshScanList, adoptScan]);

  return (
    <div
      ref={hostRef}
      onClick={(e) => {
        const el = e.target.closest('button, a');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Audit New Codebase') || text.includes('Ingest')) {
          e.preventDefault();
          setAuditView('ingest');
        } else if (text.includes('View Previous Audits') || text.includes('View All')) {
          e.preventDefault();
          setAuditView('history');
        } else if (
          text.includes('Inspect AST') ||
          text.includes('Inspect') ||
          text.includes('Open Code') ||
          text.includes('heatmap')
        ) {
          e.preventDefault();
          setAuditView('code');
        } else if (text.includes('Send to Debugging') || text.includes('Debugging Workspace')) {
          e.preventDefault();
          setMode('runtime');
          navigate('/workspace');
        } else if (text.includes('Progress') || text.includes('Live Audit')) {
          e.preventDefault();
          setAuditView('progress');
        } else if (text.includes('refresh') || text.includes('Refresh')) {
          e.preventDefault();
          refreshScanList().then(() => showToast?.('Audit overview refreshed', 'info'));
        }
      }}
    >
      <AuditOverviewStitch />
      {!activeScan && !scanList?.length ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded bg-surface-container-highest/95 px-space-md py-space-sm font-body-sm text-body-sm text-on-surface-variant shadow-xl">
          Showing designed sample overview — run an ingest to load live scan metrics.
        </div>
      ) : null}
    </div>
  );
}
