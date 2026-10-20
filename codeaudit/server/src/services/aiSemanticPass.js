/**
 * AI Semantic Pass — prefers EYRA Brain audit model enrichment.
 * The local fallback explains a finding. It does not invent a diff of code
 * that is not in the file.
 */
import { applyPatchGrounding } from './patchGrounding.js';

const BRAIN_URL = (process.env.EYRA_BRAIN_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

export function localHeuristicPass(issues) {
  for (const issue of issues.slice(0, 15)) {
    const rule = issue.ruleId || '';
    const title = issue.title || rule || 'finding';
    const where = `${issue.file || 'unknown'}:${issue.line || '?'}`;
    issue.aiExplanation =
      `Heuristic note only (not a source patch): ${title} at ${where}. ` +
      'Review the finding in the file before changing it. ' +
      (rule ? `Rule ${rule}. ` : '') +
      'No diff was generated because a template would not match this source.';
    issue.patchDiff = '';
    issue.enrichmentSource = 'local_heuristic';
    issue.patchState = 'none';
    issue.patchProvenance = 'unavailable';
    issue.patchApplicable = false;
    issue.appliedToDisk = false;
    issue.verification = 'not_run';
  }

  const architectureHealth = {
    riskRating: issues.some((i) => i.severity === 'Critical') ? 'High Risk' : 'Moderate Risk',
    recommendedNextSprint: [
      'Review Critical and High findings in the scanned files',
      'Confirm any suggested change against the current source before editing',
    ],
    enrichmentSource: 'local_heuristic',
    enrichmentNote:
      'Local heuristic explanations only. No template diff was attached.',
  };

  return { issues, architectureHealth };
}

/**
 * @param {Array} issues
 * @param {Array} partialFeatures
 * @param {Array} files
 */
export async function runAiSemanticPass(issues, partialFeatures = [], files = []) {
  const prioritized = [...(issues || [])].sort((a, b) => {
    const rank = { Critical: 4, High: 3, Medium: 2, Low: 1 };
    return (rank[b.severity] || 0) - (rank[a.severity] || 0);
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const res = await fetch(`${BRAIN_URL}/api/enrich-findings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        profile: 'audit',
        issues: prioritized.slice(0, 12).map((i) => ({
          id: i.id,
          ruleId: i.ruleId,
          file: i.file,
          line: i.line,
          severity: i.severity,
          type: i.type,
          title: i.title,
          description: i.description,
          snippet: i.snippet,
        })),
        partial_features: (partialFeatures || []).slice(0, 20),
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`Brain enrich HTTP ${res.status}`);
    }
    const data = await res.json();
    const byId = new Map((data.issues || []).map((row) => [row.id, row]));

    let brainHits = 0;
    for (const issue of issues) {
      const hit = byId.get(issue.id);
      if (hit) {
        issue.aiExplanation = hit.aiExplanation;
        issue.patchDiff = hit.patchDiff || '';
        issue.enrichmentSource = data.reasoning_source || 'brain';
        issue.patchProvenance = data.reasoning_source === 'groq' ? 'ai_generated' : 'unavailable';
        applyPatchGrounding(issue, files);
        brainHits += 1;
      }
    }

    // Fill any remaining with local heuristics (explicitly labeled)
    const missing = issues.filter((i) => !i.aiExplanation);
    if (missing.length) {
      localHeuristicPass(missing, partialFeatures);
    }

    const architectureHealth = {
      ...(data.architecture_health || {}),
      riskRating:
        data.architecture_health?.riskRating ||
        (issues.some((i) => i.severity === 'Critical') ? 'High Risk' : 'Moderate Risk'),
      recommendedNextSprint:
        data.architecture_health?.recommendedNextSprint ||
        data.architecture_health?.recommended_next_sprint ||
        [
          'Triage Critical/High findings first',
          'Remove secrets from source and rotate credentials',
        ],
      enrichmentSource:
        brainHits === 0 && missing.length
          ? 'local_heuristic'
          : missing.length
            ? 'brain_partial_heuristic'
            : data.reasoning_source || 'brain',
      enrichmentModel: data.model,
      enrichmentNote:
        'AI explains tool-generated findings; it does not invent CVE matches, line numbers, or test results.',
    };

    return { issues, architectureHealth, files };
  } catch (err) {
    console.warn('[aiSemanticPass] Brain enrichment unavailable, using heuristics:', err.message);
    return localHeuristicPass(issues, partialFeatures);
  }
}
