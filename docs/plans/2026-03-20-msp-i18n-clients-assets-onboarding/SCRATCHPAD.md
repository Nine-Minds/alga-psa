# Scratchpad — MSP i18n Batches 2b-10/11/12/16: Clients, Contacts, Assets, Onboarding

- Plan slug: `2026-03-20-msp-i18n-clients-assets-onboarding`
- Created: `2026-03-20`

## Decisions

- (2026-03-20) **String estimates carry uncertainty**: Automated scan reported ~7,450 total but previous batches showed 1.5-2.5x overestimation. Lower bound (~3,300) is more realistic. Exact counts during implementation.
- (2026-03-20) **Onboarding scope**: Only wizard steps + OnboardingWizard.tsx. Dashboard onboarding (DashboardOnboardingSection, OnboardingChecklist) already translated in batch 2b-2.
- (2026-03-20) **Execution order**: Clients → Contacts → Assets → Onboarding. Clients/contacts are daily-use features. Assets is large but self-contained. Onboarding is used once per tenant but is important for first impressions.

## Discoveries / Constraints

### Clients (2b-10)
- (2026-03-20) 32 files in `packages/clients/src/components/clients/`, ~12,357 LOC total
- (2026-03-20) `ClientDetails.tsx` (1,805 LOC) is the largest — full client detail page with multiple sections
- (2026-03-20) Heavy billing integration: BillingConfiguration, ClientContractAssignment, ClientContractLineDashboard, ClientBillingSchedule, TaxSettingsForm — may share terminology with msp/contracts namespace. Cross-check translations.
- (2026-03-20) `ClientsImportDialog.tsx` (697 LOC) has CSV column mapping — translate UI labels but keep CSV header names in English
- (2026-03-20) `ClientLanguagePreference.tsx` (118 LOC) — this component likely already has i18n awareness. Check during implementation.
- (2026-03-20) 2 empty stub files (PlanPickerDialog.tsx, ClientPlanDisambiguationGuide.tsx) — 1 LOC each, skip

### Contacts (2b-11)
- (2026-03-20) 13 files in `packages/clients/src/components/contacts/`, ~6,273 LOC total
- (2026-03-20) Same package as clients (`@alga-psa/clients`) — can share import of `useTranslation`
- (2026-03-20) `ContactPortalTab.tsx` (652 LOC) — manages client portal access for contacts. May need to coordinate with client-portal translations.
- (2026-03-20) `ContactPhoneNumbersEditor.tsx` (755 LOC) — complex phone number CRUD with format hints

### Assets (2b-12)
- (2026-03-20) 39 files in `packages/assets/src/components/`, ~8,652 LOC total
- (2026-03-20) Well-organized with subdirectories: `tabs/`, `panels/`, `shared/`
- (2026-03-20) `StatusBadge.tsx` (102 LOC, ~60 strings) — high density, many status label variations
- (2026-03-20) RMM integration components (RmmStatusIndicator, RmmVitalsPanel) — technical labels, some may stay English
- (2026-03-20) `AssetCommandPalette.tsx` (256 LOC) — search/command interface, needs accessible translations
- (2026-03-20) `index.ts` (13 LOC) — just exports, skip

### Onboarding (2b-16)
- (2026-03-20) `TicketingConfigStep.tsx` (2,920 LOC) is MASSIVE — larger than most entire components. Has ticketing board setup, status configuration, priority settings, category management, SLA configuration. This is effectively a mini settings page embedded in the wizard.
- (2026-03-20) Dashboard components are EXCLUDED (already in msp/dashboard.json):
  - DashboardOnboardingSection.tsx — translated
  - OnboardingChecklist.tsx — translated
  - DashboardOnboardingSlot.tsx — no strings
  - DashboardOnboardingSkeleton.tsx — no strings

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
