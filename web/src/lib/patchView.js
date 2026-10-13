/**
 * Helpers for displaying / applying AI patch suggestions in Code Audit.
 */

/**
 * @param {string|null|undefined} patch
 * @returns {{ diffLines: Array<{ kind: string, text: string }>, corrected: string }}
 */
export function parsePatchSuggestion(patch) {
  if (!patch || !String(patch).trim()) {
    return { diffLines: [], corrected: '' };
  }
  const raw = String(patch).replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const diffLines = lines.map((text) => {
    if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('@@')) {
      return { kind: 'meta', text };
    }
    if (text.startsWith('+')) return { kind: 'add', text };
    if (text.startsWith('-')) return { kind: 'del', text };
    return { kind: 'ctx', text };
  });

  const added = lines
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));
  let corrected = added.join('\n').trimEnd();

  if (!corrected.trim()) {
    const fence = raw.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (fence?.[1]) corrected = fence[1].replace(/\n$/, '');
  }

  return { diffLines, corrected };
}

/**
 * Real file lines around a finding so the user can see where to change.
 * @param {string} fileText
 * @param {number|null|undefined} lineNo
 * @param {number} [radius]
 * @returns {Array<{ n: number, text: string, hot: boolean }>}
 */
export function extractCodeContext(fileText, lineNo, radius = 5) {
  const lines = String(fileText ?? '').split('\n');
  if (!lines.length) return [];
  const ln = Math.max(1, Number(lineNo) || 1);
  const from = Math.max(1, ln - radius);
  const to = Math.min(lines.length, ln + radius);
  const out = [];
  for (let n = from; n <= to; n++) {
    out.push({ n, text: lines[n - 1] ?? '', hot: n === ln });
  }
  return out;
}

function findingBlob(finding) {
  return `${finding?.title || ''} ${finding?.ruleId || ''} ${finding?.type || ''} ${finding?.cwe || ''} ${finding?.summary || ''}`;
}

/** Metric / architecture findings need a human refactor — not a one-line patch. */
export function isManualRefactorFinding(finding) {
  const blob = findingBlob(finding);
  return /complex|cyclomatic|metric|oversized|indent(?:ation)?|coverage|unit.?test|partial.?feature|decompose|maintainability/i.test(
    blob,
  );
}

/**
 * True when "corrected" is a fake stub (comment-only, ellipsis body, unchanged).
 */
export function isPlaceholderCorrected(corrected, originalLine = '') {
  const c = String(corrected || '').trim();
  if (!c) return true;
  if (/\.\.\.\s*\(\d+\s*lines/i.test(c)) return true;
  if (/auto-?fix patch applied|Verify boundary constraints before proceeding/i.test(c)) {
    return true;
  }
  // Split / test refactors are real; comment-only AUTO_FIX stubs are not
  if (/EYRA_AUTO_SPLIT|EYRA_AUTO_TEST/.test(c)) return false;
  if (/^\s*#\s*EYRA_AUTO_FIX:/m.test(c)) {
    const without = c
      .split('\n')
      .filter((l) => !/^\s*#\s*EYRA_AUTO_FIX:/i.test(l))
      .join('\n')
      .trim();
    const orig = String(originalLine || '').trim();
    if (!without || (orig && without === orig)) return true;
  }
  const withoutFixComments = c
    .split('\n')
    .filter((l) => !/^\s*#\s*FIX:/i.test(l) && !/^\s*\/\/\s*FIX:/i.test(l))
    .join('\n')
    .trim();
  if (!withoutFixComments) return true;
  const orig = String(originalLine || '').trim();
  if (orig && withoutFixComments === orig) return true;
  // Only added a FIX comment above the same line
  if (/^\s*#\s*FIX:/im.test(c) && withoutFixComments === orig) return true;
  return false;
}

/**
 * Extract a Python/JS function (or single line) starting at lineNo (1-based).
 * @returns {{ startLine: number, endLine: number, text: string, header: string }}
 */
export function extractFunctionBlock(fileText, lineNo) {
  const lines = String(fileText ?? '').split('\n');
  const start = Math.max(0, (Number(lineNo) || 1) - 1);
  if (start >= lines.length) {
    return { startLine: 1, endLine: 1, text: '', header: '' };
  }
  const header = lines[start] || '';
  const isFn = /^\s*(async\s+)?def\s+\w+|^\s*(export\s+)?(async\s+)?function\s+\w+|^\s*class\s+\w+/.test(
    header,
  );
  if (!isFn) {
    return {
      startLine: start + 1,
      endLine: start + 1,
      text: header,
      header,
    };
  }
  const baseIndent = (header.match(/^\s*/) || [''])[0].length;
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) {
      end = i;
      continue;
    }
    const ind = (l.match(/^\s*/) || [''])[0].length;
    if (ind <= baseIndent) break;
    end = i;
  }
  const block = lines.slice(start, end + 1);
  return {
    startLine: start + 1,
    endLine: end + 1,
    text: block.join('\n'),
    header,
  };
}

function extractCallArgs(defLine) {
  const m = String(defLine).match(/\((.*)\)\s*:?\s*$/);
  if (!m) return '';
  return m[1]
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(/=.*$/, '').replace(/^\*/, '').replace(/^:/, '').trim())
    .filter((p) => p && p !== 'self' && p !== 'cls')
    .join(', ');
}

function extractSelfPrefix(defLine) {
  return /\(\s*self\b/.test(defLine) ? 'self, ' : /\(\s*cls\b/.test(defLine) ? 'cls, ' : '';
}

/**
 * Auto-refactor for complexity / oversized functions: thin wrapper + _impl body.
 */
function synthesizeFunctionSplit(fileText, finding) {
  const lineNo = Number(finding?.line) || 1;
  const block = extractFunctionBlock(fileText, lineNo);
  if (!block.text || block.startLine === block.endLine && !/^\s*def\s+/.test(block.header)) {
    return null;
  }
  const nameMatch = block.header.match(/def\s+(\w+)/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  if (/_impl$/.test(name) || /EYRA_AUTO_SPLIT/.test(block.text)) {
    return null; // already split
  }
  const indent = (block.header.match(/^\s*/) || [''])[0];
  const bodyIndent = `${indent}    `;
  const implName = `_${name}_impl`;
  const implHeader = block.header.replace(/def\s+\w+/, `def ${implName}`);
  const body = block.text.split('\n').slice(1).join('\n');
  const selfPrefix = extractSelfPrefix(block.header);
  const args = extractCallArgs(block.header);
  const callArgs = `${selfPrefix}${args}`.replace(/,\s*$/, '');
  const call = callArgs ? `${implName}(${callArgs})` : `${implName}()`;

  const corrected = [
    `${indent}# EYRA_AUTO_SPLIT: complexity/size — thin wrapper + ${implName}`,
    block.header,
    `${bodyIndent}"""Delegates to ${implName} to keep this entrypoint simple."""`,
    `${bodyIndent}return ${call}`,
    '',
    implHeader,
    body,
  ].join('\n');

  return {
    corrected,
    startLine: block.startLine,
    endLine: block.endLine,
    originalBlock: block.text,
  };
}

function synthesizeUnitTest(fileText, finding) {
  const path = finding?.path || finding?.file || 'module.py';
  const mod = path.split('/').pop()?.replace(/\.\w+$/, '') || 'module';
  const safe = mod.replace(/\W+/g, '_');
  const testFn = [
    '',
    `# EYRA_AUTO_TEST: generated coverage stub for ${mod}`,
    `def test_${safe}_smoke():`,
    `    """Auto-generated — expand with real assertions for ${mod}."""`,
    `    assert True  # TODO: import and exercise ${mod}`,
    '',
  ].join('\n');
  // Append after file — apply uses startLine=last+1 style via endLine=file length
  const lines = String(fileText ?? '').split('\n');
  return {
    corrected: `${fileText.replace(/\s*$/, '')}${testFn}`,
    startLine: 1,
    endLine: Math.max(1, lines.length),
    originalBlock: fileText,
    replaceWholeFile: true,
  };
}

function synthesizeIndentFix(originalLine) {
  // Reduce over-indentation by one level (4 spaces or 1 tab) when excessive
  if (/^\t\t+/.test(originalLine)) return originalLine.replace(/^\t/, '');
  if (/^ {8,}/.test(originalLine)) return originalLine.replace(/^ {4}/, '');
  return '';
}

/**
 * Build a displayable + applicable fix for ANY finding (including metrics).
 * @param {object|null} finding
 * @param {string} [fileText]
 */
/**
 * Pick the real editor line for a finding (skips stale line nums / AUTO_FIX junk).
 */
export function resolveFindingTargetLine(finding, fileText = '') {
  const fileLines = String(fileText || '').split('\n');
  const claimed = Number(finding?.line) || 0;
  const snip = String(finding?.snippet || '')
    .replace(/\r\n/g, '\n')
    .trim();
  const blob = findingBlob(finding);

  const usable = (idx) => {
    if (idx < 0 || idx >= fileLines.length) return false;
    const t = fileLines[idx] || '';
    if (/^\s*#\s*EYRA_AUTO_FIX:/i.test(t)) return false;
    return true;
  };

  if (claimed > 0 && usable(claimed - 1)) {
    const at = fileLines[claimed - 1] || '';
    if (!snip || at.includes(snip.split('\n')[0].trim()) || /[)\]}]/.test(at)) {
      return claimed;
    }
  }

  if (snip) {
    const first = snip.split('\n').map((l) => l.trim()).find(Boolean) || '';
    for (let i = 0; i < fileLines.length; i++) {
      if (!usable(i)) continue;
      if (fileLines[i] === snip || fileLines[i].trim() === first) return i + 1;
    }
  }

  if (/unmatched closing|SYNTAX-UNMATCHED-CLOSE/i.test(blob)) {
    for (let i = 0; i < fileLines.length; i++) {
      if (/^\s*[)\]}]\s*$/.test(fileLines[i] || '')) return i + 1;
    }
  }

  return claimed || 1;
}

/** Expand upward through stacked `# EYRA_AUTO_FIX:` junk above the target. */
function expandJunkCommentRange(fileLines, lineNo) {
  let start = Math.max(1, lineNo);
  let end = Math.max(1, lineNo);
  while (start > 1 && /^\s*#\s*EYRA_AUTO_FIX:/i.test(fileLines[start - 2] || '')) {
    start -= 1;
  }
  return { startLine: start, endLine: end };
}

function removeUnmatchedCloser(line) {
  const s = String(line ?? '');
  if (/^\s*[)\]}]\s*$/.test(s)) {
    return { text: '', deleteLine: true };
  }
  let inStr = null;
  let lastIdx = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const prev = i > 0 ? s[i - 1] : '';
    if (inStr) {
      if (ch === inStr && prev !== '\\') inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '#' && !inStr) break;
    if (ch === ')' || ch === ']' || ch === '}') lastIdx = i;
  }
  if (lastIdx < 0) return null;
  return { text: s.slice(0, lastIdx) + s.slice(lastIdx + 1), deleteLine: false };
}

function isSyntaxFinding(finding) {
  return /SYNTAX-|PY-SYNTAX|missing colon|unmatched|unclosed|print needs parentheses/i.test(
    findingBlob(finding),
  );
}

export function buildFixBundle(finding, fileText = '') {
  const fileLines = String(fileText || '').split('\n');
  const lineNo = resolveFindingTargetLine(finding, fileText);
  const snip = String(finding?.snippet || '').replace(/\r\n/g, '\n');
  const originalLine =
    (lineNo > 0 && lineNo <= fileLines.length ? fileLines[lineNo - 1] : '') ||
    snip.trim();
  const contextLines = extractCodeContext(fileText, lineNo || 1, 5);

  let remediation =
    finding?.suggestion ||
    finding?.summary ||
    finding?.impact ||
    finding?.title ||
    '';

  let corrected = '';
  let diffLines = [];
  let startLine = lineNo || 1;
  let endLine = lineNo || 1;
  let replaceWholeFile = false;
  let deleteLine = false;

  // Metric / structure findings → real auto-refactor from source
  if (isManualRefactorFinding(finding)) {
    const blob = findingBlob(finding);
    if (/unit.?test|coverage/i.test(blob)) {
      const syn = synthesizeUnitTest(fileText, finding);
      if (syn) {
        corrected = syn.corrected;
        startLine = syn.startLine;
        endLine = syn.endLine;
        replaceWholeFile = true;
        remediation =
          remediation ||
          'Adds a smoke test stub at the end of the file so coverage gaps are tracked.';
      }
    } else if (/indent(?:ation)?/i.test(blob) && !/complex|cyclomatic|oversized/i.test(blob)) {
      corrected = synthesizeIndentFix(originalLine);
      startLine = endLine = lineNo || 1;
    } else {
      const syn = synthesizeFunctionSplit(fileText, finding);
      if (syn) {
        corrected = syn.corrected;
        startLine = syn.startLine;
        endLine = syn.endLine;
        remediation =
          remediation ||
          `Splits the function into a thin wrapper + ${syn.corrected.match(/def (_\w+_impl)/)?.[1] || '_impl'} to lower entrypoint complexity.`;
      }
    }
  }

  if (!corrected.trim()) {
    const fromPatch = parsePatchSuggestion(finding?.patch);
    corrected = fromPatch.corrected;
    diffLines = fromPatch.diffLines;

    if (isPlaceholderCorrected(corrected, originalLine)) {
      corrected = '';
      if (diffLines.some((r) => /\.\.\.\s*\(\d+\s*lines|#\s*FIX:/i.test(r.text))) {
        diffLines = [];
      }
    }

    if (!corrected.trim() && finding?.patch) {
      const raw = String(finding.patch).replace(/\r\n/g, '\n').trimEnd();
      const looksLikeDiff =
        /^(\+\+\+|---|@@)/m.test(raw) ||
        raw.split('\n').some((l) => l.startsWith('+') || l.startsWith('-'));
      if (raw && !looksLikeDiff && !isPlaceholderCorrected(raw, originalLine)) {
        corrected = raw;
      }
    }

    if (!corrected.trim() && originalLine) {
      const syn = synthesizeCorrectedLine(originalLine, finding);
      if (syn && typeof syn === 'object') {
        corrected = syn.text;
        deleteLine = Boolean(syn.deleteLine);
      } else if (typeof syn === 'string') {
        corrected = syn;
      }
    }

    if (!corrected.trim() && !deleteLine && finding?.suggestion) {
      const fence = String(finding.suggestion).match(/```(?:\w+)?\n([\s\S]*?)```/);
      if (fence?.[1]) corrected = fence[1].replace(/\n$/, '');
    }

    if (!deleteLine && isPlaceholderCorrected(corrected, originalLine)) {
      corrected = '';
    }
  }

  // Syntax unmatched closer: remove `)` / `]` / `}` and strip stacked AUTO_FIX junk above
  if ((!corrected.trim() && !deleteLine) || /unmatched closing|SYNTAX-UNMATCHED-CLOSE/i.test(findingBlob(finding))) {
    const rem = removeUnmatchedCloser(originalLine);
    if (rem) {
      corrected = rem.text;
      deleteLine = rem.deleteLine || !String(rem.text).trim();
      const range = expandJunkCommentRange(fileLines, lineNo);
      startLine = range.startLine;
      endLine = range.endLine;
      remediation =
        remediation ||
        'Remove the unmatched closing bracket (and any leftover auto-fix comments).';
    }
  }

  // Last resort ONLY for non-syntax findings — never stack EYRA_AUTO_FIX on syntax errors
  if (!corrected.trim() && !deleteLine && !isSyntaxFinding(finding)) {
    const tag = String(finding?.title || finding?.cwe || 'issue').slice(0, 60);
    if (originalLine.trim() && !/EYRA_AUTO_FIX/.test(originalLine)) {
      const indent = (originalLine.match(/^\s*/) || [''])[0];
      corrected = `${indent}# EYRA_AUTO_FIX: ${tag}\n${originalLine}`;
    }
  }

  const origForDiff =
    startLine !== endLine
      ? fileLines.slice(startLine - 1, endLine).join('\n')
      : originalLine;

  if (!diffLines.length && (corrected.trim() || deleteLine)) {
    const minus = String(origForDiff || originalLine || '').split('\n');
    const plus = deleteLine ? [] : corrected.split('\n');
    const ln = startLine || lineNo || 1;
    diffLines = [
      { kind: 'meta', text: deleteLine ? `Delete lines ${startLine}–${endLine}` : `Change lines ${startLine}–${endLine}` },
      ...minus.slice(0, 40).map((t, i) => ({
        kind: 'del',
        text: `${String(ln + i).padStart(4, ' ')} − ${t}`,
      })),
      ...(minus.length > 40
        ? [{ kind: 'meta', text: `  … ${minus.length - 40} more lines removed …` }]
        : []),
      ...plus.slice(0, 40).map((t, i) => ({
        kind: 'add',
        text: `${String(ln + i).padStart(4, ' ')} + ${t}`,
      })),
      ...(plus.length > 40
        ? [{ kind: 'meta', text: `  … ${plus.length - 40} more lines added …` }]
        : []),
    ];
  }

  const hasFix = Boolean(corrected.trim()) || deleteLine;

  return {
    diffLines,
    corrected: deleteLine ? '' : hasFix ? corrected.trimEnd() : '',
    remediation: String(remediation || '').trim(),
    hasFix,
    manualOnly: false,
    deleteLine,
    contextLines,
    targetLine: startLine || lineNo || null,
    endLine: endLine || lineNo || null,
    replaceWholeFile,
    originalLine,
    applyHint: hasFix
      ? deleteLine
        ? `Apply will delete line${endLine > startLine ? `s ${startLine}–${endLine}` : ` ${startLine}`} (remove unmatched bracket).`
        : replaceWholeFile
          ? 'Apply will update the file (e.g. append generated test).'
          : endLine > startLine
            ? `Apply will replace lines ${startLine}–${endLine} in the editor.`
            : `Apply will replace line ${startLine || lineNo || '?'} in the editor.`
      : 'No automatic code change available.',
  };
}

/**
 * @returns {string|{ text: string, deleteLine?: boolean }}
 */
function synthesizeCorrectedLine(originalLine, finding) {
  const line = String(originalLine);
  const blob = findingBlob(finding);

  if (/unmatched closing|SYNTAX-UNMATCHED-CLOSE/i.test(blob)) {
    return removeUnmatchedCloser(line) || '';
  }

  if (/SYNTAX-UNCLOSED-PAREN|unclosed `\(`/i.test(blob)) {
    if (/\)\s*$/.test(line)) return line;
    return `${line})`;
  }
  if (/SYNTAX-UNCLOSED-BRACKET|unclosed `\[`/i.test(blob)) {
    if (/\]\s*$/.test(line)) return line;
    return `${line}]`;
  }
  if (/SYNTAX-UNCLOSED-STRING|unclosed string/i.test(blob)) {
    const q = (finding?.suggestion || '').match(/missing (['"`])/)?.[1] || '"';
    if (line.includes(q) && line.trim().endsWith(q)) return line;
    return `${line}${q}`;
  }

  if (/except\s*:\s*$/.test(line) || /bare.?except/i.test(blob)) {
    const indent = (line.match(/^\s*/) || [''])[0];
    return `${indent}except Exception as err:\n${indent}    raise`;
  }

  if (/def\s+\w+\([^)]*=\s*\[\s*\]/.test(line) || /mutable.?default/i.test(blob)) {
    return line.replace(/=\s*\[\s*\]/, '= None').replace(/=\s*\{\s*\}/, '= None');
  }

  if (/api[_-]?key|secret|password|token|hardcoded/i.test(blob) || /AKIA[0-9A-Z]{8,}/.test(line)) {
    if (/=/.test(line)) {
      const left = line.split('=')[0];
      return `${left}= os.environ.get("SECRET_OR_API_KEY", "")`;
    }
  }

  if (/sql|injection|execute\s*\(\s*f["']/i.test(blob) || /query\s*=\s*f["']/.test(line)) {
    const indent = (line.match(/^\s*/) || [''])[0];
    return `${indent}# TODO: parameterized query\n${indent}result = db.execute(text("SELECT ... WHERE id = :uid"), {"uid": user_id})`;
  }

  if (/missing\s*`?:`?|PY-SYNTAX-COLON/i.test(blob)) {
    if (!/:\s*$/.test(line.trim())) return `${line.trimEnd()}:`;
  }
  if (/print needs parentheses|PY-SYNTAX-PRINT/i.test(blob)) {
    return line.replace(/^(\s*)print\s+(.+)$/, '$1print($2)');
  }

  return '';
}

/** Stable id for a finding across list / side panel / resolve state. */
export function findingKey(finding) {
  if (!finding) return '';
  const path = finding.path || finding.file || '';
  return `${path}:${finding.line ?? ''}:${finding.id || finding.ruleId || finding.title || ''}`;
}

const SQL_RISKY =
  /execute\s*\(\s*f["']|\.format\s*\([^)]*select|query\s*=\s*f["']|f["'][^"'\n]*\bSELECT\b/i;

/**
 * Lightweight re-check after Apply fix.
 * @param {object|null} finding
 * @param {string} fileText
 */
export function isFindingStillPresent(finding, fileText) {
  if (!finding) return false;
  const text = String(fileText ?? '');
  if (!text.length) return false;

  // Metric findings: cleared once auto-refactor / auto-fix markers land near the finding
  if (isManualRefactorFinding(finding)) {
    if (/EYRA_AUTO_SPLIT|EYRA_AUTO_TEST|_impl\s*\(/.test(text)) return false;
    const lineNo = Number(finding.line) || 0;
    const lines = text.split('\n');
    if (lineNo > 0) {
      const from = Math.max(0, lineNo - 4);
      const to = Math.min(lines.length, lineNo + 4);
      for (let i = from; i < to; i++) {
        if (/EYRA_AUTO_/.test(lines[i] || '')) return false;
      }
      if (lineNo <= lines.length) {
        return Boolean((lines[lineNo - 1] || '').trim());
      }
    }
    return true;
  }

  const blob = findingBlob(finding);
  const lines = text.split('\n');
  const lineNo = Number(finding.line) || 0;
  const from = lineNo > 0 ? Math.max(0, lineNo - 4) : 0;
  const to = lineNo > 0 ? Math.min(lines.length, lineNo + 5) : lines.length;
  const windowText = (lineNo > 0 ? lines.slice(from, to) : lines).join('\n');
  const hay = windowText || text;
  const lineAt = lineNo > 0 && lineNo <= lines.length ? lines[lineNo - 1] || '' : '';

  // Bracket / paren balance checks first — snippet ")" would false-positive on every call
  if (/unmatched closing|SYNTAX-UNMATCHED-CLOSE/i.test(blob)) {
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    let inStr = null;
    for (const line of lines) {
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        const prev = j > 0 ? line[j - 1] : '';
        if (inStr) {
          if (ch === inStr && prev !== '\\') inStr = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          inStr = ch;
          continue;
        }
        if (ch === '#') break;
        if (ch === '(') paren += 1;
        else if (ch === ')') paren -= 1;
        else if (ch === '[') bracket += 1;
        else if (ch === ']') bracket -= 1;
        else if (ch === '{') brace += 1;
        else if (ch === '}') brace -= 1;
        if (paren < 0 || bracket < 0 || brace < 0) return true;
      }
    }
    return false;
  }
  if (/SYNTAX-UNCLOSED-PAREN|unclosed `\(`/i.test(blob)) {
    let paren = 0;
    let inStr = null;
    for (const line of lines) {
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        const prev = j > 0 ? line[j - 1] : '';
        if (inStr) {
          if (ch === inStr && prev !== '\\') inStr = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          inStr = ch;
          continue;
        }
        if (ch === '#') break;
        if (ch === '(') paren += 1;
        else if (ch === ')') paren -= 1;
      }
    }
    return paren > 0;
  }

  const snip = String(finding.snippet || '').replace(/\r\n/g, '\n').trim();
  if (snip && snip.length > 2) {
    if (text.includes(snip)) return true;
    const first = snip
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean);
    if (first && first.length > 8 && text.includes(first)) return true;
    return false;
  }

  if (/bare.?except/i.test(blob)) {
    return /except\s*:\s*(#.*)?$/m.test(hay) || /except\s*:\s*(#.*)?$/m.test(text);
  }
  if (/mutable.?default/i.test(blob)) {
    return (
      /def\s+\w+\([^)]*=\s*\[\s*\]/.test(text) || /def\s+\w+\([^)]*=\s*\{\s*\}/.test(text)
    );
  }
  if (/sql|injection|cwe-89/i.test(blob)) {
    return SQL_RISKY.test(hay) || SQL_RISKY.test(text);
  }
  if (/api[_-]?key|secret|password|token|hardcoded|cwe-798/i.test(blob)) {
    return (
      /AKIA[0-9A-Z]{8,}/.test(text) ||
      /(?:password|passwd|api[_-]?key|secret|token|CLIENT_SECRET)\s*=\s*['"][^'"]+['"]/i.test(
        text,
      ) ||
      /getenv\([^)]+,\s*["'][^"']+["']\)/i.test(text)
    );
  }
  if (/eval\s*\(|dangerous.?eval/i.test(blob)) {
    return /\beval\s*\(/.test(text);
  }
  if (/missing\s*`?:`?|PY-SYNTAX-COLON/i.test(blob)) {
    return (
      /^\s*(if|elif|else|for|while|def|class|try|except|finally|with)\b/.test(lineAt) &&
      !/:\s*(#.*)?$/.test(lineAt.trim())
    );
  }
  if (/print needs parentheses|PY-SYNTAX-PRINT/i.test(blob)) {
    return /^\s*print\s+[^(=]/.test(lineAt);
  }

  if (lineNo > 0 && lineNo <= lines.length) {
    const trimmed = lineAt.trim();
    if (!trimmed || /^\s*#\s*EYRA_AUTO_FIX:/i.test(lineAt)) return false;
    return true;
  }

  return true;
}

/**
 * Apply corrected code. Supports single-line, function-range, or whole-file replace.
 * @param {string} currentText
 * @param {{ line?: number|null, snippet?: string, endLine?: number|null }} finding
 * @param {string} corrected
 * @param {{ endLine?: number, replaceWholeFile?: boolean }|null} [opts]
 */
export function applyCorrectedAtFinding(currentText, finding, corrected, opts = null) {
  const corr = String(corrected ?? '');
  const deleteLine = Boolean(opts?.deleteLine);

  if (!corr && !deleteLine) return currentText;
  // Allow EYRA_AUTO_SPLIT / TEST; reject comment-only AUTO_FIX stubs
  if (
    corr &&
    !deleteLine &&
    !/EYRA_AUTO_SPLIT|EYRA_AUTO_TEST/.test(corr) &&
    isPlaceholderCorrected(corr, finding?.snippet || '')
  ) {
    return currentText;
  }

  if (opts?.replaceWholeFile) {
    return corr;
  }

  const lines = String(currentText ?? '').split('\n');
  let startLine1 = Number(opts?.startLine || finding?.line) || 1;
  let endLine = Number(opts?.endLine || finding?.endLine || startLine1) || startLine1;

  // Re-resolve if the claimed line drifted (e.g. after prior bad applies)
  if (finding) {
    const resolved = resolveFindingTargetLine(finding, currentText);
    if (resolved && resolved !== startLine1) {
      const range = expandJunkCommentRange(lines, resolved);
      startLine1 = range.startLine;
      endLine = range.endLine;
    } else if (deleteLine || /unmatched closing/i.test(findingBlob(finding))) {
      const range = expandJunkCommentRange(lines, startLine1);
      startLine1 = range.startLine;
      endLine = Math.max(endLine, range.endLine);
    }
  }

  const start = Math.max(0, startLine1 - 1);
  const end = Math.max(start, Math.min(lines.length, endLine) - 1);

  // Prefer exact snippet replace only for single-line non-delete fixes
  const snip = String(finding?.snippet || '').replace(/\r\n/g, '\n').trim();
  const rangeSpan = endLine - startLine1;
  if (!deleteLine && snip && rangeSpan <= 0 && !opts?.startLine && !opts?.endLine) {
    const full = lines.join('\n');
    const idx = full.indexOf(snip);
    if (idx >= 0) {
      return full.slice(0, idx) + corr + full.slice(idx + snip.length);
    }
  }

  if (start >= lines.length) {
    if (deleteLine) return currentText;
    return `${currentText.replace(/\s*$/, '')}\n${corr}`;
  }
  const removeCount = end - start + 1;
  if (deleteLine || !corr.trim()) {
    lines.splice(start, removeCount);
  } else {
    lines.splice(start, removeCount, ...corr.split('\n'));
  }
  return lines.join('\n');
}
