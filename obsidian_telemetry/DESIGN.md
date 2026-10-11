---
name: Obsidian Telemetry
colors:
  surface: '#0e131e'
  surface-dim: '#0e131e'
  surface-bright: '#343946'
  surface-container-lowest: '#090e19'
  surface-container-low: '#161b27'
  surface-container: '#1b1f2b'
  surface-container-high: '#252a36'
  surface-container-highest: '#303541'
  on-surface: '#dee2f2'
  on-surface-variant: '#bbc9cd'
  inverse-surface: '#dee2f2'
  inverse-on-surface: '#2b303d'
  outline: '#859397'
  outline-variant: '#3c494c'
  surface-tint: '#39d8f4'
  primary: '#9cedff'
  on-primary: '#00363f'
  primary-container: '#35d6f2'
  on-primary-container: '#005967'
  inverse-primary: '#006877'
  secondary: '#bbc3ff'
  on-secondary: '#001e91'
  secondary-container: '#1b37be'
  on-secondary-container: '#a8b4ff'
  tertiary: '#6cf9bb'
  on-tertiary: '#003824'
  tertiary-container: '#4bdca1'
  on-tertiary-container: '#005d3f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#a5eeff'
  primary-fixed-dim: '#39d8f4'
  on-primary-fixed: '#001f25'
  on-primary-fixed-variant: '#004e5a'
  secondary-fixed: '#dee0ff'
  secondary-fixed-dim: '#bbc3ff'
  on-secondary-fixed: '#000f5c'
  on-secondary-fixed-variant: '#1734bb'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#0e131e'
  on-background: '#dee2f2'
  surface-variant: '#303541'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.025em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.005em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: -0.01em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0em
  code-body:
    fontFamily: JetBrains Mono
    fontSize: 12.5px
    fontWeight: '400'
    lineHeight: 19px
    letterSpacing: 0em
  code-compact:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 15px
    letterSpacing: 0em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-dense: 0.5rem
  margin: 1rem
  margin-panel: 0.75rem
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  space-2xl: 2rem
---

## Brand & Style

This design system embodies the precision, high-signal rigor, and deep technical authority required by advanced systems engineers and site reliability architects. It operates under a tailored variant of **Developer Modernism / Technical Minimalism**, drawing structural poise from modern engineering workbenches like Linear and mission-critical observability consoles like Datadog, Sentry, and Grafana.

### Personality & Emotional Response
- **Vigilant & Unshakable:** Evokes supreme operational readiness. Surfaces are dense, calibrated, and quiet, ensuring telemetry data commands immediate attention without visual noise.
- **Instrument-Grade Precision:** Every boundary, divider, and token reflects mechanical exactness. Elements feel milled rather than painted.
- **Cognitive Calm under Incident Pressure:** High-stress triage requires high legibility, strict vertical alignment, low decorative friction, and razor-sharp typographic hierarchy.

### Visual Style
- **Layered Midnight Surfaces:** Deep obsidian and slate depths delineate structural hierarchy rather than aggressive shadows.
- **Subtle Phosphor Accents:** Electric cyan and deep indigo act as razor-focused navigational beams and tactical state indicators against the dark abyss.
- **Ultra-Restrained Technical Flourishes:** Micro-borders, fine 1px hairline dividers, precise monospaced telemetry counters, and high data density engineered for multi-monitor developer environments.

## Colors

The palette is engineered specifically for deep focus, long-term optical endurance, and instantaneous anomaly recognition. It employs structured dark tiers alongside targeted chromatic signals.

### Surface Architecture
- **Canvas Base (`#080D18`):** The foundational midnight navy void. Applied to root viewports, IDE split-frames, and terminal backplates.
- **Surface Level 1 (`#101827`):** Elevated container layer for persistent sidebars, trace-list drawers, and analytical side panels.
- **Surface Level 2 (`#151F30`):** Modular card backgrounds, inspector trays, code frame enclosures, and active tabs.
- **Border / Hairline (`#253247`):** The structural line work across the product. Used consistently at 1px thickness for dividers, grid headers, and split-pane resizers.
- **Surface Hover / Active (`#1D2A40`):** Interactive feedback state for list rows, menu items, and table elements.

### Accent & Diagnostic Spectrum
- **Primary Accent (`#35D6F2` - Electric Cyan):** Active runtime cursors, primary telemetry highlights, active execution pointers, and focused states.
- **Secondary Accent (`#647BFF` - Indigo):** Secondary execution flows, automated agent recommendations, and structural metadata tags.
- **Success / Verified (`#10B981` - Restrained Emerald):** Healthy daemon heartbeats, resolved incidents, passing unit runs, and zero-leak verifications.
- **Warning / Degraded (`#F59E0B` - Amber):** Latency spikes, elevated memory consumption, unhandled promise notices, and rate-limit thresholds.
- **Critical Error (`#EF4444` - Controlled Coral Red):** Process panics, segfaults, unhandled exceptions, and broken runtime assertions.

### Typographic Contrast
- **Text Primary (`#F8FAFC`):** Soft white ensuring uncompromised readability without the harsh glare of `#FFFFFF`.
- **Text Secondary (`#94A3B8`):** Muted slate gray for field keys, timestamps, stack line numbers, and passive metadata.
- **Text Tertiary / Disabled (`#475569`):** Subdued commentary, truncated paths, and inactive keyboard shortcut glyphs.

## Typography

The typographic hierarchy implements a disciplined bi-font system: **Inter** handles structural interface interactions, narrative explanations, and operational controls; **JetBrains Mono** governs code streams, trace dumps, memory hex maps, variable declarations, and metrics chips.

### Hierarchy & Rules
- **Proportional UI Type:** Body and header typography scales tightly (12px to 22px for core workspace layouts). Large display sizes are reserved strictly for high-level cluster overviews and agent status hero banners.
- **Monospaced Data Anchors:** Any data payload, latency value (`142ms`), timestamp (`2024-03-29T12:04:02.102Z`), thread identifier, or source-code snippet must utilize `JetBrains Mono`.
- **Compact Numerical Tabulation:** Monospaced fonts must render with tabular figures enabled (`font-variant-numeric: tabular-nums`) so that rapidly updating CPU, RAM, and network figures do not introduce layout jitter.
- **Letter Spacing:** Tighter negative tracking on medium/large Inter headlines ensures a sharp, modern developer-tool density; neutral to slightly positive tracking on monospaced labels ensures legibility at sizes down to 11px.

## Layout & Spacing

This design system employs an **Application-Frame Multi-Pane Layout** over a traditional webpage document flow. Content conforms to precise multi-axis dockable viewports, flexible horizontal splitters, and dynamic data-dense grid panels.

### Layout Philosophy
- **Viewport Lock & Docking:** The main canvas is locked to 100vh/100vw with internal scrolling restricted to data-specific viewports (e.g., stack trace timeline, terminal log pane, agent chat thread).
- **Dense Structural Rhythm:** The base unit is an 8px grid with a tight 4px sub-grid for internal component padding (`space-xs`, `space-sm`). Standard panels use `0.75rem` gutters to maximize visible screen real estate.
- **High-Density Data Grids:** Tables and trace lists feature condensed vertical row heights (28px - 32px), guaranteeing maximum line visibility without sacrificing touch/click targets.

### Responsive Breakpoints & Pane Reflow
- **Desktop (>= 1280px):** 3-to-4 column modular cockpit. Left navigation tree (240px fixed), center execution viewport / flame graph (flexible), right inspector drawer / agent assistant (360px-440px flexible).
- **Tablet / Small Laptop (1024px - 1279px):** Inspector drawer collapases to an overlay sheet or tabbed bottom console. Nav tree collapses to an icon bar (48px).
- **Mobile (< 1024px):** Single active panel with segmented top controller. Panes switch sequentially via a persistent bottom status switcher (Traces, Flame Graph, AI Diagnostics, Terminal).

## Elevation & Depth

Visual hierarchy does not rely on soft diffuse drop shadows or blurred physical realism. Depth is communicated strictly through **Tonal Layering**, **Crisp 1px Boundaries**, and **Selective Micro-Glow Accents**.

### Surface Elevation Strategy
- **Base (0dp):** Deep Midnight Navy (`#080D18`). Used for canvas backdrops and inactive pane troughs.
- **Inset / Recessed (-1dp):** Dark void (`#04070D`) with a subtle inner hairline border (`#1C2638`). Applied to terminal emulators, REPL consoles, and active code editor blocks.
- **Layer 1 Surface (1dp):** `#101827` bounded by 1px `#253247`. Structural panels, side navigation rails, and column headers.
- **Layer 2 Card / Flyout (2dp):** `#151F30` bounded by 1px `#2E3D56`. Stack trace frames, floating query filters, hover inspector tooltips, and modal diagnostic windows.
- **Focused State:** No fuzzy drop shadow; surfaces receive a sharp 1px `#35D6F2` primary outline accompanied by a faint `0 0 12px rgba(53, 214, 242, 0.15)` optical bloom.

### Divider Discipline
Overlapping panels never blend together with soft gradients. Every partition must be defined by a solid or translucent 1px `#253247` stroke.

## Shapes

The design system maintains an intentional **Soft-Engineered (Level 1)** shape radius. Pure 90-degree corners feel overly brutalist and strain prolonged visual triage, while rounded bubbly corners waste valuable screen density and compromise the serious, scientific nature of a runtime debugger.

### Geometry Specifications
- **Base Components (Inputs, Buttons, Badges, Tabs):** `0.25rem` (4px). Clean, precise, and compact.
- **Containers & Flyouts (Cards, Modals, Drawers):** `0.5rem` (8px). Softens larger surface blocks without breaking structural grid lines.
- **Micro Tags & Status Dots:** Status pills and live indicator dots may use complete pill curves (`9999px`) only when indicating continuous live execution or transient counts.

## Components

### Buttons & Interactive Triggers
- **Primary Action (Execute, Deploy Fix, Trigger Trace):** Solid electric cyan background (`#35D6F2`), text in dark navy (`#080D18`), weight 600. On hover: slight brightness ramp with an active glow `0 0 16px rgba(53, 214, 242, 0.3)`.
- **Secondary Action (Filter, Fork, Inspect):** Background `#151F30`, 1px border `#253247`, text `#F8FAFC`. On hover: surface `#1D2A40`, border `#35D6F2`.
- **Destructive Action (Halt Runtime, Terminate Pod):** Background `rgba(239, 68, 68, 0.12)`, 1px border `rgba(239, 68, 68, 0.4)`, text `#EF4444`. On hover: background `#EF4444`, text `#FFFFFF`.
- **Compact Action Bar:** Buttons in toolbars feature a fixed height of 28px, utilizing `label-sm` typography with integrated monochrome micro-icons (14px).

### Diagnostic Chips & Telemetry Badges
- **Status Pills:** Background in 10% opacity tint of status color with a 1px border at 25% opacity; text in 100% status color (e.g., Error Badge: background `rgba(239, 68, 68, 0.1)`, border `rgba(239, 68, 68, 0.25)`, text `#EF4444`).
- **Typography:** `JetBrains Mono` at 11px uppercase with `0.04em` tracking.
- **Metric Chips:** Fixed-height (20px), containing key-value pairs separated by a subtle vertical border (e.g., `CPU | 84%`).

### Stack Traces & Code Frame Lists
- **Layout:** Dense, borderless list rows housed inside a `#101827` container with alternating subtle hover highlights (`#151F30`).
- **Row Anatomy:** Left-aligned error severity dot (4px), file path in `#94A3B8`, line/column identifier in `#647BFF` (`JetBrains Mono`), and function name in `#F8FAFC`.
- **Active / Expanded Trace:** Border-left marked with a 2px vertical rail of `#35D6F2`. Inlined code snippet rendered in a `#04070D` recessed container with syntax highlighting calibrated to the system palette.

### Input Fields & Filter Command Bars
- **Command Palette (`Cmd + K`):** Floating modal with `#101827` background, 1px `#2E3D56` border, and subtle cyan top rim highlight. Text field is borderless, size 15px Inter, with secondary slate placeholder text.
- **Inline Filter Inputs:** Background `#080D18`, 1px `#253247` border, 28px height, 8px horizontal padding. Active focus transitions border to `#35D6F2` immediately with zero ease delay.

### Checkboxes, Radios & Switches
- **Form Geometry:** Checkboxes use a 3px radius; switches use a tight horizontal pill (14px height by 26px width).
- **Checked Fill:** Primary `#35D6F2` fill with `#080D18` checkmark icon. Inactive states feature `#101827` background with a 1px `#253247` outline.

### Diagnostic Cards & Flame Graph Containers
- **Card Enclosure:** 1px `#253247` outline on `#151F30` background with `0.5rem` radius. Header areas feature an integrated breadcrumb rail and runtime indicator.
- **Telemetry Charts:** Canvas charts (latency histograms, flame charts) inherit background directly from `#101827` with `#253247` micro-grids. Tracing spans use `#35D6F2` (primary span), `#647BFF` (asynchronous sub-routines), and `#EF4444` (bottlenecks/errors).