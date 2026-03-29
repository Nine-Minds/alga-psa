# PRD — Dark Mode for Main Application

- Slug: `dark-mode`
- Date: `2026-02-09`
- Status: Draft

## Summary

Add dark mode support to the main Alga PSA application, including both the MSP portal and the client portal. The ui-kit-showcase extension already has a working dark mode implementation using CSS variables and a theme bridge. The main app's infrastructure is ~80% ready — complete light/dark CSS variable sets exist in `globals.css`, a `ThemeContext` exists (but is hardlocked to light), and Tailwind is configured with CSS variable-based colors. We will use `next-themes` for SSR-safe theme switching and persist the preference to the `user_preferences` database table (with localStorage as an immediate cache). The remaining work is wiring the theme infrastructure, adding a toggle UI, aligning token systems, migrating ~600 component files, and extending dark mode to the client portal.

## Problem

The Alga PSA application only supports light mode. Users working in low-light environments or who prefer dark interfaces have no option. The ui-kit-showcase extension has demonstrated a working dark mode, but the main application ignores the dark theme entirely — the `ThemeContext` is hardcoded to always set `light` regardless of user preference.

## Goals

1. Enable dark/light/system-preference theme switching in both MSP portal and client portal
2. Persist theme preference per user in the `user_preferences` DB table (with localStorage as fast cache)
3. Ensure all core UI surfaces render correctly in both light and dark modes
4. Align the two CSS variable systems (`--color-*` main app vs `--alga-*` ui-kit)
5. Propagate theme to extension iframes via the existing bridge
6. Maintain visual consistency with the ui-kit-showcase dark mode palette
7. Fix incorrect dark submenu colors (currently light gray on dark — should be proper dark palette)

## Non-goals

- Custom theme builder / arbitrary color customization
- Automated visual regression testing infrastructure (manual QA is sufficient for v1)
- Dark mode for email templates or PDF exports
- Dark mode for third-party embedded content (e.g. external widgets)

## Users and Primary Flows

### Target Users
- **MSP operators** using the internal portal daily (primary)
- **Client portal users** viewing tickets, invoices, and approvals (included in this effort)

### Flow 1: Toggle Theme (MSP Portal)
1. User clicks the theme toggle in the MSP header
2. Options: Light / Dark / System
3. App immediately switches theme (no reload)
4. Preference is persisted to localStorage immediately, then synced to `user_preferences` DB table
5. On next visit, saved preference is applied before first paint (no flash)
6. On login from a different device, preference is loaded from DB and applied

### Flow 1b: Toggle Theme (Client Portal)
1. Client portal user clicks theme toggle in the client portal navigation bar
2. Same Light / Dark / System options
3. Theme switches immediately; preference persisted the same way

### Flow 2: System Preference
1. User selects "System" mode
2. App reads `prefers-color-scheme` media query
3. Theme matches OS setting and updates if OS setting changes

### Flow 3: Extension Theme Sync
1. User switches theme in main app
2. Extension iframes receive updated theme tokens via postMessage
3. Extension UI updates to match

## UX / UI Notes

### Theme Toggle Location
- Primary: Header bar, near user avatar/settings
- A simple icon toggle (sun/moon) or a dropdown with Light/Dark/System options
- Must be accessible from every page without navigation

### Dark Mode Palette (from globals.css `.dark` class)
The dark palette is already defined and inverts the scale (50=darkest, 900=lightest):
- Background: `rgba(0, 0, 0, 1)` (pure black base)
- Text 900 (main text): `248 250 252` (near-white)
- Text 700 (secondary text): `226 232 240`
- Border 200 (standard borders): `51 65 85` (dark slate)
- Primary 500: `152 85 238` (lighter purple for dark bg)
- Sidebar bg: `#1b1a1a` (near-black)

### Flash-of-Wrong-Theme Prevention
- Use `next-themes` (`ThemeProvider`) which injects a blocking script to apply the theme class before React hydrates
- `suppressHydrationWarning` is already set on `<body>` — required by `next-themes`

### Areas Requiring Special Attention
- Sidebar and submenu (already have dark variables but need visual QA)
- Data tables (Radix UI Tables with custom overrides in globals.css)
- react-day-picker (date picker has custom color overrides)
- react-big-calendar (imported via CDN CSS)
- Charts/graphs (if any use hardcoded colors)
- Switch/toggle components (use hardcoded `white` in globals.css)
- Collaboration cursor (hardcoded `#0d0d0d`)

## Requirements

### Functional Requirements

#### FR-1: Theme Infrastructure
- FR-1.1: Install `next-themes` package
- FR-1.2: Add `darkMode: 'class'` to `server/tailwind.config.ts`
- FR-1.3: Replace hardcoded `background: 'white'` and `card: 'white'` in Tailwind config with CSS variable references
- FR-1.4: Make status colors (success, warning, error) theme-aware in Tailwind config
- FR-1.5: Replace custom `ThemeContext` with `next-themes` `ThemeProvider` in root layout — remove hardcoded `className="light"` on `<body>`
- FR-1.6: Create a thin wrapper hook `useAppTheme()` that combines `next-themes` `useTheme()` with DB sync logic
- FR-1.7: Pass `appearance` prop to Radix UI `<Theme>` component based on resolved theme
- FR-1.8: Pass `forceColorScheme` to `<MantineProvider>` based on resolved theme
- FR-1.9: Fix dark submenu CSS variables — change `--color-submenu-bg: #D0D5DD` / `--color-submenu-text: #000000` in `.dark` block to proper dark values (e.g., `#1f2937` bg, `#f5f5f5` text)

#### FR-2: Theme Toggle UI & Persistence
- FR-2.1: Create a `ThemeToggle` component with Light/Dark/System options (sun/moon icons)
- FR-2.2: Place the toggle in the MSP portal header bar
- FR-2.3: Place the toggle in the client portal navigation bar
- FR-2.4: `next-themes` handles localStorage persistence and flash prevention automatically
- FR-2.5: `next-themes` handles `prefers-color-scheme` listener for "System" mode automatically
- FR-2.6: On theme change, sync preference to `user_preferences` DB table (`setting_name: 'theme'`, `setting_value: 'dark'|'light'|'system'`) via existing `UserPreferences.upsert()` API
- FR-2.7: On authenticated page load, fetch theme preference from DB and apply (for cross-device sync); fall back to localStorage if DB not yet loaded

#### FR-3: Token System Alignment
- FR-3.1: Create a mapping layer between `--color-*` (main app) and `--alga-*` (ui-kit) tokens
- FR-3.2: Ensure both token sets update when theme changes
- FR-3.3: Update the iframe bridge to send correct tokens based on active theme

#### FR-4: Component Migration — Core Layout
- FR-4.1: Sidebar — verify dark variables render correctly
- FR-4.2: Header — verify dark variables render correctly
- FR-4.3: Submenu — verify dark variables render correctly
- FR-4.4: Main content area backgrounds
- FR-4.5: Page-level layout wrappers

#### FR-5: Component Migration — Common UI
- FR-5.1: Cards and panels (`bg-white` -> theme-aware)
- FR-5.2: Forms (inputs, selects, textareas, checkboxes, switches)
- FR-5.3: Buttons (all variants)
- FR-5.4: Tables and data grids
- FR-5.5: Modals and dialogs
- FR-5.6: Dropdowns and popovers
- FR-5.7: Tooltips
- FR-5.8: Badges and status indicators
- FR-5.9: Alerts and notifications
- FR-5.10: Tabs and navigation components

#### FR-6: Component Migration — Domain-Specific
- FR-6.1: Ticket views and lists
- FR-6.2: Project views and boards
- FR-6.3: Billing/invoice screens
- FR-6.4: Scheduling/calendar views
- FR-6.5: Dashboard widgets and charts
- FR-6.6: Document editor
- FR-6.7: Settings pages

#### FR-7: Third-Party Overrides
- FR-7.1: react-day-picker dark mode overrides in globals.css
- FR-7.2: react-big-calendar dark mode overrides
- FR-7.3: Radix UI Tables dark mode overrides in globals.css
- FR-7.4: Mantine component dark mode
- FR-7.5: Tiptap/ProseMirror editor dark mode

#### FR-8: CSS Cleanup
- FR-8.1: Replace hardcoded `white` values in globals.css switch/button styles with CSS variables
- FR-8.2: Replace hardcoded hex colors in globals.css (collaboration cursor, etc.)
- FR-8.3: Migrate 12 CSS module files from hardcoded hex to CSS variables
- FR-8.4: Replace hardcoded `rgba(0, 0, 0, ...)` in table hover and dotted backgrounds

#### FR-9: Client Portal Dark Mode
- FR-9.1: Add `next-themes` `ThemeProvider` to client portal layout (`server/src/app/client-portal/ClientPortalLayoutClient.tsx`)
- FR-9.2: Add `ThemeToggle` to the client portal navigation bar (`packages/client-portal/src/components/layout/ClientPortalLayout.tsx`)
- FR-9.3: Replace hardcoded `bg-gray-100` in `ClientPortalLayout.tsx` with theme-aware CSS variable
- FR-9.4: Update `BrandingProvider` and `generateBrandingStyles()` to generate an inverted shade scale for dark mode — swap 50↔900, 100↔800, 200↔700, 300↔600, keep 400/500 similar. Scope dark-mode branded variables under `.dark` selector so they only apply in dark mode. Same linear RGB interpolation algorithm, just inverted output mapping.
- FR-9.5: Add `next-themes` provider to client portal auth pages (`server/src/app/auth/client-portal/`)
- FR-9.6: Verify client portal pages (tickets, invoices, approvals, profile) render correctly in dark mode

### Non-functional Requirements
- No visible flash of wrong theme on page load
- Theme switch must be instant (no reload)
- Dark mode must not degrade performance
- WCAG AA contrast ratios in both themes (4.5:1 for normal text, 3:1 for large text)

## Data / API / Integrations

- **`next-themes`**: Manages localStorage key (`theme`: `light` | `dark` | `system`) and class application automatically
- **`user_preferences` table**: Existing table with schema `(tenant, user_id, setting_name, setting_value)` — store `setting_name: 'theme'`, `setting_value: '"dark"'` (JSON-encoded string). No migration needed — table already exists.
- **API**: Existing `PUT /api/v1/users/[id]/preferences` endpoint used to persist; `GET /api/v1/users/[id]/preferences` to load on auth
- **Model**: `UserPreferences.upsert(knex, { user_id, setting_name: 'theme', setting_value: JSON.stringify(theme) })`
- **Extension iframe bridge**: Existing `bootstrapIframe()` in `server/src/lib/extensions/ui/iframeBridge.ts` already sends `theme_tokens` — needs to re-send correct tokens when theme changes and listen for theme change events

## Security / Permissions

- No new permissions required — theme uses existing `user_preferences` table which users can already read/write for their own account
- Extension iframe bridge already validates message origins — no changes needed

## Rollout / Migration

### Strategy: Phased Rollout
1. **Phase 1**: Infrastructure — install `next-themes`, wire providers, fix Tailwind config, fix dark submenu colors
2. **Phase 2**: Theme toggle UI + DB persistence — header toggle for MSP, nav toggle for client portal
3. **Phase 3**: Core layout + common UI components (usable dark mode for both portals)
4. **Phase 4**: Domain-specific pages + third-party overrides (polished)
5. **Phase 5**: Client portal branding preview with dark/light mode toggle

### Migration Approach for Components
- Use CSS variable-based colors from Tailwind config where possible (these auto-switch)
- For raw Tailwind color classes (`bg-white`, `text-gray-600`), add `dark:` prefix variants
- For CSS modules, replace hex codes with `rgb(var(--color-*))` references
- Batch changes by package/directory to keep PRs reviewable

## Resolved Questions

- [x] **Use `next-themes`** — stable, <1KB, zero deps, handles SSR flash prevention and system preference natively. Replaces our broken `ThemeContext`. Hydration mismatch caveat handled with `mounted` guard on toggle UI.
- [x] **Persist to DB** — store in `user_preferences` table (`setting_name: 'theme'`) for cross-device sync; localStorage as immediate cache. Existing API + model already support this.
- [x] **Include client portal** — dark mode for both MSP and client portal in this effort.
- [x] **Fix dark submenu colors** — current `.dark` values (`#D0D5DD` bg, `#000000` text) are wrong; fix to proper dark palette (dark bg, light text).
- [x] **Add branding preview modes** — client portal branding settings page gets a dark/light mode toggle in the preview panel.

## Resolved Questions (continued)

- [x] **Auto-adjust branded shades for dark mode** — `BrandingProvider` will generate an inverted shade scale for dark mode (swap 50↔900, 100↔800, etc.), matching the same inversion pattern used for the static primary/secondary palettes in `globals.css`. The `generateColorShades()` function in `packages/tenancy/src/lib/generateBrandingStyles.ts` uses linear RGB interpolation to white (light shades) and multiplicative darkening (dark shades). For dark mode, output the same shades but mapped to inverted steps. No separate tenant-provided dark colors needed.
- [x] **Toggle for branding preview** — single toggle switch (not side-by-side). Admin clicks to preview light vs dark.
- [x] **globals.css `.light`/`.dark` selectors compatible with `next-themes`** — verified. Both are bare class selectors (`.dark {`, `.light {` at lines 176, 282) not bound to any HTML element. `next-themes` applies class to `<html>` by default. Bare selectors match `<html class="dark">` correctly, and CSS variables cascade to all descendants. No selector changes needed.

## Open Questions

(None remaining — all resolved)

## Acceptance Criteria (Definition of Done)

1. User can toggle between Light, Dark, and System theme modes in both MSP and client portals
2. Theme preference persists to `user_preferences` DB table and is restored on login from any device
3. No flash of wrong theme on page load (localStorage + `next-themes` blocking script)
4. All core layout elements (sidebar, header, submenu, content area) render correctly in dark mode
5. All common UI components (buttons, forms, cards, tables, modals) render correctly in dark mode
6. All major MSP application pages (tickets, projects, billing, scheduling, settings) are visually usable in dark mode
7. Client portal pages (tickets, invoices, approvals, profile) render correctly in dark mode
8. Client portal branding settings page has a dark/light mode preview toggle
9. Extension iframes receive correct theme tokens and update accordingly
10. Dark submenu colors are fixed (dark bg, light text — not light gray)
11. No WCAG AA contrast violations in either theme
12. No performance regression from theme switching

---

## Appendix A: How to Start the App and Visually Inspect Dark Mode

### Option 1: Docker Compose (Full Stack)

```bash
# Community Edition
docker compose -f docker-compose.base.yaml -f docker-compose.ce.yaml up

# Enterprise Edition (includes extensions)
docker compose -f docker-compose.base.yaml -f docker-compose.ee.yaml up
```
App will be available at **http://localhost:3000** (or the port configured in your `.env`).

### Option 2: Local Dev Server (Faster Iteration for UI Work)

Prerequisites: PostgreSQL and Redis must be running (either via Docker services or locally).

```bash
# 1. Start only the infrastructure services (DB, Redis, etc.)
docker compose -f docker-compose.base.yaml up -d db redis

# 2. Ensure packages are built (first time or after package changes)
npm run build:shared

# 3. Start the Next.js dev server with hot reload
npm run dev
# Or with Turbopack for faster refresh:
npm run dev:turbo
```
App will be available at **http://localhost:3000**.

### Option 3: Dev Docker Environment (Builds from Current Worktree)

If the `alga-dev-env-manager` skill is available, use it to spin up a full Docker dev environment that builds from your local code.

### Visual Inspection Checklist

Once the app is running, use this checklist to verify dark mode:

#### Quick Smoke Test
1. Open browser DevTools → Console
2. Run: `document.body.className = 'dark'` (forces dark mode immediately)
3. Check: Does the background turn dark? Does text become light?
4. Run: `document.body.className = 'light'` (revert)

#### After Theme Toggle is Implemented
1. Click the theme toggle in the header
2. Select "Dark" → entire app should switch
3. Select "Light" → app reverts
4. Select "System" → follows OS preference
5. Refresh the page → preference should persist with no flash

#### Page-by-Page Visual QA
For each major page, verify in both light and dark mode:

| Page | URL Path | What to Check |
|------|----------|---------------|
| Dashboard | `/msp` | Widgets, charts, summary cards |
| Tickets List | `/msp/tickets` | Table rows, filters, status badges |
| Ticket Detail | `/msp/tickets/[id]` | Editor, comments, sidebar |
| Projects | `/msp/projects` | Board view, list view, cards |
| Billing | `/msp/billing` | Invoice tables, amounts, status |
| Schedule | `/msp/scheduling` | Calendar, time slots, events |
| Settings | `/msp/settings` | Forms, toggles, tabs |
| User Profile | `/msp/profile` | Theme toggle in profile, preferences |
| Client Portal Home | `/client-portal` | Layout, navigation, cards |
| Client Portal Tickets | `/client-portal/tickets` | Table, status badges, filters |
| Client Portal Invoices | `/client-portal/billing` | Invoice table, amounts |
| Client Portal Auth | `/auth/client-portal/signin` | Login form, branding |
| Branding Settings | `/msp/settings` (General tab) | Branding preview with dark/light toggle |

#### What to Look For
- **Contrast**: Can you read all text comfortably?
- **Backgrounds**: No leftover white patches on dark backgrounds
- **Borders**: Visible but not glaring
- **Focus rings**: Visible in both themes
- **Hover states**: Distinguishable from resting state
- **Status colors**: Red/green/amber/blue still readable
- **Icons**: Visible against dark backgrounds
- **Shadows**: Not too harsh in dark mode (reduce or eliminate `box-shadow`)
- **Images/logos**: Check that logos have transparent backgrounds or adapt

#### Browser DevTools Tips
- **Force dark mode CSS**: In Chrome DevTools, click the three dots → More tools → Rendering → Emulate CSS `prefers-color-scheme: dark`
- **Check contrast**: Inspect any text element → the Styles panel shows a contrast ratio indicator
- **Check all CSS variables**: In Elements panel, select `<body>` → Computed tab → filter for `--color-` to see all active variable values
