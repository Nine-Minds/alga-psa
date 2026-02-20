# SCRATCHPAD — MSP i18n Infrastructure Sprint (Phase 0)

## Key Discoveries

### Current State (Pre-Phase 0)

- `I18N_CONFIG.ns` is `['common', 'client-portal', 'msp']` — ALL namespaces loaded eagerly on every page
- `msp.json` exists for all 7 languages (en, fr, es, de, nl, it, pl) — ~73 lines, ~60 keys
- `msp/` directory does NOT yet exist under any locale folder
- **Zero** MSP components currently call `useTranslation('msp')` — the namespace exists but is unused in component code
- Phase 1 test file at `server/src/test/unit/i18n/mspI18nPhase1.test.ts` references `'msp'` namespace (lines 280, 284, 285) — needs update to `'msp/core'`
- `I18nWrapper` currently does NOT use `usePathname()` — it only resolves locale, not route-specific namespaces
- `I18nProvider` does NOT accept a `namespaces` prop — no lazy loading mechanism exists yet
- `packages/core/src/lib/i18n/config.ts` is a near-exact copy of `packages/ui/src/lib/i18n/config.ts` (exists to break circular dependency: ui → analytics → tenancy → ui)
- http-backend loadPath `/locales/{{lng}}/{{ns}}.json` naturally resolves nested paths (e.g., `msp/core` → `/locales/en/msp/core.json`) — no config change needed for nested namespaces

### Key Infrastructure Already in Place

| Component | Path | Status |
|-----------|------|--------|
| I18nProvider | `packages/ui/src/lib/i18n/client.tsx` | Exists, needs `namespaces` prop |
| I18nWrapper | `packages/tenancy/src/components/i18n/I18nWrapper.tsx` | Exists, needs `usePathname()` + namespace passing |
| i18n config (ui) | `packages/ui/src/lib/i18n/config.ts` | Exists, needs `ROUTE_NAMESPACES` + `getNamespacesForRoute()` |
| i18n config (core) | `packages/core/src/lib/i18n/config.ts` | Exists, needs sync with ui config |
| useFormatters() | `packages/ui/src/lib/i18n/client.tsx:214-257` | Exists, locale-aware (uses `useI18n()` context) |
| Feature flag | `msp-i18n-enabled` | Exists, gates MSP i18n |
| Phase 1 tests | `server/src/test/unit/i18n/mspI18nPhase1.test.ts` | Exists, needs 'msp' → 'msp/core' update |
| MSP layout (standard) | `server/src/app/msp/layout.tsx` + `MspLayoutClient.tsx` | Exists, conditionally wraps I18nWrapper |
| MSP layout (EE) | `ee/server/src/app/msp/layout.tsx` + `MspLayoutClient.tsx` | Exists, conditionally wraps I18nWrapper |
| Translation files | `server/public/locales/{lang}/msp.json` | 7 files, to be renamed to `msp/core.json` |

### useTranslation('msp') References

Grep found **zero** references in actual source code — only in documentation/plan files:
- `docs/plans/2026-02-19-msp-i18n-infrastructure-sprint/features.json`
- `docs/plans/2026-02-19-msp-i18n-infrastructure-sprint/PRD.md`
- `docs/plans/2026-02-18-msp-i18n-full-translation-plan.md`
- `docs/plans/2026-02-12-msp-i18n-phase1/SCRATCHPAD.md`

This means F017 ("Update all useTranslation('msp') references") only affects the Phase 1 test file (lines 280, 284, 285) and the config `ns` array. No component code references `'msp'` namespace directly.

## Decisions

| Decision | Rationale |
|----------|-----------|
| `ns: ['common']` — only common on init | Future-proof; as 12+ MSP namespaces are added, eager loading would be 20+ HTTP requests per page |
| Route-based lazy loading via `ROUTE_NAMESPACES` | Deterministic — developer adds route entry, namespaces auto-load. No guessing. |
| `getNamespacesForRoute()` uses exact → longest prefix → fallback | Handles both exact routes (`/msp/tickets`) and sub-routes (`/msp/tickets/123`) |
| Pseudo-locales `xx`/`yy` available in all environments | Visual QA for extraction completeness; useful in staging/production for verification |
| Pseudo-locale files NOT committed to git | They're generated artifacts; add `server/public/locales/xx/` and `yy/` to .gitignore |
| `msp.json` → `msp/core.json` rename now | Establishes the `msp/` directory convention before batch 1 adds `msp/settings.json` |
| `I18nWrapper` uses `usePathname()` from `next/navigation` | Standard Next.js hook; re-renders on route change, triggering namespace re-resolution |

## Implementation Order

Recommended order to minimize breakage:

1. **Rename msp.json → msp/core.json** (F016) — file system change, update test references (F017, F023)
2. **Add ROUTE_NAMESPACES + getNamespacesForRoute()** (F002, F003, F018) — config additions, no behavioral change yet
3. **Change I18N_CONFIG.ns to ['common']** (F001) — behavioral change, client portal will need route-based loading from this point
4. **Update I18nProvider** (F004, F005) — accept `namespaces` prop, add `loadNamespaces()` effect
5. **Update I18nWrapper** (F006, F007, F008) — `usePathname()` + pass namespaces to I18nProvider
6. **Sync core config** (F019) — copy changes to packages/core
7. **Add pseudo-locale support** (F009-F015) — script + config
8. **Verify** (F020-F024) — client portal, MSP flag off, MSP flag on, tests, build

## Key File Paths

| Purpose | Path |
|---------|------|
| i18n config (ui) | `packages/ui/src/lib/i18n/config.ts` |
| i18n config (core) | `packages/core/src/lib/i18n/config.ts` |
| I18nProvider | `packages/ui/src/lib/i18n/client.tsx` |
| I18nWrapper | `packages/tenancy/src/components/i18n/I18nWrapper.tsx` |
| Phase 1 tests | `server/src/test/unit/i18n/mspI18nPhase1.test.ts` |
| MSP layout (standard) | `server/src/app/msp/layout.tsx` |
| MSP layout client (standard) | `server/src/app/msp/MspLayoutClient.tsx` |
| MSP layout (EE) | `ee/server/src/app/msp/layout.tsx` |
| MSP layout client (EE) | `ee/server/src/app/msp/MspLayoutClient.tsx` |
| Translation files | `server/public/locales/{lang}/msp.json` (current) → `server/public/locales/{lang}/msp/core.json` (target) |
| Pseudo-locale script | `scripts/generate-pseudo-locale.ts` (new) |
| Feature flags | `server/src/lib/feature-flags/featureFlags.ts` |

## Gotchas

- **Config duplication**: `packages/ui/src/lib/i18n/config.ts` and `packages/core/src/lib/i18n/config.ts` MUST stay in sync. The core copy exists to break a circular dependency (ui → analytics → tenancy → ui).
- **http-backend loadPath**: `/locales/{{lng}}/{{ns}}.json` already resolves nested paths — `msp/core` becomes `/locales/en/msp/core.json`. No backend config change needed.
- **Client portal must keep working**: After changing `ns: ['common']`, the client portal relies on `I18nWrapper` → `getNamespacesForRoute()` to load `client-portal` namespace. Test this carefully.
- **Build memory**: Phase 1 build needed `NODE_OPTIONS=--max-old-space-size=8192`. Expect the same here.
- **Pseudo-locale .gitignore**: Remember to add `server/public/locales/xx/` and `server/public/locales/yy/` to `.gitignore`.
- **i18next.loadNamespaces()**: This is an async operation. The `I18nProvider` effect needs to handle the promise and potentially show a loading state while namespaces are being fetched.
- **usePathname() requires 'use client'**: `I18nWrapper` is already a client component, so this is fine.
- **ROUTE_NAMESPACES entries for future routes**: Include entries for routes that don't have feature namespace files yet (e.g., `/msp/settings` with just `['common', 'msp/core']`). Missing namespace files simply won't be fetched — i18next http-backend handles 404s gracefully.

## Commands

```bash
# Run Phase 1 tests (to verify msp/core rename doesn't break them)
npx jest server/src/test/unit/i18n/mspI18nPhase1.test.ts

# Build with enough memory
NODE_OPTIONS=--max-old-space-size=8192 npm run build

# Generate pseudo-locale (after script is created)
npx ts-node scripts/generate-pseudo-locale.ts --locale xx --fill 1111
npx ts-node scripts/generate-pseudo-locale.ts --locale yy --fill 5555

# Check for remaining 'msp' namespace references (should be zero after rename)
grep -r "useTranslation('msp')" --include="*.ts" --include="*.tsx" server/ packages/ ee/
grep -r "'msp'" server/src/test/unit/i18n/

# Verify msp/core.json exists for all languages
ls server/public/locales/*/msp/core.json

# Verify old msp.json removed
ls server/public/locales/*/msp.json  # should fail (files removed)
```

## Updates

- 2026-02-20: Updated `I18N_CONFIG.ns` in `packages/ui/src/lib/i18n/config.ts` to `['common']` for lazy namespace loading (F001).
- 2026-02-20: Added `ROUTE_NAMESPACES` mapping in `packages/ui/src/lib/i18n/config.ts` for client portal and MSP routes (F002).
- 2026-02-20: Added `getNamespacesForRoute()` helper with exact + longest prefix matching in `packages/ui/src/lib/i18n/config.ts` (F003).
- 2026-02-20: Added optional `namespaces` prop to `I18nProvider` in `packages/ui/src/lib/i18n/client.tsx` (F004).
- 2026-02-20: `I18nProvider` now loads missing namespaces on route changes via `i18next.loadNamespaces()` (F005).
- 2026-02-20: `I18nWrapper` now reads the current route via `usePathname()` (F006).
- 2026-02-20: `I18nWrapper` now resolves namespaces with `getNamespacesForRoute()` and passes them to `I18nProvider` (F007).
- 2026-02-20: `I18nWrapper` memoizes namespace resolution to update on pathname changes (F008).
- 2026-02-20: Added `scripts/generate-pseudo-locale.ts` with CLI args parsing for pseudo-locale generation (F009).
- 2026-02-20: Pseudo-locale script now walks all English JSON namespaces recursively (including nested `features/` and `msp/`) (F010).
- 2026-02-20: Pseudo-locale output preserves directory structure under `server/public/locales/<locale>/` (F011).
- 2026-02-20: Pseudo-locale generator replaces all leaf string values with the fill token (F012).
- 2026-02-20: Pseudo-locale generator preserves `{{variables}}` in transformed strings (F013).
- 2026-02-20: Pseudo-locale generator preserves JSON key structure (nested objects/arrays) (F014).
- 2026-02-20: Added pseudo-locales `xx` and `yy` to `LOCALE_CONFIG.supportedLocales` in UI config (F015).
- 2026-02-20: Renamed `server/public/locales/{lang}/msp.json` to `server/public/locales/{lang}/msp/core.json` for all locales (F016).
- 2026-02-20: Confirmed no `useTranslation('msp')` references in code; remaining namespace updates handled in Phase 1 tests (F017).
- 2026-02-20: ROUTE_NAMESPACES entries use `msp/core` for MSP routes (F018).
- 2026-02-20: Synced `packages/core/src/lib/i18n/config.ts` with UI config (namespaces, route mapping, pseudo-locales) (F019).
- 2026-02-20: Updated Phase 1 i18n tests to use `msp/core` namespace and file paths (F023).
- 2026-02-20: Added tracking items F025/T053 to ensure pseudo-locale outputs are gitignored per PRD rollout guidance.
- 2026-02-20: Ignored pseudo-locale outputs in `.gitignore` (`server/public/locales/xx/`, `server/public/locales/yy/`) (F025).
- 2026-02-20: Added Phase 0 i18n test suite and made pseudo-locale generator ESM-safe; validated UI `I18N_CONFIG.ns` via tests (T001).
- 2026-02-20: Verified core `I18N_CONFIG.ns` via Phase 0 test coverage (T002).
- 2026-02-20: Confirmed `ROUTE_NAMESPACES` export via Phase 0 tests (T003).
