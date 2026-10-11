import { fileIcon, tagClass } from './fileIcons.js';

function TreeNode({ node, depth, open, selected, onToggle, onSelect }) {
  if (node.type === 'folder') {
    const isOpen = open.has(node.id);
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          className="flex w-full items-center gap-0.5 rounded py-0.5 pr-1 font-code-compact text-code-compact text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          style={{ paddingLeft: 6 + depth * 12 }}
        >
          <span className="material-symbols-outlined shrink-0 text-[14px] text-outline">
            {isOpen ? 'expand_more' : 'chevron_right'}
          </span>
          <span
            className={`material-symbols-outlined shrink-0 text-[15px] ${
              isOpen ? 'text-primary' : 'text-[#dcb67a]'
            }`}
          >
            {isOpen ? 'folder_open' : 'folder'}
          </span>
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen
          ? node.children?.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                open={open}
                selected={selected}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))
          : null}
      </div>
    );
  }

  const { icon, color } = fileIcon(node.ext || node.id, node.severity);
  const active = selected === node.id;

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className={`flex w-full items-center gap-1 rounded py-0.5 pr-1.5 font-code-compact text-code-compact transition-colors ${
        active
          ? 'bg-primary-container/15 text-on-surface'
          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
      }`}
      style={{ paddingLeft: 22 + depth * 12 }}
    >
      <span className={`material-symbols-outlined shrink-0 text-[15px] ${color}`}>{icon}</span>
      <span className={`min-w-0 flex-1 truncate text-left ${active ? 'font-medium' : ''}`}>
        {node.name}
      </span>
      {node.badges?.length ? (
        <span className="flex shrink-0 gap-0.5">
          {node.badges.map((b) => (
            <span
              key={b.label}
              className={`rounded px-1 py-px font-label-sm text-[9px] leading-tight ${tagClass(b.tone)}`}
            >
              {b.label}
            </span>
          ))}
        </span>
      ) : null}
      {node.severity === 'critical' ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-error" />
      ) : null}
    </button>
  );
}

/** Nested VS Code–style repository explorer. */
export function FileExplorer({ tree, open, selected, onToggle, onSelect, title = 'Explorer' }) {
  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-outline-variant/25 bg-surface-container-lowest 2xl:w-72">
      <div className="flex items-center justify-between px-space-sm py-1.5">
        <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">
          {title}
        </span>
        <div className="flex items-center gap-0.5 text-outline">
          <span className="material-symbols-outlined text-[14px]">note_add</span>
          <span className="material-symbols-outlined text-[14px]">create_new_folder</span>
          <span className="material-symbols-outlined text-[14px]">refresh</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-space-md">
        <TreeNode
          node={tree}
          depth={0}
          open={open}
          selected={selected}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      </div>
    </aside>
  );
}
