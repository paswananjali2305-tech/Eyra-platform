import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Normalize owner/repo or github.com URL → https://github.com/owner/repo.git
 * @param {string} raw
 */
export function normalizeGithubUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('Repository URL is required');
  s = s.replace(/^git\+/, '');
  s = s.replace(/\.git$/i, '');
  s = s.replace(/\/$/, '');
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
  s = s.replace(/^github\.com\//i, '');
  s = s.replace(/^git@github\.com:/i, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('Enter a valid GitHub URL (https://github.com/org/repo)');
  }
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    throw new Error('Invalid GitHub owner or repository name');
  }
  return {
    httpsUrl: `https://github.com/${owner}/${repo}.git`,
    projectName: repo,
    owner,
    repo,
  };
}

/**
 * Safe branch name for git CLI.
 * @param {string|undefined} branch
 */
export function sanitizeBranch(branch) {
  const b = String(branch || '').trim();
  if (!b) return null;
  if (!/^[A-Za-z0-9._\-\/]+$/.test(b) || b.includes('..')) {
    throw new Error('Invalid branch name');
  }
  return b;
}

/**
 * Shallow-clone a public GitHub repo into targetDir (must not exist or be empty).
 * @param {string} repoUrl
 * @param {string|undefined} branch
 * @param {string} targetDir
 */
export async function cloneGithubRepo(repoUrl, branch, targetDir) {
  const { httpsUrl, projectName, owner, repo } = normalizeGithubUrl(repoUrl);
  const br = sanitizeBranch(branch);

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });

  const baseArgs = ['clone', '--depth', '1', '--single-branch'];
  const attempts = br
    ? [
        [...baseArgs, '--branch', br, httpsUrl, targetDir],
        [...baseArgs, httpsUrl, targetDir],
      ]
    : [[...baseArgs, httpsUrl, targetDir]];

  let lastErr = null;
  for (const args of attempts) {
    try {
      await execFileAsync('git', args, {
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      if (!fs.existsSync(targetDir)) {
        throw new Error('Clone finished but target directory is missing');
      }
      return {
        extractedDir: targetDir,
        projectName,
        owner,
        repo,
        branch: br || null,
        httpsUrl,
      };
    } catch (err) {
      lastErr = err;
      if (fs.existsSync(targetDir)) {
        try {
          fs.rmSync(targetDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
      const msg = String(err?.stderr || err?.message || err);
      // Retry without branch only when branch-specific clone failed
      if (br && /Remote branch|not found|could not find remote/i.test(msg)) {
        continue;
      }
      break;
    }
  }

  const detail = String(lastErr?.stderr || lastErr?.message || 'git clone failed')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
  if (/not recognized|ENOENT|spawn git/i.test(detail)) {
    throw new Error('Git is not installed or not on PATH — required for GitHub ingest');
  }
  if (/Authentication failed|could not read Username|403|401/i.test(detail)) {
    throw new Error('Repository is private or requires auth — only public repos are supported');
  }
  if (/not found|Repository not found|404/i.test(detail)) {
    throw new Error('Repository not found — check the URL (public repos only)');
  }
  throw new Error(detail.slice(0, 280) || 'GitHub clone failed');
}
