const PY_KEYWORDS = new Set([
  'def',
  'return',
  'from',
  'import',
  'as',
  'if',
  'elif',
  'else',
  'try',
  'except',
  'pass',
  'for',
  'in',
  'while',
  'with',
  'class',
  'async',
  'await',
  'True',
  'False',
  'None',
  'and',
  'or',
  'not',
  'yield',
  'lambda',
  'raise',
  'finally',
  'global',
  'nonlocal',
  'assert',
  'break',
  'continue',
  'del',
  'is',
]);

const JS_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'class',
  'extends',
  'import',
  'from',
  'export',
  'default',
  'async',
  'await',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'this',
  'typeof',
  'instanceof',
  'true',
  'false',
  'null',
  'undefined',
  'switch',
  'case',
  'break',
  'continue',
  'of',
  'in',
]);

function languageKind(language) {
  const l = (language || '').toLowerCase();
  if (l.includes('json')) return 'json';
  if (l.includes('markdown') || l === 'md') return 'md';
  if (l.includes('html')) return 'html';
  if (l.includes('css') || l.includes('scss')) return 'css';
  if (l.includes('sql')) return 'sql';
  if (l.includes('text') || l.includes('plain')) return 'text';
  if (
    l.includes('javascript') ||
    l.includes('typescript') ||
    l === 'js' ||
    l === 'ts' ||
    l === 'tsx' ||
    l === 'jsx'
  ) {
    return 'javascript';
  }
  if (
    l.includes('java') ||
    l.includes('c++') ||
    l.includes('cpp') ||
    l === 'c' ||
    l.includes('go')
  ) {
    return 'javascript'; // C-family / braces — reuse JS highlighter
  }
  return 'python';
}

/** Lightweight syntax highlighter → React nodes (EYRA design tokens). */
export function highlightLine(text, language) {
  if (!text) return '\u00a0';
  const kind = languageKind(language);

  if (kind === 'md') {
    if (text.startsWith('#')) {
      return <span className="font-semibold text-primary">{text}</span>;
    }
    return <span className="text-on-surface-variant">{text}</span>;
  }

  if (kind === 'html') {
    const parts = [];
    const re = /(<\/?[A-Za-z!][^>]*>)|([^<]+)/g;
    let m;
    let key = 0;
    while ((m = re.exec(text)) !== null) {
      if (m[1]) {
        const tag = m[1];
        const inner = tag.match(/^<\/?([A-Za-z!]+)/);
        const name = inner?.[1] || '';
        parts.push(
          <span key={key++}>
            <span className="text-[#89ddff]">{tag.slice(0, tag.indexOf(name))}</span>
            <span className="text-primary">{name}</span>
            <span className="text-[#89ddff]">{tag.slice(tag.indexOf(name) + name.length)}</span>
          </span>,
        );
      } else if (m[2]) {
        parts.push(
          <span key={key++} className="text-on-surface">
            {m[2]}
          </span>,
        );
      }
    }
    return parts.length ? parts : text;
  }

  if (kind === 'json') {
    const parts = [];
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+\.?\d*)|true|false|null|[{}\[\],]/g;
    let last = 0;
    let m;
    let key = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        parts.push(
          <span key={key++} className="text-on-surface">
            {text.slice(last, m.index)}
          </span>,
        );
      }
      if (m[1] && m[2]) {
        parts.push(
          <span key={key++} className="text-primary">
            {m[1]}
          </span>,
        );
        parts.push(
          <span key={key++} className="text-outline">
            {m[2]}
          </span>,
        );
      } else if (m[1]) {
        parts.push(
          <span key={key++} className="text-tertiary">
            {m[1]}
          </span>,
        );
      } else if (m[3]) {
        parts.push(
          <span key={key++} className="text-secondary">
            {m[3]}
          </span>,
        );
      } else if (m[0] === 'true' || m[0] === 'false' || m[0] === 'null') {
        parts.push(
          <span key={key++} className="font-medium text-secondary">
            {m[0]}
          </span>,
        );
      } else {
        parts.push(
          <span key={key++} className="text-outline">
            {m[0]}
          </span>,
        );
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      parts.push(
        <span key={key++} className="text-on-surface">
          {text.slice(last)}
        </span>,
      );
    }
    return parts.length ? parts : text;
  }

  if (kind === 'text') {
    const pin = text.match(/^([A-Za-z0-9_.-]+)(==|>=)(.+)$/);
    if (pin) {
      return (
        <>
          <span className="text-on-surface">{pin[1]}</span>
          <span className="text-outline">{pin[2]}</span>
          <span className="text-tertiary">{pin[3]}</span>
        </>
      );
    }
    return <span className="text-on-surface">{text}</span>;
  }

  // JavaScript / TypeScript (same tokenizer family as Python, different keywords)
  if (kind === 'javascript') {
    const commentIdx = (() => {
      let inStr = null;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
          if (c === '\\') {
            i++;
            continue;
          }
          if (c === inStr) inStr = null;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') {
          inStr = c;
          continue;
        }
        if (c === '/' && text[i + 1] === '/') return i;
      }
      return -1;
    })();
    const codePart = commentIdx >= 0 ? text.slice(0, commentIdx) : text;
    const commentPart = commentIdx >= 0 ? text.slice(commentIdx) : '';
    const tokens = [];
    const re =
      /((?:`[\s\S]*?`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))|(\b\d+\.?\d*\b)|(\b[A-Za-z_$]\w*\b)|(\s+)|(.)/g;
    let m;
    let key = 0;
    while ((m = re.exec(codePart)) !== null) {
      const [, str, num, word, space, other] = m;
      if (space) {
        tokens.push(<span key={key++}>{space}</span>);
        continue;
      }
      if (str) {
        tokens.push(
          <span key={key++} className="text-tertiary">
            {str}
          </span>,
        );
        continue;
      }
      if (num) {
        tokens.push(
          <span key={key++} className="text-[#c792ea]">
            {num}
          </span>,
        );
        continue;
      }
      if (word) {
        if (JS_KEYWORDS.has(word)) {
          tokens.push(
            <span key={key++} className="font-medium text-secondary">
              {word}
            </span>,
          );
        } else {
          const after = codePart.slice(m.index + word.length);
          const isCall = /^\s*\(/.test(after);
          if (isCall || /^[A-Z]/.test(word)) {
            tokens.push(
              <span key={key++} className="font-medium text-primary">
                {word}
              </span>,
            );
          } else {
            tokens.push(
              <span key={key++} className="text-on-surface">
                {word}
              </span>,
            );
          }
        }
        continue;
      }
      if (other) {
        tokens.push(
          <span key={key++} className="text-outline">
            {other}
          </span>,
        );
      }
    }
    if (commentPart) {
      tokens.push(
        <span key={key++} className="italic text-outline">
          {commentPart}
        </span>,
      );
    }
    return tokens.length ? tokens : text;
  }

  // Python
  const commentIdx = (() => {
    let inStr = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === "'" || c === '"') {
        inStr = c;
        continue;
      }
      if (c === '#') return i;
    }
    return -1;
  })();

  const codePart = commentIdx >= 0 ? text.slice(0, commentIdx) : text;
  const commentPart = commentIdx >= 0 ? text.slice(commentIdx) : '';

  const tokens = [];
  const re =
    /(f?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))|(@\w+)|(\b\d+\.?\d*\b)|(\b[A-Za-z_]\w*\b)|(\s+)|(.)/g;
  let m;
  let key = 0;
  while ((m = re.exec(codePart)) !== null) {
    const [, str, deco, num, word, space, other] = m;
    if (space) {
      tokens.push(<span key={key++}>{space}</span>);
      continue;
    }
    if (str) {
      tokens.push(
        <span key={key++} className="text-tertiary">
          {str}
        </span>,
      );
      continue;
    }
    if (deco) {
      tokens.push(
        <span key={key++} className="text-secondary">
          {deco}
        </span>,
      );
      continue;
    }
    if (num) {
      tokens.push(
        <span key={key++} className="text-[#c792ea]">
          {num}
        </span>,
      );
      continue;
    }
    if (word) {
      if (PY_KEYWORDS.has(word)) {
        tokens.push(
          <span key={key++} className="font-medium text-secondary">
            {word}
          </span>,
        );
      } else {
        const after = codePart.slice(m.index + word.length);
        const isCall = /^\s*\(/.test(after);
        const isDefName =
          /\bdef\s+$/.test(codePart.slice(0, m.index)) ||
          /\bclass\s+$/.test(codePart.slice(0, m.index));
        if (isDefName || isCall) {
          tokens.push(
            <span key={key++} className="font-medium text-primary">
              {word}
            </span>,
          );
        } else if (/^[A-Z]/.test(word)) {
          tokens.push(
            <span key={key++} className="text-[#ffcb6b]">
              {word}
            </span>,
          );
        } else {
          tokens.push(
            <span key={key++} className="text-on-surface">
              {word}
            </span>,
          );
        }
      }
      continue;
    }
    if (other) {
      tokens.push(
        <span key={key++} className="text-outline">
          {other}
        </span>,
      );
    }
  }

  if (commentPart) {
    tokens.push(
      <span key={key++} className="italic text-outline">
        {commentPart}
      </span>,
    );
  }

  return tokens.length ? tokens : text;
}
