/**
 * Names that are stitch / sample / upload-test leftovers — never show in project pickers.
 */
const DEMO_PROJECT_RE =
  /^(default|backend-api|identity-service|frontend-app|runtime-workspace|eyra-upload-test|novapay(\s|$)|novapay express)/i;

/**
 * @param {string|null|undefined} name
 */
export function isDemoProjectName(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  if (DEMO_PROJECT_RE.test(n)) return true;
  if (/novapay/i.test(n)) return true;
  if (/^eyra[-_]?upload/i.test(n)) return true;
  if (/^sample[-_ ]/i.test(n)) return true;
  return false;
}

/**
 * @template {{ label?: string, name?: string, id?: string }} T
 * @param {T[]} list
 * @returns {T[]}
 */
export function rejectDemoProjects(list) {
  return (Array.isArray(list) ? list : []).filter((p) => {
    const label = p?.label || p?.name || p?.id || '';
    return !isDemoProjectName(label);
  });
}
