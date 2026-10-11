import { useNavigate } from 'react-router-dom';
import { useEyra } from '../context/EyraContext';
import AnalysisStitch from './stitch_raw/AnalysisPage.jsx';

export function AnalysisPage() {
  const navigate = useNavigate();
  const { activeResult, showToast } = useEyra();

  return (
    <div
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
