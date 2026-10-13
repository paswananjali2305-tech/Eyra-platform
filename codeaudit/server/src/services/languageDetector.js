import fs from 'fs';
import path from 'path';

export function detectCodebaseMeta(extractedDir) {
  const languages = new Set();
  const frameworks = new Set();
  let primaryLanguage = 'Unknown';
  let hasTests = false;
  let packageManager = 'None';
  let totalFilesCount = 0;

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if ([
        'node_modules', '.git', '__pycache__', 'dist', 'build', '.venv', 'venv',
        'coverage', '.next', '.nuxt', '.turbo', '.cache', '.mypy_cache', '.pytest_cache',
        '.ruff_cache', '.idea', '.vscode', 'vendor', 'target', 'out',
      ].includes(entry.name)) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        totalFilesCount++;
        const ext = path.extname(entry.name).toLowerCase();
        const baseName = entry.name.toLowerCase();

        if (['.js', '.mjs', '.cjs'].includes(ext)) languages.add('JavaScript');
        if (['.ts', '.tsx'].includes(ext)) languages.add('TypeScript');
        if (['.jsx'].includes(ext)) {
          languages.add('JavaScript');
          frameworks.add('React');
        }
        if (ext === '.py') languages.add('Python');
        if (['.java', '.kt'].includes(ext)) languages.add('Java');
        if (ext === '.go') languages.add('Go');
        if (ext === '.rs') languages.add('Rust');
        if (ext === '.rb') languages.add('Ruby');
        if (ext === '.php') languages.add('PHP');

        if (baseName.includes('test') || baseName.includes('spec')) {
          hasTests = true;
        }

        // Framework manifests
        if (baseName === 'package.json') {
          packageManager = 'npm/yarn/pnpm';
          try {
            const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            if (allDeps.react) frameworks.add('React');
            if (allDeps.next) frameworks.add('Next.js');
            if (allDeps.express) frameworks.add('Express');
            if (allDeps.vue) frameworks.add('Vue');
            if (allDeps['@nestjs/core']) frameworks.add('NestJS');
            if (allDeps.jest || allDeps.vitest || allDeps.mocha) hasTests = true;
          } catch (e) {}
        }

        if (['requirements.txt', 'pyproject.toml', 'pipfile'].includes(baseName)) {
          packageManager = 'pip/poetry';
          languages.add('Python');
          try {
            const reqs = fs.readFileSync(fullPath, 'utf8').toLowerCase();
            if (reqs.includes('django')) frameworks.add('Django');
            if (reqs.includes('flask')) frameworks.add('Flask');
            if (reqs.includes('fastapi')) frameworks.add('FastAPI');
            if (reqs.includes('pytest')) hasTests = true;
          } catch (e) {}
        }
      }
    }
  }

  if (fs.existsSync(extractedDir)) {
    walk(extractedDir);
  }

  const langList = Array.from(languages);
  if (langList.includes('TypeScript')) primaryLanguage = 'TypeScript';
  else if (langList.includes('JavaScript')) primaryLanguage = 'JavaScript';
  else if (langList.includes('Python')) primaryLanguage = 'Python';
  else if (langList.length > 0) primaryLanguage = langList[0];

  return {
    primaryLanguage,
    languages: langList,
    frameworks: Array.from(frameworks),
    hasTests,
    packageManager,
    totalFilesCount
  };
}
