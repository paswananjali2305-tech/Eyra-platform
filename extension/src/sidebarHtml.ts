import { escapeHtml } from './analysisHtml';
import { eyraBaseCss, iconSvg } from './eyraUi';
import { fileTypeLogoSvg } from './fileTypeIcon';
import type { HealthResult } from './healthClient';
import type { TreeNode } from './workspaceTree';

export type SidebarUser = {
  displayName: string;
  email: string;
  username: string;
} | null;

export type CreateDraft = {
  kind: 'file' | 'folder';
  parent: string;
  anchorPath: string;
};

export type RenameDraft = {
  kind: 'file' | 'folder';
  path: string;
  name: string;
};

export type SidebarView = {
  nonce: string;
  health: HealthResult | null;
  checking: boolean;
  backendUrl: string;
  workspaceName: string;
  issueCount: number;
  user: SidebarUser;
  activeAction: string;
  treeOpen: boolean;
  treeLoading: boolean;
  tree: TreeNode[];
  expanded: string[];
  selectedPath: string;
  createDraft?: CreateDraft | null;
  renameDraft?: RenameDraft | null;
};

function onlinePill(view: SidebarView): string {
  if (view.checking) {
    return `<span class="online-pill checking" title="${escapeHtml(view.backendUrl)}"><span class="online-dot"></span>Checking…</span>`;
  }
  const online = view.health?.ok === true && view.health.status.toLowerCase() === 'ok';
  return `<span class="online-pill${online ? '' : ' off'}" title="${escapeHtml(view.backendUrl)}"><span class="online-dot"></span>${online ? 'Online' : 'Offline'}</span>`;
}

function createNameRow(kind: 'file' | 'folder', pad: number): string {
  const label = kind === 'file' ? 'New file name' : 'New folder name';
  const placeholder = kind === 'file' ? 'filename.py' : 'folder name';
  return `<div class="tree-create" style="padding-left:${pad}px">
    <span class="tree-ico">${iconSvg(kind === 'file' ? 'file' : 'folder')}</span>
    <input class="tree-create-input" data-create-input="1" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(label)}" />
  </div>`;
}

function renameNameRow(draft: RenameDraft, pad: number): string {
  return `<div class="tree-create" style="padding-left:${pad}px">
    <span class="tree-ico">${iconSvg(draft.kind === 'file' ? 'file' : 'folder')}</span>
    <input class="tree-create-input" data-rename-input="1" value="${escapeHtml(draft.name)}" aria-label="Rename ${escapeHtml(draft.name)}" />
  </div>`;
}

function rowMenu(node: TreeNode): string {
  return `<button type="button" class="tree-more-btn" data-more="${escapeHtml(node.path)}" data-kind="${node.kind}" title="More actions">${iconSvg('more')}</button>`;
}

function countVisibleRows(nodes: TreeNode[], expanded: Set<string>): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (node.kind === 'folder' && expanded.has(node.path)) {
      count += node.children?.length ? countVisibleRows(node.children, expanded) : 1;
    }
  }
  return count;
}

function renderTreeNodes(
  nodes: TreeNode[],
  expanded: Set<string>,
  selected: string,
  depth: number,
  draft: CreateDraft | null,
  placed: { done: boolean },
  rename: RenameDraft | null,
): string {
  return nodes.map((node) => {
    const pad = 10 + depth * 14;
    if (node.kind === 'folder') {
      const draftInside = Boolean(
        draft && (
          draft.parent === node.path
          || draft.parent.startsWith(`${node.path}/`)
          || draft.anchorPath === node.path
          || draft.anchorPath.startsWith(`${node.path}/`)
        ),
      );
      const open = expanded.has(node.path) || draftInside;
      const kids = open && node.children?.length
        ? renderTreeNodes(node.children, expanded, selected, depth + 1, draft, placed, rename)
        : open
          ? `<div class="tree-empty" style="padding-left:${pad + 28}px">Empty</div>`
          : '';
      const trailing = draft && open && !placed.done && draft.parent === node.path
        ? (placed.done = true, createNameRow(draft.kind, pad + 28))
        : '';
      const renameRow = rename?.path === node.path ? renameNameRow(rename, pad + 16) : '';
      return `<div class="tree-item">
        <div class="tree-row-wrap">
          <button type="button" class="tree-row folder" style="padding-left:${pad}px" data-toggle-folder="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}">
            <span class="tree-chev${open ? ' open' : ''}">${iconSvg('chevron-right')}</span>
            <span class="tree-ico">${iconSvg('folder')}</span>
            <span class="tree-name">${escapeHtml(node.name)}</span>
          </button>
          ${rowMenu(node)}
        </div>
        ${renameRow}
        ${kids}
        ${trailing}
      </div>`;
    }
    const brand = fileTypeLogoSvg(node.name, 14);
    const sel = selected === node.path ? ' selected' : '';
    const after = draft && !placed.done && draft.anchorPath === node.path
      ? (placed.done = true, createNameRow(draft.kind, pad + 16))
      : '';
    const renameRow = rename?.path === node.path ? renameNameRow(rename, pad + 16) : '';
    return `<div class="tree-row-wrap">
      <button type="button" class="tree-row file${sel}" style="padding-left:${pad + 16}px" data-open-file="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}">
        <span class="tree-ico">${brand || iconSvg('file')}</span>
        <span class="tree-name">${escapeHtml(node.name)}</span>
      </button>
      ${rowMenu(node)}
    </div>${renameRow}${after}`;
  }).join('');
}

export function renderSidebar(view: SidebarView): string {
  const workspace = view.workspaceName || 'No folder';
  const expanded = new Set(view.expanded);
  const treeOpen = view.treeOpen !== false;

  const draft = view.createDraft ?? null;
  const rename = view.renameDraft ?? null;
  const placed = { done: false };
  const visibleRows = workspace === 'No folder'
    ? 1
    : 1 + (treeOpen ? Math.max(1, countVisibleRows(view.tree, expanded)) : 0)
      + (rename ? 1 : 0)
      + (draft && treeOpen && countVisibleRows(view.tree, expanded) === 0 ? 1 : 0);
  const treeHeight = 8 + Math.min(Math.max(visibleRows, 1), 6) * 27;
  const rootTools = `<span class="tree-root-tools">
      <button type="button" class="icon-btn" data-new-file="1" title="New file">${iconSvg('file-plus')}</button>
      <button type="button" class="icon-btn" data-new-folder="1" title="New folder">${iconSvg('folder-plus')}</button>
    </span>`;
  let treeInner = '';
  if (workspace === 'No folder') {
    treeInner = '<p class="tree-empty">Open a folder in VS Code to browse files.</p>';
  } else if (view.treeLoading) {
    treeInner = `<div class="tree-root">
      <button type="button" class="tree-row root" data-toggle-folder="__root__" title="${escapeHtml(workspace)}">
        <span class="tree-chev${treeOpen ? ' open' : ''}">${iconSvg('chevron-right')}</span>
        <span class="tree-ico">${iconSvg('folder')}</span>
        <span class="tree-name">${escapeHtml(workspace)}</span>
      </button>
      ${rootTools}
    </div>
    ${treeOpen ? '<p class="tree-empty">Loading workspace…</p>' : ''}`;
  } else {
    treeInner = `<div class="tree-root">
      <button type="button" class="tree-row root" data-toggle-folder="__root__" title="${escapeHtml(workspace)}">
        <span class="tree-chev${treeOpen ? ' open' : ''}">${iconSvg('chevron-right')}</span>
        <span class="tree-ico">${iconSvg('folder')}</span>
        <span class="tree-name">${escapeHtml(workspace)}</span>
      </button>
      ${rootTools}
    </div>
    ${!treeOpen ? '' : view.tree.length
      ? renderTreeNodes(view.tree, expanded, view.selectedPath, 1, draft, placed, rename)
      : '<p class="tree-empty">This folder is empty. Use New file or New folder.</p>'}
    ${treeOpen && draft && !placed.done ? createNameRow(draft.kind, 24) : ''}`;
  }

  const historyCard = (() => {
    const active = view.activeAction === 'history' ? ' active' : '';
    return `<button type="button" class="action-card history-card${active}" data-cmd="eyra.showHistory" data-action="history">
      <span class="action-ico">${iconSvg('history')}</span>
      <span class="action-copy">
        <span class="action-title">Investigation History</span>
        <span class="action-sub">Your recent analysis and debugging sessions</span>
      </span>
      <span class="action-chev">${iconSvg('chevron-right')}</span>
    </button>`;
  })();

  const actions = [
    { id: 'explain', cmd: 'eyra.explainSelection', label: 'Explain Selected Code', sub: 'Get a simple explanation', icon: 'doc' },
    { id: 'bugs', cmd: 'eyra.analyzeFile', label: 'Find Bugs', sub: 'Detect potential issues', icon: 'bug' },
    { id: 'run', cmd: 'eyra.runFile', label: 'Run Current File', sub: 'Execute and see the output', icon: 'run' },
    { id: 'gen-tests', cmd: 'eyra.generateTests', label: 'Generate Tests', sub: 'Create and run tests for this file', icon: 'tests' },
  ].map((item) => {
    const active = view.activeAction === item.id ? ' active' : '';
    return `<button type="button" class="action-card${active}" data-cmd="${item.cmd}" data-action="${item.id}">
      <span class="action-ico">${iconSvg(item.icon)}</span>
      <span class="action-copy">
        <span class="action-title">${item.label}</span>
        <span class="action-sub">${item.sub}</span>
      </span>
      <span class="action-chev">${iconSvg('chevron-right')}</span>
    </button>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${view.nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EYRA</title>
  <style>
    ${eyraBaseCss()}
    html, body { height: 100%; }
    body {
      height: 100%; max-height: 100%; overflow: hidden; box-sizing: border-box;
      padding: 12px 10px 12px; background: var(--bg);
      display: flex; flex-direction: column; min-height: 0;
    }
    .brand {
      display: flex; align-items: flex-start; gap: 10px; margin: 0 2px 14px; padding-bottom: 12px;
      border-bottom: 1px solid var(--border); flex: 0 0 auto;
    }
    .brand-copy { flex: 1; min-width: 0; }
    .brand-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .brand-text { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; color: var(--text); }
    .brand-sub { margin-top: 3px; font-size: 11px; color: var(--muted); }
    .brand-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .icon-btn {
      width: 28px; height: 28px; border: none; background: transparent; color: var(--muted);
      border-radius: 6px; cursor: pointer; display: grid; place-items: center;
    }
    .icon-btn:hover { background: var(--hover); color: var(--text); }
    .online-pill {
      display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
      padding: 2px 8px; border-radius: 999px;
      background: var(--card); border: 1px solid var(--border);
      font-size: 10.5px; font-weight: 600; color: var(--green);
    }
    .online-pill.off { color: var(--red); }
    .online-pill.checking { color: var(--muted); }
    .online-dot {
      width: 6px; height: 6px; border-radius: 50%; background: var(--green);
      box-shadow: 0 0 6px rgba(61, 220, 132, 0.55);
    }
    .online-pill.off .online-dot { background: var(--red); box-shadow: none; }
    .online-pill.checking .online-dot { background: var(--muted); box-shadow: none; }

    .section-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      margin: 0 2px 8px; flex: 0 0 auto;
    }
    .section-label {
      font-size: 10.5px; font-weight: 650; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--muted-dim);
    }
    .section-tools { display: flex; align-items: center; gap: 2px; }

    .tree-panel {
      flex: 0 1 auto; min-height: 0; margin: 0 0 14px; overflow: auto;
      border: 1px solid var(--border); border-radius: 10px; background: var(--card); padding: 4px 0;
    }
    .tree-item { position: relative; }
    .tree-item::before {
      content: ''; position: absolute; top: 0; bottom: 0; left: 22px;
      width: 1px; background: #2a2a2a; pointer-events: none;
    }
    .tree-row {
      display: flex; align-items: center; gap: 6px; width: 100%;
      border: none; background: transparent; color: var(--text);
      text-align: left; padding: 4px 8px 4px 10px; cursor: pointer; font-size: 12.5px;
      position: relative; border-radius: 0;
    }
    .tree-row:hover { background: var(--hover); }
    .tree-row.selected {
      background: var(--hover);
      box-shadow: inset 2px 0 0 #F5F5F5;
    }
    .tree-root { display: flex; align-items: center; padding-right: 4px; }
    .tree-root .tree-row { flex: 1; min-width: 0; width: auto; }
    .tree-root-tools { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .tree-root-tools .icon-btn { width: 22px; height: 22px; }
    .tree-row.root { font-weight: 650; }
    .tree-chev {
      width: 14px; height: 14px; display: grid; place-items: center; flex-shrink: 0; color: var(--muted-dim);
      transition: transform 0.12s ease;
    }
    .tree-chev.open { transform: rotate(90deg); }
    .tree-chev svg { width: 12px; height: 12px; }
    .tree-ico { width: 16px; height: 16px; display: grid; place-items: center; flex-shrink: 0; color: var(--muted); }
    .tree-ico svg { width: 14px; height: 14px; }
    .tree-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tree-create {
      display: flex; align-items: center; gap: 6px; padding: 3px 8px 3px 0;
    }
    .tree-create-input {
      flex: 1; min-width: 0; height: 22px; border: 1px solid #3a3a3a; border-radius: 4px;
      background: #111; color: var(--text); font: inherit; font-size: 12.5px; padding: 0 6px;
    }
    .tree-create-input:focus { outline: 1px solid #F5F5F5; border-color: #F5F5F5; }
    .tree-row-wrap { position: relative; display: flex; align-items: center; }
    .tree-row-wrap .tree-row { flex: 1; min-width: 0; width: auto; padding-right: 28px; }
    .tree-row-wrap:hover { background: var(--hover); }
    .tree-row-wrap .tree-row:hover { background: transparent; }
    .tree-row-wrap .tree-row.selected { background: transparent; }
    .tree-more-btn {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      width: 22px; height: 22px; border: none; border-radius: 5px; background: transparent;
      color: var(--muted); cursor: pointer; display: grid; place-items: center; opacity: 0.75; z-index: 2;
    }
    .tree-more-btn:hover, .tree-row-wrap:hover .tree-more-btn { opacity: 1; color: var(--text); background: var(--hover); }
    .tree-more-btn svg { width: 14px; height: 14px; }
    .tree-menu {
      display: none; position: fixed; z-index: 1000; min-width: 128px;
      padding: 4px; border: 1px solid var(--border-strong); border-radius: 8px; background: #202020;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    }
    .tree-menu.open { display: block; }
    .tree-menu button {
      display: block; width: 100%; border: none; background: transparent; color: var(--text);
      text-align: left; padding: 6px 8px; border-radius: 5px; cursor: pointer; font-size: 12px;
    }
    .tree-menu button:hover { background: var(--hover); }
    .tree-menu button.danger { color: #ff9d94; }
    .tree-empty { margin: 0; padding: 10px 12px; color: var(--muted); font-size: 12px; }

    .actions {
      flex: 1 1 140px; min-height: 0; overflow: auto;
      display: flex; flex-direction: column; gap: 8px; padding-bottom: 4px;
    }
    .action-card {
      display: flex; align-items: center; gap: 12px; width: 100%; flex: 0 0 auto;
      border: 1px solid var(--border); background: var(--card); color: var(--text);
      text-align: left; padding: 12px 12px; border-radius: 10px; cursor: pointer;
    }
    .action-card:hover { background: var(--hover); border-color: #3a3a3a; }
    .action-card.active { box-shadow: inset 2px 0 0 #F5F5F5; }
    .action-ico {
      width: 32px; height: 32px; border-radius: 8px; background: var(--hover);
      border: 1px solid var(--border); color: var(--text);
      display: grid; place-items: center; flex-shrink: 0;
    }
    .action-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .action-title { font-size: 13px; font-weight: 650; }
    .action-sub { font-size: 11.5px; color: var(--muted); }
    .action-chev { color: var(--muted-dim); display: grid; place-items: center; flex-shrink: 0; }
    .history-slot { margin: 0 0 12px; flex: 0 0 auto; }
    .history-card { border-color: var(--border-strong); }
  </style>
</head>
<body>
  <div class="brand">
    ${iconSvg('brain')}
    <div class="brand-copy">
      <div class="brand-title-row">
        <div class="brand-text">EYRA</div>
        ${onlinePill(view)}
      </div>
      <div class="brand-sub">AI Debugger &amp; Dev Assistant</div>
    </div>
  </div>

  <div class="history-slot">${historyCard}</div>

  <div class="section-head">
    <div class="section-label">Workspace</div>
    <div class="section-tools">
      <button type="button" class="icon-btn" data-refresh-tree="1" title="Refresh">${iconSvg('refresh')}</button>
    </div>
  </div>
  <div class="tree-panel" style="height:${treeHeight}px">${treeInner}</div>

  <div class="actions">${actions}</div>

  <div class="tree-menu" id="tree-menu" role="menu">
    <button type="button" id="tree-menu-rename">Rename</button>
    <button type="button" class="danger" id="tree-menu-delete">Delete</button>
  </div>

  <script nonce="${view.nonce}">
    const vscode = acquireVsCodeApi();
    const treeMenu = document.getElementById('tree-menu');
    function closeTreeMenu() {
      if (treeMenu) {
        treeMenu.classList.remove('open');
        treeMenu.removeAttribute('data-for');
      }
    }
    function showTreeMenu(button, path, kind) {
      if (!treeMenu) return;
      const renameBtn = document.getElementById('tree-menu-rename');
      const deleteBtn = document.getElementById('tree-menu-delete');
      if (renameBtn) {
        renameBtn.setAttribute('data-rename', path);
        renameBtn.setAttribute('data-kind', kind);
      }
      if (deleteBtn) {
        deleteBtn.setAttribute('data-delete', path);
        deleteBtn.setAttribute('data-kind', kind);
      }
      treeMenu.setAttribute('data-for', path);
      treeMenu.classList.add('open');
      // Floating overlay: position from the button so the menu is never
      // clipped by the tree panel's overflow, and flip up near the bottom.
      const rect = button.getBoundingClientRect();
      const menuWidth = 140;
      const menuHeight = 76;
      let left = Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8);
      left = Math.max(8, left);
      let top = rect.bottom + 4;
      if (top + menuHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuHeight - 4);
      }
      treeMenu.style.left = left + 'px';
      treeMenu.style.top = top + 'px';
    }
    window.addEventListener('resize', closeTreeMenu);
    const treePanelEl = document.querySelector('.tree-panel');
    if (treePanelEl) treePanelEl.addEventListener('scroll', closeTreeMenu);
    document.body.addEventListener('click', (event) => {
      const raw = event.target instanceof Element ? event.target : null;
      const more = raw ? raw.closest('[data-more]') : null;
      if (more) {
        const path = more.getAttribute('data-more') || '';
        const wasOpen = Boolean(treeMenu && treeMenu.classList.contains('open') && treeMenu.getAttribute('data-for') === path);
        closeTreeMenu();
        if (!wasOpen) showTreeMenu(more, path, more.getAttribute('data-kind') || 'file');
        return;
      }
      const rename = raw ? raw.closest('[data-rename]') : null;
      if (rename) {
        closeTreeMenu();
        vscode.postMessage({ type: 'beginRename', path: rename.getAttribute('data-rename'), kind: rename.getAttribute('data-kind') });
        return;
      }
      const remove = raw ? raw.closest('[data-delete]') : null;
      if (remove) {
        closeTreeMenu();
        vscode.postMessage({ type: 'deleteEntry', path: remove.getAttribute('data-delete'), kind: remove.getAttribute('data-kind') });
        return;
      }
      if (raw && !raw.closest('.tree-menu')) {
        closeTreeMenu();
      }
      const target = raw
        ? raw.closest('[data-cmd], [data-toggle-folder], [data-open-file], [data-refresh-tree], [data-new-folder], [data-new-file]')
        : null;
      if (!target) return;
      if (target.hasAttribute('data-refresh-tree')) {
        vscode.postMessage({ type: 'refreshTree' });
        return;
      }
      if (target.hasAttribute('data-new-file')) {
        vscode.postMessage({ type: 'newFile' });
        return;
      }
      if (target.hasAttribute('data-new-folder')) {
        vscode.postMessage({ type: 'newFolder' });
        return;
      }
      if (target.hasAttribute('data-toggle-folder')) {
        const path = target.getAttribute('data-toggle-folder');
        vscode.postMessage({ type: 'toggleFolder', path });
        return;
      }
      if (target.hasAttribute('data-open-file')) {
        vscode.postMessage({ type: 'openFile', path: target.getAttribute('data-open-file') });
        return;
      }
      vscode.postMessage({
        type: 'command',
        command: target.getAttribute('data-cmd'),
        action: target.getAttribute('data-action') || '',
        args: target.getAttribute('data-args') || '',
      });
    });
    const createInput = document.querySelector('[data-create-input]');
    if (createInput instanceof HTMLInputElement) {
      createInput.focus();
      createInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          vscode.postMessage({ type: 'confirmCreate', name: createInput.value });
        } else if (event.key === 'Escape') {
          event.preventDefault();
          vscode.postMessage({ type: 'cancelCreate' });
        }
      });
    }
    const renameInput = document.querySelector('[data-rename-input]');
    if (renameInput instanceof HTMLInputElement) {
      renameInput.focus();
      const dot = renameInput.value.lastIndexOf('.');
      renameInput.setSelectionRange(0, dot > 0 ? dot : renameInput.value.length);
      renameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          vscode.postMessage({ type: 'confirmRename', name: renameInput.value });
        } else if (event.key === 'Escape') {
          event.preventDefault();
          vscode.postMessage({ type: 'cancelRename' });
        }
      });
    }
  </script>
</body>
</html>`;
}
