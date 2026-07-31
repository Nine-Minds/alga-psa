# Backlog (wave 2) — display/engine `|| 'USD'` fallback sweep

**Status:** Deferred. **Why:** Most of these are *defensive read-time fallbacks* — when the underlying record
already has a `currency_code` (which it will once Workstream 4 populates currency at creation, and once
existing rows are backfilled per DD-3), the `|| 'USD'` branch never executes. Converting ~150 sync display
fallbacks to call an async resolver risks sync→async render breakage for little gain. Sweep these in wave 2
after WS4 + DD-3 land, prioritizing the *write/generation* paths over pure display.

Tackle in this order: **(1) generation/write paths → (2) backend services → (3) UI display.**

## 1. Generation / write paths (highest value)

- [ ] `packages/billing/src/lib/billing/billingEngine.ts` — ~22 sites of `client?.default_currency_code || "USD"`
      (lines ~534, 552, 597, 653, 691, 715, 723, 1219, 1350, 2055, 2216, 2418, 3038, 3362, 3432, 3672, 3871,
      3920, 3962, 4176, 4396). After WS4+DD-3 these should resolve from the (now-populated) client; audit any
      that run before the client currency is known.
- [ ] `packages/billing/src/actions/invoiceGeneration.ts` (~1273, 1405, 1897, 2173, 2257, 2269)
- [ ] `packages/billing/src/actions/invoiceQueries.ts` (~90)
- [ ] `packages/billing/src/actions/creditActions.ts` (~489, 747)
- [ ] `packages/billing/src/actions/accountingExportActions.ts` (~235, 249)
- [ ] `server/src/lib/api/controllers/ApiAccountingExportController.ts` (~223, 238)
- [ ] `shared/workflow/runtime/actions/businessOperations/crm.ts` (~270) & `crmWorkerDal.ts` (~46) — `.default('USD')`
- [ ] `packages/tickets/src/actions/materialCatalogActions.ts` (~144) & `packages/projects/.../materialCatalogActions.ts` (~144)

## 2. Backend services

- [ ] `server/src/lib/api/services/FinancialService.ts` (~497, 652)
- [ ] `ee/server/src/lib/payments/PaymentService.ts` (~239, 452, 594, 637, 638, 702)
- [ ] `ee/server/src/lib/payments/StripePaymentProvider.ts` (~535)

## 3. UI display fallbacks (lowest risk, lowest value)

- [ ] Quotes: `QuoteForm.tsx` (~121), `QuoteDetail.tsx` (multiple), `QuoteApprovalDashboard.tsx` (~112),
      `QuoteTemplatesList.tsx` (~91), `QuotesTab.tsx` (~111)
- [ ] Contracts: `ContractWizard.tsx` (~317), `ContractDialog.tsx` (~384, 668), `ContractForm.tsx` (~31),
      `ContractHeader.tsx` (~60), `ContractDetail.tsx` (~1119, 1642), `ContractLines.tsx` (~560, 1233)
- [ ] Invoicing UI: `DraftInvoiceDetailsCard.tsx` (~237), `DraftsTab.tsx` (~415), `FinalizedTab.tsx` (~333),
      `ManualInvoices.tsx` (~670)
- [ ] Materials UI: `TicketMaterialsCard.tsx` (~198), `ProjectMaterialsDrawer.tsx` (~125)
- [ ] Client portal: `clientPaymentActions.ts` (~212, 255, 271, 285, 300, 314),
      `PaymentSuccessContent.tsx` (~38), `BillingOverviewTab.tsx` (~208)
- [ ] Onboarding: `BillingSetupStep.tsx` (~169, 737, 746), `onboardingActions.ts` (~660)
- [ ] EE: `ee/server/src/components/licensing/LicensePurchaseForm.tsx` (~126, 264, 271)
- [ ] Mobile: `ee/mobile/src/features/ticketDetail/components/MaterialsSection.tsx` (~23, 26, 290)

## Follow-ups surfaced during wave 1

- [x] **F-1 (DONE 2026-06-19):** Verified the legacy `server/src/lib/reports/` runtime (definitions, actions,
      `ReportEngine`, `ReportRegistry`, barrel `index`, `test-reports`) had **no production importers** — only
      EE's platform-reports use `core/types.ts` + `builders/QueryBuilder.ts`, which were kept. Deleted the dead
      cluster. The 2 tests that referenced the legacy defs were repointed to the live `@alga-psa/reporting`
      copy (now passing). **Side discovery:** doing so exposed that the live copy's billing-overview
      `active_clients_count` metric still joined the deprecated `client_contract_lines` table while its dead
      twin had been migrated to `client_contracts`/`contracts`/`contract_lines` (a missed target from the
      2026-03-19 client-contract-line post-drop cutover). Ported the migrated join into
      `packages/reporting/.../billing/overview.ts`. This also retires the long-standing two-copy "mirror
      changes" maintenance burden noted in `ee/docs/plans/2026-06-10-i18n-formatting-and-gaps/`.
- [ ] **F-2 (DD-2 fast-follow):** After WS4 wires `resolveClientBillingCurrency` into the quote/product create
      paths, drop `.default('USD')` → `.optional()` in: `server/src/lib/api/schemas/quoteSchemas.ts`,
      `server/src/lib/api/schemas/productSchemas.ts`, `packages/billing/src/schemas/quoteSchemas.ts`,
      `packages/billing/src/models/service.ts`. (Held in wave 1 — dropping before the resolver is wired would
      persist NULL currency.)
- [ ] **F-3:** Ticket-email date localization uses the tenant default, not the per-recipient locale. Move date
      formatting into the per-recipient send loop in `ticketEmailSubscriber.ts` for true per-recipient locale.

## Region long tail (wave 2, gated on DD-1)

- [ ] Address/location/phone `'US'` defaults (QuickAddClient, ClientLocations, onboarding, PhoneInput,
      CountryPicker, ContactPhoneNumbersEditor, xeroCsvClientSyncService) — drive from the org default-region
      setting once DD-1 is decided.
