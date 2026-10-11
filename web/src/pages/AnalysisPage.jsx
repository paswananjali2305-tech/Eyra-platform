import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEyra } from '../context/EyraContext';
import {
  qs,
  replaceExactText,
  replaceSubstring,
  setText,
} from '../lib/hydrateStitch.js';
import AnalysisStitch from './stitch_raw/AnalysisPage.jsx';

function hydrateAnalysis(root, result) {
  if (!root || !result) return;

  replaceExactText(root, 'EYRA-SESSION-0142', result.session_id || 'EYRA-SESSION');
  if (result.project_name) {
    replaceExactText(root, 'backend-api', result.project_name);
  }
  if (result.file_name) {
    replaceSubstring(root, 'test.py:3', `${result.file_name}`);
    replaceSubstring(root, 'test.py', result.file_name);
  }
  if (result.error_type) {
    replaceSubstring(root, 'ZeroDivisionError', result.error_type);
  }

  const rcaHeading = Array.from(root.querySelectorAll('span, h2, h3')).find((el) =>
    (el.textContent || '').includes('Root-Cause Analysis'),
  );
  if (rcaHeading) {
    const block = rcaHeading.closest('.rounded-xl, .rounded-lg, .flex')?.parentElement || rcaHeading.parentElement;
    const para = block?.querySelector?.('p.font-body-sm, p');
    if (para && (result.root_cause || result.explanation)) {
      setText(para, result.root_cause || result.explanation);
    }
  }

  const evidence = result.evidence || [];
  const factCards = qsa(root, '.rounded-lg.bg-surface-container');
  evidence.slice(0, 3).forEach((ev, i) => {
    const card = factCards[i];
    if (!card) return;
    const title = card.querySelector('.font-label-sm, .font-semibold');
    const detail = card.querySelector('p');
    if (title && ev.kind) setText(title.querySelector('span:last-child') || title, ev.kind);
    if (detail && ev.detail) setText(detail, ev.detail);
  });

  const patchPre = root.querySelector('pre');
  const patch =
    result.suggested_correction?.diff_unified || result.suggested_correction?.corrected_code;
  if (patchPre && patch) setText(patchPre, patch);

  if (result.verification?.detail) {
    replaceSubstring(root, 'Verification Results Sandbox', 'Verification Results Sandbox');
    const verBadge = Array.from(root.querySelectorAll('span')).find((el) =>
      /verified|hypothesis|unverified|failed/i.test((el.textContent || '').trim()),
    );
    if (verBadge && result.verification.status) {
      setText(verBadge, result.verification.status);
    }
  }

  const runtimePane = qs(root, '#runtimePane') || root;
  runtimePane.setAttribute('data-eyra-session', result.session_id || '');
}

export function AnalysisPage() {
  const navigate = useNavigate();
  const { activeResult, showToast } = useEyra();
  const hostRef = useRef(null);

  useEffect(() => {
    const root = hostRef.current?.querySelector('.stitch-screen') || hostRef.current;
    if (!root || !activeResult) return;
    hydrateAnalysis(root, activeResult);
  }, [activeResult]);

  return (
    <div
      ref={hostRef}
      onClick={async (e) => {
        const el = e.target.closest('button, a');
        if (!el) return;
        const text = (el.textContent || '').trim();
        if (text.includes('Open in Debugging Workspace') || text.includes('Debugging Workspace')) {
          e.preventDefault();
          navigate('/workspace');
        } else if (text.includes('Copy Patch') || text.includes('Copy Diff')) {
          e.preventDefault();
          const patch =
            activeResult?.suggested_correction?.diff_unified ||
            activeResult?.suggested_correction?.corrected_code ||
            'if b != 0:\n    print(a / b)\nelse:\n    print("Cannot divide by zero")\n';
          try {
            await navigator.clipboard.writeText(patch);
            showToast?.('Patch copied', 'info');
          } catch {
            showToast?.('Clipboard blocked', 'error');
          }
        } else if (text.includes('History')) {
          e.preventDefault();
          navigate('/history');
        } else if (text.includes('Verify') || text.includes('Sandbox')) {
          e.preventDefault();
          navigate('/workspace');
          showToast?.('Open workspace to run sandbox', 'info');
        }
      }}
    >
      <AnalysisStitch />
    </div>
  );
}
