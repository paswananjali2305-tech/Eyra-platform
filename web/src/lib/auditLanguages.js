/**
 * Shared multi-language catalog for Runtime Debugging + Code Audit.
 * Logos: brand color + glyph for editor chrome / pickers.
 */

/** @typedef {{ id: string, label: string, syntax: string, features: string, extensions: string, ext: string, core?: boolean, logoColor: string, logoGlyph: string, template: string }} AuditLanguage */

/** @type {AuditLanguage[]} */
export const AUDIT_LANGUAGES = [
  {
    id: 'Python',
    label: 'Python',
    syntax: 'CPython 3.x · indent blocks · type hints',
    features: 'AST, CVE (pip/poetry), TODOs, AI pass',
    extensions: '.py, .pyi',
    ext: 'py',
    core: true,
    logoColor: '#3776AB',
    logoGlyph: 'Py',
    template: `# Scratch file — edit freely, then Save (Ctrl+S)

def main():
    """Entry point."""
    print("hello from EYRA")


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'JavaScript',
    label: 'JavaScript',
    syntax: 'ES modules · CommonJS · JSX-friendly',
    features: 'AST, CVE (npm/yarn), TODOs, AI pass',
    extensions: '.js, .mjs, .cjs, .jsx',
    ext: 'js',
    core: true,
    logoColor: '#F7DF1E',
    logoGlyph: 'JS',
    template: `// Scratch file — edit freely, then Save (Ctrl+S)

function main() {
  console.log('hello from EYRA');
}

main();
`,
  },
  {
    id: 'TypeScript',
    label: 'TypeScript',
    syntax: 'Typed JS · interfaces · TSX',
    features: 'AST, CVE (npm), TODOs, AI pass',
    extensions: '.ts, .tsx',
    ext: 'ts',
    core: true,
    logoColor: '#3178C6',
    logoGlyph: 'TS',
    template: `// Scratch file — edit freely, then Save (Ctrl+S)

function main(): void {
  console.log('hello from EYRA');
}

main();
`,
  },
  {
    id: 'Java',
    label: 'Java',
    syntax: 'JVM · packages · annotations',
    features: 'AST, CVE (Maven/Gradle), TODOs, AI pass',
    extensions: '.java',
    ext: 'java',
    core: true,
    logoColor: '#ED8B00',
    logoGlyph: 'Jv',
    template: `// Scratch file — edit freely, then Save (Ctrl+S)

public class Main {
  public static void main(String[] args) {
    System.out.println("hello from EYRA");
  }
}
`,
  },
  {
    id: 'C',
    label: 'C',
    syntax: 'ISO C · pointers · headers',
    features: 'AST, TODOs, AI pass',
    extensions: '.c, .h',
    ext: 'c',
    core: true,
    logoColor: '#A8B9CC',
    logoGlyph: 'C',
    template: `/* Scratch file — edit freely, then Save (Ctrl+S) */
#include <stdio.h>

int main(void) {
  printf("hello from EYRA\\n");
  return 0;
}
`,
  },
  {
    id: 'C++',
    label: 'C++',
    syntax: 'ISO C++ · STL · classes',
    features: 'AST, TODOs, AI pass',
    extensions: '.cpp, .cc, .cxx, .hpp, .hh',
    ext: 'cpp',
    core: true,
    logoColor: '#00599C',
    logoGlyph: 'C+',
    template: `// Scratch file — edit freely, then Save (Ctrl+S)
#include <iostream>

int main() {
  std::cout << "hello from EYRA\\n";
  return 0;
}
`,
  },
  {
    id: 'Go',
    label: 'Go',
    syntax: 'goroutines · packages · interfaces',
    features: 'AST, CVE (go.mod), TODOs',
    extensions: '.go',
    ext: 'go',
    core: true,
    logoColor: '#00ADD8',
    logoGlyph: 'Go',
    template: `// Scratch file — edit freely, then Save (Ctrl+S)

package main

import "fmt"

func main() {
	fmt.Println("hello from EYRA")
}
`,
  },
  {
    id: 'HTML',
    label: 'HTML',
    syntax: 'Markup · semantic tags · forms',
    features: 'Markup audit, TODOs, AI pass',
    extensions: '.html, .htm',
    ext: 'html',
    core: true,
    logoColor: '#E34F26',
    logoGlyph: '<>',
    template: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>EYRA Scratch</title>
  </head>
  <body>
    <h1>hello from EYRA</h1>
  </body>
</html>
`,
  },
  {
    id: 'CSS',
    label: 'CSS',
    syntax: 'Selectors · flex/grid · variables',
    features: 'Style audit, TODOs, AI pass',
    extensions: '.css, .scss',
    ext: 'css',
    core: true,
    logoColor: '#1572B6',
    logoGlyph: '#',
    template: `/* Scratch file — edit freely, then Save (Ctrl+S) */

:root {
  --accent: #35d6f2;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  color: #dee2f2;
  background: #0f1117;
}
`,
  },
  {
    id: 'SQL',
    label: 'SQL',
    syntax: 'Queries · DDL · joins',
    features: 'Query review, TODOs, AI pass',
    extensions: '.sql',
    ext: 'sql',
    core: true,
    logoColor: '#336791',
    logoGlyph: 'SQL',
    template: `-- Scratch file — edit freely, then Save (Ctrl+S)

SELECT id, name
FROM users
WHERE active = 1
ORDER BY name;
`,
  },
];

const EXT_TO_ID = {
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

/** Map catalog id → Brain / execute language token. */
export function apiLanguageFromId(langId) {
  const map = {
    Python: 'python',
    JavaScript: 'javascript',
    TypeScript: 'typescript',
    Java: 'java',
    C: 'c',
    'C++': 'cpp',
    Go: 'go',
    HTML: 'html',
    CSS: 'css',
    SQL: 'sql',
  };
  return map[langId] || languageById(langId).label.toLowerCase().split(/\s+/)[0] || 'python';
}

/** @param {string} id */
export function languageById(id) {
  return AUDIT_LANGUAGES.find((l) => l.id === id) || AUDIT_LANGUAGES[0];
}

/** @param {string} path */
export function languageIdFromPath(path) {
  const raw = String(path || '');
  const base = raw.split('/').pop() || '';
  const ext = base.includes('.')
    ? base.slice(base.lastIndexOf('.') + 1).toLowerCase()
    : '';
  return EXT_TO_ID[ext] || 'JavaScript';
}

/** @param {string} path */
export function languageLabelFromPath(path) {
  return languageById(languageIdFromPath(path)).label;
}

/** Human label for editor / tree. */
export function editorLanguageLabel(path, overrideId) {
  if (overrideId) return languageById(overrideId).label;
  return languageLabelFromPath(path);
}

/**
 * Icon metadata for tabs / explorer (Material Symbol + brand color).
 * @param {string} langIdOrPath
 */
export function languageIconMeta(langIdOrPath) {
  const asId = AUDIT_LANGUAGES.some((l) => l.id === langIdOrPath)
    ? langIdOrPath
    : languageIdFromPath(langIdOrPath);
  const lang = languageById(asId);
  const iconById = {
    Python: 'code',
    JavaScript: 'javascript',
    TypeScript: 'code_blocks',
    Java: 'coffee',
    C: 'memory',
    'C++': 'memory',
    Go: 'bolt',
    HTML: 'html',
    CSS: 'css',
    SQL: 'database',
  };
  return {
    id: lang.id,
    label: lang.label,
    icon: iconById[lang.id] || 'draft',
    color: lang.logoColor,
    glyph: lang.logoGlyph,
  };
}
