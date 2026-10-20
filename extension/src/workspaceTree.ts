import * as vscode from 'vscode';

export type TreeNode = {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  children?: TreeNode[];
};

const SKIP = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'out',
  '.next',
  '.turbo',
  'coverage',
  '.pytest_cache',
  '.mypy_cache',
  '.cursor',
  '.vscode',
]);

const MAX_ENTRIES = 800;

function sortNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) {
    return a.kind === 'folder' ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function isDir(type: vscode.FileType): boolean {
  return (type & vscode.FileType.Directory) === vscode.FileType.Directory;
}

function isFile(type: vscode.FileType): boolean {
  return (type & vscode.FileType.File) === vscode.FileType.File;
}

async function readDir(uri: vscode.Uri, depth: number, budget: { left: number }): Promise<TreeNode[]> {
  if (budget.left <= 0 || depth > 10) {
    return [];
  }
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(uri);
  } catch {
    return [];
  }
  const nodes: TreeNode[] = [];
  const sorted = [...entries]
    .filter(([name]) => !SKIP.has(name))
    .filter(([name]) => !name.startsWith('.') || name === '.env' || name === '.env.example')
    .sort((a, b) => {
      const aIsDir = isDir(a[1]);
      const bIsDir = isDir(b[1]);
      if (aIsDir !== bIsDir) {
        return aIsDir ? -1 : 1;
      }
      return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });
    });

  for (const [name, type] of sorted) {
    if (budget.left <= 0) {
      break;
    }
    budget.left -= 1;
    const childUri = vscode.Uri.joinPath(uri, name);
    const path = vscode.workspace.asRelativePath(childUri, false);
    if (isDir(type)) {
      const children = await readDir(childUri, depth + 1, budget);
      nodes.push({ name, path, kind: 'folder', children });
    } else if (isFile(type)) {
      nodes.push({ name, path, kind: 'file' });
    }
  }
  return nodes.sort(sortNodes);
}

/** Paths of folders to auto-expand (all folders up to maxDepth). */
export function autoExpandPaths(nodes: TreeNode[], maxDepth = 3): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      if (node.kind !== 'folder') {
        continue;
      }
      if (depth < maxDepth) {
        out.push(node.path);
        if (node.children?.length) {
          walk(node.children, depth + 1);
        }
      }
    }
  };
  walk(nodes, 0);
  return out;
}

export async function buildWorkspaceTree(): Promise<TreeNode[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return [];
  }
  return readDir(folder.uri, 0, { left: MAX_ENTRIES });
}

export { runCommandForFile } from './runCommand';
