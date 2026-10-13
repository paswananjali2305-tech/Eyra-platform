/**
 * Controlled subprocess helpers for optional analysis tools (ruff, radon, python).
 * Never auto-installs packages. Reports UNAVAILABLE / FAILED / SKIPPED honestly.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** @typedef {'PASS'|'FINDINGS'|'FAILED'|'UNAVAILABLE'|'SKIPPED'|'PARTIAL'} ToolStatus */

export async function commandExists(bin, args = ['--version']) {
  try {
    await execFileAsync(bin, args, { timeout: 8_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {{ timeoutMs?: number, cwd?: string, maxBuffer?: number }} [opts]
 */
export async function runTool(bin, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: opts.maxBuffer ?? 12 * 1024 * 1024,
      cwd: opts.cwd,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1' },
    });
    return { ok: true, code: 0, stdout: stdout || '', stderr: stderr || '' };
  } catch (err) {
    const code = typeof err.code === 'number' ? err.code : null;
    // Tools like ruff exit 1 when findings exist
    if (err.stdout != null || err.stderr != null) {
      return {
        ok: code === 0,
        code: code ?? 1,
        stdout: err.stdout || '',
        stderr: err.stderr || String(err.message || ''),
        timedOut: Boolean(err.killed && /ETIMEDOUT|timeout/i.test(String(err.message || ''))),
        error: err.message,
      };
    }
    return {
      ok: false,
      code: null,
      stdout: '',
      stderr: String(err.message || err),
      unavailable: err.code === 'ENOENT',
      error: err.message,
    };
  }
}

export function toolResult(status, detail = {}, issues = []) {
  return {
    status,
    detail: typeof detail === 'string' ? detail : detail.message || JSON.stringify(detail),
    ...detail,
    issues,
  };
}

export async function detectPython() {
  for (const bin of ['python', 'python3', 'py']) {
    if (await commandExists(bin, ['--version'])) {
      return { available: true, bin };
    }
  }
  return { available: false, bin: null };
}

export async function detectRuff() {
  if (await commandExists('ruff', ['--version'])) {
    return { available: true, bin: 'ruff', via: 'path' };
  }
  // python -m ruff
  const py = await detectPython();
  if (py.available) {
    const probe = await runTool(py.bin, ['-m', 'ruff', '--version'], { timeoutMs: 8_000 });
    if (probe.stdout || (probe.code === 0)) {
      return { available: true, bin: py.bin, argsPrefix: ['-m', 'ruff'], via: 'python-module' };
    }
  }
  return { available: false, bin: null };
}

export async function detectRadon() {
  const py = await detectPython();
  if (!py.available) return { available: false, bin: null, reason: 'python unavailable' };
  const probe = await runTool(py.bin, ['-m', 'radon', '--version'], { timeoutMs: 8_000 });
  if (probe.unavailable || /No module named radon/i.test(probe.stderr + probe.stdout)) {
    return { available: false, bin: null, reason: 'radon module not installed' };
  }
  if (probe.code === 0 || /radon/i.test(probe.stdout + probe.stderr)) {
    return { available: true, bin: py.bin, argsPrefix: ['-m', 'radon'], via: 'python-module' };
  }
  return { available: false, bin: null, reason: probe.stderr || 'radon probe failed' };
}
