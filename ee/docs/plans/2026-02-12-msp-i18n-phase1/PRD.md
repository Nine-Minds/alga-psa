# PRD — MSP i18n Phase 1: Foundation

- Slug: `msp-i18n-phase1`
- Date: `2026-02-12`
- Status: Draft

## Summary

Add internationalization (i18n) support to the MSP portal, gated behind a feature flag. Restructure all translation keys into shared feature namespaces (migrating both client portal and MSP to use them), create an MSP-specific core namespace, and add language settings at both the user profile level and the organization level. When the flag is off, the MSP portal stays English-only with zero behavior change.

## Problem

The client portal supports 7 languages (en, fr, es, de, nl, it, pl) but translations live in 2 monolithic flat files (`common.json`, `clientPortal.json`). The MSP portal has zero translation support — all strings are hardcoded in English.

Key issues:
- `clientPortal.json` contains shared feature keys (tickets, billing, projects, documents, appointments) that MSP also needs — but they're locked in the client portal namespace
- No namespace separation — everything in 2 flat files per language
- `MspLayoutClient.tsx` does not include `I18nWrapper`, so `useTranslation()` cannot be called in MSP pages
- No organization-level language controls for MSP admins

## Goals

- **G1**: Gate MSP i18n behind `msp-i18n-enabled` feature flag for incremental rollout
- **G2**: Add `I18nWrapper` to MSP layout (standard + EE) so MSP pages can use translations
- **G3**: Restructure translation keys: extract shared features from `clientPortal.json` into `features/*.json` and portal-specific keys into `client-portal/*.json`
- **G4**: Migrate all ~52 client portal components to use new namespaces (full migration, not duplication)
- **G5**: Create `msp/core.json` namespace with MSP shell translations (nav, sidebar, header, settings tabs)
- **G6**: Add personal language preference to user Profile page (`/msp/profile`), behind feature flag
- **G7**: Add organization-level MSP language settings (default language + enabled languages) to Settings > General > Organization & Access, after Teams
- **G8**: Maintain full backward compatibility for client portal (same functionality, different namespace paths)

## Non-goals

- Translating all MSP page content (that's Phase 2+)
- Professional translation of non-English msp/core.json (machine-translated placeholders for now)
- RTL language support
- Moving client portal language settings to the new org settings location (later)
- Email/notification template translations for new languages

## Users and Primary Flows

### Persona: MSP Administrator

**Flow 1: Flag OFF (default) — no change**
1. MSP admin uses portal as usual — everything in English
2. No language selector in Profile, no language section in Settings
3. No i18n initialization overhead

**Flow 2: Flag ON — personal language selection**
1. Admin navigates to Profile (`/msp/profile`)
2. Language preference selector appears (using existing `LanguagePreference` component)
3. Admin selects their language (e.g., Fran&ccedil;ais)
4. Preference persists to `user_preferences` table and cookie
5. MSP shell (nav, sidebar, header, settings tabs) displays in selected language
6. Shared feature pages (tickets, billing, projects) display translated strings

**Flow 3: Flag ON — organization language settings**
1. Admin navigates to Settings > General > Organization & Access
2. New "Language" section appears after Teams (same pattern as existing Client Portal language settings)
3. Admin sets default language for the MSP organization
4. Admin selects which languages are available to MSP users
5. Individual users can override with their personal preference from Profile

### Persona: Client Portal User
- **No change** — client portal continues working as before but now uses `features/*.json` and `client-portal/*.json` namespaces internally

## UX / UI Notes

### Personal Language (Profile page)
- Uses existing `LanguagePreference` component from `packages/ui/src/components/LanguagePreference.tsx`
- Shows enabled languages with "Not set" option showing inherited org default
- Appears as a new section/tab in the UserProfile component
- Only visible when `msp-i18n-enabled` flag is ON

### Organization Language (Settings > General)
- Located in Settings > General > Organization & Access section, after "Teams"
- Mirrors pattern from existing `ClientPortalSettings.tsx` language section:
  - Default language dropdown (CustomSelect)
  - Enabled languages checkboxes
  - Language hierarchy info alert
- Only visible when `msp-i18n-enabled` flag is ON

## Requirements

### Functional Requirements

- **FR1**: `msp-i18n-enabled` boolean feature flag (default: false)
- **FR2**: MSP server layout checks flag; fetches locale only when enabled
- **FR3**: `MspLayoutClient` conditionally wraps in `I18nWrapper` when flag is enabled (standard + EE)
- **FR4**: Shared feature namespaces extracted from `clientPortal.json`:
  - `features/tickets.json`
  - `features/projects.json`
  - `features/billing.json`
  - `features/documents.json`
  - `features/appointments.json`
- **FR5**: Client-portal-specific namespaces extracted from `clientPortal.json`:
  - `client-portal/core.json` (nav, dashboard, common, pagination, time)
  - `client-portal/auth.json` (auth, account)
  - `client-portal/profile.json` (profile, clientSettings, notifications)
- **FR6**: All ~52 client portal components migrated from `useTranslation('clientPortal')` to appropriate new namespaces
- **FR7**: `clientPortal.json` removed (or emptied) after full migration — no duplication
- **FR8**: `msp/core.json` created for all 7 languages with MSP shell translations
- **FR9**: Personal language preference in UserProfile component (`/msp/profile`), gated by feature flag
- **FR10**: Organization MSP language settings in Settings > General > Organization & Access (after Teams), gated by feature flag — includes default language and enabled languages
- **FR11**: Locale hierarchy for MSP: user preference > org default > system default
- **FR12**: All new namespace files valid JSON, consistent structure across all 7 languages

## Data / API / Integrations

- **User preferences**: `user_preferences` table (setting_name='locale')
- **Org MSP locale settings**: `tenant_settings` table — new `mspPortal.defaultLocale` and `mspPortal.enabledLocales` fields in settings JSON (mirrors `clientPortal.defaultLocale` pattern)
- **Locale resolution**: Extended `getHierarchicalLocaleAction()` — user > MSP org default > system default
- **Feature flag**: PostHog-backed via `featureFlags.isEnabled()`

### Key file paths

| Purpose | Path |
|---------|------|
| Feature flags | `server/src/lib/feature-flags/featureFlags.ts` |
| I18nWrapper | `packages/tenancy/src/components/i18n/I18nWrapper.tsx` |
| I18nProvider | `packages/ui/src/lib/i18n/client.tsx` |
| i18n config | `packages/ui/src/lib/i18n/config.ts` + `packages/core/src/lib/i18n/config.ts` |
| Hierarchical locale | `packages/tenancy/src/actions/locale-actions/getHierarchicalLocale.ts` |
| User locale actions | `packages/users/src/actions/user-actions/localeActions.ts` |
| Tenant locale actions | `packages/tenancy/src/actions/` (getTenantLocaleSettingsAction, updateTenantDefaultLocaleAction) |
| LanguagePreference UI | `packages/ui/src/components/LanguagePreference.tsx` |
| useFeatureFlag | `packages/ui/src/hooks/useFeatureFlag.tsx` |
| MSP layout (standard) | `server/src/app/msp/layout.tsx` + `MspLayoutClient.tsx` |
| MSP layout (EE) | `ee/server/src/app/msp/layout.tsx` + `MspLayoutClient.tsx` |
| MSP Profile page | `server/src/app/msp/profile/page.tsx` |
| UserProfile component | `server/src/components/settings/profile/UserProfile.tsx` |
| Settings page | `server/src/components/settings/SettingsPage.tsx` |
| Client Portal Settings (reference) | `server/src/components/settings/general/ClientPortalSettings.tsx` |
| Menu config | `server/src/config/menuConfig.ts` |
| Translation files | `server/public/locales/{lang}/` |

## Rollout / Migration

1. Feature flag `msp-i18n-enabled` defaults to OFF — zero impact
2. Client portal namespace migration is transparent (same translations, new file paths)
3. Enable flag per-tenant in PostHog for testing
4. Phase 2 expands MSP page translation coverage
5. Client portal language settings will later be consolidated into the org settings location

## Open Questions

- Should `getHierarchicalLocaleAction` be extended to read MSP org defaults, or should a separate action be created?
- Should machine-translated non-English `msp/core.json` files have a `_comment` field marking them as needing review?

## Acceptance Criteria (Definition of Done)

1. Flag OFF: MSP portal identical to today — no regressions
2. Flag ON: `useTranslation('msp/core')` returns correct translations in MSP pages
3. Flag ON: `useTranslation('features/tickets')` loads shared translations
4. Flag ON: Language selector in Profile page works and persists
5. Flag ON: Organization language settings (default + enabled) work in Settings > General
6. Client portal works with new namespace structure (no regressions)
7. `clientPortal.json` no longer contains extracted keys (clean migration, no duplication)
8. `npm run build` succeeds
9. All new JSON files are valid across all 7 languages
