# PRD — MSP i18n Infrastructure Sprint (Phase 0)

- Slug: `msp-i18n-infrastructure-sprint`
- Date: `2026-02-19`
- Status: Draft
- Parent plan: `docs/plans/2026-02-18-msp-i18n-full-translation-plan.md`
- Depends on: `docs/plans/2026-02-12-msp-i18n-phase1/` (completed)

## Summary

Prepare the i18n infrastructure for batch translation of the entire MSP portal. This sprint makes five changes: (a) lazy namespace loading so only route-relevant namespaces are fetched, (b) pseudo-locale generation for visual QA, (c) rename `msp.json` to `msp/core.json`, (d) update I18nWrapper to load namespaces by route, and (e) sync the core config package. When complete, any subsequent translation batch can be added as a new namespace file without architectural changes.

## Problem

Phase 1 established the MSP i18n foundation (feature flag, I18nWrapper, namespace restructuring, language settings). But the current config eagerly loads ALL namespaces on every page (`ns: ['common', 'client-portal', 'msp']`). As 12+ MSP feature namespaces are added, this becomes 20+ HTTP requests per page load. Additionally, there's no way to visually verify that all hardcoded strings have been extracted. The `msp.json` filename doesn't match the planned `msp/core.json` convention.

## Goals

- **G1**: Change i18next to only load `common` on init, with additional namespaces loaded on-demand per route
- **G2**: Add `ROUTE_NAMESPACES` mapping and `getNamespacesForRoute()` helper to config
- **G3**: Update `I18nWrapper` to use `usePathname()` and load route-appropriate namespaces
- **G4**: Create `scripts/generate-pseudo-locale.ts` that generates `xx` and `yy` pseudo-locale files
- **G5**: Add pseudo-locales (`xx`, `yy`) to config in development mode only
- **G6**: Rename `msp.json` to `msp/core.json` for all 7 languages
- **G7**: Update all references from `useTranslation('msp')` to `useTranslation('msp/core')`
- **G8**: Keep `packages/core/src/lib/i18n/config.ts` in sync with `packages/ui/src/lib/i18n/config.ts`
- **G9**: Client portal continues working with zero regressions
- **G10**: MSP portal with flag OFF continues working with zero regressions

## Non-goals

- Translating any new MSP page content (that's Batch 1+)
- Creating the actual `msp/settings.json` or other feature namespace files
- Server-side namespace preloading or caching
- CI/CD translation validation pipeline
- Changing the feature flag behavior

## Users and Primary Flows

### Persona: Developer adding a translation batch

**Flow 1: Adding a new MSP feature namespace**
1. Developer creates `server/public/locales/en/msp/<feature>.json`
2. Developer adds route entry to `ROUTE_NAMESPACES` in config
3. Namespaces auto-load when users navigate to that route
4. No changes to I18nWrapper, I18nProvider, or layout files needed

**Flow 2: Visual QA with pseudo-locales**
1. Developer runs `npx ts-node scripts/generate-pseudo-locale.ts --locale xx --fill 1111`
2. Pseudo-locale files generated for all existing namespaces
3. Developer enables `msp-i18n-enabled` flag locally
4. Developer switches browser to `xx` locale
5. All translated strings show `1111`; untranslated strings remain in English (= missed extraction)

### Persona: End user (MSP portal)

**Flow 3: Flag OFF (default) — no change**
- MSP portal stays English-only, identical to today
- No additional HTTP requests for namespace files

**Flow 4: Flag ON — navigating MSP portal**
- Only `common` + `msp/core` + route-specific namespaces are loaded
- No loading of irrelevant namespaces (e.g., `msp/settings` doesn't load on `/msp/tickets`)

### Persona: End user (Client portal)

**Flow 5: Client portal — no change**
- Client portal continues loading `common` + `client-portal` + relevant `features/*` namespaces
- Zero regressions from namespace renaming or config changes

## UX / UI Notes

No user-facing UI changes in this sprint. All changes are developer-facing infrastructure.

## Requirements

### Functional Requirements

#### Lazy Namespace Loading
- **FR1**: `I18N_CONFIG.ns` changed from `['common', 'client-portal', 'msp']` to `['common']`
- **FR2**: `ROUTE_NAMESPACES` constant exported from `packages/ui/src/lib/i18n/config.ts` mapping route prefixes to namespace arrays
- **FR3**: `getNamespacesForRoute(pathname: string): string[]` function exported from config — exact match first, then longest prefix match, fallback to `['common']`
- **FR4**: `I18nWrapper` reads `usePathname()` and passes resolved namespaces to `I18nProvider`
- **FR5**: `I18nProvider` calls `i18next.loadNamespaces()` for any namespaces not yet loaded when route changes
- **FR6**: `I18nProvider` accepts optional `namespaces` prop for route-specific namespace list

#### Pseudo-Locale Generation
- **FR7**: `scripts/generate-pseudo-locale.ts` script exists and is runnable with `npx ts-node`
- **FR8**: Script accepts `--locale <code>` and `--fill <string>` CLI arguments
- **FR9**: Script reads all English namespace JSON files (including nested `features/` and `msp/` directories)
- **FR10**: Script outputs corresponding files under `server/public/locales/<locale>/` preserving directory structure
- **FR11**: Script replaces all leaf string values with the fill string
- **FR12**: Script preserves `{{variables}}` within the fill string (e.g., `"1111 {{name}} 1111"`)
- **FR13**: Script preserves JSON key structure exactly
- **FR14**: Pseudo-locales `xx` and `yy` added to `LOCALE_CONFIG.supportedLocales` only when `NODE_ENV === 'development'`

#### Namespace Rename (msp.json → msp/core.json)
- **FR15**: `server/public/locales/{lang}/msp.json` renamed to `server/public/locales/{lang}/msp/core.json` for all 7 languages
- **FR16**: All `useTranslation('msp')` references updated to `useTranslation('msp/core')`
- **FR17**: `I18N_CONFIG.ns` no longer lists `'msp'` (it now only lists `'common'`)
- **FR18**: `ROUTE_NAMESPACES` uses `'msp/core'` (not `'msp'`)

#### Config Sync
- **FR19**: `packages/core/src/lib/i18n/config.ts` updated to match any locale config changes in `packages/ui/src/lib/i18n/config.ts`

#### Backward Compatibility
- **FR20**: Client portal loads correct namespaces per route (no regressions)
- **FR21**: MSP portal with flag OFF has zero behavior change
- **FR22**: MSP portal with flag ON loads `msp/core` namespace correctly
- **FR23**: Existing Phase 1 tests continue passing (with updated namespace name `msp/core`)

## Data / API / Integrations

No database changes. No new API endpoints. Translation files served as static JSON from `server/public/locales/`.

### Key file changes

| File | Change |
|------|--------|
| `packages/ui/src/lib/i18n/config.ts` | Add `ROUTE_NAMESPACES`, `getNamespacesForRoute()`, change `ns` to `['common']`, add dev pseudo-locales |
| `packages/core/src/lib/i18n/config.ts` | Sync locale config changes |
| `packages/ui/src/lib/i18n/client.tsx` | `I18nProvider` accepts `namespaces` prop, calls `loadNamespaces()` on route change |
| `packages/tenancy/src/components/i18n/I18nWrapper.tsx` | Use `usePathname()` + `getNamespacesForRoute()` to pass namespaces to `I18nProvider` |
| `server/public/locales/{lang}/msp.json` | Renamed to `server/public/locales/{lang}/msp/core.json` (7 languages) |
| `scripts/generate-pseudo-locale.ts` | New file — pseudo-locale generator |

## Rollout / Migration

1. Rename `msp.json` → `msp/core.json` (7 files moved, old files removed)
2. Update config and wrapper in one PR
3. Update Phase 1 tests to reference `msp/core` instead of `msp`
4. All behind existing `msp-i18n-enabled` flag — zero user impact
5. Pseudo-locale files not committed to git (generated on demand, .gitignore the `xx/` and `yy/` directories)

## Open Questions

- Should pseudo-locale directories be gitignored or committed? (Recommendation: gitignore — they're generated artifacts)
- Should `ROUTE_NAMESPACES` include entries for routes that don't have feature namespaces yet (e.g., `/msp/settings` before `msp/settings.json` exists)? (Recommendation: yes, with just `['common', 'msp/core']` — the missing namespace will simply not be fetched until the file exists)

## Acceptance Criteria (Definition of Done)

1. `I18N_CONFIG.ns` is `['common']` — only common loaded on init
2. Navigating to `/msp/tickets` loads `common`, `msp/core`, `features/tickets` (and NOT `client-portal`, `msp/settings`, etc.)
3. Navigating to `/client-portal/billing` loads `common`, `client-portal`, `features/billing`
4. `scripts/generate-pseudo-locale.ts` generates correct pseudo files for all namespaces
5. Pseudo files preserve `{{variables}}` and JSON structure
6. `msp/core.json` exists for all 7 languages with same content as old `msp.json`
7. Old `msp.json` files are removed
8. `useTranslation('msp/core')` returns correct translations
9. Client portal has zero regressions
10. MSP portal with flag OFF has zero behavior change
11. `npm run build` succeeds
12. Phase 1 tests pass (updated to `msp/core` namespace)
