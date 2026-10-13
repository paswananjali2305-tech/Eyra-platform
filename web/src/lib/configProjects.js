import { isDemoProjectName } from './demoProjects.js';
import { relativeTime } from './hydrateStitch.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function whenMs(iso) {
  const t = new Date(iso || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function healthScore(scan) {
  if (scan?.summary?.healthScore != null) return Number(scan.summary.healthScore);
  return null;
}

function statusBadge(scan, isActive) {
  const st = String(scan?.status || '').toLowerCase();
  if (isActive && (st === 'completed' || st === 'running' || st === 'scanning')) {
    return { label: 'ACTIVE', cls: 'bg-tertiary/15 text-tertiary', pulse: true };
  }
  if (st === 'running' || st === 'scanning' || st === 'pending' || st === 'queued') {
    return { label: 'RUNNING', cls: 'bg-primary/15 text-primary', pulse: true };
  }
  if (st === 'failed' || st === 'cancelled') {
    return { label: st.toUpperCase(), cls: 'bg-error/15 text-error', pulse: false };
  }
  if (st === 'completed') {
    return { label: 'CONNECTED', cls: 'bg-primary/15 text-primary', pulse: false };
  }
  return { label: 'IDLE', cls: 'bg-surface-container-high text-outline', pulse: false };
}

function iconForLang(lang) {
  const l = String(lang || '').toLowerCase();
  if (l.includes('python')) return 'terminal';
  if (l.includes('go')) return 'vpn_key';
  if (l.includes('type') || l.includes('java') || l.includes('react')) return 'web_asset';
  return 'folder_code';
}

function sparkPath(score) {
  const s = score == null ? 50 : Math.max(0, Math.min(100, score));
  const pts = [0, 15, 30, 45, 60, 75, 90, 100].map((x, i) => {
    const wave = Math.sin(i * 1.1 + s / 20) * 4;
    const y = 18 - (s / 100) * 14 - wave;
    return `${x},${Math.max(2, Math.min(18, y)).toFixed(1)}`;
  });
  return `M${pts.join(' L')}`;
}

/**
 * One workspace card per project from audit scans and/or runtime history.
 * @param {object[]} scans ZIP / GitHub audit scans
 * @param {object[]} sessions runtime debug sessions
 * @param {{
 *   activeScanId?: string|null,
 *   brainLabel?: string,
 *   scope?: 'audit' | 'runtime' | 'all',
 * }} [opts]
 *   - audit: only ZIP/GitHub scan projects (no runtime-only cards)
 *   - runtime: only debugging session projects
 *   - all: merge both
 */
export function buildConfigProjects(scans, sessions, opts = {}) {
  const scope = opts.scope === 'audit' || opts.scope === 'runtime' ? opts.scope : 'all';
  const byKey = new Map();

  const touch = (name, patch) => {
    const key = String(name || 'default').trim() || 'default';
    const prev = byKey.get(key.toLowerCase()) || {
      name: key,
      scan: null,
      session: null,
      activityAt: 0,
    };
    byKey.set(key.toLowerCase(), { ...prev, ...patch, name: prev.name || key });
  };

  if (scope !== 'runtime') {
    for (const scan of Array.isArray(scans) ? scans : []) {
      const name = scan.projectName || scan.archiveName || 'codebase';
      const key = name.toLowerCase();
      const prev = byKey.get(key);
      const t = whenMs(scan.completedAt || scan.updatedAt || scan.createdAt);
      if (!prev?.scan || t >= whenMs(prev.scan.completedAt || prev.scan.updatedAt || prev.scan.createdAt)) {
        touch(name, {
          scan,
          activityAt: Math.max(prev?.activityAt || 0, t),
        });
      } else {
        touch(name, { activityAt: Math.max(prev.activityAt || 0, t) });
      }
    }
  }

  // Runtime sessions: enrich matching audit cards only when scope=all;
  // create session-only cards when scope=runtime or all.
  if (scope !== 'audit') {
    for (const sess of Array.isArray(sessions) ? sessions : []) {
      const name = sess.project_name || 'default';
      const key = name.toLowerCase();
      const prev = byKey.get(key);
      const t = whenMs(sess.created_at);
      if (!prev?.session || t >= whenMs(prev.session.created_at)) {
        touch(name, {
          session: sess,
          activityAt: Math.max(prev?.activityAt || 0, t),
        });
      } else {
        touch(name, { activityAt: Math.max(prev?.activityAt || 0, t) });
      }
    }
  }

  // Drop sample / upload-test / NovaPay leftovers from Config → Active Projects.
  for (const key of [...byKey.keys()]) {
    const row = byKey.get(key);
    if (isDemoProjectName(row?.name || key)) byKey.delete(key);
  }

  const activeId = opts.activeScanId || null;
  const rows = [...byKey.values()]
    .filter((row) => {
      if (scope === 'audit') return Boolean(row.scan);
      if (scope === 'runtime') return Boolean(row.session);
      return Boolean(row.scan || row.session);
    })
    .map((row) => {
      const scan = row.scan;
      const sess = scope === 'audit' ? null : row.session;
      const isActive = Boolean(activeId && scan?.id && scan.id === activeId);
      const badge = statusBadge(scan, isActive);
      const score = healthScore(scan);
      const lang =
        scan?.meta?.primaryLanguage ||
        scan?.meta?.languages?.[0] ||
        sess?.language ||
        null;
      const framework = scan?.meta?.frameworks?.[0] || null;
      const files =
        scan?.summary?.totalFiles ?? scan?.meta?.totalFilesCount ?? null;
      const issues =
        scan?.summary?.totalIssues != null
          ? Number(scan.summary.totalIssues)
          : Array.isArray(scan?.issues)
            ? scan.issues.length
            : null;
      const auditWhen = scan
        ? relativeTime(scan.completedAt || scan.updatedAt || scan.createdAt)
        : null;
      const debugWhen = sess ? relativeTime(sess.created_at) : null;
      const errHint =
        sess?.error_type && sess.error_type !== 'none'
          ? sess.error_type
          : sess
            ? '0 errors'
            : null;

      const sourceType =
        scan?.sourceType ||
        (scan?.archiveName && /\.zip$/i.test(scan.archiveName)
          ? 'zip'
          : scan
            ? 'repo'
            : 'runtime');
      const subtitle = scan
        ? [
            sourceType === 'zip' || /\.zip$/i.test(String(scan.archiveName || ''))
              ? 'ZIP upload'
              : sourceType === 'github' || sourceType === 'repo'
                ? 'GitHub / repo'
                : 'Codebase audit',
            scan.archiveName
              ? String(scan.archiveName).replace(/\.zip$/i, '')
              : String(scan.id || '').slice(0, 8),
          ]
            .filter(Boolean)
            .join(' · ')
        : sess?.session_id || 'runtime';

      return {
        name: row.name,
        scanId: scan?.id || null,
        isActive,
        badge,
        lang,
        framework,
        brainLabel: opts.brainLabel || null,
        score,
        files,
        issues,
        auditWhen,
        auditStatus: scan?.status || null,
        debugWhen,
        errHint,
        auditOnly: scope === 'audit',
        sourceType,
        subtitle,
        footer: [
          scan?.id ? `#${String(scan.id).slice(0, 8)}` : null,
          files != null ? `${files} files` : null,
          issues != null ? `${issues} findings` : null,
          !scan && sess?.session_id ? sess.session_id : null,
        ]
          .filter(Boolean)
          .join(' · '),
        spark: sparkPath(score),
        icon: iconForLang(lang),
        activityAt: row.activityAt,
        openLabel: scan
          ? String(scan.status || '').toLowerCase() === 'completed'
            ? 'Open Workspace'
            : 'Open Progress'
          : 'Open Debugging',
        openAction: scan ? 'open-audit' : 'open-runtime',
      };
    })
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return b.activityAt - a.activityAt;
    });

  return rows.slice(0, 9);
}

/**
 * @param {ReturnType<typeof buildConfigProjects>} projects
 * @param {{ offline?: boolean, loading?: boolean }} [opts]
 */
export function renderConfigProjectsHtml(projects, opts = {}) {
  if (opts.loading) {
    return `
<div class="w-full min-w-full p-space-lg rounded-xl bg-surface-container-low border border-outline-variant/20 flex flex-col items-center gap-space-sm text-center shrink-0">
  <span class="material-symbols-outlined text-[28px] text-outline animate-pulse">progress_activity</span>
  <div class="font-headline-sm text-headline-sm text-on-surface font-semibold">Loading projects…</div>
  <p class="font-body-sm text-body-sm text-on-surface-variant max-w-md">Fetching workspaces from the Brain.</p>
</div>`;
  }
  if (opts.offline) {
    return `
<div class="w-full min-w-full p-space-lg rounded-xl bg-surface-container-low border border-outline-variant/20 flex flex-col items-center gap-space-sm text-center shrink-0">
  <span class="material-symbols-outlined text-[28px] text-error">cloud_off</span>
  <div class="font-headline-sm text-headline-sm text-on-surface font-semibold">Brain offline</div>
  <p class="font-body-sm text-body-sm text-on-surface-variant max-w-md">Cannot load projects while the backend is unreachable. Start the Brain and refresh.</p>
</div>`;
  }
  if (!projects?.length) {
    return `
<div class="w-full min-w-full p-space-lg rounded-xl bg-surface-container-low border border-outline-variant/20 flex flex-col items-center gap-space-sm text-center shrink-0">
  <span class="material-symbols-outlined text-[28px] text-outline">inventory_2</span>
  <div class="font-headline-sm text-headline-sm text-on-surface font-semibold">No projects yet</div>
  <p class="font-body-sm text-body-sm text-on-surface-variant max-w-md">Upload a ZIP or connect a GitHub repo to create your first workspace.</p>
  <button type="button" data-action="add-project" class="mt-1 px-3 py-1.5 rounded-lg bg-primary-container text-on-primary-container font-label-sm text-label-sm flex items-center gap-1.5 cursor-pointer">
    <span class="material-symbols-outlined text-[15px]">add</span>
    <span>Add New Project</span>
  </button>
</div>`;
  }

  const cards = projects
    .map((p) => {
      const tags = [
        p.lang
          ? `<span class="px-2 py-0.5 rounded bg-surface-container-high font-code-compact text-code-compact text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-[13px] text-primary">data_object</span>${esc(p.lang)}</span>`
          : '',
        p.framework
          ? `<span class="px-2 py-0.5 rounded bg-surface-container-high font-code-compact text-code-compact text-on-surface-variant">${esc(p.framework)}</span>`
          : '',
        p.brainLabel
          ? `<span class="px-2 py-0.5 rounded bg-surface-container-high font-code-compact text-code-compact text-outline">${esc(p.brainLabel)}</span>`
          : p.auditStatus
            ? `<span class="px-2 py-0.5 rounded bg-surface-container-high font-code-compact text-code-compact text-outline">${esc(p.auditStatus)}</span>`
            : '',
      ]
        .filter(Boolean)
        .join('\n');

      const debugLine = p.debugWhen
        ? `${esc(p.debugWhen)}${p.errHint ? ` (${esc(p.errHint)})` : ''}`
        : 'No debug sessions';
      const auditLine = p.auditWhen
        ? `${esc(p.auditWhen)}${p.score != null ? ` (Score: ${esc(p.score)}/100)` : ''}`
        : 'No audit yet';

      return `
<div class="w-[320px] max-w-[85vw] shrink-0 p-space-md rounded-xl bg-surface-container-low hover:bg-surface-container flex flex-col justify-between gap-space-md transition-all shadow-md group" data-project-card="1" data-scan-id="${esc(p.scanId || '')}" data-project-name="${esc(p.name)}">
  <div class="flex flex-col gap-space-xs">
    <div class="flex items-start justify-between">
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-[18px]">${esc(p.icon)}</span>
        </div>
        <div class="min-w-0">
          <div class="font-headline-sm text-headline-sm text-on-surface font-semibold truncate flex items-center gap-1.5">
            ${esc(p.name)}
            ${p.isActive ? '<span class="material-symbols-outlined text-[13px] text-tertiary">verified</span>' : ''}
          </div>
          <div class="font-code-compact text-code-compact text-outline truncate">${esc(p.subtitle)}</div>
        </div>
      </div>
      <span class="px-2 py-0.5 rounded font-label-sm text-label-sm ${p.badge.cls} flex items-center gap-1 shrink-0">
        <span class="w-1.5 h-1.5 rounded-full ${p.badge.pulse ? 'bg-current animate-pulse' : 'bg-current'}"></span>
        ${esc(p.badge.label)}
      </span>
    </div>
    <div class="mt-2 flex items-center gap-2 flex-wrap">${tags}</div>
  </div>
  <div class="pt-space-xs flex flex-col gap-space-xs bg-surface-container-lowest/60 p-2.5 rounded-lg">
    ${
      p.auditOnly
        ? ''
        : `<div class="flex items-center justify-between font-label-sm text-label-sm gap-2">
      <span class="text-outline shrink-0">Last Debug Session:</span>
      <span class="text-tertiary font-code-compact text-code-compact text-right truncate">${debugLine}</span>
    </div>`
    }
    <div class="flex items-center justify-between font-label-sm text-label-sm gap-2">
      <span class="text-outline shrink-0">${p.auditOnly ? 'Last scan:' : 'Last Audit Scan:'}</span>
      <span class="text-on-surface-variant font-code-compact text-code-compact text-right truncate">${auditLine}</span>
    </div>
    <div class="mt-1 flex items-center justify-between text-outline font-label-sm text-label-sm">
      <span>Health trend</span>
      <svg class="w-28 h-5 text-primary" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 100 20">
        <path d="${esc(p.spark)}"></path>
      </svg>
    </div>
  </div>
  <div class="flex items-center justify-between pt-1 font-label-sm text-label-sm text-outline gap-2">
    <span class="font-code-compact text-[10px] text-outline-variant truncate">${esc(p.footer || '—')}</span>
    <div class="flex items-center gap-3 shrink-0">
      <button type="button" data-action="configure" class="text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer bg-transparent border-0 p-0 font-label-sm text-label-sm">Configure</button>
      <button type="button" data-action="${esc(p.openAction)}" data-scan-id="${esc(p.scanId || '')}" class="text-primary hover:brightness-110 transition-colors cursor-pointer bg-transparent border-0 p-0 font-label-sm text-label-sm">${esc(p.openLabel)}</button>
    </div>
  </div>
</div>`;
    })
    .join('\n');

  return `
<div class="relative">
  <div id="eyra-config-projects-track" class="flex flex-nowrap gap-space-md overflow-x-auto scroll-smooth pb-1 [scrollbar-width:thin]" style="scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch">
    ${cards.replace(
      /data-project-card="1"/g,
      'data-project-card="1" style="scroll-snap-align:start"',
    )}
  </div>
<button type="button" data-action="scroll-projects-left" data-projects-arrow="left" hidden aria-label="Scroll projects left" class="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 z-10 w-9 h-9 rounded-full bg-surface-container-highest/95 border border-outline-variant/40 text-on-surface shadow-lg hover:bg-surface-container-high items-center justify-center cursor-pointer">
  <span class="material-symbols-outlined text-[20px]">chevron_left</span>
</button>
<button type="button" data-action="scroll-projects-right" data-projects-arrow="right" hidden aria-label="Scroll projects right" class="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1 z-10 w-9 h-9 rounded-full bg-surface-container-highest/95 border border-outline-variant/40 text-primary shadow-lg hover:bg-surface-container-high items-center justify-center cursor-pointer">
  <span class="material-symbols-outlined text-[20px]">chevron_right</span>
</button>
</div>`;
}

/**
 * Show left/right arrows only when the row overflows (and in that scroll direction).
 * @param {ParentNode|null} root
 */
export function syncConfigProjectArrows(root) {
  const host =
    root?.querySelector?.('#eyra-config-projects') ||
    document.getElementById('eyra-config-projects');
  const track =
    host?.querySelector?.('#eyra-config-projects-track') ||
    document.getElementById('eyra-config-projects-track');
  if (!host || !track) return;

  const left = host.querySelector('[data-projects-arrow="left"]');
  const right = host.querySelector('[data-projects-arrow="right"]');
  if (!left || !right) return;

  const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
  const overflows = maxScroll > 4;
  const atStart = track.scrollLeft <= 4;
  const atEnd = track.scrollLeft >= maxScroll - 4;

  const showLeft = overflows && !atStart;
  const showRight = overflows && !atEnd;

  left.hidden = !showLeft;
  right.hidden = !showRight;
  left.style.display = showLeft ? 'flex' : 'none';
  right.style.display = showRight ? 'flex' : 'none';
}

/**
 * Replace the stitch mock project grid with a single-row horizontal scroller.
 * @param {ParentNode|null} root
 * @param {ReturnType<typeof buildConfigProjects>} projects
 * @param {{ offline?: boolean, loading?: boolean }} [opts]
 */
export function hydrateConfigProjects(root, projects, opts = {}) {
  if (!root) return;
  let grid =
    root.querySelector('#eyra-config-projects') ||
    root.querySelector('[data-eyra-projects]');
  if (!grid) {
    const grids = Array.from(root.querySelectorAll('div.grid')).filter((g) =>
      /grid-cols-1/.test(g.className || ''),
    );
    grid =
      grids.find((g) => {
        const text = g.textContent || '';
        return /backend-api|identity-service|frontend-app|Loading projects|No projects yet|Brain offline/i.test(
          text,
        );
      }) || null;
  }
  if (!grid) return;
  grid.id = 'eyra-config-projects';
  grid.className = 'relative w-full min-w-0';
  grid.innerHTML = renderConfigProjectsHtml(projects, opts);
  grid.setAttribute(
    'data-eyra-projects',
    opts.offline ? 'offline' : opts.loading ? 'loading' : 'live',
  );

  const track = grid.querySelector('#eyra-config-projects-track');
  if (track && !track.dataset.arrowBound) {
    track.dataset.arrowBound = '1';
    track.addEventListener('scroll', () => syncConfigProjectArrows(root), {
      passive: true,
    });
  }
  // Layout must settle before overflow can be measured.
  requestAnimationFrame(() => {
    syncConfigProjectArrows(root);
    requestAnimationFrame(() => syncConfigProjectArrows(root));
  });
}

/** Scroll the projects track by roughly one card (±direction). */
export function scrollConfigProjects(root, direction = 1) {
  const track =
    root?.querySelector?.('#eyra-config-projects-track') ||
    document.getElementById('eyra-config-projects-track');
  if (!track) return;
  const card = track.querySelector('[data-project-card]');
  const step = (card?.getBoundingClientRect?.().width || 320) + 16;
  track.scrollBy({ left: direction * step, behavior: 'smooth' });
  window.setTimeout(() => syncConfigProjectArrows(root), 220);
}
