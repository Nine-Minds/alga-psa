# Scratchpad — MSP i18n Batches 2b-1 + 2b-2: Core + Dashboard

- Plan slug: `2026-03-19-msp-i18n-batch-2b1-core`
- Created: `2026-03-19`

## Decisions

- (2026-03-19) **menuConfig.ts approach**: Option A — add `translationKey` field to `MenuItem` and `NavigationSection`. Keep `name` as stable identifier / English fallback. Sidebar.tsx uses `t(item.translationKey) || item.name` for display. This avoids making menuConfig depend on React hooks and keeps it as a plain data export.
- (2026-03-19) **GitHubStarButton**: Skip translation — "Star" text and aria-label are injected by the external GitHub buttons widget script, not our code.
- (2026-03-19) **"AlgaPSA" brand name**: Keep hardcoded — brand names are not translated. Only the alt text ("AlgaPSA Logo") gets a key.
- (2026-03-19) **Breadcrumb translation**: `getMenuItemNameByPath()` returns `item.name` (English). Once Sidebar translates via `translationKey`, breadcrumbs should also translate. Two options: (a) move translation lookup into `getMenuItemNameByPath` by passing `t` function, or (b) return the translationKey and let breadcrumb component call `t()`. Decision: option (a) — pass `t` to the function or move it into Header component where `t` is available.
- (2026-03-19) **TIER_LABELS**: TrialBanner uses `TIER_LABELS[tier]` from `@alga-psa/types` for tier display names ("Pro", "Premium"). These are product tier names and should likely stay in English. Only the surrounding text ("Trial:", "days left", "confirm to keep") gets translated.

## Discoveries / Constraints

### Core (msp/core)
- (2026-03-19) `msp/core.json` already has 72 keys covering: nav.* (27), sidebar.* (4), settings.sections.* (6), settings.tabs.* (17+), header.* (5). Many sidebar/header strings are NOT yet wired up — the keys exist but components still use hardcoded English.
- (2026-03-19) Sidebar.tsx does NOT use `useTranslation` currently. It reads `item.name` directly from menuConfig. The `sidebar.backToMain` key exists in core.json but is not consumed.
- (2026-03-19) Header.tsx does NOT use `useTranslation` currently. The `header.*` keys exist in core.json but are not consumed.
- (2026-03-19) `settingsNavigationSections` has a "Language" item that's conditionally filtered out when `msp-i18n-enabled` is OFF. This filter uses `item.name !== 'Language'` — if we change how names work, this filter needs to use `translationKey` or a stable id instead.
- (2026-03-19) `billingNavigationSections` has 4 section titles + 12 items = 16 new strings. These are NOT in the current core.json.
- (2026-03-19) `QuickCreateDialog.tsx` delegates to child components (QuickAddTicket, QuickAddClient, etc.) which have their own internal strings — those are OUT OF SCOPE for this batch. Only the wrapper's toast messages, dialog titles, and error messages are in scope.
- (2026-03-19) `RightSidebar.tsx` CE fallback has only 2 strings. The enterprise version (`@enterprise/components/layout/RightSidebar`) is separate and out of scope.
- (2026-03-19) `PlatformNotificationBanner.tsx` renders `banner_content` via `dangerouslySetInnerHTML` — this content comes from the database and is NOT translatable via i18n keys. Only the "Learn More" and "Dismiss" buttons are in scope.

### Dashboard (msp/dashboard)
- (2026-03-19) Dashboard has NO existing translations — `msp/dashboard.json` doesn't exist yet. This is a new namespace.
- (2026-03-19) Onboarding components live in `packages/onboarding/src/components/dashboard/`, NOT in `server/src/`. They import from `@alga-psa/onboarding`. Need to verify `useTranslation` works from package context (it should — `@alga-psa/ui/lib/i18n/client` is the shared import path).
- (2026-03-19) `stepDefinitions.ts` is a plain data file (not a React component) — same pattern as menuConfig. Should export `translationKey` fields, rendering component calls `t()`.
- (2026-03-19) `DashboardContainer.tsx` shows different welcome banners for Enterprise vs Community editions — both need translation.
- (2026-03-19) Onboarding progress ring has interpolated text: "3 of 5 Steps" — needs `{{completed}}` and `{{total}}` variables.
- (2026-03-19) Feature cards have a "Coming soon!" toast — this fires on click for cards without an href. Simple string, one key.
- (2026-03-19) `ROUTE_NAMESPACES` currently maps `/msp` to `['common', 'msp/core']`. Need to add `'msp/dashboard'` to both `/msp` and `/msp/dashboard` routes.
- (2026-03-19) `DashboardOnboardingSlot.tsx` and `DashboardOnboardingSkeleton.tsx` have no user-visible text — just layout/loading components. No translation needed.

## Progress Log

- (2026-03-19) Completed `F001-F006` and `T001-T009` together in the shared menu config layer. Added optional `translationKey` metadata to `MenuItem` and `NavigationSection`, populated every main/bottom/settings/billing/extensions nav item with stable i18n keys, and added `server/src/test/unit/layout/menuConfig.i18n.test.ts` to lock the mapping in place before Sidebar/Header consume it.
- (2026-03-19) New core keys implied by the menu config and still pending locale-file work: `nav.documentsAll`, `nav.knowledgeBase`, `nav.controlPanel`, `nav.workflowEditor`, `nav.systemMonitoring`, `nav.jobMonitoring`, `settings.tabs.language`, `settings.tabs.sla`, and all `nav.billing.*` entries.
- (2026-03-19) Completed `F007-F012` and `T010-T018` in `Sidebar.tsx`. Sidebar now translates menu item labels by cloning config items with `t(item.translationKey)`, translates the dashboard link/logo/toggle/back-to-main chrome, and filters the hidden Language settings entry by `translationKey` instead of English text so locale changes do not break the feature-flag behavior.
- (2026-03-19) Added `server/src/test/unit/layout/Sidebar.i18n.test.tsx` with a lightweight tooltip/collapse mock to verify translated open-state labels, collapsed tooltip labels, section titles in settings and billing modes, and the English fallback path when translations are unavailable.

## Commands / Runbooks

- **Validate translations**: `npx ts-node scripts/validate-translations.ts`
- **Generate pseudo-locales**: `npx ts-node scripts/generate-pseudo-locale.ts --locale xx --fill "1111"`
- **Italian accent audit**: `grep -n ' e [a-z]\| puo \| gia \| verra \| funzionalita\| necessario' server/public/locales/it/msp/core.json`
- **Count keys**: `node -e "const o=JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/core.json'));const c=(o,p='')=>{let n=0;for(const[k,v]of Object.entries(o)){if(typeof v==='object'&&v!==null)n+=c(v,p+k+'.');else n++}return n};console.log(c(o))"`
- **Visual QA**: Enable `msp-i18n-enabled` flag locally, switch to `xx` locale, navigate sidebar/header/settings/billing modes

## Links / References

- Translation plan: `.ai/translation/MSP_i18n_plan.md`
- Translation guide: `.ai/translation/translation-guide.md`
- File structure: `.ai/translation/translation_files_structure.md`
- Phase 1 plan: `docs/plans/2026-02-12-msp-i18n-phase1/`
- Infra sprint plan: `docs/plans/2026-02-19-msp-i18n-infrastructure-sprint/`

### Key file paths

| File | Role |
|------|------|
| `server/src/config/menuConfig.ts` | Menu data — needs translationKey fields |
| `server/src/components/layout/Sidebar.tsx` | Main sidebar — needs useTranslation |
| `server/src/components/layout/Header.tsx` | Top bar — needs useTranslation |
| `server/src/components/layout/DefaultLayout.tsx` | Layout wrapper — AI interrupt dialogs |
| `server/src/components/layout/TrialBanner.tsx` | Trial status badge |
| `server/src/components/layout/PaymentFailedBanner.tsx` | Payment failure badge |
| `server/src/components/layout/QuickCreateDialog.tsx` | Quick-create modal + toasts |
| `server/src/components/layout/RightSidebar.tsx` | CE chat fallback |
| `server/src/components/layout/PlatformNotificationBanner.tsx` | Platform notifications |
| `server/public/locales/en/msp/core.json` | English core translation file |
| `server/public/locales/en/msp/dashboard.json` | English dashboard translation file (TO CREATE) |
| `server/src/components/dashboard/DashboardContainer.tsx` | Main dashboard component |
| `packages/onboarding/src/components/dashboard/DashboardOnboardingSection.tsx` | Onboarding progress cards |
| `packages/onboarding/src/components/dashboard/OnboardingChecklist.tsx` | Alternative checklist view |
| `packages/onboarding/src/lib/stepDefinitions.ts` | Onboarding step data |
| `packages/core/src/lib/i18n/config.ts` | ROUTE_NAMESPACES config |

## Open Questions

- **Breadcrumb name source**: Currently `getMenuItemNameByPath()` returns English `item.name`. Need to decide how to pass `t()` function to it (it's called inside the Header component, so `t` is available — could change the function signature to accept a translator, or move the logic inline).
- **Language filter in Sidebar**: The `item.name !== 'Language'` check needs updating once translationKeys are used. Should use `item.translationKey !== 'settings.tabs.language'` or add a stable `id` field.
- **Onboarding package imports**: Verify that `useTranslation` from `@alga-psa/ui/lib/i18n/client` works correctly when called from components in `packages/onboarding/`. The i18n context is provided at the layout level, so it should work — but test early.
- **stepDefinitions.ts pattern**: Should it use the same `translationKey` pattern as menuConfig? Or should the rendering components just use hardcoded key paths like `t('onboarding.steps.identity.title')`? The latter is simpler since step IDs are stable.
