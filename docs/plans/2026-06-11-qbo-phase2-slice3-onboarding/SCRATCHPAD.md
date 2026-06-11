# SCRATCHPAD — QBO Slice 3: Onboarding & Reconciliation

## Decisions

- **2026-06-11 — One-time payment backfill for wizard-matched invoices**
  (user-confirmed). The sync cursor starts at connect, so pre-connect payments
  never replay via CDC; without backfill, linked history reads unpaid forever.
  Backfill runs in the wizard as a progress batch (not in the 15-min cycle),
  applies through `recordExternalPayment`, skips already-paid invoices.
- Link-only customer import: QBO customers are never turned into new Alga
  clients; creation flows Alga→QBO only.
- "Exact match" = strict normalized equality; similarity scoring is
  suggestion-tier only and always human-confirmed.
- Match candidates computed live, no wizard-session tables → wizard is
  idempotent and re-runnable by construction.

## Key file paths

- Live mapping manager to host the Customers tab:
  `packages/integrations/src/components/qbo/QboLiveMappingManager.tsx`
- Catalog action pattern to mirror for getQboCustomers:
  `packages/integrations/src/actions/qboActions.ts` (getQboItems et al.)
- Company auto-provision path the mapping must take precedence over:
  `packages/billing/src/services/companySync/adapters/quickBooksCompanyAdapter.ts`
  + `AccountingMappingResolver.ensureCompanyMapping`
- Finalize producer to gain the cutoff check: slice-1 hook in
  `packages/billing/src/actions/invoiceModification.ts`
- Payment landing service (from slice 1): `recordExternalPayment`

## Gotchas

- QBO query pagination: 1000-row max per query; customer and invoice fetches
  must page (STARTPOSITION/MAXRESULTS).
- Wizard payment backfill can be hundreds of Payment queries on big files —
  batch with progress UI, rate-limit politely (QBO throttles ~500 req/min).
- Historical invoices may carry doc numbers QBO de-duplicated or altered;
  total+customer agreement is what makes a match "confident".
- `excludeSyncedInvoices` in the export selector keys off mapping presence —
  verify linked-without-export rows are treated as synced.

## Implementation notes (built 2026-06-11)

- All onboarding UI lives in packages/billing/src/components/accounting
  (QboCustomerMappingPanel, QboOnboardingWizard + Entry) and reaches
  QboIntegrationSettings via a second slot (`onboardingSlot`) threaded from
  SettingsPage — same cycle-avoidance as the health panel. The customer
  mapping surface is therefore NOT a 4th live-mapping tab; it renders inside
  the wizard and the connection-card slot (deviation from PRD §5.1 framing,
  same capability).
- Payment backfill reuses applyExternalPaymentChange with synthetic change
  objects, so backfilled history gets identical mappings/idempotency/status
  flips as the live pull; payments are fetched once per distinct customer.
- Wizard completion state per realm under
  tenant_settings.settings.accountingSync.onboarding.
- F015 (go-live cutoff in the producer) was already shipped in slice 1.
- Deferred to DB env / live smoke: T007 (link-without-export exclusion uses
  excludeSyncedInvoices mapping presence — code-audited), T011 (DB-backed
  wizard integration), T012-T015 (sandbox smoke).
- Pre-existing billing-suite failures (14, DB-dependent) verified unchanged
  via git-stash baseline by the server agent.
