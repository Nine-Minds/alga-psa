# PRD: Narrow cross-feature imports in the /msp/settings tree

- **Status:** Draft (ready for implementation loop)
- **Date:** 2026-07-09
- **Owner:** Natallia Bukhtsik
- **Branch:** `fix/eliminate_node_crashes`

## Context

`/msp/settings` is the heaviest MSP route in the dev RSC server-reference manifest: **31.85 MB / 237 reachable 'use server' modules** (next heaviest: billing 24 MB). The cause is NOT the app shell (already fixed by Phase A+B + the workspace scoping): the settings **hub is a single client page** (`server/src/components/settings/SettingsPage.tsx`) where every tab body is statically imported, and those tabs import **feature `/components` barrels** and **`/actions` barrels** — each dragging an entire feature package's `'use server'` set into this one route. `dynamic(() => import(...), { ssr:false })` does NOT help — it still creates a static module edge in the RSC manifest.

**Priority framing (honest):** a dev-only Next patch (`patches/next+16.2.6.patch`, interning duplicated manifest moduleIds) has removed the OOM crash itself — at 40 routes the manifest is now 6.5 MB vs a projected ~500 MB. So this work is no longer OOM-critical; it remains valuable for per-route compile weight, dev responsiveness on the settings route, and manifest hygiene (and as insurance if the patch is ever lost on a Next upgrade). Treat as normal-priority mechanical cleanup.

The cure is the proven Phase-A/B method: replace barrel imports with specific-module imports, verified by the manifest canary, locked in by extending the existing ESLint guard.

## Goals

- G1. `/msp/settings` manifest partial drops materially (target: < ~15 MB / < ~150 modules; the arbiter is the canary, not the estimate).
- G2. The settings tree (`server/src/app/msp/settings/**`, `server/src/components/settings/**`) and the package-side settings component subtrees contain zero bare `@alga-psa/*/actions` or feature `/components` barrel imports.
- G3. ESLint guard extended so it can't regress.
- G4. Zero behavior change — every settings tab renders and functions identically.

## Non-goals

- N1. No restructuring of `?tab=` params into route segments (the ticketing/billing tabs are strong candidates — precedent exists: `settings/sla` and `settings/notifications` are already segments — but that's a separate, flagged decision; see OQ1).
- N2. Do not touch `server/src/components/settings/profile/**` (belongs to `/msp/profile`) or `security/**` (`/msp/security-settings`) — different routes' manifests.
- N3. Do not touch the orphan `general/TicketNumberingSettings.tsx` (no importers; dead edge).
- N4. No dynamic imports; no changes to the Next patch; no god-module splitting.

## Approach

Work from the verified offender inventory in `SCRATCHPAD.md` (full tables). Pattern per edit: replace the barrel specifier with the defining file (`@alga-psa/<pkg>/actions/<file>`, `@alga-psa/<pkg>/components/<path>/<Component>`), preserving aliases and `import type`. Verify each symbol's defining file at implementation time (`rg -l "export (async function|const|function) <sym>"` — a few are marked "verify" in the inventory). tsconfig wildcards `@alga-psa/<pkg>/* → packages/<pkg>/src/*` exist for all packages; hundreds of granular-import precedents.

### Tier 1 — feature `/components` barrels (biggest wins; heaviest packages first)
The four top packages all enter through barrels: clients (via `UserManagement.tsx:61`), tickets (via `TicketingSettings.tsx:8`), projects (via `SettingsPage.tsx:81`), scheduling (via `SettingsPage.tsx:68`). Plus billing, integrations ×2, notifications, reference-data ×2, tenancy (`useBranding`). Granularize each to the specific settings component file(s).

### Tier 2 — bare `/actions` barrels (~30 import lines)
clients (5 sites), user-composition (9 sites), users (4), teams (3), tenancy (8), reference-data (4), client-portal (2), licensing (2), sla (1). Full file:line → symbols → target table in SCRATCHPAD.

### Tier 3 — package-side settings component subtrees (required, or Tier 1 is hollow)
The entry components re-pull barrels themselves: `packages/tickets/src/components/settings/BoardsSettings.tsx:25` imports `@alga-psa/tickets/actions` (+ reference-data/user-composition/teams barrels); `billing .../BillingSettings.tsx:10` and `projects .../ProjectSettings.tsx:6` import `@alga-psa/reference-data/components`. Sweep `packages/*/src/components/settings/**` for barrel imports and granularize (package-side action-barrel counts: billing 44 component files, integrations 29, clients 20, scheduling 12, notifications 5 — scope to the settings subtrees reached from the hub, measure, and extend only if the canary says a package still dominates).

### Sub-route cleanups (separate manifests, small)
`app/msp/settings/sla/page.tsx` (sla components+actions, reference-data, clients barrels), `app/msp/settings/notifications/page.tsx` (notifications components barrel).

### Guard
Add to `ALGA_BARREL_RESTRICTED_PATHS` `files` in `eslint.config.js`:
`"server/src/app/msp/settings/**/*.{ts,tsx}"`, `"server/src/components/settings/**/*.{ts,tsx}"`, `"packages/*/src/components/settings/**/*.{ts,tsx}"` — land each glob only once its scope is violation-free.

## Verification (per commit group)

- Manifest canary (runbook in SCRATCHPAD): fresh `.next/dev` + `E2E_AUTH_BYPASS=true`, curl `/msp/settings` (+ sla/notifications sub-routes), measure partial size + `ACTIONS_MODULE` count + package breakdown. Record before/after per group.
- `cd server && NODE_OPTIONS="--max-old-space-size=16384" npm run typecheck` → exit 0.
- ESLint guard → 0 violations in the newly-guarded scopes.
- Runtime smoke: every settings tab opens (General incl. user management + org chart, Ticketing, Billing, Projects, Time Entry, Integrations, Notifications, Secrets, Import/Export, Extensions, MCP); user add/edit, team add/edit, interaction-type CRUD still work.

## Acceptance criteria

- AC1. `/msp/settings` partial materially reduced (record exact numbers; target <~15 MB / <~150 modules).
- AC2. Guarded scopes lint clean; typecheck exit 0.
- AC3. All settings tabs render and their primary CRUD flows work (smoke list above).
- AC4. Inventory tables in SCRATCHPAD updated with per-group before/after; any non-productive narrowing (canary shows no change) is noted, not forced.

## Open questions

- OQ1. If after Tiers 1–3 the settings manifest is still dominated by one tab's package (likely tickets or billing), decide whether to promote that tab to its own route segment (precedent: `settings/sla`, `settings/notifications`). Flag with measurements; separate approval.
- OQ2. `UserDetails.tsx:6` role functions (`getRoles`, `assignRoleToUser`, `removeRoleFromUser`) — defining file in `packages/users` marked "verify" (not co-located with `userActions.ts`); resolve at implementation time.
