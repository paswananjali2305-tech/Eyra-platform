/** Image-5 monochrome EYRA UI tokens — deep black, white active chrome. */

export const EYRA_UI = {
  bg: '#111111',
  panel: '#111111',
  card: '#1B1B1B',
  cardAlt: '#1F1F1F',
  hover: '#252525',
  border: '#303030',
  borderStrong: '#3A3A3A',
  text: '#F5F5F5',
  muted: '#A3A3A3',
  mutedDim: '#777777',
  blue: '#FFFFFF',
  blueHover: '#E8E8E8',
  blueSoft: 'rgba(255, 255, 255, 0.08)',
  cyan: '#D4D4D4',
  cyanSoft: 'rgba(255, 255, 255, 0.04)',
  green: '#22C55E',
  greenSoft: 'rgba(34, 197, 94, 0.14)',
  red: '#EF4444',
  redSoft: 'rgba(239, 68, 68, 0.16)',
  orange: '#F5A524',
  orangeSoft: 'rgba(245, 165, 36, 0.16)',
  purple: '#A3A3A3',
  purpleSoft: 'rgba(255, 255, 255, 0.06)',
  codeBg: '#111111',
  terminalBg: '#0A0A0A',
  radius: '8px',
  font: 'var(--vscode-font-family), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'var(--vscode-editor-font-family), ui-monospace, Consolas, monospace',
};

export function iconSvg(name: string): string {
  const common = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
  switch (name) {
    case 'chat':
      return `<svg ${common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    case 'analysis':
      return `<svg ${common}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
    case 'run':
      return `<svg ${common}><rect x="3" y="3" width="18" height="18" rx="3"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>`;
    case 'tests':
      return `<svg ${common}><path d="M9 3h6M10 3v6l-5.5 9.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3"/><path d="M8.5 14h7"/></svg>`;
    case 'history':
      return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
    case 'target':
      return `<svg ${common}><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="10"/></svg>`;
    case 'settings':
      return `<svg ${common}><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>`;
    case 'help':
      return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.5 1-1.5 2.2V14"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></svg>`;
    case 'refresh':
      return `<svg ${common}><path d="M21 12a9 9 0 1 1-2.6-6.2"/><path d="M21 3v6h-6"/></svg>`;
    case 'send':
      return `<svg ${common}><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;
    case 'attach':
      return `<svg ${common}><path d="M21.4 11.6l-8.5 8.5a5 5 0 0 1-7.1-7.1l8.5-8.5a3.2 3.2 0 0 1 4.5 4.5l-8.5 8.5a1.4 1.4 0 1 1-2-2l7.8-7.8"/></svg>`;
    case 'check':
      return `<svg ${common}><path d="M20 6L9 17l-5-5"/></svg>`;
    case 'file':
      return `<svg ${common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    case 'file-check':
      return `<svg ${common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>`;
    case 'x':
      return `<svg ${common}><path d="M18 6L6 18M6 6l12 12"/></svg>`;
    case 'search':
      return `<svg ${common}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
    case 'plus':
      return `<svg ${common}><path d="M12 5v14M5 12h14"/></svg>`;
    case 'warn':
      return `<svg ${common}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>`;
    case 'terminal':
      return `<svg ${common}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
    case 'code':
      return `<svg ${common}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
    case 'folder':
      return `<svg ${common}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
    case 'file-plus':
      return `<svg ${common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6M9 15h6"/></svg>`;
    case 'folder-plus':
      return `<svg ${common}><path d="M12 10v6M9 13h6"/><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
    case 'chevron':
      return `<svg ${common}><polyline points="6 9 12 15 18 9"/></svg>`;
    case 'chevron-right':
      return `<svg ${common}><polyline points="9 6 15 12 9 18"/></svg>`;
    case 'more':
      return `<svg ${common}><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>`;
    case 'grid':
      return `<svg ${common}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;
    case 'gauge':
      return `<svg ${common}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
    case 'export':
      return `<svg ${common}><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>`;
    case 'bolt':
      return `<svg ${common}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" stroke="none"/></svg>`;
    case 'radar':
      return `<svg ${common}><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="10"/></svg>`;
    case 'bug':
      return `<svg ${common}><path d="M8 9V7a4 4 0 0 1 8 0v2"/><rect x="7" y="9" width="10" height="10" rx="3"/><path d="M5 12h2M17 12h2M5 16h2M17 16h2M12 9v10"/></svg>`;
    case 'doc':
      return `<svg ${common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h4"/></svg>`;
    case 'analysis-doc':
      return `<svg ${common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="11.5" cy="14.5" r="3.2"/><path d="M16.5 19.5l-2-2"/></svg>`;
    case 'wrench':
      return `<svg ${common}><path d="M14.7 6.3a4.5 4.5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a4.5 4.5 0 0 0 6.4-6.4l-2.5 2.5-3-3 2.5-2.5z"/></svg>`;
    case 'link':
      return `<svg ${common}><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/></svg>`;
    case 'chart':
      return `<svg ${common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`;
    case 'git':
      return `<svg ${common}><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M6 8.5v7M8.5 18h7M8.2 8.2l7.6 7.6"/></svg>`;
    case 'code-brace':
      return `<svg ${common}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
    case 'gear':
      return `<svg ${common}><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>`;
    case 'lightbulb':
      return `<svg ${common}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 4 12c-.8.8-1 1.5-1 2H9c0-.5-.2-1.2-1-2a7 7 0 0 1 4-12z"/></svg>`;
    case 'optimize':
      return `<svg ${common}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" stroke="none"/></svg>`;
    case 'cube':
      return `<svg ${common}><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M12 12l9-5M12 12L3 7"/></svg>`;
    case 'at':
      return `<svg ${common}><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a9 9 0 1 0-3.5 7"/></svg>`;
    case 'copy':
      return `<svg ${common}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    case 'drop':
      return `<svg ${common}><path d="M12 2.7c.4.5 4.5 5.4 4.5 9.3a4.5 4.5 0 1 1-9 0c0-3.9 4.1-8.8 4.5-9.3z"/></svg>`;
    case 'trash':
      return `<svg ${common}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    case 'filter':
      return `<svg ${common}><polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3"/></svg>`;
    case 'menu':
      return `<svg ${common}><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;
    case 'clock':
      return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
    case 'camera':
      return `<svg ${common}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
    case 'user':
      return `<svg ${common}><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>`;
    case 'brain':
      return `<svg width="40" height="40" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="44" height="44" rx="10" fill="#252525" stroke="#404040"/>
        <circle cx="18" cy="20" r="3.2" fill="#F5F5F5"/>
        <circle cx="30" cy="18" r="2.6" fill="#A3A3A3"/>
        <circle cx="26" cy="28" r="3" fill="#F5F5F5"/>
        <circle cx="16" cy="30" r="2.1" fill="#A3A3A3"/>
        <path d="M18 20c4 2 6 4 8 8M30 18c-2 4-2 6-4 10M16 30c4-1 6-2 10-2" stroke="#A3A3A3" stroke-width="1.7" stroke-linecap="round"/>
      </svg>`;
    case 'brain-sm':
      return `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="44" height="44" rx="10" fill="#252525" stroke="#404040"/>
        <circle cx="18" cy="20" r="3.2" fill="#F5F5F5"/>
        <circle cx="30" cy="18" r="2.6" fill="#A3A3A3"/>
        <circle cx="26" cy="28" r="3" fill="#F5F5F5"/>
        <path d="M18 20c4 2 6 4 8 8M30 18c-2 4-2 6-4 10" stroke="#A3A3A3" stroke-width="1.7" stroke-linecap="round"/>
      </svg>`;
    default:
      return `<svg ${common}><circle cx="12" cy="12" r="4"/></svg>`;
  }
}

export function eyraBaseCss(): string {
  const c = EYRA_UI;
  return `
    :root {
      --bg: ${c.bg};
      --panel: ${c.panel};
      --card: ${c.card};
      --card-alt: ${c.cardAlt};
      --hover: ${c.hover};
      --border: ${c.border};
      --border-strong: ${c.borderStrong};
      --text: ${c.text};
      --muted: ${c.muted};
      --muted-dim: ${c.mutedDim};
      --cyan: ${c.cyan};
      --blue: ${c.blue};
      --blue-hover: ${c.blueHover};
      --blue-soft: ${c.blueSoft};
      --cyan-soft: ${c.cyanSoft};
      --green: ${c.green};
      --green-soft: ${c.greenSoft};
      --red: ${c.red};
      --red-soft: ${c.redSoft};
      --orange: ${c.orange};
      --orange-soft: ${c.orangeSoft};
      --purple: ${c.purple};
      --purple-soft: ${c.purpleSoft};
      --code: ${c.codeBg};
      --terminal: ${c.terminalBg};
      --radius: ${c.radius};
      --font: ${c.font};
      --mono: ${c.mono};
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 13px;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    button, input, textarea { font-family: inherit; }
  `;
}
