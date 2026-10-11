import { highlightLine } from './highlightLine.jsx';
import { fileIcon } from './fileIcons.js';

function textToLines(text) {
  const parts = text.length ? text.split('\n') : [''];
  return parts.map((t, i) => ({ n: i + 1, text: t, crash: false }));
}

/**
 * Line-numbered syntax-colored editor (read-only) or editable textarea pane.
 */
export function CodeEditor({
  path,
  language,
  lines,
  findingLine,
  findingLabel,
  metaRight,
  editable = false,
  value,
  onChange,
}) {
  const name = path?.split('/').pop() || 'untitled';
  const { icon, color } = fileIcon(path);

  const displayLines = editable ? textToLines(value ?? '') : lines || [];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      {metaRight != null ? (
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-outline-variant/10 bg-surface-container-lowest/80 px-space-md">
          <div className="flex items-center gap-1.5 font-code-compact text-code-compact text-outline">
            <span className={`material-symbols-outlined text-[13px] ${color}`}>{icon}</span>
            <span className="text-on-surface-variant">{path}</span>
            {editable ? (
              <span className="rounded bg-primary-container/15 px-1.5 py-0.5 font-label-sm text-[10px] text-primary">
                Editable
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">{metaRight}</div>
        </div>
      ) : null}

      {editable ? (
        <div className="flex min-h-0 flex-1 overflow-hidden font-code-body text-code-body">
          <div className="flex w-12 shrink-0 select-none flex-col overflow-hidden border-r border-outline-variant/10 bg-surface-container-lowest/40 pt-space-sm text-right font-code-compact text-code-compact text-outline-variant">
            {displayLines.map((line) => (
              <div key={line.n} className="flex h-[22px] items-center justify-end pr-3">
                {line.n}
              </div>
            ))}
          </div>
          <textarea
            value={value ?? ''}
            onChange={(e) => onChange?.(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-transparent py-space-sm pl-2 pr-space-md font-code-body text-code-body leading-[22px] text-on-surface caret-primary outline-none placeholder:text-outline"
            placeholder="# Write or paste your code here…"
            style={{ lineHeight: '22px' }}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto font-code-body text-code-body">
          <div className="flex min-w-[560px] py-space-sm">
            <div className="flex w-12 shrink-0 select-none flex-col text-right font-code-compact text-code-compact text-outline-variant">
              {displayLines.map((line) => (
                <div
                  key={line.n}
                  className={`flex h-[22px] items-center justify-end pr-3 ${
                    line.crash ? 'bg-error-container/20 font-semibold text-error' : ''
                  }`}
                >
                  {line.n}
                </div>
              ))}
            </div>
            <div className="flex-1">
              {displayLines.map((line) => (
                <div
                  key={line.n}
                  className={`relative flex h-[22px] items-center whitespace-pre pr-space-md ${
                    line.crash ? 'bg-error-container/25' : 'hover:bg-surface-container/40'
                  }`}
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
