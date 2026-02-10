# Scratchpad — Dark Mode for Main Application

- Plan slug: `dark-mode`
- Created: `2026-02-09`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Decisions

- (2026-02-09) Two token systems exist: `--color-*` (main app, in globals.css) and `--alga-*` (ui-kit, in tokens.css). Need a mapping layer rather than replacing one — both are entrenched.
- (2026-02-09) Theme switching uses CSS class on `<body>` (`.light` / `.dark`) — this matches the existing globals.css structure and is compatible with Tailwind's `darkMode: 'class'`.
- (2026-02-09) The ui-kit uses `data-theme="dark"` on `<html>` — we'll need to set both the body class AND the data-theme attribute when switching.
- (2026-02-09) **USE `next-themes`** — stable (<1KB, 6K+ stars, zero deps), handles SSR flash prevention, localStorage, system preference, and cross-tab sync. Replaces our broken `ThemeContext`. Hydration mismatch handled with `mounted` guard on toggle UI.
- (2026-02-09) **PERSIST TO DB** — store theme preference in existing `user_preferences` table (`setting_name: 'theme'`). No new migration needed. `UserPreferences.upsert()` and existing REST API (`PUT /api/v1/users/[id]/preferences`) used for persistence. localStorage used as immediate cache; DB synced async for cross-device consistency.
- (2026-02-09) **INCLUDE CLIENT PORTAL** — dark mode for both MSP and client portal in this effort. Client portal needs: add `ThemeProvider` to `ClientPortalLayoutClient.tsx`, add toggle to nav bar, fix `bg-gray-100` hardcoding, ensure `BrandingProvider` works in dark mode, cover auth pages.
- (2026-02-09) **FIX DARK SUBMENU COLORS** — current `.dark` values (`--color-submenu-bg: #D0D5DD`, `--color-submenu-text: #000000`) are incorrect for dark mode. Fix to proper dark palette (e.g., `#1f2937` bg, `#f5f5f5` text).
- (2026-02-09) **ADD BRANDING PREVIEW MODES** — client portal branding settings page gets a dark/light mode toggle in the preview panel so admins can see how branded colors look in both themes.
- (2026-02-09) **AUTO-ADJUST BRANDED SHADES** — `BrandingProvider` will generate inverted shade scale for dark mode (swap 50↔900 etc.), matching the static primary/secondary inversion pattern in globals.css. No separate tenant dark-mode colors needed.
- (2026-02-09) **TOGGLE FOR PREVIEW** — single toggle switch in branding settings, not side-by-side comparison.
- (2026-02-09) **SELECTORS VERIFIED COMPATIBLE** — globals.css `.dark`/`.light` are bare class selectors (not `body.dark` or `html.dark`). They match `<html class="dark">` (next-themes default target) correctly. CSS variables cascade to all descendants. No selector changes needed.
- (2026-02-10) Installed `next-themes` in `server` workspace via npm workspaces to satisfy FR-1.1.
- (2026-02-10) Enabled Tailwind dark mode via `darkMode: 'class'` in `server/tailwind.config.ts`.
- (2026-02-10) Added theme-aware `--color-background`/`--color-card` CSS variables and switched Tailwind `background`/`card` colors to use them.
- (2026-02-10) Added theme-aware status color CSS variables and wired Tailwind `success`/`warning`/`error` colors to them.
- (2026-02-10) Replaced the light-locked ThemeContext with `next-themes` via `AppThemeProvider` in the root layout and removed the old context file.
- (2026-02-10) Added `useAppTheme()` hook to load theme preference from `/api/v1/users/:id/preferences` and persist changes back to the DB.
- (2026-02-10) Removed hardcoded `className="light"` from root `<body>` so next-themes controls the theme class.
- (2026-02-10) Added `ThemeBridge` to map resolved theme to Radix `appearance` and Mantine `forceColorScheme`.
- (2026-02-10) Created `ThemeToggle` dropdown (Light/Dark/System) powered by `useAppTheme`.
- (2026-02-10) Added `ThemeToggle` to the MSP header actions area.
- (2026-02-10) Moved `ThemeToggle` and `useAppTheme` into `@alga-psa/ui` so both MSP and client portal can share them; added toggle to client portal nav.
- (2026-02-10) next-themes provider now handles localStorage persistence and flash prevention without custom code.
- (2026-02-10) useAppTheme now persists theme changes to `user_preferences` via the v1 preferences API.
- (2026-02-10) useAppTheme loads the saved theme from `user_preferences` on auth and applies it.
- (2026-02-10) Added CSS variable mapping to sync `--color-*` tokens to `--alga-*` tokens and set `data-theme` via `ThemeBridge` so ui-kit tokens track theme changes.
- (2026-02-10) Updated iframe bridge to recompute and re-send theme tokens on theme changes (class/data-theme mutations).
- (2026-02-10) Fixed dark submenu CSS variables to use dark background and light text.
- (2026-02-10) Added dark-mode utility overrides for common Tailwind classes plus base body/header/main backgrounds to avoid white patches.
- (2026-02-10) Added dark-mode form field styling for inputs, selects, and textareas to use theme-aware colors.
- (2026-02-10) Replaced switch thumb hardcoded white with `--color-switch-thumb` and added checkbox/radio accent colors for dark mode.
- (2026-02-10) Updated `time-slot-working` background to use theme-aware card color.
- (2026-02-10) Replaced collaboration cursor hardcoded color with theme-aware text color variable.
- (2026-02-10) Updated table hover and dotted background colors to use theme-aware CSS variables.
- (2026-02-10) Marked common UI surfaces (buttons, tables, dialogs, dropdowns, tooltips, badges, tabs) as theme-aware based on shared tokenized styling and dark overrides.
- (2026-02-10) Replaced hardcoded hex colors in dashboard/editor/ticket/project/billing CSS modules with CSS variable references.
- (2026-02-10) Extension loading overlay already uses CSS variables, marked as dark-mode ready.
- (2026-02-10) Added AppThemeProvider + ThemeBridge to client portal layout for theme class + data-theme sync.

## Discoveries / Constraints

- (2026-02-09) `ThemeContext` (`server/src/context/ThemeContext.tsx`) is completely hardlocked to light — `setThemeStatus` ignores its argument and always sets `light`. This was intentional (comment says "Always set to light mode").
- (2026-02-09) Dark CSS variables are **fully defined** in globals.css under `.dark` class (lines 176-279). They invert the scale: 50=darkest, 900=lightest.
- (2026-02-09) Root layout (`server/src/app/layout.tsx:116`) has `className={\`light\`}` hardcoded on `<body>`.
- (2026-02-09) Tailwind config has `background: 'white'` and `card: 'white'` hardcoded (lines 44, 63). These must become CSS variable references.
- (2026-02-09) Status colors (success/warning/error) are hardcoded hex in Tailwind config (lines 51-62). Need CSS variable equivalents.
- (2026-02-09) Radix UI `<Theme>` is rendered without an `appearance` prop (layout.tsx:62).
- (2026-02-09) `<MantineProvider>` has no theme configuration (layout.tsx:60).
- (2026-02-09) globals.css has hardcoded `white` in switch thumb (lines 528, 580), `time-slot-working` (line 639), and `rgba(0,0,0,0.05)` in table hover (line 473) and `bg-dotted` (line 428).
- (2026-02-09) Dark `.dark` block sets submenu to `--color-submenu-bg: #D0D5DD` (light gray) and `--color-submenu-text: #000000` (black) — this looks wrong for a dark theme and likely needs fixing.
- (2026-02-09) 12 CSS module files contain hardcoded hex colors. Key files: `Dashboard.module.css`, `TextEditor.module.css`, `TicketDetails.module.css`, `ProjectDetail.module.css`, `billing-dashboard/*.module.css`.
- (2026-02-09) Agent scan found ~5,084 Tailwind color class references across ~602 files. Zero `dark:` prefixed classes exist currently.
- (2026-02-09) Zero hardcoded hex colors in TSX files — all color application is via Tailwind classes or CSS variables. This is very good for migration.
- (2026-02-09) `suppressHydrationWarning` is already set on `<body>` — good for dynamic class application.
- (2026-02-09) Extension iframe bridge (`iframeBridge.ts`) sends `theme_tokens` during bootstrap but doesn't re-send on theme change. Will need a theme change listener.

## Commands / Runbooks

### Start the App for Visual Testing

```bash
# Option A: Full Docker stack (Community Edition)
docker compose -f docker-compose.base.yaml -f docker-compose.ce.yaml up

# Option B: Full Docker stack (Enterprise Edition, includes extensions)
docker compose -f docker-compose.base.yaml -f docker-compose.ee.yaml up

# Option C: Local dev (faster iteration — requires DB + Redis running)
docker compose -f docker-compose.base.yaml up -d db redis
npm run build:shared    # first time only
npm run dev             # http://localhost:3000
# or with Turbopack:
npm run dev:turbo
```

### Package Install

```bash
npm install next-themes --workspace server
```

### Quick Dark Mode Smoke Test (Before Toggle Exists)

```javascript
// In browser console — force dark mode:
document.body.className = 'dark';

// Revert to light:
document.body.className = 'light';

// Check CSS variable values:
getComputedStyle(document.body).getPropertyValue('--color-text-900');
```

### Find Files Needing Migration

```bash
# Files with hardcoded bg-white / bg-gray-* / text-gray-* etc
rg -l 'bg-white|bg-gray-|text-gray-|text-black|border-gray-' --glob '*.tsx' packages/ server/src/

# CSS modules with hex colors
rg -l '#[0-9a-fA-F]{3,8}' --glob '*.module.css' packages/ server/src/

# Count all Tailwind color refs
rg -c 'bg-(white|gray|red|green|blue|amber|black)|text-(gray|black|white)|border-gray' --glob '*.tsx' packages/ server/src/ | wc -l
```

### Validate Contrast Ratios

Use Chrome DevTools: Inspect element → Styles → click the color swatch → contrast ratio is shown.
Or use the Lighthouse accessibility audit.

## Links / References

- **ThemeContext**: `server/src/context/ThemeContext.tsx`
- **Root layout**: `server/src/app/layout.tsx`
- **Tailwind config**: `server/tailwind.config.ts`
- **globals.css**: `server/src/app/globals.css`
- **UI Kit tokens**: `packages/ui-kit/src/theme/tokens.css`
- **UI Kit useTheme hook**: `packages/ui-kit/src/hooks/useTheme.ts`
- **Iframe bridge**: `server/src/lib/extensions/ui/iframeBridge.ts`
- **UI Kit Showcase PRD**: `docs/plans/2026-02-04-ui-kit-showcase-extension/PRD.md`
- **CSS modules with hex colors**:
  - `packages/ui/src/components/dashboard/Dashboard.module.css`
  - `packages/ui/src/editor/TextEditor.module.css`
  - `packages/ui/src/editor/TicketDetails.module.css`
  - `packages/tickets/src/components/ticket/TicketDetails.module.css`
  - `packages/projects/src/components/ProjectDetail.module.css`
  - `packages/billing/src/components/billing-dashboard/*.module.css`

## Resolved Questions

- [x] Install `next-themes` — yes, decided. Pros far outweigh the single dependency cost.
- [x] Persist to DB — yes, use existing `user_preferences` table. No migration needed.
- [x] Client portal — include in this effort.
- [x] Dark submenu colors — they're wrong, fix them.
- [x] Branding preview — add dark/light mode preview toggle to branding settings page.
- [x] Branded shades — auto-adjust by generating inverted scale for dark mode (same algorithm, reversed step mapping). No separate tenant dark colors.
- [x] Preview format — single toggle switch, not side-by-side.
- [x] CSS selectors — **verified compatible**. `.dark`/`.light` are bare class selectors at globals.css:176/282. `next-themes` applies to `<html>` by default. Bare selectors match regardless of element. CSS variables cascade. No changes needed.

## Open Questions

(All resolved)

## User Preferences Integration

### Existing infrastructure (no changes needed):
- **Table**: `user_preferences` — PK `(tenant, user_id, setting_name)`
- **Model**: `server/src/lib/models/userPreferences.tsx` — `UserPreferences.upsert()`, `.get()`, `.getAllForUser()`
- **Service**: `packages/users/src/services/UserService.ts` — `getUserPreferences()`, `updateUserPreferences()`
- **API**: `PUT /api/v1/users/[id]/preferences` — body: `{ theme: "dark" }`
- **Example**: locale preference already stored this way

### Client Portal Layout Structure
```
ClientPortalLayoutClient.tsx
├── AppSessionProvider
├── I18nWrapper
├── BrandingProvider
└── [needs ThemeProvider here]
    └── ClientPortalLayout (has hardcoded bg-gray-100)
```

### CSS Selector Verification
- `globals.css:176` → `.dark {` — bare class selector, not element-bound
- `globals.css:282` → `.light {` — bare class selector, not element-bound
- `next-themes` default → applies class to `document.documentElement` (`<html>`)
- Old `ThemeContext` → applied class to `document.body`
- **Result**: bare selectors match either element. CSS variables on `<html>` cascade to `<body>` and all descendants. No migration needed.
- **Bonus**: `next-themes` also sets `style="color-scheme: dark"` on `<html>`, which affects browser-native scrollbars and form controls.

### Branding Shade Generation Algorithm
**File**: `packages/tenancy/src/lib/generateBrandingStyles.ts`

Current `generateColorShades(hexColor)`:
- **Light shades (50-400)**: Lerp towards white. `component + (255 - component) * factor`
  - 50: factor=0.95, 100: 0.90, 200: 0.75, 300: 0.60, 400: 0.30
- **Base (500)**: Unchanged original color
- **Dark shades (600-900)**: Multiply. `component * multiplier`
  - 600: 0.85, 700: 0.70, 800: 0.50, 900: 0.30
- Output format: `"r g b"` (space-separated, no commas)

**Dark mode strategy**: Generate same shades, then swap output mapping:
```
Light step 50  → Dark step 900 (lightest shade becomes highest step)
Light step 100 → Dark step 800
Light step 200 → Dark step 700
Light step 300 → Dark step 600
Light step 400 → kept similar (or minor adjustment)
Light step 500 → kept as-is (base color unchanged)
Light step 600 → Dark step 400
Light step 700 → Dark step 300
Light step 800 → Dark step 200
Light step 900 → Dark step 100 (darkest shade becomes lowest step)
```

**Injection approach**: `BrandingProvider` must emit two selector blocks:
```css
:root { --color-primary-50: <light-50>; ... }  /* existing */
.dark { --color-primary-50: <inverted-900> !important; ... }  /* new */
```

### Key client portal files:
- `server/src/app/client-portal/layout.tsx` — server layout, fetches branding + locale
- `server/src/app/client-portal/ClientPortalLayoutClient.tsx` — client wrapper with providers
- `packages/client-portal/src/components/layout/ClientPortalLayout.tsx` — UI shell with nav bar
- `packages/tenancy/src/components/providers/BrandingProvider.tsx` — injects branded CSS variables
- `packages/tenancy/src/lib/generateBrandingStyles.ts` — generates branded CSS on server side
- `server/src/app/auth/client-portal/signin/page.tsx` — auth page (needs ThemeProvider too)
