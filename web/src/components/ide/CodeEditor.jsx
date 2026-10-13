import { useEffect, useRef } from 'react';
import { highlightLine } from './highlightLine.jsx';

const LINE_H = 22;

function textToLines(text) {
  const parts = String(text ?? '').length ? String(text).split('\n') : [''];
  return parts.map((t, i) => ({ n: i + 1, text: t, crash: false }));
}

function indentUnit(language) {
  const l = (language || '').toLowerCase();
  if (l.includes('python') || l.includes('py')) return '    ';
  if (l.includes('makefile') || l === 'go') return '\t';
  return '  ';
}

function leadingWs(line) {
  const m = String(line || '').match(/^[ \t]*/);
  return m ? m[0] : '';
}

/**
 * Line-numbered editor: read-only highlighted view, or editable with
 * syntax overlay, Tab indent, and Ctrl/Cmd+S save.
 */
export function CodeEditor({
  path,
  language,
  /** Optional catalog id (Python, C++, …) so logos stay correct when mode ≠ file extension */
  languageId = null,
  lines,
  findingLine,
  findingLabel,
  /** @type {Record<number, string>|null} line number → short label for gutter markers */
  issueLines = null,
  metaRight,
  editable = false,
  value,
  onChange,
  onSave,
  dirty = false,
}) {
  const name = path?.split('/').pop() || 'untitled';
  const unit = indentUnit(language);

  const scrollRef = useRef(null);
  const gutterRef = useRef(null);
  const highlightRef = useRef(null);
  const textareaRef = useRef(null);

  const displayLines = editable
    ? textToLines(value ?? '')
    : (lines || []).map((line) =>
        typeof line === 'string' ? { n: 0, text: line, crash: false } : line,
      );

  // Keep gutter / highlight / textarea scroll locked
  useEffect(() => {
    if (!editable) return undefined;
    const ta = textareaRef.current;
    if (!ta) return undefined;
    const sync = () => {
      const top = ta.scrollTop;
      const left = ta.scrollLeft;
      if (gutterRef.current) gutterRef.current.scrollTop = top;
      if (highlightRef.current) {
        highlightRef.current.scrollTop = top;
        highlightRef.current.scrollLeft = left;
      }
    };
    ta.addEventListener('scroll', sync);
    return () => ta.removeEventListener('scroll', sync);
  }, [editable, path]);

  // Scroll editor to the selected finding line so Apply/context match what you see
  useEffect(() => {
    if (!editable) return;
    const ln = Number(findingLine);
    if (!ln || ln < 1) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const top = Math.max(0, (ln - 3) * LINE_H);
    ta.scrollTop = top;
    if (gutterRef.current) gutterRef.current.scrollTop = top;
    if (highlightRef.current) highlightRef.current.scrollTop = top;
  }, [editable, findingLine, path]);

  function handleKeyDown(e) {
    if (!editable) return;

    // Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onSave?.(value ?? '');
      return;
    }

    const ta = e.target;
    const text = value ?? '';
    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        // Outdent current line(s)
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = text.indexOf('\n', end);
        const blockEnd = lineEnd === -1 ? text.length : lineEnd;
        const block = text.slice(lineStart, blockEnd);
        const out = block
          .split('\n')
          .map((ln) => {
            if (ln.startsWith(unit)) return ln.slice(unit.length);
            if (ln.startsWith('\t')) return ln.slice(1);
            if (ln.startsWith('  ')) return ln.slice(2);
            if (ln.startsWith(' ')) return ln.slice(1);
            return ln;
          })
          .join('\n');
        const next = text.slice(0, lineStart) + out + text.slice(blockEnd);
        onChange?.(next);
        requestAnimationFrame(() => {
          const delta = block.length - out.length;
          ta.selectionStart = Math.max(lineStart, start - Math.min(delta, unit.length));
          ta.selectionEnd = Math.max(lineStart, end - delta);
        });
      } else if (start !== end) {
        // Indent selection
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = text.indexOf('\n', end);
        const blockEnd = lineEnd === -1 ? text.length : lineEnd;
        const block = text.slice(lineStart, blockEnd);
        const out = block
          .split('\n')
          .map((ln) => unit + ln)
          .join('\n');
        const next = text.slice(0, lineStart) + out + text.slice(blockEnd);
        onChange?.(next);
        requestAnimationFrame(() => {
          const added = out.length - block.length;
          ta.selectionStart = start + unit.length;
          ta.selectionEnd = end + added;
        });
      } else {
        const next = text.slice(0, start) + unit + text.slice(end);
        onChange?.(next);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + unit.length;
        });
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const curLine = text.slice(lineStart, start);
      let indent = leadingWs(curLine);
      if (/[:{[(]\s*$/.test(curLine.trimEnd()) || /^\s*(def|class|if|elif|else|for|while|try|except|finally|with)\b/.test(curLine)) {
        indent += unit;
      }
      const next = `${text.slice(0, start)}\n${indent}${text.slice(end)}`;
      onChange?.(next);
      requestAnimationFrame(() => {
        const pos = start + 1 + indent.length;
        ta.selectionStart = ta.selectionEnd = pos;
      });
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      {metaRight != null ? (
        <div className="flex h-7 shrink-0 items-center justify-end border-b border-outline-variant/10 bg-surface-container-lowest/80 px-space-md">
          <div className="flex shrink-0 items-center gap-2">{metaRight}</div>
        </div>
      ) : null}

      {editable ? (
        <div ref={scrollRef} className="relative flex min-h-0 flex-1 overflow-hidden font-code-body text-code-body">
          <div
            ref={gutterRef}
            className="flex w-12 shrink-0 select-none flex-col overflow-hidden border-r border-outline-variant/10 bg-surface-container-lowest/40 pt-space-sm text-right font-code-compact text-code-compact text-outline-variant"
            aria-hidden
          >
            {displayLines.map((line) => {
              const hot =
                (findingLine != null && line.n === Number(findingLine)) ||
                Boolean(issueLines && issueLines[line.n]);
              return (
                <div
                  key={line.n}
                  className={`flex items-center justify-end pr-3 ${hot ? 'bg-error-container/20 font-semibold text-error' : ''}`}
                  style={{ height: LINE_H }}
                  title={issueLines?.[line.n] || (hot ? findingLabel : undefined)}
                >
                  {line.n}
                </div>
              );
            })}
          </div>

          <div className="relative min-h-0 min-w-0 flex-1">
            {/* Syntax highlight layer (non-interactive) */}
            <div
              ref={highlightRef}
              className="pointer-events-none absolute inset-0 overflow-hidden py-space-sm pl-2 pr-space-md"
              aria-hidden
            >
              {displayLines.map((line) => {
                const selected = findingLine != null && line.n === Number(findingLine);
                const marked = Boolean(issueLines && issueLines[line.n]);
                const hot = selected || marked;
                const label = selected
                  ? findingLabel
                  : marked
                    ? issueLines[line.n]
                    : null;
                return (
                  <div
                    key={line.n}
                    className={`flex items-center whitespace-pre ${
                      selected
                        ? 'bg-error-container/25'
                        : marked
                          ? 'bg-error-container/15'
                          : ''
                    }`}
                    style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}
                  >
                    <span>{highlightLine(line.text, language)}</span>
                    {hot && label ? (
                      <span className="ml-3 shrink-0 rounded bg-error px-1.5 py-0.5 font-label-sm text-[10px] font-semibold text-on-error">
                        {label}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <textarea
              ref={textareaRef}
              value={value ?? ''}
              onChange={(e) => onChange?.(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              wrap="off"
              className={`absolute inset-0 z-[1] min-h-0 w-full resize-none overflow-auto bg-transparent py-space-sm pl-2 pr-space-md font-code-body text-code-body caret-primary outline-none selection:bg-primary/30 placeholder:text-outline ${
                value ? 'text-transparent' : 'text-on-surface'
              }`}
              placeholder="# Write or paste your code here…"
              style={{
                lineHeight: `${LINE_H}px`,
                tabSize: unit.length,
                WebkitTextFillColor: value ? 'transparent' : undefined,
              }}
              aria-label={`Edit ${name}`}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto font-code-body text-code-body">
          <div className="flex min-w-[560px] py-space-sm">
            <div className="flex w-12 shrink-0 select-none flex-col text-right font-code-compact text-code-compact text-outline-variant">
              {displayLines.map((line) => (
                <div
                  key={line.n}
                  className={`flex items-center justify-end pr-3 ${
                    line.crash ? 'bg-error-container/20 font-semibold text-error' : ''
                  }`}
                  style={{ height: LINE_H }}
                >
                  {line.n}
                </div>
              ))}
            </div>
            <div className="flex-1">
              {displayLines.map((line) => (
                <div
                  key={line.n}
                  className={`relative flex items-center whitespace-pre pr-space-md ${
                    line.crash ? 'bg-error-container/25' : 'hover:bg-surface-container/40'
                  }`}
                  style={{ height: LINE_H }}
                >
                  <span className="pl-1">{highlightLine(line.text, language)}</span>
                  {line.crash && findingLine === line.n && findingLabel ? (
                    <span className="ml-3 shrink-0 rounded bg-error px-1.5 py-0.5 font-label-sm text-[10px] font-semibold text-on-error">
                      {findingLabel}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <span className="sr-only">{name}</span>
    </div>
  );
}
