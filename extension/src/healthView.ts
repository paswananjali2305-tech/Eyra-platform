import * as vscode from 'vscode';
import { fetchMe } from './brainClient';
import { brainBaseUrl } from './config';
import { countWorkspaceIssues, type IssueCountEntry } from './diagnosticsModel';
import { checkBrainHealth, type HealthResult } from './healthClient';
import { openInvestigationTab } from './investigationPanel';
import { readAccessToken } from './session';
import { renderSidebar, type CreateDraft, type RenameDraft, type SidebarUser } from './sidebarHtml';
import { autoExpandPaths, buildWorkspaceTree, type TreeNode } from './workspaceTree';

type ViewState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; result: HealthResult };

function workspaceName(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.name || 'No folder';
}

function diagnosticIssueCount(): number {
  const entries: IssueCountEntry[] = [];
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== 'file') {
      continue;
    }
    for (const d of diags) {
      entries.push({
        filePath: uri.fsPath,
        severity: d.severity,
        line: d.range.start.line,
        character: d.range.start.character,
        message: d.message,
        source: d.source,
        code: d.code,
      });
    }
  }
  const roots = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  return countWorkspaceIssues(entries, roots);
}

export class HealthViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'eyra.healthView';

  private view: vscode.WebviewView | undefined;
  private state: ViewState = { kind: 'idle' };
  private checkSeq = 0;
  private user: SidebarUser = null;
  private activeAction = 'history';
  private secrets: vscode.SecretStorage | undefined;
  private issueCount = 0;
  private treeLoading = false;
  private tree: TreeNode[] = [];
  private expanded = new Set<string>();
  private selectedPath = '';
  private activeFolder = '';
  private createDraft: CreateDraft | null = null;
  private renameDraft: RenameDraft | null = null;
  private treeOpen = true;

  constructor(private readonly extensionUri: vscode.Uri) {}

  bindSecrets(secrets: vscode.SecretStorage): void {
    this.secrets = secrets;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.onDidReceiveMessage((message: {
      type?: string;
      command?: string;
      action?: string;
      args?: string;
      path?: string;
      name?: string;
      kind?: string;
    }) => {
      if (message?.type === 'refreshTree') {
        void this.loadTree();
        return;
      }
      if (message?.type === 'newFolder') {
        this.beginCreate('folder');
        return;
      }
      if (message?.type === 'newFile') {
        this.beginCreate('file');
        return;
      }
      if (message?.type === 'cancelCreate') {
        this.createDraft = null;
        this.render();
        return;
      }
      if (message?.type === 'confirmCreate' && typeof message.name === 'string') {
        void this.confirmCreate(message.name);
        return;
      }
      if (message?.type === 'beginRename' && typeof message.path === 'string'
        && (message.kind === 'file' || message.kind === 'folder')) {
        this.beginRename(message.path, message.kind);
        return;
      }
      if (message?.type === 'cancelRename') {
        this.renameDraft = null;
        this.render();
        return;
      }
      if (message?.type === 'confirmRename' && typeof message.name === 'string') {
        void this.confirmRename(message.name);
        return;
      }
      if (message?.type === 'deleteEntry' && typeof message.path === 'string'
        && (message.kind === 'file' || message.kind === 'folder')) {
        void this.deleteEntry(message.path, message.kind);
        return;
      }
      if (message?.type === 'toggleFolder' && typeof message.path === 'string') {
        if (message.path === '__root__') {
          this.treeOpen = !this.treeOpen;
          this.render();
          return;
        }
        this.activeFolder = message.path;
        if (this.expanded.has(message.path)) {
          this.expanded.delete(message.path);
        } else {
          this.expanded.add(message.path);
        }
        this.render();
        return;
      }
      if (message?.type === 'openFile' && typeof message.path === 'string') {
        this.selectedPath = message.path;
        const parts = message.path.replace(/\\/g, '/').split('/').filter(Boolean);
        parts.pop();
        this.activeFolder = parts.join('/');
        void this.openWorkspaceFile(message.path);
        this.render();
        return;
      }
      if (message?.type === 'command' && typeof message.command === 'string') {
        if (typeof message.action === 'string' && message.action) {
          this.activeAction = message.action;
        }

        if (message.command === 'workbench.action.openSettings' && message.args) {
          void vscode.commands.executeCommand(message.command, message.args);
          this.render();
          return;
        }

        void vscode.commands.executeCommand(message.command);

        if (message.command === 'eyra.analyzeFile') {
          openInvestigationTab('analysis');
        }
        if (message.command === 'eyra.explainSelection') {
          openInvestigationTab('chat');
        }
        if (message.command === 'eyra.generateTests' || message.command === 'eyra.runTests') {
          openInvestigationTab('tests');
        }
        if (message.command === 'eyra.showHistory') {
          openInvestigationTab('history');
        }
        this.render();
        return;
      }
      if (message?.type === 'check') {
        void this.refresh(false);
      }
    });

    this.issueCount = diagnosticIssueCount();
    this.render();
    void this.refresh(false);
    void this.refreshUser().then(() => this.render());
    void this.loadTree();

    const diagSub = vscode.languages.onDidChangeDiagnostics(() => {
      this.issueCount = diagnosticIssueCount();
      if (this.createDraft || this.renameDraft) {
        return;
      }
      this.render();
    });
    const folderSub = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.tree = [];
      this.expanded.clear();
      this.createDraft = null;
      this.renameDraft = null;
      this.treeOpen = true;
      void this.loadTree();
    });
    const visSub = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.render();
        // One click on the EYRA Activity Bar icon opens the whole workbench:
        // this Workspace panel (left) plus the chatbot (right).
        openInvestigationTab('chat');
      }
    });
    webviewView.onDidDispose(() => {
      diagSub.dispose();
      folderSub.dispose();
      visSub.dispose();
    });
  }

  private async loadTree(): Promise<void> {
    this.treeLoading = true;
    this.render();
    try {
      this.tree = await buildWorkspaceTree();
      if (this.expanded.size === 0) {
        this.expanded = new Set(autoExpandPaths(this.tree, 4));
      }
    } catch {
      this.tree = [];
    }
    this.treeLoading = false;
    this.render();
  }

  private editorAnchor(): { parent: string; anchorPath: string } {
    const editor = vscode.window.activeTextEditor;
    const doc = editor?.document;
    if (doc && doc.uri.scheme === 'file' && vscode.workspace.getWorkspaceFolder(doc.uri)) {
      const relative = vscode.workspace.asRelativePath(doc.uri, false).replace(/\\/g, '/');
      const parts = relative.split('/').filter(Boolean);
      parts.pop();
      return { parent: parts.join('/'), anchorPath: relative };
    }
    if (this.selectedPath) {
      const relative = this.selectedPath.replace(/\\/g, '/');
      const parts = relative.split('/').filter(Boolean);
      parts.pop();
      return { parent: parts.join('/'), anchorPath: relative };
    }
    if (this.activeFolder) {
      return { parent: this.activeFolder.replace(/\\/g, '/'), anchorPath: '' };
    }
    return { parent: '', anchorPath: '' };
  }

  private beginCreate(kind: 'file' | 'folder'): void {
    if (!vscode.workspace.workspaceFolders?.[0]) {
      void vscode.window.showErrorMessage('Open a workspace folder before creating a file or folder.');
      return;
    }
    this.treeOpen = true;
    this.renameDraft = null;
    const anchor = this.editorAnchor();
    let acc = '';
    for (const part of anchor.parent.split('/').filter(Boolean)) {
      acc = acc ? `${acc}/${part}` : part;
      this.expanded.add(acc);
    }
    this.createDraft = { kind, parent: anchor.parent, anchorPath: anchor.anchorPath };
    this.render();
  }

  private nameProblem(kind: 'file' | 'folder', value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return kind === 'file' ? 'Enter a file name.' : 'Enter a folder name.';
    }
    if (trimmed.includes('..') || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
      return 'Use a name inside this folder.';
    }
    if (/[<>:"|?*]/.test(trimmed)) {
      return 'That name has a character this system does not allow.';
    }
    return '';
  }

  private async confirmCreate(rawName: string): Promise<void> {
    const draft = this.createDraft;
    if (!draft) {
      return;
    }
    const problem = this.nameProblem(draft.kind, rawName);
    if (problem) {
      void vscode.window.showErrorMessage(problem);
      return;
    }
    await this.createEntry(draft.kind, rawName.trim(), draft.parent);
  }

  private async createEntry(kind: 'file' | 'folder', name: string, parent: string): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showErrorMessage('Open a workspace folder before creating a file or folder.');
      return;
    }
    const relative = [parent, name.replace(/\\/g, '/')].filter(Boolean).join('/');
    const parts = relative.split('/').filter(Boolean);
    const uri = vscode.Uri.joinPath(folder.uri, ...parts);
    try {
      try {
        await vscode.workspace.fs.stat(uri);
        void vscode.window.showErrorMessage(`"${parts[parts.length - 1]}" already exists.`);
        return;
      } catch {
        // The path is free.
      }
      if (parts.length > 1) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, ...parts.slice(0, -1)));
      }
      if (kind === 'folder') {
        await vscode.workspace.fs.createDirectory(uri);
      } else {
        await vscode.workspace.fs.writeFile(uri, new Uint8Array());
      }
      const stored = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
      const ancestors = stored.split('/').filter(Boolean);
      const stop = kind === 'file' ? ancestors.length - 1 : ancestors.length;
      let acc = '';
      for (let i = 0; i < stop; i += 1) {
        acc = acc ? `${acc}/${ancestors[i]}` : ancestors[i];
        this.expanded.add(acc);
      }
      this.createDraft = null;
      if (kind === 'file') {
        this.selectedPath = stored;
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } else {
        this.activeFolder = stored;
        this.expanded.add(stored);
      }
      await this.loadTree();
    } catch (err) {
      const detail = err instanceof Error ? err.message : `Could not create the ${kind}.`;
      void vscode.window.showErrorMessage(detail);
    }
  }

  private replacePathPrefix(value: string, oldPath: string, newPath: string): string {
    if (value === oldPath) {
      return newPath;
    }
    return value.startsWith(`${oldPath}/`) ? `${newPath}${value.slice(oldPath.length)}` : value;
  }

  private beginRename(path: string, kind: 'file' | 'folder'): void {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    const name = parts[parts.length - 1] || '';
    if (!name) {
      return;
    }
    this.createDraft = null;
    this.treeOpen = true;
    let acc = '';
    for (const part of parts.slice(0, -1)) {
      acc = acc ? `${acc}/${part}` : part;
      this.expanded.add(acc);
    }
    this.renameDraft = { kind, path: path.replace(/\\/g, '/'), name };
    this.render();
  }

  private async confirmRename(rawName: string): Promise<void> {
    const draft = this.renameDraft;
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!draft || !root) {
      return;
    }
    const name = rawName.trim();
    if (!name || name === '.' || name === '..' || /[/\\]/.test(name) || /[<>:"|?*]/.test(name)) {
      void vscode.window.showErrorMessage('Enter a valid name without a folder separator.');
      return;
    }
    const oldParts = draft.path.split('/').filter(Boolean);
    if (name === draft.name) {
      this.renameDraft = null;
      this.render();
      return;
    }
    const newParts = [...oldParts.slice(0, -1), name];
    const oldUri = vscode.Uri.joinPath(root.uri, ...oldParts);
    const newUri = vscode.Uri.joinPath(root.uri, ...newParts);
    try {
      try {
        await vscode.workspace.fs.stat(newUri);
        void vscode.window.showErrorMessage(`"${name}" already exists.`);
        return;
      } catch {
        // The new name is free.
      }
      await vscode.workspace.fs.rename(oldUri, newUri, { overwrite: false });
      const newPath = newParts.join('/');
      this.selectedPath = this.selectedPath
        ? this.replacePathPrefix(this.selectedPath.replace(/\\/g, '/'), draft.path, newPath)
        : '';
      this.activeFolder = this.activeFolder
        ? this.replacePathPrefix(this.activeFolder.replace(/\\/g, '/'), draft.path, newPath)
        : '';
      this.expanded = new Set([...this.expanded].map((item) => this.replacePathPrefix(item, draft.path, newPath)));
      this.renameDraft = null;
      await this.loadTree();
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Could not rename it.';
      void vscode.window.showErrorMessage(detail);
    }
  }

  private async deleteEntry(path: string, kind: 'file' | 'folder'): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) {
      return;
    }
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    const name = parts[parts.length - 1] || path;
    const detail = kind === 'folder'
      ? `Delete "${name}" and everything inside it?`
      : `Delete "${name}"?`;
    const choice = await vscode.window.showWarningMessage(detail, { modal: true }, 'Delete');
    if (choice !== 'Delete') {
      return;
    }
    const uri = vscode.Uri.joinPath(root.uri, ...parts);
    try {
      await vscode.workspace.fs.delete(uri, { recursive: kind === 'folder', useTrash: true });
      const stored = parts.join('/');
      if (this.selectedPath === stored || this.selectedPath.startsWith(`${stored}/`)) {
        this.selectedPath = '';
      }
      if (this.activeFolder === stored || this.activeFolder.startsWith(`${stored}/`)) {
        this.activeFolder = '';
      }
      this.expanded = new Set([...this.expanded].filter((item) => item !== stored && !item.startsWith(`${stored}/`)));
      if (this.renameDraft?.path === stored) {
        this.renameDraft = null;
      }
      if (this.createDraft?.anchorPath === stored || this.createDraft?.anchorPath.startsWith(`${stored}/`)) {
        this.createDraft = null;
      }
      await this.loadTree();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not delete it.';
      void vscode.window.showErrorMessage(message);
    }
  }

  private async openWorkspaceFile(relativePath: string): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showErrorMessage('No workspace folder is open.');
      return;
    }
    const uri = vscode.Uri.joinPath(folder.uri, ...relativePath.split(/[/\\]/).filter(Boolean));
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch {
      void vscode.window.showErrorMessage(`Could not open ${relativePath}.`);
    }
  }

  async refresh(notify: boolean): Promise<void> {
    const seq = ++this.checkSeq;
    this.state = { kind: 'checking' };
    this.render();
    const result = await checkBrainHealth();
    if (seq !== this.checkSeq) {
      return;
    }
    this.state = { kind: 'done', result };
    this.issueCount = diagnosticIssueCount();
    await this.refreshUser();
    this.render();
    if (!notify) {
      return;
    }
    if (result.ok && result.status.toLowerCase() === 'ok') {
      void vscode.window.showInformationMessage(
        `EYRA Brain responded: ${result.status} · ${result.service || 'unknown service'} ${result.version || ''}`.trim(),
      );
      return;
    }
    const message = result.ok
      ? `EYRA Brain responded, but status is "${result.status || 'missing'}".`
      : result.message;
    void vscode.window.showErrorMessage(message);
  }

  async refreshUser(): Promise<void> {
    if (!this.secrets) {
      this.user = null;
      return;
    }
    const token = await readAccessToken(this.secrets);
    if (!token) {
      this.user = null;
      return;
    }
    try {
      const me = await fetchMe(token);
      this.user = {
        displayName: me.display_name || me.username,
        email: me.email,
        username: me.username,
      };
    } catch {
      this.user = null;
    }
  }

  private render(): void {
    if (!this.view) {
      return;
    }
    const health = this.state.kind === 'done' ? this.state.result : null;
    this.view.webview.html = renderSidebar({
      nonce: `${Date.now()}`,
      health,
      checking: this.state.kind === 'checking' || this.state.kind === 'idle',
      backendUrl: brainBaseUrl(),
      workspaceName: workspaceName(),
      issueCount: this.issueCount,
      user: this.user,
      activeAction: this.activeAction,
      treeOpen: this.treeOpen,
      treeLoading: this.treeLoading,
      tree: this.tree,
      expanded: [...this.expanded],
      selectedPath: this.selectedPath,
      createDraft: this.createDraft,
      renameDraft: this.renameDraft,
    });
  }
}
