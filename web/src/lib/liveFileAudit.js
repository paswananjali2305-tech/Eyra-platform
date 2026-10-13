/**
 * Lightweight client-side audit for the Code Audit editor.
 * Full-repo security/bug severity still comes from Eyraaaa scan (Ingest → Start scan).
 * This catches common mistakes in files you type/edit without waiting for a new upload.
 */

/**
 * @typedef {object} LiveFinding
 * @property {string} path
 * @property {string} title
 * @property {number} line
 * @property {string} cwe
 * @property {string} summary
 * @property {string} impact
 * @property {string} suggestion
 * @property {string} patch
 * @property {string} severity
 * @property {string} ruleId
 * @property {string} type
 * @property {string} snippet
 * @property {string} id
 */

/**
 * @param {string} path
 * @param {string} text
 * @returns {LiveFinding[]}
 */
export function auditFileText(path, text) {
  const filePath = path || 'untitled';
  const src = String(text ?? '').replace(/\r\n/g, '\n');
  if (!src.trim()) return [];

  const lines = src.split('\n');
  /** @type {LiveFinding[]} */
  const out = [];
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  const isPy = ext === 'py' || /scratch\/.*\.py$/i.test(filePath);
  const isJs = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(ext);
  const isHtml = ext === 'html' || ext === 'htm';
  const isCss = ext === 'css' || ext === 'scss';
  const isMd = ext === 'md' || ext === 'markdown';
  const isMarkup = isHtml || isCss || isMd;

  function add(rule) {
    const line = Math.max(1, Number(rule.line) || 1);
    const snippet = rule.snippet ?? (lines[line - 1] || '');
    out.push({
      path: filePath,
      title: rule.title,
      line,
      cwe: rule.cwe || rule.ruleId || 'LIVE',
      summary: rule.summary,
      impact: rule.impact || rule.summary,
      suggestion: rule.suggestion || '',
      patch: rule.patch || '',
      severity: rule.severity || 'Medium',
      ruleId: rule.ruleId || 'live-check',
      type: rule.type || 'live',
      snippet,
      id: `live:${filePath}:${line}:${rule.ruleId || rule.title}`,
      file: filePath,
      _live: true,
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    if (isPy || (!isJs && /except\s*:/.test(line))) {
      if (/except\s*:\s*(#.*)?$/.test(line)) {
        add({
          line: n,
          title: 'Bare except clause',
          ruleId: 'PY-BARE-EXCEPT',
          cwe: 'CWE-396',
          severity: 'High',
          summary: 'Bare `except:` swallows all errors including KeyboardInterrupt and SystemExit.',
          suggestion: 'Catch a specific exception type, e.g. `except Exception as err:`.',
          patch: line.replace(/except\s*:/, 'except Exception as err:'),
          snippet: line,
        });
      }
    }

    if (isPy && /def\s+\w+\([^)]*=\s*\[\s*\]/.test(line)) {
      add({
        line: n,
        title: 'Mutable default argument (list)',
        ruleId: 'PY-MUTABLE-DEFAULT',
        cwe: 'CWE-1188',
        severity: 'Medium',
        summary: 'Default list arguments are shared across calls and can leak state.',
        suggestion: 'Use `= None` and create a new list inside the function.',
        patch: line.replace(/=\s*\[\s*\]/, '= None'),
        snippet: line,
      });
    }

    if (isPy && /def\s+\w+\([^)]*=\s*\{\s*\}/.test(line)) {
      add({
        line: n,
        title: 'Mutable default argument (dict)',
        ruleId: 'PY-MUTABLE-DEFAULT-DICT',
        cwe: 'CWE-1188',
        severity: 'Medium',
        summary: 'Default dict arguments are shared across calls.',
        suggestion: 'Use `= None` and create a new dict inside the function.',
        patch: line.replace(/=\s*\{\s*\}/, '= None'),
        snippet: line,
      });
    }

    if (/\beval\s*\(/.test(line)) {
      const indent = (line.match(/^\s*/) || [''])[0];
      add({
        line: n,
        title: 'Dangerous eval()',
        ruleId: 'SEC-EVAL',
        cwe: 'CWE-95',
        severity: 'Critical',
        summary: '`eval()` can execute arbitrary code from untrusted input.',
        suggestion: 'Avoid eval; use ast.literal_eval or a safe parser.',
        patch: isPy
          ? `${indent}# FIX: replace eval with ast.literal_eval for trusted literals only\n${indent}import ast\n${indent}value = ast.literal_eval(source)  # was: ${trimmed}`
          : `${indent}// FIX: never use eval on untrusted input\n${indent}// value = JSON.parse(source);`,
        snippet: line,
      });
    }

    if (/\bexec\s*\(/.test(line) && (isPy || !isJs)) {
      const indent = (line.match(/^\s*/) || [''])[0];
      add({
        line: n,
        title: 'Dangerous exec()',
        ruleId: 'SEC-EXEC',
        cwe: 'CWE-95',
        severity: 'Critical',
        summary: '`exec()` can run arbitrary code.',
        suggestion: 'Remove exec or strictly sandbox inputs.',
        patch: `${indent}# FIX: remove exec — do not run dynamic code\n${indent}raise RuntimeError("exec() disabled for safety")`,
        snippet: line,
      });
    }

    if (/AKIA[0-9A-Z]{16}/.test(line) || /(['"])[A-Za-z0-9/+]{32,}\1/.test(line)) {
      if (/api[_-]?key|secret|password|token|AKIA/i.test(line)) {
        add({
          line: n,
          title: 'Possible hardcoded secret',
          ruleId: 'SEC-HARDCODED-SECRET',
          cwe: 'CWE-798',
          severity: 'Critical',
          summary: 'Credentials or API keys appear hardcoded in source.',
          suggestion: 'Load secrets from environment variables or a secret manager.',
          snippet: line,
        });
      }
    }

    if (
      /(?:password|passwd|api[_-]?key|secret|token)\s*=\s*['"][^'"]+['"]/i.test(line) &&
      !(/os\.environ|process\.env|getenv/i.test(line))
    ) {
      const left = line.split('=')[0];
      add({
        line: n,
        title: 'Hardcoded credential assignment',
        ruleId: 'SEC-HARDCODED-CRED',
        cwe: 'CWE-798',
        severity: 'Critical',
        summary: 'A credential is assigned a string literal in source.',
        suggestion: 'Use environment variables instead of literals.',
        patch: isPy
          ? `${left}= os.environ.get("SECRET_OR_API_KEY", "")`
          : `${left}= process.env.SECRET_OR_API_KEY || ""`,
        snippet: line,
      });
    }

    if (
      /execute\s*\(\s*f["']/.test(line) ||
      /\.format\s*\([^)]*SELECT/i.test(line) ||
      /query\s*=\s*f["']/.test(line) ||
      /f["'][^"'\n]*\bSELECT\b/i.test(line)
    ) {
      const indent = (line.match(/^\s*/) || [''])[0];
      add({
        line: n,
        title: 'Possible SQL injection',
        ruleId: 'SEC-SQL-INJECTION',
        cwe: 'CWE-89',
        severity: 'Critical',
        summary: 'SQL built with f-strings/format is vulnerable to injection.',
        suggestion: 'Use parameterized queries (placeholders + bound values).',
        patch: `${indent}# FIX: use parameterized query\n${indent}# cursor.execute("SELECT ... WHERE id = %s", (value,))`,
        snippet: line,
      });
    }

    if (
      /getenv\([^)]+,\s*["'][^"']+["']\)/.test(line) &&
      /secret|password|token|jwt|api[_-]?key/i.test(line)
    ) {
      add({
        line: n,
        title: 'Insecure secret default in getenv',
        ruleId: 'SEC-GETENV-DEFAULT',
        cwe: 'CWE-798',
        severity: 'High',
        summary: 'Fallback secret in getenv means production may run with a hardcoded default.',
        suggestion: 'Require the env var (no insecure default) or fail closed.',
        patch: line.replace(/,\s*["'][^"']+["']\s*\)/, ')'),
        snippet: line,
      });
    }

    if (isPy && /\bis\s+None\b/.test(line) === false && /==\s*None|!=\s*None/.test(line)) {
      add({
        line: n,
        title: 'Compare with None using ==',
        ruleId: 'PY-NONE-CMP',
        cwe: 'CWE-710',
        severity: 'Low',
        summary: 'PEP 8 recommends `is None` / `is not None` instead of `== None`.',
        suggestion: 'Replace `== None` with `is None`.',
        patch: line.replace(/==\s*None/g, 'is None').replace(/!=\s*None/g, 'is not None'),
        snippet: line,
      });
    }

    if (isJs && /\binnerHTML\s*=/.test(line)) {
      add({
        line: n,
        title: 'Unsafe innerHTML assignment',
        ruleId: 'SEC-INNERHTML',
        cwe: 'CWE-79',
        severity: 'High',
        summary: 'Assigning to innerHTML can introduce XSS.',
        suggestion: 'Use textContent or sanitize HTML before assignment.',
        snippet: line,
      });
    }

    if (/\bpickle\.loads?\s*\(/.test(line)) {
      add({
        line: n,
        title: 'Unsafe pickle deserialization',
        ruleId: 'SEC-PICKLE',
        cwe: 'CWE-502',
        severity: 'Critical',
        summary: 'Unpickling untrusted data can execute arbitrary code.',
        suggestion: 'Prefer JSON or a safe serializer for untrusted inputs.',
        snippet: line,
      });
    }

    if (isPy && /subprocess\.(call|run|Popen)\([^)]*shell\s*=\s*True/.test(line)) {
      add({
        line: n,
        title: 'subprocess shell=True',
        ruleId: 'SEC-SHELL-TRUE',
        cwe: 'CWE-78',
        severity: 'High',
        summary: 'shell=True enables command injection if arguments are user-controlled.',
        suggestion: 'Pass an argument list with shell=False.',
        snippet: line,
      });
    }

    if (/\/\/\s*FIXME|\/\*\s*FIXME|#\s*FIXME/i.test(line) || /\bTODO\s*:\s*fix|XXX\b/.test(line)) {
      add({
        line: n,
        title: 'Unresolved FIXME / TODO',
        ruleId: 'MAINT-FIXME',
        cwe: 'CWE-1078',
        severity: 'Low',
        summary: 'Marked debt that may hide incomplete or buggy logic.',
        suggestion: 'Resolve or track the item before shipping.',
        snippet: line,
      });
    }

    // --- Concurrent syntax / statement mistakes (as you type) ---
    if (isPy) {
      if (
        /^\s*(if|elif|else|for|while|def|class|try|except|finally|with|match|case)\b/.test(trimmed) &&
        !/:\s*(#.*)?$/.test(trimmed) &&
        !trimmed.endsWith('\\')
      ) {
        const indent = (line.match(/^\s*/) || [''])[0];
        add({
          line: n,
          title: 'Syntax error: missing `:`',
          ruleId: 'PY-SYNTAX-COLON',
          cwe: 'CWE-1078',
          severity: 'Critical',
          summary: `Python compound statement on line ${n} is missing a trailing colon.`,
          suggestion: 'Add `:` at the end of this statement.',
          patch: `${indent}${trimmed}:`,
          snippet: line,
        });
      }

      if (/^\s*print\s+[^(=]/.test(line)) {
        add({
          line: n,
          title: 'Syntax error: print needs parentheses',
          ruleId: 'PY-SYNTAX-PRINT',
          cwe: 'CWE-1078',
          severity: 'High',
          summary: 'Python 3 requires `print(...)` — this looks like Python 2 print syntax.',
          suggestion: 'Wrap the printed value in parentheses.',
          patch: line.replace(/^(\s*)print\s+(.+)$/, '$1print($2)'),
          snippet: line,
        });
      }

      if (
        /[=+\-*/%]\s*$/.test(trimmed) &&
        !trimmed.endsWith(':') &&
        !trimmed.endsWith('\\') &&
        !/^\s*(def|class|if|elif|else|for|while|try|except|with)\b/.test(line)
      ) {
        add({
          line: n,
          title: 'Incomplete statement',
          ruleId: 'PY-SYNTAX-INCOMPLETE',
          cwe: 'CWE-1078',
          severity: 'High',
          summary: `Line ${n} ends with an operator — statement looks incomplete.`,
          suggestion: 'Finish the expression or remove the trailing operator.',
          snippet: line,
          patch: '',
        });
      }
    }

    if (isJs) {
      if (/^\s*(if|for|while|switch|catch)\s*\([^)]*\)\s*\{?\s*$/.test(trimmed) === false) {
        if (/^\s*(if|for|while)\s+[^(]/.test(line)) {
          add({
            line: n,
            title: 'Syntax error: missing parentheses',
            ruleId: 'JS-SYNTAX-PARENS',
            cwe: 'CWE-1078',
            severity: 'High',
            summary: 'Control statements need parentheses around the condition.',
            suggestion: 'Use `if (condition) { ... }` form.',
            snippet: line,
          });
        }
      }
    }

    if (isHtml) {
      if (/\sjavascript:\s*/i.test(line)) {
        add({
          line: n,
          title: 'javascript: URL handler',
          ruleId: 'HTML-SEC-001',
          cwe: 'CWE-79',
          severity: 'High',
          summary: 'javascript: URLs are an XSS vector and blocked by modern CSP defaults.',
          suggestion: 'Use addEventListener handlers instead of javascript: links.',
          snippet: line,
        });
      }
      if (/\son\w+\s*=\s*["'][^"']*["']/i.test(line)) {
        add({
          line: n,
          title: 'Inline event handler attribute',
          ruleId: 'HTML-SEC-002',
          cwe: 'CWE-79',
          severity: 'Medium',
          summary: 'Inline onclick/onerror handlers are harder to audit and often blocked by CSP.',
          suggestion: 'Move handlers to external JS with addEventListener.',
          snippet: line,
        });
      }
      if (/target\s*=\s*["']_blank["']/i.test(line) && !/rel\s*=\s*["'][^"']*noopener/i.test(line)) {
        add({
          line: n,
          title: 'target=_blank without rel',
          ruleId: 'HTML-SEC-004',
          cwe: 'CWE-1022',
          severity: 'Medium',
          summary: 'target=_blank without rel="noopener noreferrer" enables tab-nabbing.',
          suggestion: 'Add rel="noopener noreferrer".',
          snippet: line,
        });
      }
      if (/<img(?![^>]*\balt=)/i.test(line)) {
        add({
          line: n,
          title: 'Image missing alt attribute',
          ruleId: 'HTML-A11Y-002',
          cwe: 'CWE-1078',
          severity: 'Medium',
          summary: 'Images without alt text fail basic accessibility checks.',
          suggestion: 'Add alt="..." (or alt="" for decorative images).',
          snippet: line,
        });
      }
    }

    if (isCss) {
      if (/expression\s*\(/i.test(line) || /url\s*\(\s*["']?javascript:/i.test(line)) {
        add({
          line: n,
          title: 'Unsafe CSS construct',
          ruleId: 'CSS-SEC-001',
          cwe: 'CWE-79',
          severity: 'High',
          summary: 'Legacy CSS expression()/javascript: urls are unsafe.',
          suggestion: 'Remove expression() and javascript: urls from CSS.',
          snippet: line,
        });
      }
    }

    if (isMd) {
      if (/\]\(\s*javascript:/i.test(line)) {
        add({
          line: n,
          title: 'javascript: link in Markdown',
          ruleId: 'MD-SEC-002',
          cwe: 'CWE-79',
          severity: 'Medium',
          summary: 'javascript: links in docs can become XSS vectors if copied into apps.',
          suggestion: 'Use https:// links instead.',
          snippet: line,
        });
      }
    }
  }

  // Unbalanced brackets / unclosed strings — skip HTML/CSS/MD (angle brackets / freeform prose)
  addBalanceIssues(add, lines, (isPy || isJs) && !isMarkup);

  if (isJs) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(src);
    } catch (err) {
      const msg = String(err?.message || err);
      const m = msg.match(/line\s+(\d+)/i) || msg.match(/:(\d+)(?::\d+)?\s*$/);
      const lineNo = m ? Number(m[1]) : Math.max(1, lines.length);
      add({
        line: lineNo,
        title: 'JavaScript syntax error',
        ruleId: 'JS-SYNTAX',
        cwe: 'CWE-1078',
        severity: 'Critical',
        summary: msg,
        suggestion: 'Fix the syntax error reported by the parser.',
        snippet: lines[lineNo - 1] || '',
      });
    }
  }

  // Deduplicate same rule+line
  const seen = new Set();
  return out.filter((f) => {
    const k = `${f.ruleId}:${f.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function addBalanceIssues(add, lines, enabled) {
  if (!enabled) return;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let inStr = null;
  let lastChange = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const prev = j > 0 ? line[j - 1] : '';
      if (inStr) {
        if (ch === inStr && prev !== '\\') inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inStr = ch;
        lastChange = n;
        continue;
      }
      if (ch === '#') break; // python comment — approximate for py; js uses //
      if (ch === '/' && line[j + 1] === '/') break;
      if (ch === '(') {
        paren += 1;
        lastChange = n;
      } else if (ch === ')') {
        paren -= 1;
        lastChange = n;
      } else if (ch === '[') {
        bracket += 1;
        lastChange = n;
      } else if (ch === ']') {
        bracket -= 1;
        lastChange = n;
      } else if (ch === '{') {
        brace += 1;
        lastChange = n;
      } else if (ch === '}') {
        brace -= 1;
        lastChange = n;
      }
      if (paren < 0 || bracket < 0 || brace < 0) {
        add({
          line: n,
          title: 'Syntax error: unmatched closing bracket',
          ruleId: 'SYNTAX-UNMATCHED-CLOSE',
          cwe: 'CWE-1078',
          severity: 'Critical',
          summary: `Unexpected closing bracket on line ${n}.`,
          suggestion: 'Remove the extra `)`, `]`, or `}` — Apply deletes the stray closer.',
          snippet: line,
        });
        paren = Math.max(0, paren);
        bracket = Math.max(0, bracket);
        brace = Math.max(0, brace);
      }
    }
  }

  if (inStr) {
    add({
      line: lastChange,
      title: 'Syntax error: unclosed string',
      ruleId: 'SYNTAX-UNCLOSED-STRING',
      cwe: 'CWE-1078',
      severity: 'Critical',
      summary: `String literal opened around line ${lastChange} was never closed.`,
      suggestion: `Add the missing ${inStr} quote.`,
      snippet: lines[lastChange - 1] || '',
      patch: `${lines[lastChange - 1] || ''}${inStr}`,
    });
  }
  if (paren > 0) {
    add({
      line: lastChange,
      title: 'Syntax error: unclosed `(`',
      ruleId: 'SYNTAX-UNCLOSED-PAREN',
      cwe: 'CWE-1078',
      severity: 'Critical',
      summary: `${paren} unclosed parenthesis — last activity near line ${lastChange}.`,
      suggestion: 'Add the missing `)`.',
      snippet: lines[lastChange - 1] || '',
      patch: `${lines[lastChange - 1] || ''})`,
    });
  }
  if (bracket > 0) {
    add({
      line: lastChange,
      title: 'Syntax error: unclosed `[`',
      ruleId: 'SYNTAX-UNCLOSED-BRACKET',
      cwe: 'CWE-1078',
      severity: 'Critical',
      summary: `${bracket} unclosed '[' — last activity near line ${lastChange}.`,
      suggestion: 'Add the missing `]`.',
      snippet: lines[lastChange - 1] || '',
      patch: `${lines[lastChange - 1] || ''}]`,
    });
  }
}
