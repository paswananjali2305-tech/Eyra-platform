/** VS Code–style file/folder icons via Material Symbols + accent colors */

export function extOf(pathOrName) {
  const base = String(pathOrName).split('/').pop() || '';
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function fileIcon(extOrPath, severity = null) {
  const ext = extOrPath.includes('.') || extOrPath.includes('/') ? extOf(extOrPath) : extOrPath;
  const hot = severity === 'critical' || severity === 'high';

  if (ext === 'py') {
    return { icon: 'code', color: hot ? 'text-error' : 'text-[#3776AB]', label: 'Python' };
  }
  if (ext === 'html' || ext === 'htm') {
    return { icon: 'html', color: hot ? 'text-error' : 'text-[#e44d26]', label: 'HTML' };
  }
  if (ext === 'json') {
    return { icon: 'data_object', color: hot ? 'text-error' : 'text-[#cbcb41]', label: 'JSON' };
  }
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs') {
    return { icon: 'javascript', color: 'text-[#f7df1e]', label: 'JavaScript' };
  }
  if (ext === 'ts' || ext === 'tsx') {
    return { icon: 'code_blocks', color: 'text-[#3178c6]', label: 'TypeScript' };
  }
  if (ext === 'css' || ext === 'scss') {
    return { icon: 'css', color: 'text-[#264de4]', label: 'CSS' };
  }
  if (ext === 'md') {
    return { icon: 'description', color: 'text-secondary', label: 'Markdown' };
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
  if (tone === 'error') return 'bg-error-container/40 text-error';
  if (tone === 'secondary') return 'bg-secondary-container/30 text-secondary';
  return 'bg-surface-container-high text-outline';
}
