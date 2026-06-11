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
