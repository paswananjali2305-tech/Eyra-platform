import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export class SandboxService {
  constructor(baseSandboxDir = './sandbox_uploads') {
    this.baseSandboxDir = path.resolve(baseSandboxDir);
    if (!fs.existsSync(this.baseSandboxDir)) {
      fs.mkdirSync(this.baseSandboxDir, { recursive: true });
    }
  }

  /**
   * Safely unpacks a zip file into an isolated sandbox folder.
   * Enforces strict Zip-Slip and path traversal mitigation.
   */
  extractZipSafely(zipFilePath, scanId) {
    const targetDir = path.join(this.baseSandboxDir, scanId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const zip = new AdmZip(zipFilePath);
    const zipEntries = zip.getEntries();

    for (const entry of zipEntries) {
      // Normalize entry path and sanitize
      const entryName = entry.entryName.replace(/\\/g, '/');
      const resolvedTarget = path.resolve(targetDir, entryName);

      // ZIP-SLIP DEFENSE: ensure extracted path remains inside targetDir
      if (!resolvedTarget.startsWith(targetDir)) {
        throw new Error(`Security Exception: Zip-Slip path traversal detected in entry: ${entry.entryName}`);
      }

      if (entry.isDirectory) {
        fs.mkdirSync(resolvedTarget, { recursive: true });
      } else {
        const parentDir = path.dirname(resolvedTarget);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        // Write file safely
        fs.writeFileSync(resolvedTarget, entry.getData());
      }
    }

    return targetDir;
  }

  /**
   * Cleanup sandbox directory after scan or on request
   */
  cleanup(scanId) {
    const targetDir = path.join(this.baseSandboxDir, scanId);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  }
}

export const sandboxService = new SandboxService();
