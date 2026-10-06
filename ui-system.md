# torreno Dashboard: Design Spec

This spec shows how to build an app dashboard in the visual language of **vellar.xyz**. That site is the earlier web3flutter-style system (poster type, one italic-serif accent word per headline, mono eyebrows, pill buttons, lime "drip" menu) rebuilt in Vellar's own forest-green, mint, lime and sun palette.

The token values here were read from vellar.xyz's live stylesheet: the app theme variables (`:root` / `[data-theme="light"]`) and the landing variables (`.lp`). Reuse these names. **Don't invent new colors.**

> **Agent rules:** Use only the tokens in §1. Every card must be one of the types in §4. Motion must use the durations and easings in §7. If you need a pattern that isn't listed, build it from existing tokens and components, then note it in your summary.

---

## 0. Dashboard principles (how this differs from the landing page)

| Landing page | Dashboard |
|---|---|
| Poster headlines, scroll scenes, curtains, marquees | Calm, dense, scannable. **No sticky scroll scenes, no scroll-scrubbed transforms.** |
| Huge display type everywhere | The display font is kept for **numbers and page titles**. Everything else uses body text at 14–16 px. |
| Tinted cards for decoration | Tinted fills **carry meaning**: each tint maps to a category or status (§1.2). |
| Lots of motion | Motion only confirms an action: hover lift, reveal on first load, live pulse, copy feedback. |

The brand signature still has to be visible on every screen:
1. **Mono uppercase eyebrow** above every title.
2. **One italic-serif accent word** in the page title (e.g. "Payments, *settled.*").
3. **Pill buttons** with sun / forest / outline variants.
4. **Rounded tinted cards** in mint-soft, sun-soft or lime-soft, plus one ink card as the anchor.
5. **Live signal dot** (mint, pulsing) wherever data is real-time.

---

## 1. Tokens

### 1.1 App theme: dark is the default, light is opt-in via `data-theme="light"`

```css
:root {                         /* DARK (default app theme) */
  --bg: #060a09;          --bg2: #0a100e;
  --surface: #111a17;     --surface2: #0d1613;
  --line: #ffffff17;
  --ink: #eff5f2;         --muted: #eff5f2bd;      --muted2: #eff5f28f;
  --chip: #ffffff0f;
  --green: #13594d;       --green-mid: #1f8a72;
  --signal: #3ee6ad;      --lime: #c8f048;         --negative: #ff6b5e;
  --neo-bg: #0a0f0d;      --neo-surface: #0e1512;
  --neo-light: #3ee6ad0f; --neo-shadow: #000000a8;
  --neo-raised:    -6px -6px 16px var(--neo-light), 8px 8px 20px var(--neo-shadow);
  --neo-raised-sm: -3px -3px 8px var(--neo-light), 4px 4px 10px var(--neo-shadow);
  --neo-inset:     inset 4px 4px 10px var(--neo-shadow), inset -4px -4px 10px var(--neo-light);
  --shell-header-h: 92px;
}
:root[data-theme="light"] {     /* LIGHT */
  --bg: #eef2f0;          --bg2: #e6ece9;
  --surface: #ffffff;     --surface2: #f2f6f4;
  --line: #060a091a;
  --ink: #0d1a15;         --muted: #0d1a15b8;      --muted2: #0d1a1585;
  --chip: #0d1a150f;
  --signal: #10b981;
  --neo-bg: #eef2f0;      --neo-surface: #f4f8f6;
  --neo-light: #ffffffe6; --neo-shadow: #060a0924;
  /* --neo-raised / --neo-raised-sm / --neo-inset use the same formulas as dark */
}
```

### 1.2 Brand accents (from the landing page `.lp`), with their dashboard meaning

```css
:root {
  --forest: #13594d;   --forest-ink: #0c3b31;      /* brand ink / anchor cards */
  --mint: #3ee6ad;     --mint-soft: #dcf8ec;       /* success, settled, live */
  --lime: #c8f048;     --lime-soft: #f0f9d2;       /* primary highlight, focus ring, active nav */
  --sun:  #ffc94a;     --sun-soft:  #ffefc9;       /* primary CTA, pending, attention */
  --coral:#ff6b5e;     --coral-soft:#ffe4e0;       /* error, refused, negative delta */
}
```

| Meaning | Solid (dots, bars, text on dark) | Soft (card fill on light) | Dark-theme fill |
|---|---|---|---|
| Settled / success / live | `--mint` | `--mint-soft` | `color-mix(in srgb, var(--mint) 12%, var(--surface))` |
| Pending / needs action | `--sun` | `--sun-soft` | `color-mix(in srgb, var(--sun) 12%, var(--surface))` |
| Highlight / selected / active | `--lime` | `--lime-soft` | `color-mix(in srgb, var(--lime) 12%, var(--surface))` |
| Refused / error / negative | `--coral` (= `--negative`) | `--coral-soft` | `color-mix(in srgb, var(--coral) 12%, var(--surface))` |
| Anchor / hero metric | `--forest-ink` fill, white text | n/a | `--green` fill |

Text on any *-soft fill is always `--forest-ink` (#0c3b31), at 74% (`#0c3b31bd`) for secondary text and 55% (`#0c3b318c`) for faint text. Text on forest or ink fills is white, with secondary text at `#ffffffc7` and faint text at `#ffffff8c`.

### 1.3 Typography

| Role | Family | Use in the dashboard |
|---|---|---|
| Display | **Cabinet Grotesk** (fallback Plus Jakarta Sans), weight 700–800, tracking −0.01 to −0.02em | page titles, KPI numbers, card titles, amounts |
| Body | **Plus Jakarta Sans** 400/600/700 | all UI text, tables, buttons (700) |
| Mono | **Space Mono** 400/700 | eyebrows, labels, IDs, hashes, addresses, code, axis ticks |
| Serif accent | **Playfair Display** *italic* 600, tracking −0.02em | ONE word per page title or empty-state headline (`<em>`) |
| Condensed poster | **Anton** | empty states or a 404 only. Never inside data UI. |

Load Cabinet Grotesk from Fontshare and the other four from Google Fonts.

Type scale for the dashboard (the landing clamps are tightened for density):

| Token | Value | Used for |
|---|---|---|
| `--fs-title` | `clamp(1.75rem, 1.4rem + 1.2vw, 2.5rem)` | page title (display 800) |
| `--fs-h3` | `1.1875rem` | card titles (display 700) |
| `--fs-kpi` | `clamp(2rem, 1.6rem + 1.4vw, 3rem)` | KPI values (display 800, line-height 1) |
| `--fs-body` | `0.9375rem` | default UI text |
| `--fs-sm` | `0.8125rem` | table cells, meta |
| `--fs-eyebrow` | `0.75rem` mono 700, tracking 0.22em, uppercase | section eyebrows |
| `--fs-label` | `0.6875rem` 700, tracking 0.14em, uppercase | field labels |

### 1.4 Space, radius, elevation, motion tokens

```css
:root {
  --sp-2: .5rem; --sp-3: .75rem; --sp-4: 1rem; --sp-6: 1.5rem; --sp-8: 2rem; --sp-12: 3rem;
  --gutter: clamp(1.25rem, 4vw, 2.5rem);
  --r-pill: 9999px; --r-card: 2rem; --r-lg: 1rem; --r-md: .75rem;
  --sh-card: 0 40px 100px #0c3b3173;        /* modals / spotlight only */
  --sh-hover: 0 8px 20px rgba(12,59,49,.12); /* card hover */
  --sh-glow: 0 12px 40px #c8f04826;          /* lime glow for the active / primary card */
  --ease-rise: cubic-bezier(.22,.95,.3,1);   /* entrances */
  --ease-io:   cubic-bezier(.65,.05,.36,1);  /* panels, drawers */
  --dur-fast: .2s; --dur-reveal: .6s;
}
```

---

## 2. App shell layout

```
┌───────────────────────────────────────────────────────────────────────┐
│ Header  h = var(--shell-header-h) 92px, sticky, bg = color-mix(bg 88%) │
│ + backdrop-blur(12px), border-bottom 1px var(--line)                  │
├──────────────┬────────────────────────────────────────────────────────┤
│ Sidebar      │ Main  (padding var(--gutter), max-width 1240px, centered)
│ 248px        │  PageHeader                                            │
│ bg --bg2     │  KPI row (4 cards)                                     │
│ border-right │  12-col grid of cards, gap var(--sp-6)                 │
│ --line       │                                                        │
└──────────────┴────────────────────────────────────────────────────────┘
```

**Header:** brand mark (left), global search (center, pill input), network chip (`TESTNET` / `MAINNET` in mono inside a `--chip` pill), theme toggle, account button. The account menu may use the **lime drip-blob** from the landing nav as its one signature flourish: spring `{stiffness:300, damping:28}`, closed 140×48, opened as a panel.

**Sidebar:**
- Width 248px; collapses to a 72px icon rail at < 1280px and becomes a drawer at < 768px.
- Groups get mono eyebrows (`10px`, tracking 0.3em, `--muted2`).
- Items: `px-4 py-3 rounded-xl`, 15px, 600.
  - Idle: `--muted`. Hover: `--chip` background.
  - **Active:** `--lime` text and a 3px lime bar on the left edge on dark; `--lime-soft` fill with forest-ink text on light. Active icons sit inside a 28px circle with a lime fill.
- Bottom of the sidebar: a **status card** (§4.8) showing facilitator health with the live dot.

**Main grid:** 12 columns, `gap: var(--sp-6)`, row gap `var(--sp-6)`. Standard spans:

| Card | Span (≥1280) | 768–1279 | < 768 |
|---|---|---|---|
| KPI | 3 | 6 | 12 |
| Chart (primary) | 8 | 12 | 12 |
| Side list / activity | 4 | 12 | 12 |
| Table | 12 | 12 | 12 (becomes a card list) |
| Split "For X / For Y" panels | 6 + 6 | 12 | 12 |

**Page header (on every page):**
```tsx
<header className="flex flex-wrap items-end justify-between gap-6 mb-8">
  <div>
    <p className="eyebrow">Payments · Testnet</p>                      {/* mono, 0.22em, uppercase */}
    <h1 className="page-title">Every payment, <em>settled.</em></h1>  {/* display 800 + serif italic em */}
    <p className="lead max-w-[56ch]">Live x402 settlements verified by your facilitator.</p>
  </div>
  <div className="flex gap-3">
    <Button variant="outline">Export CSV</Button>
    <Button variant="sun">New endpoint</Button>
  </div>
</header>
```
Keep the lead text to 56ch max, 1.6 line-height, in `--muted`. Links inside it get a 2px mint underline, offset 3px, which turns ink on hover.

---

## 3. Base surfaces

| Surface | Dark | Light | Radius | Border | Use |
|---|---|---|---|---|---|
| Page | `--bg` | `--bg` | n/a | n/a | canvas |
| **Card** (default) | `--surface` | `--surface` | `--r-lg` 1rem | 1px `--line` | everything |
| **Panel** (feature) | `--surface` or a tint | tint | `--r-card` 2rem | none | split panels, hero metrics, onboarding |
| **Field** (inset data) | `--surface2` | `#f5f9f6` | `--r-md` .75rem | 1px `--line` | labelled values inside cards |
| **Neo raised** | `--neo-surface` + `--neo-raised` | same | `--r-lg` | none | toggles, segmented controls, small widgets only |
| **Neo inset** | `--neo-bg` + `--neo-inset` | same | `--r-md` | none | input wells, sliders, the progress-track background |
| **Terminal** | `#0c3b31` (forest-ink) | `#0c3b31` | `--r-lg` | 1px `#ffffff29` | CLI snippets, logs, raw payloads |

Card padding: `var(--sp-6)` (24px) by default and 32px for panels. Gap between internal blocks: `var(--sp-3)` to `var(--sp-4)`.

---

## 4. Card catalog (use only these)

Every card has the same anatomy, top to bottom:
1. **Header row:** a mono eyebrow on the left, plus an optional action or chip on the right.
2. **Title:** display 700, 19px.
3. **Body.**
4. **Footer** (optional): `border-top 1px --line`, `pt-4`, mono meta on the left, a "go →" link on the right.

### 4.1 KPI card (tinted rotation, from `.lp-proofcard`)

KPI rows use the landing's 4-step tint rotation, so the row reads as a set:

| Position | Fill | Text |
|---|---|---|
| 1st | `--mint-soft` | forest-ink |
| 2nd | `--sun-soft` | forest-ink |
| 3rd | `--lime-soft` | forest-ink |
| 4th | `--forest-ink` (#0c3b31) | white (label `#ffffffc7`) |

In the dark theme, keep the same tints (they glow against the dark canvas) or switch to the 12% `color-mix` fills from §1.2. Pick one and keep it the same across the whole app.

```tsx
<a className="kpi" href="/payments">
  <span className="kpi-label">Settled · 24h</span>            {/* mono .75rem uppercase .08em, ink-soft */}
  <span className="kpi-value">1,284</span>                    {/* display 800 --fs-kpi, line-height 1 */}
  <span className="kpi-delta up">▲ 12.4% vs prev</span>       {/* .8125rem 700; up = forest/mint, down = coral */}
  <Sparkline />                                               {/* 32px tall, stroke currentColor at 60% */}
  <span className="kpi-go">View payments →</span>             {/* mono .75rem; hidden until hover */}
</a>
```
```css
.kpi { display:flex; flex-direction:column; gap:var(--sp-3); padding:var(--sp-6);
       background:var(--fill); border:1px solid var(--line); border-radius:var(--r-lg);
       transition: transform .15s, box-shadow .15s; }
.kpi:hover { transform: translateY(-3px); box-shadow: var(--sh-hover); }
.kpi-go { opacity:0; transform:translateX(-4px); margin-top:auto;
          font:600 .75rem var(--font-mono); transition: opacity .15s, transform .15s; }
.kpi:hover .kpi-go { opacity:1; transform:none; }
```

### 4.2 Chart card
- Default card surface.
- Header: eyebrow "VOLUME · 30D", title, and on the right a **pill segmented control** (24H / 7D / 30D). The active segment uses `--lime` fill with ink text; idle segments are `--muted`.
- Plot area: 280px tall (220px on mobile).
- Series colors, in order: `--mint`, `--lime`, `--sun`, `--coral`, then `--green-mid`. Area fills use the series color at 16% opacity.
- Gridlines `--line`, horizontal only. Axis ticks in Space Mono 11px `--muted2`. Don't draw an axis line.
- Tooltip: a terminal surface (forest-ink), with a mono label and a display-700 value.
- Live charts show the signal dot in the header (§4.8).

### 4.3 Table card (transactions, endpoints)
- The card has no inner padding on the table itself; the header row keeps `--sp-6` padding.
- `th`: mono 11px, 700, uppercase, tracking .14em, `--muted2`, `border-bottom 1px --line`, `py-3 px-4`.
- `td`: 13–14px body, `py-3.5 px-4`, row `border-bottom 1px --line`, row hover `--chip` background (150ms).
- Hashes, addresses and IDs use Space Mono, are truncated in the middle (`GABX…7Q2P`), and have a copy icon that appears on row hover.
- Amounts: display 700, right-aligned, `tabular-nums`, with the asset code in mono `--muted2`.
- Status column: a **status pill** (§5.3).
- A row is clickable when it opens a detail drawer (§6.3).
- Toolbar above the table: a search pill input on the left, filter chips (§5.2) next to it, and Export (outline sm) on the right.
- Under 768px each row becomes a stacked mini-card: the amount on top, then status, then the mono hash.

### 4.4 Field card / labelled value (from `.lp-field`)
For details and summaries (a payment's amount, fee, network):
```html
<div class="field">
  <span class="lbl">AMOUNT</span>                     <!-- .6875rem 700 .14em, faint -->
  <div class="row"><span class="amt">0.50 USDC</span><span class="badge">x402</span></div>
  <div class="sub"><span>Fee sponsored</span><span>~5s finality</span></div>   <!-- .75rem faint -->
</div>
```
`.amt` is display 700, 1.375rem, tracking −0.01em. The field background is `--surface2`, with a 1px `--line` border and `--r-md` radius. Stack fields with `gap: var(--sp-2)`.

### 4.5 Split audience panels (from "For sellers / For agents")
A pair of `--r-card` panels on a 6+6 split.
- Left panel: `--mint-soft` fill (light theme) or a mint 12% mix (dark).
- Right panel: **forest** (`--green`) fill with white text.
- Each panel holds: a display-700 title (1.75rem), a lead paragraph, an embedded terminal or field stack, and a pill CTA at the bottom. The left CTA is forest; the right CTA is sun.
- Use these for onboarding ("Sell an endpoint" / "Pay as an agent") or for comparing two modes.

### 4.6 Terminal / code card
- Forest-ink background, Space Mono 13px, line-height 1.7, padding `--sp-4`. The prompt `$` is shown at `#ffffff8c`.
- A successful line ends with a right-aligned `✓ paid` in `--lime`; a failed line ends with `✗ refused` in `--coral`.
- A copy button in the top-right is a ghost button (sm) that switches to "Copied ✓" in mint for 2s.
- Logs stream new lines in with `opacity 0 → 1, y 4 → 0` over 200ms.

### 4.7 Activity / feed card
- A vertical list with 14px rows and `gap: var(--sp-3)`.
- Each row: a 10px status dot (mint, sun or coral), a body-600 title, a mono timestamp on the right (`--muted2`), and an optional amount.
- New items **slide in from the top**: `y −8 → 0, opacity`, 300ms `--ease-rise`. The newest row gets a lime-soft background that fades out over 1.2s.
- An optional **ticker** strip (the landing marquee) can run across the top of the Overview page, showing the latest settlements as `◆ 0.50 USDC · weather-api · 3s ago`. It loops `translateX 0 → −50%` linear over 40s, pauses on hover, and is hidden under reduced motion.

### 4.8 Status / health card
- Small card: eyebrow "FACILITATOR", a value like "Operational" in display 700, and a **live dot**: an 8px `--signal` circle with `animation: pulse 2s infinite` (`@keyframes pulse { 50% { opacity: .5 } }`) plus a ring (`box-shadow 0 0 0 4px` signal at 20%).
- Degraded: sun dot, no pulse. Down: coral dot plus a coral-soft card fill.
- Optional uptime bar: 30 slim bars 4px wide with 2px gaps, colored mint, sun or coral, each with a tooltip on hover.

### 4.9 Progress / step card (from `.lp-slat`)
- For multi-step flows (onboarding, "make your first payment").
- Steps run in a row. Each has a mono number, a display-700 title, and the description shown when the step is active.
- The active step has a **4px progress bar** along its bottom edge in the step's accent color, scaling `scaleX(0 → 1)` from the left (the landing uses 4.6s linear for auto-advance; for user-driven steps, tie it to completion).
- Completed steps show a mint check.

### 4.10 Empty state card
- Panel radius, dashed 1.5px `--line` border, centered content.
- A headline in display 800 with a serif-italic word ("No payments *yet.*"), one sentence of help, and a sun CTA.
- Optionally an **Anton** poster word in the background at 6% opacity, cropped by the card edge.

---

## 5. Components

### 5.1 Buttons (pill, from `.lp-btn`)
Base: body font 700, `.9375rem`, `padding .9em 1.6em`, `border-radius 9999px`, `gap .6em`, transitions on background, color and translate (`.2s ease`). `:active` → `translate: 0 1px`. `:disabled` → opacity .45.

| Variant | Rest | Hover | Use |
|---|---|---|---|
| `sun` | sun background, ink text | ink background, sun text | **one** primary action per view |
| `forest` | ink/forest background, white text | mint background, ink text | secondary solid |
| `outline` | transparent, `inset 0 0 0 2px` ink | ink background, paper text | tertiary |
| `ghost` | transparent, `inset 0 0 0 2px` white | white background, ink text | on forest/ink surfaces |
| `lime` | lime background, ink text | ink background, lime text | primary on dark canvases where sun clashes |

Sizes: `sm` (`.75em 1.3em`, .8125rem), `md` (default), `lg` (`1em 1.9em`, 1.0625rem). Icon-only buttons are 40px circles that follow the same variants. Destructive actions use an outline button with coral and hover to a coral fill.

### 5.2 Chips (filters, tags)
`border 1px var(--line-strong, #0c3b3152)`, pill shape, `padding 5px 12px`, .75rem 700. **Selected:** `--mint-soft` background (12% mint on dark) with a transparent border. Multi-select is allowed.

### 5.3 Status pills and badges

| Status | Pill |
|---|---|
| Settled / Verified | mint-soft background, forest-ink text, mint dot |
| Pending | sun-soft background, ink text, sun dot (pulsing) |
| Refused / Failed | coral-soft background, `#8a1f17` text, coral dot |
| Draft / Inactive | `--chip` background, `--muted` text |

Pill shape: `padding 4px 10px`, .75rem 700, a 6px leading dot. **Badge** (neutral metadata such as `x402` or `USDC`): paper or surface background, `1px --line-strong`, `padding 6px 12px`, .8125rem 700, `--r-md`.

### 5.4 Inputs
- Height 44px, `--r-md` (search fields use the pill radius), `--surface2` background, 1px `--line` border, 15px text.
- Mono for values that are addresses or keys.
- Focus: `outline 2px solid var(--lime); outline-offset 3px; box-shadow 0 0 0 3px var(--ink)`. This is the site's exact focus ring; use it on **every** focusable element.
- Label above the input in the field-label style.
- Error: coral border plus a coral helper text line.

### 5.5 Tabs
Pill tabs in a row with `gap: 4px`. Active: `--lime` 10% background, lime text, 1px lime-20% border. Idle: `--muted` text, hover `--ink`. The content swaps with `opacity 0 → 1, y 12 → 0`, .25s.

### 5.6 Copy-to-clipboard (used everywhere)
Icon or label button. On success it switches to `Check` plus "Copied" in mint (or a mint-soft background) for **2s**, then reverts. The same timing applies across the whole app.

### 5.7 Toasts
Bottom-right, terminal surface (forest-ink), `--r-lg`, white text, a 4px left bar in the status color. They enter with `y 16 → 0, opacity` over .3s `--ease-rise` and auto-dismiss after 4s.

### 5.8 Modal and drawer
- **Modal:** surface `--r-card`, shadow `--sh-card`, backdrop `#060a09b3` with `backdrop-blur(6px)`. Enter `scale .96 → 1, opacity` over .25s `--ease-rise`.
- **Detail drawer** (right side, 480px, full-screen on mobile): `x 100% → 0`, spring `{damping:25, stiffness:250}`. It contains: header (eyebrow + title + close), a field stack, a terminal block with the raw payload, a "View on ledger ↗" outline button, and a timeline (activity rows).

---

## 6. Page compositions

### 6.1 Overview
1. Page header: "Your payment layer, *live.*"
2. Optional ticker strip (§4.7).
3. KPI row ×4 in tint rotation: Settled 24h · Volume (USDC) · Active endpoints · Refused.
4. Volume chart (8 columns) next to the activity feed (4 columns).
5. Table: recent payments (12 columns, 8 rows, then "View all →").
6. Split panels: "Sell an endpoint" / "Pay as an agent" (only when the user has no endpoints).

### 6.2 Payments
Page header with filters. Toolbar: search, chips (All · Settled · Pending · Refused), date range, Export. Full table. Clicking a row opens the detail drawer.

### 6.3 Endpoints (Bazaar listings)
- A grid of endpoint cards (span 4). Each card has:
  - an eyebrow with the method and path (mono)
  - the endpoint name as a display-700 title
  - a price badge
  - a 24h calls sparkline
  - a status pill
  - a toggle (neo raised)
  - a "Manage →" footer
- Hover: lift −3px with the hover shadow.
- The selected or featured card gets `--sh-glow` and a lime border.

### 6.4 Settings
A two-column layout: left, a sticky in-page nav (mono eyebrows + items, like the sidebar); right, stacked cards for each section, each with a title, description and fields. Danger zone: a coral-soft panel with an outline-coral button.

---

## 7. Motion

| What | Values |
|---|---|
| First-load reveal (cards) | `opacity 0 → 1, y 16 → 0`, `--dur-reveal` .6s, `--ease-rise`, stagger 60ms per card. **First load only**, never on re-render. |
| Card hover | `translateY(-3px)` + `--sh-hover`, .15s |
| Hover arrow "go →" | opacity 0 → 1, x −4 → 0, .15s |
| Buttons | color/background .2s ease; press `translate 0 1px` |
| Tab / page content swap | `opacity, y 12 → 0 → −12`, .25s, AnimatePresence `mode="wait"` |
| Drawer | spring damping 25 / stiffness 250 |
| Account drip menu | spring stiffness 300 / damping 28 |
| Live dot | `pulse` 2s infinite (opacity 1 → .5 → 1) |
| New feed row | `y −8 → 0`, .3s `--ease-rise`, lime-soft highlight fades over 1.2s |
| KPI number change | count-up over .6s `--ease-rise`, `tabular-nums` so the width doesn't jump |
| Ticker | marquee 40s linear, pause on hover |
| Smooth scroll | **Off in the dashboard.** Lenis is for the landing page only; app panes scroll natively. |

`prefers-reduced-motion`: turn off reveals, the marquee, the pulse and count-ups. Keep the instant state changes.

---

## 8. Responsive

| Width | Shell | Grid |
|---|---|---|
| ≥ 1280 | sidebar 248px + header | 12 columns, KPI 4-up |
| 1024–1279 | icon rail 72px | KPI 2×2, chart full width |
| 768–1023 | icon rail | single-column cards, table kept |
| < 768 | sidebar becomes a drawer (spring), header 64px, hamburger | everything 1 column, tables become row-cards, KPI 2-up with the last card spanning both columns (from `.lp-pillar:last-child`) |

Use `--gutter` (`clamp(1.25rem, 4vw, 2.5rem)`) for page padding at every size.

---

## 9. Accessibility checklist
- Focus ring on every interactive element: `outline 2px var(--lime)` + offset 3 + `0 0 0 3px var(--ink)` ring.
- Status is never shown by color alone: every dot or pill has a text label.
- Contrast: forest-ink on every soft tint passes AA. **Don't** put white text on lime, sun or mint; use ink.
- Sidebar items have `aria-current="page"`. Drawers and menus get `aria-expanded`, close on Esc, and trap focus.
- Tables use real `<table>` markup; on mobile, row-cards keep the column labels as `.lbl`.
- Number columns use `font-variant-numeric: tabular-nums`.

---

## 10. Do / Don't

**Do**
- One sun CTA per view.
- One serif-italic word per title.
- Mono eyebrow above every card title.
- Tints that carry meaning (mint = good, sun = pending, coral = bad, lime = selected).
- Keep the forest-ink card as the single "anchor" in a KPI row.

**Don't**
- Scroll-scrubbed scenes, curtains, tilted marquees of cards, or giant poster type inside data views. Those belong on the landing page.
- New hex values, gradients or extra fonts.
- Neo shadows on large cards. They are for small controls only.
- Mix both dark-theme tint strategies (§4.1) in one app.