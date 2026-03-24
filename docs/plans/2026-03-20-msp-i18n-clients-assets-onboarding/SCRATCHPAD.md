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
- (2026-03-20) `ClientsImportDialog.tsx` (697 LOC) has CSV column mapping — translate UI labels but keep CSV header names in English
- (2026-03-20) `ClientLanguagePreference.tsx` (118 LOC) — this component likely already has i18n awareness. Check during implementation.
- (2026-03-20) 2 empty stub files (PlanPickerDialog.tsx, ClientPlanDisambiguationGuide.tsx) — 1 LOC each, skip
- (2026-03-24) `ClientLocations.tsx` already contains partial `clients.locations.*` key usage. Extend that structure instead of replacing it with unrelated key names.
- (2026-03-24) Keep stable ids/values untranslated in clients batch: client detail tab ids (`details`, `tickets`, `assets`, `billing`, `billing-dashboard`, `contacts`, `documents`, `tax-settings`, `additional-info`, `notes`, `interactions`), billing tab ids (`general`, `plans`, `taxRates`, `overlaps`), guide tabs (`overview`, `bestPractices`, `scenarios`, `troubleshooting`), import steps (`upload`, `mapping`, `preview`, `importing`, `complete`, `unassigned`), and list/filter values (`grid`, `list`, `all`, `active`, `inactive`, `company`, `individual`).

### Contacts (2b-11)
- (2026-03-24) 12 files in `packages/clients/src/components/contacts/` (was 13 at plan time; ContactNotes.tsx removed or merged)
- (2026-03-20) Same package as clients (`@alga-psa/clients`) — can share import of `useTranslation`
- (2026-03-20) `ContactPortalTab.tsx` (652 LOC) — manages client portal access for contacts. May need to coordinate with client-portal translations.
- (2026-03-20) `ContactPhoneNumbersEditor.tsx` (755 LOC) — complex phone number CRUD with format hints

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
