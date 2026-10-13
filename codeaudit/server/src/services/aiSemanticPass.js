/**
 * AI Semantic Pass — prefers EYRA Brain audit model enrichment,
 * falls back to local heuristics if Brain/Groq is unavailable.
 */

const BRAIN_URL = (process.env.EYRA_BRAIN_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

function localHeuristicPass(issues, partialFeatures) {
  for (const issue of issues.slice(0, 15)) {
    let aiExplanation = '';
    let patchDiff = '';
    const rule = issue.ruleId || '';

    if (rule.includes('SQLI')) {
      aiExplanation = `Semantic Analysis: The dynamic interpolation in '${issue.file}' creates an unchecked injection vector. An attacker can supply a malicious payload such as "1' OR '1'='1" to extract tables or bypass authentication filters.`;
      patchDiff = `--- a/${issue.file}\n+++ b/${issue.file}\n@@ -${issue.line},3 +${issue.line},3 @@\n- db.execute(f"SELECT * FROM accounts WHERE id = '{user_id}'")\n+ db.execute("SELECT * FROM accounts WHERE id = %s", (user_id,))`;
    } else if (rule.includes('AWS') || rule.includes('SECRET')) {
      aiExplanation = `Semantic Analysis: Static hardcoding of sensitive credentials poses high blast-radius exposure. If checked into version control or CI/CD logs, access tokens can be scraped within minutes by automated scanners.`;
      patchDiff = `--- a/${issue.file}\n+++ b/${issue.file}\n@@ -${issue.line},2 +${issue.line},2 @@\n- const API_KEY = "AKIA12345EXAMPLEKEY";\n+ const API_KEY = process.env.AWS_ACCESS_KEY_ID;`;
    } else if (rule.includes('BUG-001') || (issue.title || '').includes('Default Argument')) {
      aiExplanation = `Semantic Analysis: Python binds default arguments once at function definition time, not at invocation. Modifying a mutable list/dict modifies the exact object referenced across all future invocations.`;
      patchDiff = `--- a/${issue.file}\n+++ b/${issue.file}\n@@ -${issue.line},4 +${issue.line},5 @@\n- def process_queue(items=[]):\n+ def process_queue(items=None):\n+     if items is None:\n+         items = []`;
    } else if (rule.includes('BUG-002') || (issue.title || '').includes('Bare Except')) {
      aiExplanation = `Semantic Analysis: Intercepting all base exceptions without discrimination blinds the application from graceful SIGINT or OS kill signals, leading to zombie background jobs and blocked threadpools.`;
      patchDiff = `--- a/${issue.file}\n+++ b/${issue.file}\n@@ -${issue.line},2 +${issue.line},3 @@\n- except:\n-     pass\n+ except Exception as err:\n+     logger.error(f"Execution failed: {err}", exc_info=True)\n+     raise`;
    } else if (rule.includes('DEEP-NESTING') || rule.includes('COMPLEXITY')) {
      aiExplanation = `Semantic Analysis: Cognitive cyclomatic density is high. High branch nesting multiplies permutations required for full test coverage and leads to untested corner-case execution paths.`;
      patchDiff = `--- a/${issue.file}\n+++ b/${issue.file}\n@@ -${issue.line},6 +${issue.line},5 @@\n- if condition:\n-     if valid:\n-         execute_job()\n+ if not condition or not valid:\n+     return\n+ execute_job()`;
    } else {
      aiExplanation = `Semantic Analysis: Static pattern detected potential failure point. Recommended best practice is to isolate input boundaries, enforce validation schemas, and ensure deterministic return types.`;
      patchDiff = `--- a/${issue.file}\n+++ b/${issue.file}\n@@ -${issue.line},1 +${issue.line},1 @@\n// Auto-generated safety guard\n+ // Verify boundary constraints before proceeding`;
    }

    issue.aiExplanation = aiExplanation;
    issue.patchDiff = patchDiff;
    issue.enrichmentSource = 'local_heuristic';
    issue.patchState = issue.patchDiff ? 'generated' : 'none';
    issue.patchProvenance = 'heuristic_template';
  }

  const architectureHealth = {
    riskRating: issues.some((i) => i.severity === 'Critical') ? 'High Risk' : 'Moderate Risk',
    recommendedNextSprint: [
      'Eliminate exposed secrets from source and integrate AWS Secrets Manager / Doppler',
      'Address unparameterized SQL statements to prevent catastrophic injection vulnerabilities',
      'Resolve unimplemented TODO stubs in payment/auth controllers before production cutover',
      'Add unit test suites for high-complexity service files lacking test coverage',
    ],
    enrichmentSource: 'local_heuristic',
    enrichmentNote:
      'Local heuristic explanations — not Brain LLM. Templates may not match the exact source line.',
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
        issue.patchDiff = hit.patchDiff || issue.patchDiff || '';
        issue.enrichmentSource = data.reasoning_source || 'brain';
        issue.patchState = issue.patchDiff ? 'generated' : 'none';
        issue.patchProvenance = 'brain_enrichment';
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
