import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { sandboxService } from '../services/sandbox.js';
import { detectCodebaseMeta } from '../services/languageDetector.js';
import { scanStorage } from '../services/storage.js';
import { cloneGithubRepo } from '../services/githubClone.js';
import { collectRepoFiles } from '../services/repoFileInventory.js';

const router = express.Router();

const uploadDir = path.resolve('./temp_uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const MAX_ZIP_BYTES = 50 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_ZIP_BYTES },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.zip') {
      const err = new Error('Only .zip files are supported');
      err.code = 'INVALID_FILE_TYPE';
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

function mapUploadError(err) {
  if (!err) return null;
  if (err.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, error: 'ZIP exceeds 50 MB upload limit' };
  }
  if (err.code === 'INVALID_FILE_TYPE' || /only \.zip/i.test(err.message || '')) {
    return { status: 400, error: 'Only .zip files are supported' };
  }
  if (err instanceof multer.MulterError) {
    return { status: 400, error: err.message || 'Invalid upload' };
  }
  if (err.status && err.status >= 400 && err.status < 500) {
    return { status: err.status, error: err.message || 'Bad request' };
  }
  return null;
}

/** Multer only for multipart ZIP uploads — never for JSON GitHub clone bodies. */
function runUpload(req, res, next) {
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('application/json')) {
    return next();
  }
  upload.single('codebase')(req, res, (err) => {
    const mapped = mapUploadError(err);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.error });
    }
    if (err) return next(err);
    return next();
  });
}

/**
 * Upload a .zip OR shallow-clone a public GitHub repo.
 * Built-in sample projects (NovaPay / PyCrypto) are removed — no mock ingest.
 */
router.post('/upload', runUpload, async (req, res) => {
  let uploadedPath = null;
  let scanId = null;
  try {
    scanId = uuidv4();
    let zipPath = null;
    let projectName = 'Uploaded Codebase';
    let extractedDir = null;
    let sourceType = 'zip';
    let repoMeta = null;

    if (req.body?.sampleId) {
      return res.status(410).json({
        error:
          'Built-in sample projects were removed. Upload a ZIP or paste a public GitHub URL (Configure & Index).',
      });
    }

    if (req.file) {
      zipPath = req.file.path;
      uploadedPath = req.file.path;
      projectName = req.file.originalname.replace(/\.zip$/i, '');
      sourceType = 'zip';
    } else if (req.body?.repoUrl) {
      sourceType = 'github';
      const targetDir = path.join(sandboxService.baseSandboxDir, scanId);
      try {
        repoMeta = await cloneGithubRepo(req.body.repoUrl, req.body.branch, targetDir);
        extractedDir = repoMeta.extractedDir;
        projectName = repoMeta.projectName;
      } catch (cloneErr) {
        const msg = cloneErr?.message || 'GitHub clone failed';
        return res.status(400).json({ error: msg.slice(0, 300) });
      }
    } else {
      return res.status(400).json({
        error: 'No .zip file or GitHub URL provided (samples are disabled)',
      });
    }

    if (!extractedDir) {
      if (!zipPath || !fs.existsSync(zipPath)) {
        return res.status(404).json({ error: 'Zip archive file not found' });
      }
      try {
        extractedDir = sandboxService.extractZipSafely(zipPath, scanId);
      } catch (extractErr) {
        const msg = extractErr?.message || 'Invalid or corrupted ZIP archive';
        if (/zip-slip|path traversal|invalid|corrupt|adm-zip|end of central/i.test(msg)) {
          return res.status(400).json({ error: `Invalid ZIP archive: ${msg}` });
        }
        return res.status(400).json({ error: `Unable to extract ZIP: ${msg}` });
      }
    }

    const { fileInventory } = collectRepoFiles(extractedDir);
    const detected = detectCodebaseMeta(extractedDir);
    const meta = {
      ...detected,
      totalFilesCount: fileInventory.listed || detected.totalFilesCount || 0,
      excludedFilesCount: fileInventory.skippedNoise,
      unreadableFileCount: fileInventory.binaryOrUnreadable,
      sourceType,
      ...(repoMeta
        ? {
            repoUrl: repoMeta.httpsUrl,
            branch: repoMeta.branch || req.body?.branch || null,
            owner: repoMeta.owner,
            repo: repoMeta.repo,
          }
        : {}),
    };

    const ingestStage =
      sourceType === 'github' ? 'Cloned repository' : 'Unpacking archive';
    const createdAt = new Date().toISOString();
    const newScan = {
      id: scanId,
      projectName,
      status: 'pending',
      progress: 0,
      currentStage: ingestStage,
      createdAt,
      meta,
      extractedDir,
      sourceType,
      fileInventory,
      logs: [
        {
          ts: createdAt,
          tag: 'INIT',
          text: `${ingestStage} · ${fileInventory.listed} files`,
          level: 'info',
          status: 'pending',
          elapsed: '00:00.00',
        },
      ],
      summary: {
        healthScore: 0,
        grade: 'Pending',
        totalFiles: meta.totalFilesCount,
        totalLoc: 0,
        totalIssues: 0,
        severity: { Critical: 0, High: 0, Medium: 0, Low: 0 },
        issueTypes: {},
      },
      issues: [],
      partialFeatures: [],
      dependencies: [],
      files: [],
    };

    scanStorage.createScan(newScan);

    if (uploadedPath && fs.existsSync(uploadedPath)) {
      try {
        fs.unlinkSync(uploadedPath);
      } catch {
        /* ignore */
      }
    }

    res.json({
      success: true,
      scanId,
      projectName,
      meta,
      sourceType,
      fileInventory,
      message:
        sourceType === 'github'
          ? `GitHub repository cloned — ${fileInventory.listed} files indexed for explorer`
          : `Codebase ingested — ${fileInventory.listed} files indexed for explorer`,
    });
  } catch (error) {
    console.error('Upload processing error:', error);
    if (uploadedPath && fs.existsSync(uploadedPath)) {
      try {
        fs.unlinkSync(uploadedPath);
      } catch {
        /* ignore */
      }
    }
    if (scanId) {
      try {
        sandboxService.cleanup(scanId);
      } catch {
        /* ignore */
      }
    }
    const safe = error?.message || 'Internal extraction failure';
    res.status(500).json({ error: safe.split('\n')[0].slice(0, 300) });
  }
});

export default router;
