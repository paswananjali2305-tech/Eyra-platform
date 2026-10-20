import fs from 'fs';
import path from 'path';
import { collectRepoFiles } from './repoFileInventory.js';

export class ScanStorage {
  constructor(storageFile = './data/scans.json') {
    this.storageFile = path.resolve(storageFile);
    this.scans = new Map();
    this.init();
  }

  init() {
    const dir = path.dirname(this.storageFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(this.storageFile)) {
      try {
        const raw = fs.readFileSync(this.storageFile, 'utf8').replace(/^\uFEFF/, '');
        const data = JSON.parse(raw);
        for (const scan of data) {
          this.scans.set(scan.id, scan);
        }
      } catch (e) {
        console.error('Failed reading scans storage file:', e);
      }
    }
  }

  /**
   * Persist scan metadata without embedding full fileContents (can be MBs per repo).
   * Explorer bodies are rebuilt from extractedDir on read.
   */
  save() {
    try {
      const data = Array.from(this.scans.values()).map((scan) => {
        const { fileContents, ...rest } = scan;
        const listed =
          rest.fileInventory?.listed ??
          (fileContents && typeof fileContents === 'object'
            ? Object.keys(fileContents).length
            : undefined);
        return {
          ...rest,
          // Tiny marker so clients know contents are live-hydrated from sandbox
          fileContentsPersisted: false,
          ...(listed != null
            ? {
                fileInventory: {
                  listed,
                  skippedNoise: rest.fileInventory?.skippedNoise ?? 0,
                  binaryOrUnreadable: rest.fileInventory?.binaryOrUnreadable ?? 0,
                },
              }
            : {}),
        };
      });
      fs.writeFileSync(this.storageFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed writing scans storage file:', e);
    }
  }

  /**
   * Attach explorer fileContents from the sandbox on disk (source of truth).
   * @param {object|null} scan
   */
  hydrateFileContents(scan) {
    if (!scan) return null;
    const dir = scan.extractedDir;
    if (!dir || !fs.existsSync(dir)) {
      return scan;
    }
    try {
      const { fileContents, fileInventory } = collectRepoFiles(dir);
      return {
        ...scan,
        fileContents,
        fileInventory,
        meta: {
          ...(scan.meta || {}),
          totalFilesCount: fileInventory.listed || scan.meta?.totalFilesCount || 0,
          excludedFilesCount: fileInventory.skippedNoise,
          unreadableFileCount: fileInventory.binaryOrUnreadable,
        },
      };
    } catch (e) {
      console.error('Failed hydrating fileContents from sandbox:', e);
      return scan;
    }
  }

  createScan(scan) {
    this.scans.set(scan.id, scan);
    this.save();
    return scan;
  }

  updateScan(id, updates) {
    const existing = this.scans.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.scans.set(id, updated);
    this.save();
    return updated;
  }

  /**
   * Append a real audit-daemon log line (stage / finding / CVE message).
   * Dedupes consecutive identical tag+text; keeps the last 120 entries.
   */
  appendLog(id, entry = {}) {
    const existing = this.scans.get(id);
    if (!existing) return null;
    const text = String(entry.text || '').trim();
    if (!text) return existing;
    const tag = entry.tag ? String(entry.tag).toUpperCase() : null;
    const logs = Array.isArray(existing.logs) ? existing.logs : [];
    const last = logs[logs.length - 1];
    if (last && last.text === text && (last.tag || null) === tag) {
      return existing;
    }
    const next = {
      ts: entry.ts || new Date().toISOString(),
      text,
      tag,
      level: entry.level || 'info',
      status: entry.status || existing.status || null,
      elapsed: entry.elapsed || null,
    };
    const updated = {
      ...existing,
      logs: [...logs, next].slice(-120),
      updatedAt: new Date().toISOString(),
    };
    this.scans.set(id, updated);
    this.save();
    return updated;
  }

  /**
   * @param {string} id
   * @param {{ hydrate?: boolean }} [opts] hydrate=true rebuilds explorer fileContents from sandbox (API reads)
   */
  getScan(id, { hydrate = false } = {}) {
    const scan = this.scans.get(id) || null;
    if (!hydrate) return scan;
    return this.hydrateFileContents(scan);
  }

  getAllScans() {
    return Array.from(this.scans.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Legacy scans have no ownerUserId. They stay on disk and are not listed,
   * readable, or clearable by any user. They are never assigned to the first caller.
   */
  listForUser(userId) {
    if (!userId) return [];
    return this.getAllScans().filter((scan) => scan.ownerUserId && scan.ownerUserId === userId);
  }

  getOwnedScan(id, userId, opts = {}) {
    const scan = this.getScan(id, opts);
    if (!scan || !userId || !scan.ownerUserId || scan.ownerUserId !== userId) return null;
    return scan;
  }

  /** Delete only this user's scans. Legacy and other owners are left in place. */
  clearForUser(userId) {
    if (!userId) return 0;
    let n = 0;
    for (const scan of this.getAllScans()) {
      if (scan.ownerUserId === userId) {
        this.scans.delete(scan.id);
        n += 1;
      }
    }
    if (n) this.save();
    return n;
  }

  deleteScan(id) {
    const res = this.scans.delete(id);
    this.save();
    return res;
  }

  /** Wipe every scan. Not used by the user-facing Clear Stale Cache action. */
  clearAll() {
    const n = this.scans.size;
    this.scans.clear();
    this.save();
    return n;
  }
}

export const scanStorage = new ScanStorage();
