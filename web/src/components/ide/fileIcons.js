/** VS Code–style file/folder icons via Material Symbols + language brand colors */

import { languageIconMeta, languageIdFromPath } from '../../lib/auditLanguages.js';

const LANG_EXTS = new Set([
  'py',
  'pyi',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'java',
  'c',
  'h',
  'cpp',
  'cc',
  'cxx',
  'hpp',
  'hh',
  'go',
  'html',
  'htm',
  'css',
  'scss',
  'sql',
]);

export function extOf(pathOrName) {
  const base = String(pathOrName).split('/').pop() || '';
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i + 1).toLowerCase() : '';
}

/**
 * @param {string} extOrPath
 * @param {string|null} [severity]
 * @returns {{ icon: string, color: string, label: string, brandColor?: string, glyph?: string }}
 */
export function fileIcon(extOrPath, severity = null) {
  const hot = severity === 'critical' || severity === 'high';
  const raw = String(extOrPath || '');
  const base = raw.split('/').pop() || raw;
  const ext = raw.includes('/') || raw.includes('.') ? extOf(raw) : raw.toLowerCase();

  if (LANG_EXTS.has(ext)) {
    const id = languageIdFromPath(raw.includes('.') || raw.includes('/') ? raw : `file.${ext}`);
    const meta = languageIconMeta(id);
    return {
      icon: meta.icon,
      color: hot ? 'text-error' : '',
      label: meta.label,
      brandColor: meta.color,
      glyph: meta.glyph,
    };
  }

  if (ext === 'json') {
    return { icon: 'data_object', color: hot ? 'text-error' : 'text-[#cbcb41]', label: 'JSON' };
  }
  if (ext === 'md' || ext === 'markdown') {
    return { icon: 'description', color: hot ? 'text-error' : 'text-secondary', label: 'Markdown' };
  }
  if (ext === 'txt' || ext === 'log') {
    return { icon: 'article', color: 'text-outline', label: 'Text' };
  }
  if (ext === 'toml' || ext === 'yml' || ext === 'yaml') {
    return { icon: 'settings', color: 'text-primary', label: 'Config' };
  }
  return { icon: 'draft', color: 'text-outline', label: 'File' };
}

export function tagClass(tone) {
  if (tone === 'critical' || tone === 'error') {
    return 'bg-error text-white font-bold min-w-[1.1rem] text-center';
  }
  if (tone === 'high') {
    return 'bg-[#e67e22] text-white font-bold min-w-[1.1rem] text-center';
  }
  if (tone === 'medium' || tone === 'secondary') {
    return 'bg-[#d4a017] text-[#1a1400] font-bold min-w-[1.1rem] text-center';
  }
  if (tone === 'low') {
    return 'bg-primary-container/80 text-on-primary-container font-bold min-w-[1.1rem] text-center';
  }
  return 'bg-surface-container-high text-outline';
}
