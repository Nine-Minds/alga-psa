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
- Extracted `tickets` translations into `server/public/locales/*/features/tickets.json`.
- Extracted `projects` translations into `server/public/locales/*/features/projects.json`.
- Extracted `billing` translations into `server/public/locales/*/features/billing.json`.
- Extracted `documents` translations into `server/public/locales/*/features/documents.json`.
- Extracted `appointments` translations into `server/public/locales/*/features/appointments.json`.
- Added `client-portal/core.json` with nav/dashboard/common/pagination/time keys for all locales.
- Added `client-portal/auth.json` with auth/account translations for all locales.
- Added `client-portal/profile.json` with profile/clientSettings/notifications translations for all locales.
- Migrated client portal tickets usage to `features/tickets` namespace and adjusted common key usage via `client-portal/core`.
- Migrated client portal projects components to `features/projects` namespace and routed shared common strings via `client-portal/core`.
- Migrated client portal billing components to `features/billing` namespace with shared core strings handled via `client-portal/core`.
- Migrated client portal document-related UI to `features/documents` and updated Documents components to support new key paths.
- Migrated client portal appointments components to `features/appointments` with common strings routed via `client-portal/core`.
- Updated client portal UI to use `client-portal/core` for nav/dashboard/common/pagination/time keys.
- Migrated client portal auth/account strings to `client-portal/auth` namespace.
- Migrated client portal profile/clientSettings/notifications strings to `client-portal/profile` namespace.
- Emptied legacy `server/public/locales/*/clientPortal.json` files after migration to avoid duplicate keys.
- Added `server/public/locales/en/msp/core.json` with MSP nav, sidebar, header, and settings tab strings.
- Added machine-translated `msp/core.json` files for fr/es/de/nl/it/pl.
- Added MSP Profile language preference section behind `msp-i18n-enabled` flag in `UserProfile`.
- Profile language selector uses `LanguagePreference` with `showNoneOption` for inherited defaults.
- Added `MspLanguageSettings` component for MSP org language defaults and enabled locales.
- Inserted MSP language settings tab in Settings (after Teams) and gated visibility behind `msp-i18n-enabled`.
- MSP org language settings now persist to `tenant_settings.settings.mspPortal` via new actions.
- Added `getTenantMspLocaleSettingsAction` and `updateTenantMspLocaleSettingsAction` in tenancy actions.
- Locale hierarchy now considers `mspPortal.defaultLocale` for internal users in `getHierarchicalLocaleAction` (and inherited locale for profile).

## Updates
- Added `server/src/test/unit/i18n/mspI18nPhase1.test.ts` to validate new i18n namespace JSON files (parseable, duplicate-free, consistent key structure) and MSP i18n wiring; fixed import path for `settingsNavigationSections`.
- T001: msp-i18n-enabled flag exists in DEFAULT_BOOLEAN_FLAGS with default value false (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T002: With flag OFF: standard MSP layout does NOT call getHierarchicalLocaleAction (no locale fetch overhead) (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T003: With flag ON: standard MSP layout calls getHierarchicalLocaleAction and passes locale to MspLayoutClient (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T004: With flag OFF: standard MspLayoutClient renders children without I18nWrapper (zero behavior change) (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T005: With flag ON: standard MspLayoutClient wraps children in I18nWrapper with portal='msp' (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T006: With flag OFF: EE MSP layout does NOT call getHierarchicalLocaleAction (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T007: With flag ON: EE MSP layout calls getHierarchicalLocaleAction and passes locale to MspLayoutClient (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T008: With flag ON: EE MspLayoutClient wraps children in I18nWrapper with portal='msp' (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T009: With flag ON: useTranslation() works inside MSP page components (no 'must be used within I18nProvider' error) (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T010: MSP onboarding flow still works when flag is ON (I18nWrapper does not break redirect logic) (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T011: features/tickets.json exists for all 7 languages (en, fr, es, de, nl, it, pl) with flattened keys (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T012: features/projects.json exists for all 7 languages with flattened keys (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T013: features/billing.json exists for all 7 languages with flattened keys (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T014: features/documents.json exists for all 7 languages with flattened keys (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T015: features/appointments.json exists for all 7 languages with flattened keys (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T016: Feature namespace files contain flattened keys (no wrapping top-level key like 'tickets') (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T017: useTranslation('features/tickets') loads features/tickets.json via http-backend loadPath (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T018: client-portal/core.json exists for all 7 languages with nav, dashboard, common, pagination, time keys (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T019: client-portal/auth.json exists for all 7 languages with auth and account keys (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T020: client-portal/profile.json exists for all 7 languages with profile, clientSettings, notifications keys (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T021: All client portal components using tickets.* keys migrated to useTranslation('features/tickets') (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T022: All client portal components using projects.* keys migrated to useTranslation('features/projects') (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T023: All client portal components using billing.* keys migrated to useTranslation('features/billing') (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T024: All client portal components using documents.* keys migrated to useTranslation('features/documents') (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T025: All client portal components using appointments.* keys migrated to useTranslation('features/appointments') (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T026: All client portal components using nav/dashboard/common/pagination/time keys migrated to useTranslation('client-portal/core') (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T027: All client portal components using auth/account keys migrated to useTranslation('client-portal/auth') (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T028: All client portal components using profile/clientSettings/notifications keys migrated to useTranslation('client-portal/profile') (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T029: Client portal continues working after full migration (no regressions — same translations, new namespace paths) (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T030: clientPortal.json removed or emptied after all components migrated — no duplication of keys (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T031: msp/core.json exists for English with nav, sidebar, header, and settings keys (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T032: msp/core.json nav items match navigation entries in menuConfig.ts (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T033: msp/core.json exists for all 6 non-English languages with translated content (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T034: useTranslation('msp/core') returns correct English translations when flag is ON (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T035: With flag OFF: no language preference section visible in UserProfile (/msp/profile) (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T036: With flag ON: LanguagePreference selector appears in UserProfile component (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T037: Language selector shows all 7 supported languages plus 'Not set' option (fallback to org default) (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T038: Selecting a language in Profile updates user_preferences table (setting_name='locale') (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T039: Selecting a language in Profile updates the locale cookie (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T040: After selecting a language and reloading, the selected language persists (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T041: Selecting 'Not set' clears user preference and falls back to org/system default (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T042: With flag OFF: no Language section visible in Settings > General > Organization & Access (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T043: With flag ON: MspLanguageSettings section appears in Settings > General > Organization & Access after Teams (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T044: MspLanguageSettings shows default language dropdown with all 7 languages (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T045: MspLanguageSettings shows enabled languages checkboxes (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T046: Changing default language persists to tenant_settings (mspPortal.defaultLocale) (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T047: Changing enabled languages persists to tenant_settings (mspPortal.enabledLocales) (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T048: getTenantMspLocaleSettings server action reads mspPortal locale settings from tenant_settings (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T049: updateTenantMspLocaleSettings server action writes mspPortal locale settings to tenant_settings (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T050: Locale resolution for internal users: user preference takes priority over org default (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T051: Locale resolution for internal users: org default takes priority over system default when no user preference set (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T052: Locale resolution for internal users: falls back to system default when no user or org preference (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
- T053: All new JSON namespace files pass JSON syntax validation (no parse errors) (covered by `server/src/test/unit/i18n/mspI18nPhase1.test.ts`).
