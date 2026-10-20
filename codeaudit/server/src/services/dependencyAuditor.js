/**
 * Offline advisory matcher (NOT live OSV.dev / GitHub Advisory API).
 * Matches package name + version against documented affected ranges when possible.
 */
import fs from 'fs';
import path from 'path';

// Offline curated advisories — source labeled on every finding
const KNOWN_CVES = [
  {
    package: 'lodash',
    ecosystem: 'npm',
    vulnerableVersions: '<4.17.21',
    cve: 'CVE-2020-8203',
    severity: 'High',
    cvss: 7.4,
    title: 'Prototype Pollution in lodash.zipObjectDeep',
    patchedVersion: '4.17.21',
    advisoryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2020-8203',
  },
  {
    package: 'axios',
    ecosystem: 'npm',
    vulnerableVersions: '<0.21.2',
    cve: 'CVE-2021-3749',
    severity: 'High',
    cvss: 7.5,
    title: 'Regular Expression Denial of Service (ReDoS) in trim method',
    patchedVersion: '0.21.4',
    advisoryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2021-3749',
  },
  {
    package: 'jsonwebtoken',
    ecosystem: 'npm',
    vulnerableVersions: '<9.0.0',
    cve: 'CVE-2022-23529',
    severity: 'Critical',
    cvss: 9.8,
    title: 'Insecure Key Retrieval in verify() leading to Remote Code Execution',
    patchedVersion: '9.0.0',
    advisoryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2022-23529',
  },
  {
    package: 'express',
    ecosystem: 'npm',
    vulnerableVersions: '<4.19.2',
    cve: 'CVE-2024-29041',
    severity: 'Medium',
    cvss: 6.5,
    title: 'Open Redirect vulnerability in res.location() & res.redirect()',
    patchedVersion: '4.19.2',
    advisoryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-29041',
  },
  {
    package: 'requests',
    ecosystem: 'pypi',
    vulnerableVersions: '<2.31.0',
    cve: 'CVE-2023-32681',
    severity: 'Medium',
    cvss: 6.1,
    title: 'Proxy-Authorization header leak on redirect to HTTP destination',
    patchedVersion: '2.31.0',
    advisoryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-32681',
  },
  {
    package: 'urllib3',
    ecosystem: 'pypi',
    vulnerableVersions: '<1.26.18',
    cve: 'CVE-2023-45803',
    severity: 'High',
    cvss: 8.1,
    title: 'Request body not stripped on redirect',
    patchedVersion: '1.26.18',
    advisoryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-45803',
  },
  {
    package: 'cryptography',
    ecosystem: 'pypi',
    vulnerableVersions: '<42.0.4',
    cve: 'CVE-2024-26130',
    severity: 'High',
    cvss: 7.5,
    title: 'Null pointer dereference with pkcs12.serialize_key_and_certificates',
    patchedVersion: '42.0.4',
    advisoryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-26130',
  },
];

const ADVISORY_SOURCE = 'eyra-offline-known-cves';

/** Parse "1.2.3" / "1.2" → [1,2,3] */
export function parseVersion(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || /^latest$/i.test(s) || s === '*') return null;
  const cleaned = s.replace(/^[=v]+/i, '').replace(/[\^~>=<]*/g, '');
  const m = cleaned.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

export function cmpVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Evaluate simple range specs used in KNOWN_CVES: "<1.2.3", "<=1.2.3", ">=1.0.0 <2.0.0"
 */
export function versionMatchesRange(versionStr, rangeStr) {
  const ver = parseVersion(versionStr);
  if (!ver) return { matched: false, reason: 'unknown_version' };
  const range = String(rangeStr || '').trim();
  if (!range) return { matched: false, reason: 'no_range' };

  const parts = range.split(/\s+/).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(<|<=|>|>=|=)?\s*v?(\d+(?:\.\d+){0,2})$/i);
    if (!m) continue;
    const op = m[1] || '=';
    const bound = parseVersion(m[2]);
    if (!bound) continue;
    const c = cmpVersion(ver, bound);
    if (op === '<' && !(c < 0)) return { matched: false, reason: 'outside_range' };
    if (op === '<=' && !(c <= 0)) return { matched: false, reason: 'outside_range' };
    if (op === '>' && !(c > 0)) return { matched: false, reason: 'outside_range' };
    if (op === '>=' && !(c >= 0)) return { matched: false, reason: 'outside_range' };
    if (op === '=' && c !== 0) return { matched: false, reason: 'outside_range' };
  }
  return { matched: true, reason: 'in_range' };
}

function makeFinding(depName, verStr, cleanVer, match, { uncertain = false } = {}) {
  return {
    id: `DEP-${match.cve}`,
    package: depName,
    installedVersion: verStr,
    currentCleanVersion: cleanVer || '',
    ecosystem: match.ecosystem,
    cve: match.cve,
    severity: uncertain ? 'Medium' : match.severity,
    cvss: match.cvss,
    title: match.title,
    patchedVersion: match.patchedVersion,
    advisoryUrl: match.advisoryUrl,
    advisorySource: ADVISORY_SOURCE,
    advisorySourceNote:
      'Matched against EYRA offline curated CVE list — not a live OSV.dev or GitHub Advisory API query.',
    versionMatch: uncertain ? 'unknown' : 'affected',
    confidence: uncertain ? 0.45 : 0.9,
    type: 'Dependency',
    sourceTool: 'dependency-auditor',
    ruleId: match.cve,
    file: match.ecosystem === 'npm' ? 'package.json' : 'requirements.txt',
    line: 1,
    description: uncertain
      ? `Package '${depName}' appears in the offline advisory list (${match.cve}) but the installed version could not be resolved; vulnerability is unconfirmed.`
      : `Installed version of '${depName}' matches offline advisory range '${match.vulnerableVersions}' (${match.cve}).`,
  };
}

/**
 * @returns {{ findings: object[], toolStatus: object }}
 */
export function auditDependencies(extractedDir) {
  const findings = [];
  const manifests = { packageJson: false, requirementsTxt: false };
  let packagesChecked = 0;
  let skippedUnaffected = 0;
  let unknownVersionHits = 0;
  let unmatchedPackages = 0;

  const pkgJsonPath = path.join(extractedDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    manifests.packageJson = true;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const [depName, verStr] of Object.entries(deps)) {
        packagesChecked += 1;
        const cleanVer = String(verStr || '').replace(/[\^~>=<]/g, '').trim();
        const match = KNOWN_CVES.find(
          (c) => c.ecosystem === 'npm' && c.package.toLowerCase() === depName.toLowerCase(),
        );
        if (!match) {
          unmatchedPackages += 1;
          continue;
        }
        const parsed = parseVersion(cleanVer);
        if (!parsed) {
          unknownVersionHits += 1;
          findings.push(makeFinding(depName, verStr, cleanVer, match, { uncertain: true }));
          continue;
        }
        const { matched } = versionMatchesRange(cleanVer, match.vulnerableVersions);
        if (matched) findings.push(makeFinding(depName, verStr, cleanVer, match));
        else skippedUnaffected += 1;
      }
    } catch (e) {
      return {
        findings: [],
        toolStatus: {
          status: 'FAILED',
          checkStatus: 'analyzer_failed',
          message: `Failed to parse package.json: ${e.message}`,
          advisorySource: ADVISORY_SOURCE,
        },
      };
    }
  }

  const reqTxtPath = path.join(extractedDir, 'requirements.txt');
  if (fs.existsSync(reqTxtPath)) {
    manifests.requirementsTxt = true;
    try {
      const content = fs.readFileSync(reqTxtPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [pkgName, ver] = trimmed.split(/==|>=|<=|~=/);
        if (!pkgName) continue;
        packagesChecked += 1;
        const cleanName = pkgName.trim();
        const cleanVer = (ver || '').trim();
        const match = KNOWN_CVES.find(
          (c) => c.ecosystem === 'pypi' && c.package.toLowerCase() === cleanName.toLowerCase(),
        );
        if (!match) {
          unmatchedPackages += 1;
          continue;
        }
        if (!cleanVer || !parseVersion(cleanVer)) {
          unknownVersionHits += 1;
          findings.push(
            makeFinding(cleanName, trimmed, cleanVer, match, { uncertain: true }),
          );
          continue;
        }
        const { matched } = versionMatchesRange(cleanVer, match.vulnerableVersions);
        if (matched) findings.push(makeFinding(cleanName, trimmed, cleanVer, match));
        else skippedUnaffected += 1;
      }
    } catch (e) {
      return {
        findings: [],
        toolStatus: {
          status: 'FAILED',
          checkStatus: 'analyzer_failed',
          message: `Failed to parse requirements.txt: ${e.message}`,
          advisorySource: ADVISORY_SOURCE,
        },
      };
    }
  }

  if (!manifests.packageJson && !manifests.requirementsTxt) {
    return {
      findings: [],
      toolStatus: {
        status: 'SKIPPED',
        checkStatus: 'unsupported_manifest',
        message: 'No supported dependency manifests (package.json / requirements.txt) at repo root. Maven, Gradle, poetry, and go.mod are not checked by this offline list.',
        advisorySource: ADVISORY_SOURCE,
        datasetId: ADVISORY_SOURCE,
        liveLookup: false,
        limitation:
          'Unsupported manifest. This is not a vulnerability scan and not a statement that dependencies are safe.',
      },
    };
  }

  return {
    findings,
    toolStatus: {
      status: findings.length ? 'FINDINGS' : 'NO_DATASET_MATCH',
      checkStatus: findings.some((f) => f.versionMatch === 'affected')
        ? 'confirmed_match'
        : findings.some((f) => f.versionMatch === 'unknown')
          ? 'unknown_version'
          : 'no_match_in_dataset',
      message: findings.length
        ? `Offline dataset ${ADVISORY_SOURCE}: ${findings.filter((f) => f.versionMatch === 'affected').length} confirmed match(es); ${unknownVersionHits} unknown-version; ${unmatchedPackages} package(s) were not in this dataset (not verified safe).`
        : `Offline dataset ${ADVISORY_SOURCE}: no confirmed match among ${packagesChecked} package(s). ${unmatchedPackages} package(s) are absent from this short list and are not verified safe.`,
      advisorySource: ADVISORY_SOURCE,
      datasetId: ADVISORY_SOURCE,
      liveLookup: false,
      limitation:
        'This check uses a small offline CVE list. It does not query OSV.dev, NVD, or GitHub Advisory. No match is not a clean bill of health.',
      packagesChecked,
      unmatchedPackages,
      confirmedMatches: findings.filter((f) => f.versionMatch === 'affected').length,
      skippedUnaffected,
      unknownVersionHits,
      manifests,
    },
  };
}
