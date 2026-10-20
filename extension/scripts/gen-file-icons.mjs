/**
 * Embed the same Simple Icons brands + logoColor values the web LanguageLogo uses.
 * Source: web/src/components/ide/LanguageLogo.jsx + web/src/lib/auditLanguages.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const s = require(path.resolve(__dirname, '../../web/node_modules/simple-icons'));

const ICON_KEYS = {
  Python: 'siPython',
  JavaScript: 'siJavascript',
  TypeScript: 'siTypescript',
  Java: 'siOpenjdk',
  C: 'siC',
  'C++': 'siCplusplus',
  Go: 'siGo',
  HTML: 'siHtml5',
  CSS: 'siCss',
  SQL: 'siMysql',
};

const LOGO_COLORS = {
  Python: '#3776AB',
  JavaScript: '#F7DF1E',
  TypeScript: '#3178C6',
  Java: '#ED8B00',
  C: '#A8B9CC',
  'C++': '#00599C',
  Go: '#00ADD8',
  HTML: '#E34F26',
  CSS: '#1572B6',
  SQL: '#336791',
};

const LABELS = {
  Python: 'Python',
  JavaScript: 'JavaScript',
  TypeScript: 'TypeScript',
  Java: 'Java',
  C: 'C',
  'C++': 'C++',
  Go: 'Go',
  HTML: 'HTML',
  CSS: 'CSS',
  SQL: 'SQL',
};

const brands = {};
for (const [id, key] of Object.entries(ICON_KEYS)) {
  brands[id] = {
    id,
    label: LABELS[id],
    logoColor: LOGO_COLORS[id],
    path: s[key].path,
  };
}

const brandsJson = JSON.stringify(brands, null, 2);
const helper = `
export type WebLangLogo = {
  id: string;
  label: string;
  logoColor: string;
  path: string;
};

const BRANDS: Record<string, WebLangLogo> = ${brandsJson};

/** Same EXT_TO_ID as web auditLanguages.js */
const EXT_TO_ID: Record<string, string> = {
  py: 'Python',
  pyi: 'Python',
  js: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  jsx: 'JavaScript',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  java: 'Java',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  hh: 'C++',
  go: 'Go',
  html: 'HTML',
  htm: 'HTML',
  css: 'CSS',
  scss: 'CSS',
  sql: 'SQL',
};

export function fileExtension(fileName: string): string {
  const base = fileName.replace(/\\\\/g, '/').split('/').pop() || fileName;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) {
    return '';
  }
  return base.slice(dot + 1).toLowerCase();
}

/** Match web language mapping; unknown types return null (generic file icon). */
export function languageIdFromFileName(fileName: string): string | null {
  const ext = fileExtension(fileName);
  return ext ? EXT_TO_ID[ext] ?? null : null;
}

export function brandForFileName(fileName: string): WebLangLogo | null {
  const id = languageIdFromFileName(fileName);
  return id ? BRANDS[id] ?? null : null;
}

/**
 * Same SVG as web LanguageLogo:
 * <svg viewBox="0 0 24 24"><path d={brand.path} fill={lang.logoColor} /></svg>
 */
export function fileTypeLogoSvg(fileName: string, size = 16): string | null {
  const brand = brandForFileName(fileName);
  if (!brand) {
    return null;
  }
  const label = brand.label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return (
    '<svg role="img" aria-label="' + label + '" viewBox="0 0 24 24" width="' + size +
    '" height="' + size + '" xmlns="http://www.w3.org/2000/svg" style="display:block">' +
    '<title>' + label + '</title>' +
    '<path d="' + brand.path + '" fill="' + brand.logoColor + '"/>' +
    '</svg>'
  );
}
`;

const header = `/** Same language logos as the web LanguageLogo (Simple Icons + auditLanguages logoColor). */
`;

// In the helper template above, /\\\\/g in a normal string becomes /\\/g in output — correct for TS.
const target = path.resolve(__dirname, '../src/fileTypeIcon.ts');
fs.writeFileSync(target, header + helper, 'utf8');
console.log('wrote', target);
console.log('languages', Object.keys(brands).join(', '));
