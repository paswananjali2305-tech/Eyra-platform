import { LanguageLogo } from './LanguageLogo.jsx';
import { fileIcon, tagClass } from './fileIcons.js';

function SeverityBadges({ badges }) {
  if (!badges?.length) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5">
      {badges.map((b) => (
        <span
          key={`${b.tone}-${b.label}`}
          title={b.title || b.label}
          className={`rounded px-1 py-px font-label-sm text-[10px] leading-tight ${tagClass(b.tone)}`}
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}

function TreeNode({ node, depth, open, selected, onToggle, onSelect }) {
  if (!node || !node.type) return null;
  if (node.type === 'folder') {
    const isOpen = open.has(node.id);
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          className="flex w-full items-center gap-0.5 rounded py-0.5 pr-1.5 font-code-compact text-code-compact text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
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
          <span className="min-w-0 truncate">{node.name}</span>
          <SeverityBadges badges={node.badges} />
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

  const meta = fileIcon(node.ext || node.id, node.severity);
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
      {meta.glyph ? (
        <LanguageLogo path={node.id} size={14} />
      ) : (
        <span className={`material-symbols-outlined shrink-0 text-[15px] ${meta.color}`}>
          {meta.icon}
        </span>
      )}
      <span className={`min-w-0 flex-1 truncate text-left ${active ? 'font-medium' : ''}`}>
        {node.name}
      </span>
      <SeverityBadges badges={node.badges} />
    </button>
  );
}

/** Nested VS Code–style repository explorer. */
export function FileExplorer({
  tree,
  open,
  selected,
  onToggle,
  onSelect,
  title = 'Explorer',
  width,
}) {
  const style = width != null ? { width, minWidth: width, maxWidth: width } : undefined;
  return (
    <aside
      style={style}
      className={`flex shrink-0 flex-col overflow-hidden border-r border-outline-variant/25 bg-surface-container-lowest ${
        width == null ? 'w-60 2xl:w-72' : ''
      }`}
    >
      <div className="flex items-center px-space-sm py-1.5">
        <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">
          {title}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-space-md">
        {tree ? (
          <TreeNode
            node={tree}
            depth={0}
            open={open}
            selected={selected}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ) : (
          <p className="px-space-sm py-space-md font-body-sm text-[11px] leading-relaxed text-outline">
            No codebase loaded yet. Ingest a ZIP or GitHub repo, then Start Codebase Audit.
          </p>
        )}
      </div>
    </aside>
  );
}
