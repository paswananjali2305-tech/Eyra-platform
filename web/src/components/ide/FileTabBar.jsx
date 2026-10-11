import { fileIcon } from './fileIcons.js';

/**
 * VS Code–style open-file tabs with type icons, dirty marker, close, and optional +.
 */
export function FileTabBar({ tabs, activeId, onSelect, onClose, onAdd, dirtyIds }) {
  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-outline-variant/15 bg-surface-container-lowest">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const dirty = dirtyIds?.has?.(tab.id) || tab.dirty;
        const { icon, color } = fileIcon(tab.id, tab.severity);
        const name = tab.name || tab.id.split('/').pop();
        return (
          <div
            key={tab.id}
            className={`group flex h-full min-w-[7.5rem] max-w-[14rem] shrink-0 items-center gap-1.5 border-r border-outline-variant/15 px-2.5 font-code-compact text-code-compact ${
              active
                ? 'bg-surface text-on-surface'
                : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container/60'
            }`}
          >
            <button
              type="button"
              title={tab.id}
              onClick={() => onSelect(tab.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            >
              <span className={`material-symbols-outlined shrink-0 text-[14px] ${color}`}>{icon}</span>
              <span className={`truncate ${active ? '' : 'italic opacity-90'}`}>{name}</span>
              {dirty ? (
                <span className="shrink-0 font-label-sm text-[10px] font-semibold text-[#cbcb41]">
                  M
                </span>
              ) : null}
            </button>
            {onClose ? (
              <button
                type="button"
                aria-label={`Close ${name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface ${
                  dirty || active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                {dirty && !active ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-on-surface-variant" />
                ) : (
                  <span className="material-symbols-outlined text-[12px]">close</span>
                )}
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
      <div className="flex-1 bg-surface-container-lowest" />
    </div>
  );
}
