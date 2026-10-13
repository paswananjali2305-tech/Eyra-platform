import { LanguageLogo } from './LanguageLogo.jsx';
import { fileIcon } from './fileIcons.js';

/**
 * VS Code–style open-file tabs with +, and optional trailing actions (lang / save / download / run).
 */
export function FileTabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onAdd,
  dirtyIds,
  trailing = null,
  onRun,
  runDisabled = false,
  runLabel = 'Run',
}) {
  const showRun = typeof onRun === 'function';

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-outline-variant/15 bg-surface-container-lowest">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const dirty = dirtyIds?.has?.(tab.id) || tab.dirty;
          const meta = fileIcon(tab.id, tab.severity);
          const name = tab.name || tab.id.split('/').pop();
          return (
            <div
              key={tab.id}
              className={`group flex h-full min-w-[7.5rem] max-w-[14rem] shrink-0 items-center gap-1 border-r border-outline-variant/15 pl-2.5 pr-1 font-code-compact text-code-compact ${
                active
                  ? 'bg-surface text-on-surface'
                  : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container/60'
              }`}
            >
              <button
                type="button"
                title={tab.id}
                onClick={() => onSelect?.(tab.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                {tab.languageId || meta.glyph ? (
                  <LanguageLogo langId={tab.languageId} path={tab.id} size={14} />
                ) : (
                  <span className={`material-symbols-outlined shrink-0 text-[14px] ${meta.color}`}>
                    {meta.icon}
                  </span>
                )}
                <span className={`truncate ${active ? '' : 'italic opacity-90'}`}>{name}</span>
                {dirty ? (
                  <span
                    className="shrink-0 font-label-sm text-[10px] font-semibold text-[#cbcb41]"
                    title="Unsaved"
                  >
                    ●
                  </span>
                ) : null}
              </button>
              {onClose ? (
                <button
                  type="button"
                  aria-label={`Close ${name}`}
                  title={`Close ${name}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-outline transition-colors hover:bg-error/20 hover:text-error"
                >
                  <span className="material-symbols-outlined text-[14px] leading-none">close</span>
                </button>
              ) : null}
            </div>
          );
        })}
        {onAdd ? (
          <button
            type="button"
            title="New code file"
            aria-label="Add new code file"
            onClick={onAdd}
            className="flex h-full w-9 shrink-0 items-center justify-center border-r border-outline-variant/15 text-outline transition-colors hover:bg-surface-container hover:text-primary"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
          </button>
        ) : null}
        <div className="min-w-0 flex-1 bg-surface-container-lowest" />
      </div>
      {(trailing || showRun) && (
        <div className="flex shrink-0 items-center gap-1.5 border-l border-outline-variant/15 bg-surface-container-lowest px-2">
          {trailing}
          {showRun ? (
            <button
              type="button"
              disabled={runDisabled}
              onClick={onRun}
              title="Run sandbox"
              className="flex items-center gap-1 rounded bg-secondary-container/45 px-2.5 py-1 font-label-sm text-[11px] font-semibold text-secondary transition-colors hover:bg-secondary-container/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[15px]">play_arrow</span>
              <span>{runLabel}</span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
