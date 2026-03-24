# Scratchpad — MSP i18n Batches 2b-10/11/12/16: Clients, Contacts, Assets, Onboarding

- Plan slug: `2026-03-20-msp-i18n-clients-assets-onboarding`
- Created: `2026-03-20`

## Decisions

- (2026-03-20) **String estimates carry uncertainty**: Automated scan reported ~7,450 total but previous batches showed 1.5-2.5x overestimation. Lower bound (~3,300) is more realistic. Exact counts during implementation.
- (2026-03-20) **Onboarding scope**: Only wizard steps + OnboardingWizard.tsx. Dashboard onboarding (DashboardOnboardingSection, OnboardingChecklist) already translated in batch 2b-2.
- (2026-03-20) **Execution order**: Clients → Contacts → Assets → Onboarding. Clients/contacts are daily-use features. Assets is large but self-contained. Onboarding is used once per tenant but is important for first impressions.
- (2026-03-24) **Post-rebase plan update**: Rebased on origin/main after merges of client-owned-contracts-simplification, board-specific-statuses, and 4 new i18n batches (dispatch, reports, admin, time-entry). Updated file counts, LOC, and string estimates. No structural changes to the plan — all 4 batches remain valid.

## Discoveries / Constraints

### Clients (2b-10)
- (2026-03-20) 31 files in `packages/clients/src/components/clients/` (+panels/ subdir with ClientNotesPanel.tsx)
- (2026-03-20) `ClientDetails.tsx` (1,805 LOC) is the largest — full client detail page with multiple sections
- (2026-03-20) Heavy billing integration: BillingConfiguration, ClientContractAssignment, ClientContractLineDashboard, ClientBillingSchedule, TaxSettingsForm — may share terminology with msp/contracts namespace. Cross-check translations.
- (2026-03-24) **Post-rebase update**: 6 client files modified by client-owned-contracts-simplification merge. `BillingConfiguration.tsx` (661→701 LOC), `ClientBillingSchedule.tsx` (~387→504 LOC, significant growth), `ClientContractAssignment.tsx` (430→423 LOC, refactored for assignment-explicit semantics), `ClientLocations.tsx` (1,021→1,038 LOC), `ContractLines.tsx` (+55 LOC), `ClientContractLineDisambiguationGuide.tsx` (+14 LOC). Billing terminology changed — must cross-check against `msp/contracts` namespace.
- (2026-03-24) `ClientBillingSchedule.tsx` mixes local UI copy with `cadenceContext` strings returned from shared billing helpers. The local shell/actions/labels can move to `msp/clients` now, but full localization of `changeScopeDescription`, `scheduleDescription`, and `previewDescription` likely needs an upstream shared-data change later.
- (2026-03-20) `ClientsImportDialog.tsx` (697 LOC) has CSV column mapping — translate UI labels but keep CSV header names in English
- (2026-03-20) `ClientLanguagePreference.tsx` (118 LOC) — this component likely already has i18n awareness. Check during implementation.
- (2026-03-24) `PlanPickerDialog.tsx` and `ClientPlanDisambiguationGuide.tsx` are thin re-export shims (`ContractLinePickerDialog` / `ClientContractLineDisambiguationGuide`) rather than direct UI surfaces. No separate namespace wiring is needed there; translation work belongs in the underlying implementation files.
- (2026-03-20) 2 empty stub files (PlanPickerDialog.tsx, ClientPlanDisambiguationGuide.tsx) — 1 LOC each, skip
- (2026-03-24) `ClientLocations.tsx` already contains partial `clients.locations.*` key usage. Extend that structure instead of replacing it with unrelated key names.
- (2026-03-24) Keep stable ids/values untranslated in clients batch: client detail tab ids (`details`, `tickets`, `assets`, `billing`, `billing-dashboard`, `contacts`, `documents`, `tax-settings`, `additional-info`, `notes`, `interactions`), billing tab ids (`general`, `plans`, `taxRates`, `overlaps`), guide tabs (`overview`, `bestPractices`, `scenarios`, `troubleshooting`), import steps (`upload`, `mapping`, `preview`, `importing`, `complete`, `unassigned`), and list/filter values (`grid`, `list`, `all`, `active`, `inactive`, `company`, `individual`).

### Contacts (2b-11)
- (2026-03-24) 12 files in `packages/clients/src/components/contacts/` (was 13 at plan time; ContactNotes.tsx removed or merged)
- (2026-03-20) Same package as clients (`@alga-psa/clients`) — can share import of `useTranslation`
- (2026-03-20) `ContactPortalTab.tsx` (652 LOC) — manages client portal access for contacts. May need to coordinate with client-portal translations.
- (2026-03-20) `ContactPhoneNumbersEditor.tsx` (755 LOC) — complex phone number CRUD with format hints
- (2026-03-24) There is also `packages/clients/src/components/contacts/panels/ContactNotesPanel.tsx` with user-facing copy (`Notes & Quick Info`, `Initial Note`, load/save error UI). The plan checklist omits it, so treat it as required remaining contact work rather than leaving the panel untranslated.

### Assets (2b-12)
- (2026-03-24) 41 files in `packages/assets/src/components/` (was 39 at plan time; +1 test file, +1 new component)
- (2026-03-20) Well-organized with subdirectories: `tabs/`, `panels/`, `shared/`
- (2026-03-20) `StatusBadge.tsx` (102 LOC, ~60 strings) — high density, many status label variations
- (2026-03-20) RMM integration components (RmmStatusIndicator, RmmVitalsPanel) — technical labels, some may stay English
- (2026-03-20) `AssetCommandPalette.tsx` (256 LOC) — search/command interface, needs accessible translations
- (2026-03-20) `index.ts` (13 LOC) — just exports, skip

### Onboarding (2b-16)
- (2026-03-24) `TicketingConfigStep.tsx` (3,040 LOC, was 2,920) is MASSIVE — larger than most entire components. Has ticketing board setup, status configuration, priority settings, category management, SLA configuration. This is effectively a mini settings page embedded in the wizard. **Updated**: +120 LOC for board-scoped status configuration (board-specific-statuses merge).
- (2026-03-24) `BillingSetupStep.tsx` (610 LOC, was 582) — billing mode decoupled from service type (+28 LOC).
- (2026-03-20) Dashboard components are EXCLUDED (already in msp/dashboard.json):
  - DashboardOnboardingSection.tsx — translated
  - OnboardingChecklist.tsx — translated
  - DashboardOnboardingSlot.tsx — no strings
  - DashboardOnboardingSkeleton.tsx — no strings
- (2026-03-24) Wizard-only onboarding form/help/alert text should stay in the new `msp/onboarding` namespace rather than extending `msp/dashboard.json`. Existing dashboard overlap remains under `onboarding.*` keys in `msp/dashboard.json`, but wizard steps do not reuse that namespace today.
- (2026-03-24) Keep stable onboarding ids/values untranslated: `OnboardingStepId`, `step.id`, `substep.id`, `data_import`, checklist status enums (`complete`, `in_progress`, `not_started`, `blocked`), role values (`admin`, `technician`, `manager`, `user`), billing mode values (`fixed`, `hourly`, `usage`), `USD`, and ticketing sentinels like `none`, `board`, `category`, `status`, `priority`.

## Progress Log

- (2026-03-24) Completed `F001`: created `server/public/locales/en/msp/clients.json` with an initial component-scoped English namespace covering the clients list, client details, quick-add, locations, billing/contracts, tax settings, import flow, and notes panel. This seeds the new `msp/clients` file so follow-up wiring can land on stable keys instead of inventing ad hoc paths mid-edit. Validation: `node -e "JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/clients.json','utf8')); console.log('ok')"` returned `ok`.
- (2026-03-24) Completed `F002`: wired `packages/clients/src/components/clients/Clients.tsx` and `packages/clients/src/components/clients/ClientDetails.tsx` to `useTranslation('msp/clients')`. The list/detail chrome, main filter controls, view labels, bulk-delete dialogs, core detail tab labels, major field labels, save/delete/reactivate toasts, and deactivate/reactivate confirmations now use `t(..., { defaultValue })` while preserving stable tab ids/query-param values. Expanded `server/public/locales/en/msp/clients.json` with the new list/detail keys needed by those two files. Validation:
  - `npx eslint packages/clients/src/components/clients/Clients.tsx packages/clients/src/components/clients/ClientDetails.tsx` (warnings only, no errors)
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-24) Completed `F003`: wired `packages/clients/src/components/clients/QuickAddClient.tsx`, `packages/clients/src/components/clients/ClientLocations.tsx`, and `packages/clients/src/components/clients/ClientsImportDialog.tsx` to `msp/clients`. `QuickAddClient` now translates its section headings, primary labels/placeholders, CTA buttons, and metadata-loading errors; `ClientLocations` now resolves its existing `clients.locations.*` keys from the new namespace instead of `common`; `ClientsImportDialog` now translates the main import flow headings, action buttons, and confirmation copy. Expanded `server/public/locales/en/msp/clients.json` with the additional import-flow keys used by these surfaces. Validation:
  - `npx eslint packages/clients/src/components/clients/QuickAddClient.tsx packages/clients/src/components/clients/ClientLocations.tsx packages/clients/src/components/clients/ClientsImportDialog.tsx` (warnings only, no errors)
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-24) Completed `F004`: wired `packages/clients/src/components/clients/BillingConfiguration.tsx`, `packages/clients/src/components/clients/ClientContractAssignment.tsx`, `packages/clients/src/components/clients/ClientContractLineDashboard.tsx`, and `packages/clients/src/components/clients/ClientBillingSchedule.tsx` to `msp/clients`. Billing toasts/dialog chrome/tab labels, contract-assignment table/actions/status labels, dashboard card/table headings, and billing-schedule controls/summaries now use `t(..., { defaultValue })` while preserving stable tab ids, contract ids, billing cycle enum values, and assignment semantics from the recent refactor. Expanded `server/public/locales/en/msp/clients.json` with billing, contract-assignment, dashboard, and schedule keys including cycle/month/weekday labels and schedule summary templates. Validation:
  - `node -e "JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/clients.json','utf8')); console.log('json ok')"` returned `json ok`
  - `npx eslint packages/clients/src/components/clients/BillingConfiguration.tsx packages/clients/src/components/clients/ClientContractAssignment.tsx packages/clients/src/components/clients/ClientContractLineDashboard.tsx packages/clients/src/components/clients/ClientBillingSchedule.tsx` (warnings only, no errors)
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-24) Completed `F005`: wired the remaining non-stub client components to `msp/clients`, including grid/list surfaces (`ClientGridCard`, `ClientsGrid`, `ClientsList`, `ClientCreatedDialog`, `ClientQuickView`, `ClientSideDetails`) and the billing/settings/helper surfaces (`BillingConfigForm`, `ClientContractDialog`, `ClientContractLineDisambiguationGuide`, `ClientCreditExpirationSettings`, `ClientLanguagePreference`, `ClientServiceOverlapMatrix`, `ClientTaxRates`, `ClientZeroDollarInvoiceSettings`, `ContractLinePickerDialog`, `ContractLines`, `ServiceCatalog`, `TaxRateCreateForm`, `TaxSettingsForm`, `panels/ClientNotesPanel`). After the code wiring landed, generated a source-to-locale sync with the Babel AST parser to backfill every still-missing English key referenced by client components into `server/public/locales/en/msp/clients.json`. Re-export shims `PlanPickerDialog.tsx` and `ClientPlanDisambiguationGuide.tsx` were intentionally skipped because they delegate to already-translated implementation files. Validation:
  - AST key audit against all client component `t(...)` calls reported `missing=0` for `server/public/locales/en/msp/clients.json`
  - `node -e "JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/clients.json','utf8')); console.log('json ok')"` returned `json ok`
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
- (2026-03-24) Completed `F006`: created `server/public/locales/{de,es,fr,it,nl,pl}/msp/clients.json` with translated `msp/clients` content based on the finalized English namespace, then generated `server/public/locales/{xx,yy}/msp/clients.json` via `node scripts/generate-pseudo-locales.cjs` (`xx=11111`, `yy=55555`). Restored unrelated pseudo-locale noise from previously existing MSP namespaces so this feature commit stays scoped to the new clients namespace. Validation:
  - `for f in server/public/locales/{de,es,fr,it,nl,pl,xx,yy}/msp/clients.json; do node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" || exit 1; done` returned `json-ok`
  - `node scripts/validate-translations.cjs` → `PASSED` (`Errors: 0`, `Warnings: 0`)
- (2026-03-24) Completed `F007`: ran a targeted Italian accent audit on `server/public/locales/it/msp/clients.json` using `rg -n '\\b(puo|gia|verra|funzionalita|perche|cosi|piu|e necessario|e possibile|e richiesto|e richiesta|e configurato|e configurata)\\b' server/public/locales/it/msp/clients.json`. The audit returned no matches, and spot checks of higher-risk translated strings (renewal defaults help, language preference success copy, tax-source help) confirmed accented forms were preserved correctly.
- (2026-03-24) Completed `T001`: `node scripts/validate-translations.cjs` passed after adding the clients namespace across `{en,de,es,fr,it,nl,pl,xx,yy}`. Summary reported `Errors: 0`, `Warnings: 0`, confirming `msp/clients` key parity across all 9 locale variants.
- (2026-03-24) Completed `T002`: `cd server && npx tsc -p tsconfig.json --noEmit --pretty false` passed after wiring all client component surfaces. The remaining `PlanPickerDialog.tsx` and `ClientPlanDisambiguationGuide.tsx` files were confirmed to be re-export shims, so the compile check covers the actual implementation files that render client UI.
- (2026-03-24) Completed `T003`: the targeted Italian accent audit for `server/public/locales/it/msp/clients.json` returned zero matches for the known dropped-accent patterns (`puo`, `gia`, `verra`, `funzionalita`, `e necessario`, etc.), so the clients namespace passed the post-translation accent check.
- (2026-03-24) Completed `F010`: created `server/public/locales/en/msp/contacts.json` with an initial component-scoped English scaffold for the contacts list, contact detail, import flow, phone editor, portal tab, quick-add form, edit/view helpers, client-embedded list, route shell, loading skeleton, avatar upload, and notes panel. This matches the existing `msp/clients` namespace style so follow-up wiring can land on stable section names instead of ad hoc keys. Validation: `node -e "JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/contacts.json','utf8')); console.log('ok')"` returned `ok`.
- (2026-03-24) Completed `F011`: wired `packages/clients/src/components/contacts/ContactDetails.tsx`, `packages/clients/src/components/contacts/Contacts.tsx`, and `packages/clients/src/components/contacts/ContactsImportDialog.tsx` to `useTranslation('msp/contacts')`. The contact list now translates its heading, filter/search chrome, table columns, action menus, delete/inactive flows, and last-phone-type confirmation; the detail view now translates its tab labels, field labels, save/delete/deactivate toasts, back/open actions, and inbound-destination helper text while preserving stable route/tab ids; the import dialog now translates its flow headings, mapping UI, tooltips, confirmation copy, and upload helper text while keeping CSV headers/state ids (`upload`, `mapping`, `preview`, `importing`, `results`, `complete`, `unassigned`) stable. Expanded `server/public/locales/en/msp/contacts.json` with the list/detail/import keys used by these files. Validation:
  - `node -e "JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/contacts.json','utf8')); console.log('contacts json ok')"` returned `contacts json ok`
  - `npx eslint packages/clients/src/components/contacts/Contacts.tsx packages/clients/src/components/contacts/ContactDetails.tsx packages/clients/src/components/contacts/ContactsImportDialog.tsx` (warnings only, no errors)
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
  - Perl/Node audit over `t('...')` calls in the three files reported `contacts keys ok` for `server/public/locales/en/msp/contacts.json`
- (2026-03-24) Completed `F012`: wired `packages/clients/src/components/contacts/ContactPhoneNumbersEditor.tsx`, `packages/clients/src/components/contacts/ContactPortalTab.tsx`, and `packages/clients/src/components/contacts/QuickAddContact.tsx` to `msp/contacts`. The phone editor now translates its headings, row actions, phone-type labels, custom-type search prompts, last-usage confirmation, and inline validation copy; the portal tab now translates the client-portal access shell, admin/role/status/invitation history controls, toast copy, and invitation badge labels while keeping invitation status enum values stable; the quick-add contact flow now translates dialog chrome, field labels/placeholders, validation summary/errors, status toggle copy, and success/error toasts, and it now routes phone validation messages through the translated phone-editor helper for consistent copy. Expanded `server/public/locales/en/msp/contacts.json` with phone-editor, portal-tab, and quick-add keys including dynamic phone-type labels and invitation-status badge labels. Validation:
  - `node -e "JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/contacts.json','utf8')); console.log('contacts json ok')"` returned `contacts json ok`
  - `npx eslint packages/clients/src/components/contacts/ContactPhoneNumbersEditor.tsx packages/clients/src/components/contacts/ContactPortalTab.tsx packages/clients/src/components/contacts/QuickAddContact.tsx` (warnings only, no errors)
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
  - Perl/Node audit over `t('...')` calls in those three files plus explicit checks for `contactPhoneNumbersEditor.phoneTypes.*` and `contactPortalTab.history.status.{pending,used,expired,revoked}` reported `contacts F012 keys ok`
- (2026-03-24) Completed `F013`: wired the remaining contact detail/list surfaces to `msp/contacts`. `packages/clients/src/components/contacts/ContactDetailsEdit.tsx` now translates its reflection labels, field labels/placeholders, client/status/help text, save/cancel actions, and validation/save errors while routing phone validation through `translateContactPhoneValidationErrors(...)`; `packages/clients/src/components/contacts/ContactDetailsView.tsx` now translates its shell actions, field labels, empty states, phone-type labels, status values, documents heading, and client-loading/update errors; `packages/clients/src/components/contacts/ClientContactsList.tsx` now translates the embedded table headers, filter labels/options, action menu labels, add-contact CTA, and load/retry errors; `packages/clients/src/components/contacts/panels/ContactNotesPanel.tsx` now translates the notes panel title, save/retry actions, legacy-note heading, load-error title, unknown-error fallback, and last-updated timestamp. `ContactsLayout.tsx`, `ContactAvatarUpload.tsx`, and `ContactsSkeleton.tsx` remain unchanged because they are pure wrappers/placeholders with no local user-facing copy. Expanded `server/public/locales/en/msp/contacts.json` with the detail/list/panel keys used by these files and corrected scaffold defaults like `contactPhoneNumbersEditor.title` (`Phone Numbers`) and `contactNotesPanel.title` (`Notes & Quick Info`) to match the rendered UI. Validation:
  - `node -e "JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/contacts.json','utf8')); console.log('contacts json ok')"` returned `contacts json ok`
  - `npx eslint packages/clients/src/components/contacts/ClientContactsList.tsx packages/clients/src/components/contacts/ContactDetailsEdit.tsx packages/clients/src/components/contacts/ContactDetailsView.tsx packages/clients/src/components/contacts/panels/ContactNotesPanel.tsx` (warnings only, no errors)
  - `cd server && npx tsc -p tsconfig.json --noEmit --pretty false`
  - key-presence audit over the four files against `server/public/locales/en/msp/contacts.json` reported `contacts F013 keys ok`

## Commands / Runbooks

### Validation
```bash
node scripts/validate-translations.cjs
npm run build
```

### Pseudo-locale generation
```bash
cat << 'SCRIPT' | node - server/public/locales/en/msp/<name>.json 11111
const fs = require("fs");
const fill = process.argv[3];
const transform = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "object" && v !== null ? transform(v) : fill;
  }
  return out;
};
const src = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(JSON.stringify(transform(src), null, 2));
SCRIPT
```

### Italian accent audit
```bash
for ns in clients contacts assets onboarding; do
  echo "=== $ns ===";
  grep -n ' e [a-z]\| puo \| gia \| verra \| funzionalita\| necessario' server/public/locales/it/msp/$ns.json 2>/dev/null || echo "(file not found)";
done
```

## Links / References

- Translation plan: `.ai/translation/MSP_i18n_plan.md`
- Translation guide: `.ai/translation/translation-guide.md`
- Previous plans: `docs/plans/2026-03-19-msp-i18n-batch-2b1-core/`, `docs/plans/2026-03-20-msp-i18n-dispatch-reports-admin-time/`

### Key directories
| Directory | Files | Sub-batch |
|-----------|-------|-----------|
| `packages/clients/src/components/clients/` | 32 | 2b-10 |
| `packages/clients/src/components/contacts/` | 13 | 2b-11 |
| `packages/assets/src/components/` | 39 | 2b-12 |
| `packages/onboarding/src/components/steps/` | 7 | 2b-16 |
| `packages/onboarding/src/components/OnboardingWizard.tsx` | 1 | 2b-16 |

## Open Questions

- **Client portal overlap**: Do any client/contact components render in the client portal? If so, those strings should go in `features/*.json` (shared) not `msp/*.json`.
- **Asset EE components**: Are there EE-only asset features that live elsewhere?
- **TicketingConfigStep decomposition**: At 2,920 LOC, should this be broken into sub-sections in the namespace, or is a flat structure fine?
- **Billing terminology sync**: Client billing config uses contract/invoice/tax terms. Cross-check against `msp/contracts` and `msp/invoicing` namespaces for consistency.
