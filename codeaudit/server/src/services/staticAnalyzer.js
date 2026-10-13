import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectPython } from './analysis/toolRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run custom EYRA Python AST engine. Never invents mock findings on failure.
 * @returns {Promise<object>}
 */
export async function runCodebaseAudit(extractedDir) {
  const pythonScript = path.resolve(__dirname, '../../../analyzer-python/engine.py');
  const py = await detectPython();

  if (!py.available) {
    return {
      engineStatus: 'UNAVAILABLE',
      error: 'Python interpreter not found on PATH (python / python3 / py)',
      summary: {
        healthScore: null,
        grade: 'N/A',
        totalFiles: 0,
        totalLoc: 0,
        totalIssues: 0,
        severity: { Critical: 0, High: 0, Medium: 0, Low: 0 },
        issueTypes: {},
        partialFeaturesCount: 0,
        totalEffortHours: 0,
        analysisLimitation: 'Essential AST analysis could not run — Python unavailable',
      },
      issues: [],
      partialFeatures: [],
      files: [],
      limitations: ['python_unavailable'],
    };
  }

  return new Promise((resolve) => {
    execFile(
      py.bin,
      [pythonScript, '--path', extractedDir],
      { maxBuffer: 1024 * 1024 * 20, timeout: 180_000, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          const unavailable = error.code === 'ENOENT';
          return resolve({
            engineStatus: unavailable ? 'UNAVAILABLE' : 'FAILED',
            error: error.message,
            stderr: String(stderr || '').slice(0, 2000),
            summary: {
              healthScore: null,
              grade: 'N/A',
              totalFiles: 0,
              totalLoc: 0,
              totalIssues: 0,
              severity: { Critical: 0, High: 0, Medium: 0, Low: 0 },
              issueTypes: {},
              partialFeaturesCount: 0,
              totalEffortHours: 0,
              analysisLimitation: unavailable
                ? 'Python unavailable'
                : `AST engine failed: ${error.message}`,
            },
            issues: [],
            partialFeatures: [],
            files: [],
            limitations: [unavailable ? 'python_unavailable' : 'ast_engine_failed'],
          });
        }

        try {
          const parsed = JSON.parse(stdout || '{}');
          if (parsed.error && !parsed.issues) {
            return resolve({
              engineStatus: 'FAILED',
              error: parsed.error,
              summary: {
                healthScore: null,
                grade: 'N/A',
                totalFiles: 0,
                totalLoc: 0,
                totalIssues: 0,
                severity: { Critical: 0, High: 0, Medium: 0, Low: 0 },
                issueTypes: {},
                analysisLimitation: parsed.error,
              },
              issues: [],
              partialFeatures: [],
              files: [],
              limitations: ['ast_engine_error'],
            });
          }
          const issueCount = Array.isArray(parsed.issues) ? parsed.issues.length : 0;
          // Tag custom engine findings
          const issues = (parsed.issues || []).map((i) => ({
            ...i,
            sourceTool: i.sourceTool || 'eyra-ast',
            contributingTools: i.contributingTools || ['eyra-ast'],
          }));
          resolve({
            ...parsed,
            issues,
            engineStatus: issueCount ? 'FINDINGS' : 'PASS',
            limitations: parsed.limitations || [],
          });
        } catch (parseErr) {
          resolve({
            engineStatus: 'FAILED',
            error: `Invalid JSON from analysis engine: ${parseErr.message}`,
            stderr: String(stderr || stdout || '').slice(0, 2000),
            summary: {
              healthScore: null,
              grade: 'N/A',
              totalFiles: 0,
              totalLoc: 0,
              totalIssues: 0,
              severity: { Critical: 0, High: 0, Medium: 0, Low: 0 },
              issueTypes: {},
              analysisLimitation: 'AST engine returned invalid JSON',
            },
            issues: [],
            partialFeatures: [],
            files: [],
            limitations: ['ast_invalid_json'],
          });
        }
      },
    );
  });
}
