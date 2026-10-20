/**
 * Model replies sometimes store source as one JSON-escaped line (`\n`, `\"`)
 * even though the editor buffer has real newlines. Decode that shape only.
 * A file that already has real newlines may legally contain `\n` (C printf).
 */

const QUOTE_CLAIM =
  /clos(?:e|ing)\s+(?:double\s+|single\s+)?quote|unclosed\s+string|unterminated\s+string|missing\s+["'`]?quote/i;

export function normalizeDisplayedCode(text) {
  let source = String(text ?? '');
  if (!source) return '';
  if (source.length >= 2 && source.startsWith('"') && source.endsWith('"')) {
    try {
      const parsed = JSON.parse(source);
      if (typeof parsed === 'string') source = parsed;
    } catch {
      /* not a JSON string */
    }
  }
  const realNewlines = (source.match(/\n/g) || []).length;
  const escapedNewlines = (source.match(/\\n/g) || []).length;
  // Two or more escaped breaks means a multi-line file was stored as one line.
  // A single \n can be a real escape inside a C or C++ string.
  if (realNewlines === 0 && escapedNewlines >= 2) {
    source = source
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
  }
  return source.replace(/\r\n/g, '\n');
}

export function sameSourceText(left, right) {
  const norm = (value) =>
    normalizeDisplayedCode(value)
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''))
      .join('\n')
      .trim();
  return norm(left) === norm(right);
}

export function claimsUnclosedQuote(text) {
  return QUOTE_CLAIM.test(String(text || ''));
}

/**
 * Hide a suggested fix that is only the escaped original, or a quote error
 * claimed against source that is already the same text.
 */
export function presentSuggestedFix(summary, code, original) {
  const next = normalizeDisplayedCode(code);
  const same = Boolean(original) && sameSourceText(next, original);
  if (!next.trim() || same) {
    return {
      code: '',
      summary: claimsUnclosedQuote(summary)
        ? 'The source already parses. No quote fix is needed.'
        : same
          ? ''
          : String(summary || ''),
    };
  }
  return { code: next, summary: String(summary || '') };
}
