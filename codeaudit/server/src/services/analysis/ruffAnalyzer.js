/**
 * Optional Ruff integration — does not replace the custom Python AST engine.
 */
import path from 'path';
import fs from 'fs';
import { detectRuff, runTool, toolResult } from './toolRunner.js';

const SEVERITY_MAP = {
  E: 'Medium',
  F: 'High',
  W: 'Low',
  C: 'Low',
  I: 'Low',
  N: 'Low',
  D: 'Low',
  UP: 'Low',
  S: 'High',
  B: 'High',
  A: 'Medium',
  T: 'Low',
  RUF: 'Medium',
};

function severityForCode(code) {
  const c = String(code || '');
  if (c.startsWith('S') || c.startsWith('B') || c.startsWith('F')) return 'High';
  const prefix = c.match(/^[A-Z]+/)?.[0] || '';
  return SEVERITY_MAP[prefix] || 'Medium';
}

function collectPyFiles(rootDir, limit = 400) {
  const out = [];
  const ignore = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build']);
  function walk(dir) {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= limit) return;
      if (ignore.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.py')) {
        out.push(full);
      }
    }
  }
  walk(rootDir);
  return out;
}

/**
 * @param {string} extractedDir
 * @param {{ enabled?: boolean }} [opts]
 */
export async function runRuffAnalysis(extractedDir, opts = {}) {
  if (opts.enabled === false) {
    return toolResult('SKIPPED', { message: 'Ruff skipped (disabled in scan engines)' }, []);
  }

  const pyFiles = collectPyFiles(extractedDir);
  if (!pyFiles.length) {
    return toolResult('SKIPPED', { message: 'No Python files to lint with Ruff' }, []);
  }

  const det = await detectRuff();
  if (!det.available) {
    return toolResult('UNAVAILABLE', {
      message: 'Ruff is not installed or not on PATH (not auto-installed)',
    }, []);
  }

  const args = [...(det.argsPrefix || []), 'check', '--output-format=json', '--quiet', extractedDir];
  const result = await runTool(det.bin, args, { timeoutMs: 90_000, cwd: extractedDir });

  if (result.unavailable) {
    return toolResult('UNAVAILABLE', { message: 'Ruff binary became unavailable' }, []);
  }
  if (result.timedOut) {
    return toolResult('FAILED', { message: 'Ruff timed out' }, []);
  }

  let rows = [];
  const raw = (result.stdout || '').trim();
  if (raw) {
    try {
      rows = JSON.parse(raw);
      if (!Array.isArray(rows)) rows = [];
    } catch {
      return toolResult('FAILED', {
        message: 'Ruff returned non-JSON output',
        stderr: (result.stderr || '').slice(0, 500),
      }, []);
    }
  } else if (result.code != null && result.code !== 0 && result.code !== 1) {
    return toolResult('FAILED', {
      message: `Ruff exited with code ${result.code}`,
      stderr: (result.stderr || '').slice(0, 500),
    }, []);
  }

  const root = path.resolve(extractedDir);
  const issues = rows.map((row, idx) => {
    const abs = row.filename || row.file || '';
    let rel = abs;
    try {
      rel = path.relative(root, abs).replace(/\\/g, '/');
      if (rel.startsWith('..')) rel = abs.replace(/\\/g, '/');
    } catch {
      rel = String(abs).replace(/\\/g, '/');
    }
    const code = row.code || row.rule_id || 'RUFF';
    const line = row.location?.row ?? row.location?.line ?? row.row ?? 1;
    const col = row.location?.column ?? row.column ?? 1;
    const endLine = row.end_location?.row ?? line;
    const msg = row.message || row.msg || 'Ruff lint finding';
    return {
      id: `RUFF-${code}-${idx}-${line}`,
      ruleId: String(code),
      file: rel,
      line,
      column: col,
      endLine,
      severity: severityForCode(code),
      type: 'Code Smell',
      category: 'lint',
      title: `Ruff ${code}: ${msg.slice(0, 80)}`,
      description: msg,
      confidence: 0.9,
      snippet: row.noqa_row != null ? '' : (row.source || ''),
      suggestion: row.fix?.applicability ? 'Auto-fix may be available via ruff check --fix' : '',
      sourceTool: 'ruff',
      evidence: { tool: 'ruff', code, endLine },
    };
  });

  if (issues.length) {
    return toolResult('FINDINGS', {
      message: `Ruff completed with ${issues.length} finding(s)`,
      filesScanned: pyFiles.length,
      via: det.via,
    }, issues);
  }
  return toolResult('PASS', {
    message: 'Ruff completed with no lint findings',
    filesScanned: pyFiles.length,
    via: det.via,
  }, []);
}
