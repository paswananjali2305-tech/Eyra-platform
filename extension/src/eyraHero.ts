/**
 * Colorful EYRA hero bot for the chat preview (empty) screen.
 *
 * Inline SVG — no image asset to load, scales cleanly in the webview.
 * The surrounding UI stays monochrome (black/white); only the bot and
 * its glow use the blue/violet palette from the reference artwork.
 */
export function eyraHeroBotSvg(): string {
  return `<svg class="hero-bot-svg" viewBox="0 0 360 300" fill="none" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="eyraHead" x1="0" y1="0" x2="360" y2="300" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#22D3EE"/>
      <stop offset="0.48" stop-color="#3B82F6"/>
      <stop offset="1" stop-color="#A855F7"/>
    </linearGradient>
    <linearGradient id="eyraBody" x1="140" y1="150" x2="230" y2="235" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#38BDF8"/>
      <stop offset="1" stop-color="#7C3AED"/>
    </linearGradient>
    <linearGradient id="eyraRing" x1="60" y1="250" x2="300" y2="250" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#22D3EE"/>
      <stop offset="1" stop-color="#A855F7"/>
    </linearGradient>
    <radialGradient id="eyraGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(180 238) rotate(90) scale(58 128)">
      <stop offset="0" stop-color="#2563EB" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="#7C3AED" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#7C3AED" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <ellipse cx="180" cy="238" rx="128" ry="58" fill="url(#eyraGlow)"/>

  <g opacity="0.9">
    <circle cx="52" cy="58" r="2.2" fill="#22D3EE"/>
    <circle cx="88" cy="28" r="1.6" fill="#A855F7"/>
    <circle cx="306" cy="44" r="2.2" fill="#38BDF8"/>
    <circle cx="330" cy="112" r="1.7" fill="#C084FC"/>
    <circle cx="36" cy="140" r="1.6" fill="#818CF8"/>
    <circle cx="286" cy="150" r="1.5" fill="#22D3EE"/>
    <path d="M262 30l1.8 4.7L268.5 36.5l-4.7 1.8L262 43l-1.8-4.7-4.7-1.8 4.7-1.8L262 30z" fill="#E9D5FF"/>
  </g>

  <g>
    <rect x="18" y="86" width="62" height="44" rx="9" fill="#0B1530" stroke="#38BDF8" stroke-opacity="0.75" stroke-width="1.4"/>
    <text x="49" y="115" text-anchor="middle" font-family="ui-monospace, Consolas, monospace" font-size="17" font-weight="700" fill="#22D3EE">&lt;/&gt;</text>
  </g>
  <g>
    <rect x="272" y="82" width="70" height="52" rx="9" fill="#0B1530" stroke="#818CF8" stroke-opacity="0.8" stroke-width="1.4"/>
    <path d="M284 98h46M284 109h34M284 120h42" stroke="#60A5FA" stroke-width="4" stroke-linecap="round"/>
    <path d="M284 98h20M284 120h16" stroke="#C084FC" stroke-width="4" stroke-linecap="round"/>
  </g>
  <g>
    <rect x="282" y="166" width="48" height="44" rx="9" fill="#170B30" stroke="#A855F7" stroke-opacity="0.8" stroke-width="1.4"/>
    <g stroke="#C084FC" stroke-width="2" stroke-linecap="round" fill="none">
      <ellipse cx="306" cy="190" rx="7" ry="10" fill="#2A1454"/>
      <path d="M306 180v20M299 184l-7-5M299 190h-8M299 196l-7 5M313 184l7-5M313 190h8M313 196l7 5"/>
      <path d="M301 181a5 4 0 0 1 10 0"/>
    </g>
  </g>

  <ellipse cx="180" cy="254" rx="104" ry="17" stroke="url(#eyraRing)" stroke-width="2.4" opacity="0.95"/>
  <ellipse cx="180" cy="254" rx="72" ry="11" stroke="#38BDF8" stroke-opacity="0.65" stroke-width="1.6"/>
  <ellipse cx="180" cy="254" rx="38" ry="6" fill="#1D4ED8" opacity="0.35"/>

  <g stroke="#22D3EE" stroke-width="3" stroke-linecap="round" opacity="0.9">
    <path d="M86 118l-10-8M92 104l-4-12M102 116l2-13"/>
  </g>
  <path d="M148 176C128 166 112 148 106 128" stroke="url(#eyraBody)" stroke-width="17" stroke-linecap="round"/>
  <circle cx="104" cy="122" r="12" fill="url(#eyraBody)"/>
  <path d="M222 178c14 6 24 16 28 30" stroke="url(#eyraBody)" stroke-width="16" stroke-linecap="round"/>
  <circle cx="252" cy="212" r="10.5" fill="url(#eyraBody)"/>

  <rect x="103" y="96" width="17" height="42" rx="8.5" fill="url(#eyraBody)"/>
  <rect x="240" y="96" width="17" height="42" rx="8.5" fill="url(#eyraBody)"/>
  <rect x="114" y="52" width="132" height="106" rx="46" fill="url(#eyraHead)"/>
  <rect x="126" y="64" width="108" height="82" rx="36" fill="#FFFFFF" opacity="0.14"/>
  <rect x="132" y="76" width="96" height="62" rx="29" fill="#070D24"/>
  <path d="M152 108q10-11 21 0M188 108q10-11 21 0" stroke="#22D3EE" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M171 122q9 7 18 0" stroke="#38BDF8" stroke-width="4" stroke-linecap="round"/>
  <path d="M254 48l2.2 5.8 5.8 2.2-5.8 2.2L254 64l-2.2-5.8-5.8-2.2 5.8-2.2L254 48z" fill="#F5D0FE"/>

  <path d="M180 148v10" stroke="#38BDF8" stroke-width="7" stroke-linecap="round"/>
  <rect x="143" y="158" width="74" height="62" rx="21" fill="url(#eyraBody)"/>
  <rect x="152" y="166" width="56" height="46" rx="16" fill="#0A1230" opacity="0.34"/>
  <g stroke="#E0F2FE" stroke-width="3.2" stroke-linecap="round">
    <path d="M166 178l14 14M194 178l-14 14M166 192l14-14M194 192l-14-14" opacity="0"/>
    <circle cx="166" cy="178" r="4.2" fill="#22D3EE" stroke="none"/>
    <circle cx="194" cy="178" r="4.2" fill="#E9D5FF" stroke="none"/>
    <circle cx="166" cy="198" r="4.2" fill="#E9D5FF" stroke="none"/>
    <circle cx="194" cy="198" r="4.2" fill="#22D3EE" stroke="none"/>
    <path d="M169 181l8 8M191 181l-8 8M169 195l8-8M191 195l-8-8"/>
  </g>
  <path d="M162 224h36" stroke="#22D3EE" stroke-width="4" stroke-linecap="round" opacity="0.8"/>
</svg>`;
}
