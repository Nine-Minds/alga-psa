# SCRATCHPAD — MSP i18n Phase 1

## Key Discoveries

### Existing Infrastructure (ready to reuse)
- `I18nWrapper` (`packages/tenancy/src/components/i18n/I18nWrapper.tsx`) already supports `portal="msp"` — no wrapper changes needed
- `I18nProvider` (`packages/ui/src/lib/i18n/client.tsx`) already has MSP persistence logic (lines 107-117) saving locale to `/api/user/preferences`
- `LanguagePreference` component (`packages/ui/src/components/LanguagePreference.tsx`) is fully built with inheritance display, "Not set" option, loading states
- `useFeatureFlag` hook (`packages/ui/src/hooks/useFeatureFlag.tsx`) exists for client-side gating
- `featureFlags.isEnabled()` (`server/src/lib/feature-flags/featureFlags.ts`) for server-side gating
- `getHierarchicalLocaleAction` (`packages/tenancy/src/actions/locale-actions/getHierarchicalLocale.ts`) for locale resolution
- Existing tenant locale actions: `getTenantLocaleSettingsAction`, `updateTenantDefaultLocaleAction` — mirror pattern for MSP org settings

### i18next Namespace Loading
- http-backend loadPath `/locales/{{lng}}/{{ns}}.json` naturally resolves nested paths
- `features/tickets` → `/locales/en/features/tickets.json` — no config change needed
- Namespaces load on-demand, no need to register them upfront in config

### Current State
- 7 languages supported: en, fr, es, de, nl, it, pl
- 2 namespaces currently: `common.json`, `clientPortal.json`
- `clientPortal.json` top-level keys: nav, dashboard, tickets, billing, projects, profile, clientSettings, account, documents, common, auth, notifications, pagination, time, appointments
- ~52 client portal components use `useTranslation('clientPortal')` — all need migration
- MSP has zero i18n support currently

### Layout Files
- Standard: `server/src/app/msp/layout.tsx` + `MspLayoutClient.tsx`
- EE: `ee/server/src/app/msp/layout.tsx` + `MspLayoutClient.tsx`
- EE layout uses `TenantProvider` instead of `TagProvider`, otherwise similar structure

## Decisions

| Decision | Rationale |
|----------|-----------|
| Full migration (not copy) of client portal namespaces | Avoids duplication; client portal moves to new paths, clientPortal.json removed |
| Flattened feature namespace keys | `features/tickets.json` has `{"title": "..."}` not `{"tickets": {"title": "..."}}` — cleaner `t('title')` with namespace |
| Personal language preference in UserProfile (/msp/profile) | Natural place for personal settings |
| Org language settings in Settings > General > Organization & Access after Teams | Mirrors org-level config pattern; client portal settings will be consolidated here later |
| Default language + enabled languages for org settings | Mirrors existing ClientPortalSettings pattern |
| Machine-translated placeholders for non-English msp/core.json | Professional translation is Phase 2+ |
| Email template refactoring is a SEPARATE branch | Will happen before this work is finished but not part of this scope |

## Commit Strategy

Batch into ~4 meaningful commits (not one-liners):

1. **Feature flag + I18nWrapper** — Flag, standard layout, EE layout
2. **Shared feature namespaces** — Extract from clientPortal.json, create features/*.json and client-portal/*.json (35+ new files)
3. **MSP core namespace** — Create msp/core.json for all 7 languages
4. **Language settings UI** — Personal preference in Profile + Org settings in Settings > General

## Key File Paths

| Purpose | Path |
|---------|------|
| Feature flags | `server/src/lib/feature-flags/featureFlags.ts` |
| I18nWrapper | `packages/tenancy/src/components/i18n/I18nWrapper.tsx` |
| I18nProvider | `packages/ui/src/lib/i18n/client.tsx` |
| i18n config | `packages/ui/src/lib/i18n/config.ts` + `packages/core/src/lib/i18n/config.ts` |
| Hierarchical locale | `packages/tenancy/src/actions/locale-actions/getHierarchicalLocale.ts` |
| LanguagePreference UI | `packages/ui/src/components/LanguagePreference.tsx` |
| useFeatureFlag | `packages/ui/src/hooks/useFeatureFlag.tsx` |
| Standard MSP layout | `server/src/app/msp/layout.tsx` + `MspLayoutClient.tsx` |
| EE MSP layout | `ee/server/src/app/msp/layout.tsx` + `MspLayoutClient.tsx` |
| UserProfile | `server/src/components/settings/profile/UserProfile.tsx` |
| Settings page | `server/src/components/settings/SettingsPage.tsx` |
| ClientPortalSettings (reference) | `server/src/components/settings/general/ClientPortalSettings.tsx` |
| Menu config | `server/src/config/menuConfig.ts` |
| Translation files | `server/public/locales/{lang}/` |

## Gotchas

- `packages/ui/src/lib/i18n/config.ts` and `packages/core/src/lib/i18n/config.ts` must stay in sync
- When migrating client portal components, need to handle components that use keys from multiple top-level sections (may need multiple namespaces in one `useTranslation` call)
- EE layout has `TenantProvider` wrapping — I18nWrapper must go outside or inside it consistently
- Onboarding pages in MSP layout use a different render path (`isOnboardingPage` check) — I18nWrapper must wrap both paths

## Updates
- Added `msp-i18n-enabled` default flag in `server/src/lib/feature-flags/featureFlags.ts`.
- Standard MSP layout now gates locale fetch via `msp-i18n-enabled` and only calls `getHierarchicalLocaleAction` when enabled.
- Standard `MspLayoutClient` wraps content in `I18nWrapper` when MSP i18n flag is enabled.
- Standard MSP layout returns existing layout tree when flag is disabled (no I18nWrapper).
- EE MSP layout now gates locale fetch behind `msp-i18n-enabled`.
- EE `MspLayoutClient` wraps content in `I18nWrapper` only when MSP i18n is enabled.
