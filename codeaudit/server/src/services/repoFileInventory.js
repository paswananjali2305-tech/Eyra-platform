import fs from 'fs';
import path from 'path';

/** Dependency / VCS / cache folders — never listed in the Code Audit explorer. */
export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.idea',
  '.vscode',
  'vendor',
  'target',
  'out',
]);

/** Dotfiles / OS junk that confuse the tree without aiding audit. */
export const SKIP_FILES = new Set([
  '.gitignore',
  '.gitattributes',
  '.gitmodules',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
]);

/** Compiled / native junk only — media (jpg/mp3/ico) stay listed as stubs so the tree matches GitHub. */
export const SKIP_EXTS = new Set([
  '.pyc',
  '.pyo',
  '.class',
  '.o',
  '.obj',
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.bin',
  '.wasm',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
]);

/** Known binary/media extensions — listed in explorer with a stub body (not loaded as text). */
export const BINARY_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.svg',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.mp3',
  '.mp4',
  '.webm',
  '.wav',
  '.ogg',
  '.flac',
  '.mov',
  '.avi',
]);

const MAX_TEXT_BYTES = 1_500_000;

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Walk an extracted sandbox and build explorer fileContents.
 * Always lists text (and stub) paths so the UI matches the uploaded/cloned tree.
 *
 * @param {string} rootDir
 * @returns {{ fileContents: Record<string, string>, fileInventory: { listed: number, skippedNoise: number, binaryOrUnreadable: number } }}
 */
export function collectRepoFiles(rootDir) {
  const fileContents = {};
  const fileInventory = { listed: 0, skippedNoise: 0, binaryOrUnreadable: 0 };

  if (!rootDir || !fs.existsSync(rootDir)) {
    return { fileContents, fileInventory };
  }

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          fileInventory.skippedNoise += 1;
          continue;
        }
        walk(path.join(dir, entry.name));
        continue;
      }
      if (SKIP_FILES.has(entry.name)) {
        fileInventory.skippedNoise += 1;
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (SKIP_EXTS.has(ext)) {
        fileInventory.skippedNoise += 1;
        continue;
      }
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full).replace(/\\/g, '/');
      try {
        // Media / known binaries: stub only (still appear in explorer like on GitHub)
        if (BINARY_EXTS.has(ext)) {
          let size = 0;
          try {
            size = fs.statSync(full).size;
          } catch {
            /* ignore */
          }
          fileInventory.listed += 1;
          fileInventory.binaryOrUnreadable += 1;
          fileContents[rel] =
            `// [media/binary — ${size} bytes; listed in explorer, content not loaded]\n`;
          continue;
        }
        const buf = fs.readFileSync(full);
        fileInventory.listed += 1;
        if (looksBinary(buf)) {
          fileInventory.binaryOrUnreadable += 1;
          fileContents[rel] =
            `// [binary file — ${buf.length} bytes; listed in explorer, content not loaded]\n`;
        } else {
          const text = buf.toString('utf8');
          fileContents[rel] =
            text.length > MAX_TEXT_BYTES
              ? `${text.slice(0, MAX_TEXT_BYTES)}\n\n// [truncated — file exceeds ${MAX_TEXT_BYTES} bytes]\n`
              : text;
        }
      } catch {
        fileInventory.listed += 1;
        fileInventory.binaryOrUnreadable += 1;
        fileContents[rel] = '// [unreadable file — listed in explorer]\n';
      }
    }
  }

  walk(rootDir);
  return { fileContents, fileInventory };
}
