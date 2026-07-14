# Libraries — real tools, verified live

Professional finish comes from real, current tools — not hand-rolled approximations of them. This
file is a **map of categories and strong candidates**, deliberately unversioned.

## The hard rule

> Before using ANY library below: verify its current major version, install command and API
> against its real source (official docs, npm/pub.dev/NuGet/crates.io) **online, at use-time**.
> Never scaffold from memory; never pin from this file — it names candidates, the web names
> versions. No web access? Say so and mark every library choice as an unverified assumption.

Second rule: **real assets, always.** A real typeface loaded properly, ONE real icon set (never
mixed, never emoji-as-icons), real spacing/color tokens. The gap between "generated" and
"designed" is usually assets.

## Web — styling & components

- **Styling:** Tailwind CSS (v4 era: CSS-first config, `@theme` tokens) · vanilla CSS with custom
  properties + OKLCH + nesting (no build step, underrated) · CSS Modules. Match the project's
  existing choice first.
- **Headless/behavior foundations** (accessibility solved, zero look): Base UI (from the
  Radix/Floating UI/MUI lineage) · Radix Primitives · React Aria · Ark UI (React/Vue/Solid/Svelte).
- **Styled starting points:** shadcn/ui and its registry ecosystem — but **re-theme it to the
  committed direction**; the default look shipped as-is is the new slop (see `direction.md`).
  Others worth knowing: Mantine, HeroUI, DaisyUI (CSS-only).
- **Per framework:** Vue → Reka UI (powers Nuxt UI), PrimeVue, shadcn-vue · Svelte → bits-ui,
  shadcn-svelte, Melt UI · Solid → Kobalte, Ark UI · Angular → Angular Material, Spartan ·
  Web Components → Lit; Shoelace lineage (verify its current name/status online).
- **Motion:** Motion (formerly Framer Motion — React/JS/Vue, `motion.dev`) · GSAP (free including
  former club plugins; framework-agnostic, timeline-strong) · anime.js · native View Transitions
  API and CSS scroll-driven animations (check current browser support when targeting them).
- **Fonts:** Fontsource (self-host via npm) · Google Fonts (variable families) · Fontshare (free
  professional display faces). Load variable fonts, subset, `font-display: swap`, and use real
  weights/optical sizes. A deliberate system-font stack is a valid _instrument-panel_ choice.
  **Typefaces with a voice** (free; verify availability at use-time — full pairings live in the
  lineage capsules, `lineages.md`): grotesks with range — Archivo, Hanken Grotesk,
  Schibsted Grotesk, Bricolage Grotesque; Fontshare display — General Sans, Cabinet Grotesk,
  Clash Display; serifs — Fraunces (variable opsz), Newsreader, Instrument Serif, Alegreya,
  Source Serif 4; monos — JetBrains Mono, IBM Plex Mono, Commit Mono, Space Mono; pixel/era —
  Departure Mono, Silkscreen, DotGothic16. Reaching for Inter/Poppins instead of this list is
  the fingerprint (`direction.md`) unless the lineage justifies it.
- **Icons:** Lucide · Phosphor · Tabler · Heroicons · Remix Icon. Pick ONE set per product; match
  stroke width to the type's weight; size on the spacing grid.

## Mobile native

- **iOS/iPadOS/macOS:** SwiftUI with the current Apple design language (Liquid Glass since
  iOS 26 — materials via APIs like `glassEffect()`; verify current HIG guidance online). Respect
  HIG navigation/gesture idiom; innovate in identity (type, color), not chrome mechanics.
- **Android:** Jetpack Compose with Material 3 / M3 Expressive (dynamic color, motion schemes).
  Deviating from Material is legitimate _brandwork_ — do it via a full custom design system, not
  by half-overriding Material defaults.
- **Cross-platform:** Flutter (Material 3 by default; `fluent_ui` for Windows idiom; Cupertino has
  historically lagged new Apple languages — verify before promising native look) ·
  Compose Multiplatform · React Native (pair with the web rules above).

## Desktop native

- **Windows:** WPF (.NET 9+ ships a Fluent theme; WPF UI by lepoco for the full Fluent kit) ·
  WinUI 3. Respect Windows 11 idiom: Mica/Acrylic materials, Segoe UI Variable, corner radii,
  light+dark.
- **Cross-platform:** Avalonia (WPF-like, own theming) · Uno (WinUI everywhere) · Qt/QML · GTK4 +
  libadwaita (GNOME HIG). Electron/Tauri/webview shells follow ALL the web rules plus native
  feel: real window chrome decisions, native menus/shortcuts, no browser-scrollbar look.
- Desktop is _lived in_: density and keyboard-first flows beat marketing airiness; every list
  gets keyboard navigation; respect the OS accent color and theme unless the direction overrides
  deliberately.

## Terminal (TUI)

Design discipline applies to terminals too: Textual (Python) · ratatui (Rust) · Bubble Tea +
Lip Gloss (Go) · OpenTUI (TypeScript). The medium's foundations: a deliberate 16/256/truecolor
palette with a graceful fallback, box-drawing hierarchy, whitespace via padding not blank-line
spam, and state shown redundantly (color + symbol) because themes vary wildly.

## Dataviz

- **Libraries:** Observable Plot (concise grammar, exploratory-to-production) · Apache ECharts
  (interactive dashboards at scale, canvas) · D3 (full control, bespoke/editorial) · visx (React
  primitives) · uPlot (huge time series, tiny) · Chart.js (simple embeds) · LayerChart (Svelte) ·
  Vega-Lite (declarative specs).
- **Craft rules regardless of library:** direct labels over legends when series ≤ 4 · one
  categorical palette derived from the design tokens (OKLCH-spaced, colorblind-checked — never
  library defaults, never rainbow) · axes start at zero for bars (not necessarily lines) ·
  tabular-nums everywhere numbers align · gridlines quieter than data (hairline, low contrast) ·
  no 3D, no glow, no dual axes without explicit justification.

## Brand / print / slides

Vector deliverables are code too: hand-crafted SVG (logos, marks — clean paths, optical
corrections, test at 16px and 512px), design tokens as the bridge to any tool, and for print-like
documents whatever typesetting stack the project already has. Slides follow the same direction
protocol — one lineage, one type system, one accent — which is exactly what generated decks never
have.

## Choosing when the project has nothing yet

Prefer, in order: (1) what the codebase already uses; (2) the platform's native idiom; (3) the
smallest real library that covers the need with accessibility solved; (4) bespoke — only with the
skill's foundations applied and the a11y gate passed. Record the choice and the reason in the
deliverable.
