import {
  siC,
  siCplusplus,
  siCss,
  siGo,
  siHtml5,
  siJavascript,
  siMysql,
  siOpenjdk,
  siPython,
  siTypescript,
} from 'simple-icons';
import { AUDIT_LANGUAGES, languageById, languageIconMeta } from '../../lib/auditLanguages.js';

/** Official brand SVG paths (simple-icons, CC0) keyed by our catalog id. */
const BRAND_ICONS = {
  Python: siPython,
  JavaScript: siJavascript,
  TypeScript: siTypescript,
  Java: siOpenjdk,
  C: siC,
  'C++': siCplusplus,
  Go: siGo,
  HTML: siHtml5,
  CSS: siCss,
  SQL: siMysql,
};

/**
 * Brand SVG language logo (Python two-snakes, JS, etc.) — not text glyphs.
 * @param {{ langId?: string, path?: string, size?: number, showLabel?: boolean, className?: string }} props
 */
export function LanguageLogo({
  langId,
  path,
  size = 16,
  showLabel = false,
  className = '',
}) {
  const id = langId || (path ? languageIconMeta(path).id : 'Python');
  const lang = languageById(id);
  const brand = BRAND_ICONS[id] || BRAND_ICONS.Python;
  const px = Math.max(12, Number(size) || 16);
  const fill = lang.logoColor || `#${brand.hex}`;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} title={lang.label}>
      <svg
        role="img"
        aria-label={lang.label}
        viewBox="0 0 24 24"
        width={px}
        height={px}
        className="shrink-0"
        style={{ display: 'block' }}
      >
        <title>{lang.label}</title>
        <path d={brand.path} fill={fill} />
      </svg>
      {showLabel ? (
        <span className="font-label-sm text-[11px] text-on-surface">{lang.label}</span>
      ) : null}
    </span>
  );
}

/**
 * Compact select with logo chip beside it (shared runtime + audit).
 */
export function LanguageSelect({
  value,
  onChange,
  options,
  'aria-label': ariaLabel = 'Code language',
  className = '',
}) {
  const list = Array.isArray(options) && options.length ? options : AUDIT_LANGUAGES;
  return (
    <label className={`flex items-center gap-1.5 ${className}`} title="Language">
      <LanguageLogo langId={value} size={16} />
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="eyra-lang-select max-w-[10.5rem] cursor-pointer appearance-none rounded-md border border-outline-variant/40 bg-surface-container-highest py-0.5 pl-2 pr-6 font-label-sm text-[11px] text-on-surface outline-none hover:border-outline-variant/70 focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
        style={{
          colorScheme: 'dark',
          backgroundColor: 'var(--color-surface-container-highest, #303541)',
          color: 'var(--color-on-surface, #dee2f2)',
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23bbc9cd' d='M3 4.5L6 8l3-3.5'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.4rem center',
        }}
        aria-label={ariaLabel}
      >
        {list.map((lang) => (
          <option
            key={lang.id}
            value={lang.id}
            style={{ backgroundColor: '#303541', color: '#dee2f2' }}
          >
            {lang.label}
          </option>
        ))}
      </select>
    </label>
  );
}
