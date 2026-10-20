import * as vscode from 'vscode';

const DEFAULT_BASE = 'http://127.0.0.1:8000';

export function brainBaseUrl(): string {
  const configured = vscode.workspace.getConfiguration('eyra').get<string>('backendUrl', DEFAULT_BASE);
  const trimmed = (configured || DEFAULT_BASE).trim().replace(/\/+$/, '');
  return trimmed || DEFAULT_BASE;
}
