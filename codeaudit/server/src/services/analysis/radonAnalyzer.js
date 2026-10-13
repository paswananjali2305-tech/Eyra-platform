/**
 * Optional Radon complexity / maintainability — metrics findings, not confirmed bugs.
 */
import path from 'path';
import { detectRadon, runTool, toolResult } from './toolRunner.js';

/** Cyclomatic complexity grade threshold: report when rank is C or worse (11+). */
const CC_MIN_RANK = 'C';
const MI_THRESHOLD = 65; // maintainability index below this → finding

const RANK_ORDER = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 };

function rankAtLeast(rank, min) {
  return (RANK_ORDER[String(rank || '').toUpperCase()] || 0) >= (RANK_ORDER[min] || 99);
}

/**
 * @param {string} extractedDir
 * @param {{ enabled?: boolean }} [opts]
 */
export async function runRadonAnalysis(extractedDir, opts = {}) {
  if (opts.enabled === false) {
    return toolResult('SKIPPED', { message: 'Radon skipped (disabled in scan engines)' }, []);
  }

  const det = await detectRadon();
  if (!det.available) {
    return toolResult('UNAVAILABLE', {
      message: det.reason || 'Radon is not installed (python -m radon); not auto-installed',
    }, []);
  }

  const ccArgs = [...(det.argsPrefix || []), 'cc', extractedDir, '-j', '-a'];
  const miArgs = [...(det.argsPrefix || []), 'mi', extractedDir, '-j'];

  const [ccRes, miRes] = await Promise.all([
    runTool(det.bin, ccArgs, { timeoutMs: 90_000, cwd: extractedDir }),
    runTool(det.bin, miArgs, { timeoutMs: 90_000, cwd: extractedDir }),
  ]);

  if (ccRes.unavailable && miRes.unavailable) {
    return toolResult('UNAVAILABLE', { message: 'Radon unavailable at execution time' }, []);
  }

  const issues = [];
  const root = path.resolve(extractedDir);
  let parsedAny = false;

  try {
    const ccJson = JSON.parse(ccRes.stdout || '{}');
    parsedAny = true;
    for (const [filePath, blocks] of Object.entries(ccJson)) {
      if (!Array.isArray(blocks)) continue;
      let rel = filePath.replace(/\\/g, '/');
      try {
        rel = path.relative(root, filePath).replace(/\\/g, '/') || rel;
      } catch {
        /* keep */
      }
      for (const b of blocks) {
        const rank = b.rank || '';
        const complexity = b.complexity ?? b.cc ?? null;
        if (!rankAtLeast(rank, CC_MIN_RANK)) continue;
        const name = b.name || b.classname || 'block';
        const line = b.lineno || b.line || 1;
        issues.push({
          id: `RADON-CC-${hashStr(`${rel}:${line}:${name}`)}`,
          ruleId: 'RADON-CC-HIGH',
          file: rel,
          line,
          column: b.col_offset != null ? b.col_offset + 1 : 1,
          severity: rankAtLeast(rank, 'E') ? 'High' : 'Medium',
          type: 'Code Smell',
          category: 'complexity-metric',
          title: `High cyclomatic complexity in ${name} (rank ${rank})`,
          description:
            `Radon measured cyclomatic complexity ${complexity} (rank ${rank}) for '${name}'. ` +
            `This is a maintainability metric, not a confirmed functional bug. Threshold: rank ≥ ${CC_MIN_RANK}.`,
          confidence: 0.85,
          snippet: `${name} — complexity=${complexity}, rank=${rank}`,
          suggestion: 'Consider splitting the function/class into smaller units to reduce branching.',
          sourceTool: 'radon',
          evidence: {
            tool: 'radon',
            metric: 'cyclomatic_complexity',
            value: complexity,
            rank,
            threshold: `rank>=${CC_MIN_RANK}`,
          },
        });
      }
    }
  } catch {
    if (ccRes.stdout) {
      return toolResult('FAILED', { message: 'Failed to parse Radon CC JSON', stderr: ccRes.stderr }, []);
    }
  }

  try {
    const miJson = JSON.parse(miRes.stdout || '{}');
    parsedAny = true;
    for (const [filePath, miVal] of Object.entries(miJson)) {
      const score =
        typeof miVal === 'number'
          ? miVal
          : typeof miVal === 'object' && miVal
            ? Number(miVal.mi ?? miVal.score ?? NaN)
            : Number(miVal);
      if (!Number.isFinite(score) || score >= MI_THRESHOLD) continue;
      let rel = String(filePath).replace(/\\/g, '/');
      try {
        rel = path.relative(root, filePath).replace(/\\/g, '/') || rel;
      } catch {
        /* keep */
      }
      issues.push({
        id: `RADON-MI-${hashStr(rel)}`,
        ruleId: 'RADON-MI-LOW',
        file: rel,
        line: 1,
        column: 1,
        severity: score < 40 ? 'High' : 'Medium',
        type: 'Code Smell',
        category: 'maintainability-metric',
        title: `Low maintainability index (${score.toFixed(1)})`,
        description:
          `Radon maintainability index for '${rel}' is ${score.toFixed(1)} ` +
          `(threshold < ${MI_THRESHOLD}). This is a metric signal, not proof of a defect.`,
        confidence: 0.8,
        snippet: `mi=${score.toFixed(1)}`,
        suggestion: 'Improve readability, reduce complexity, and add documentation/tests.',
        sourceTool: 'radon',
        evidence: {
          tool: 'radon',
          metric: 'maintainability_index',
          value: score,
          threshold: MI_THRESHOLD,
        },
      });
    }
  } catch {
    /* MI optional if CC worked */
  }

  if (!parsedAny && (ccRes.code != null && ccRes.code !== 0)) {
    return toolResult('FAILED', {
      message: 'Radon execution failed',
      stderr: (ccRes.stderr || miRes.stderr || '').slice(0, 500),
    }, []);
  }

  if (issues.length) {
    return toolResult('FINDINGS', {
      message: `Radon completed with ${issues.length} metric finding(s)`,
      thresholds: { ccRank: CC_MIN_RANK, mi: MI_THRESHOLD },
    }, issues);
  }
  return toolResult('PASS', {
    message: 'Radon completed; no metrics exceeded thresholds',
    thresholds: { ccRank: CC_MIN_RANK, mi: MI_THRESHOLD },
  }, []);
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return String(h % 1_000_000);
}
