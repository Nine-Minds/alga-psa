# USA/USD/English Default Leakage — Tracker

**Date:** 2026-06-18
**Origin:** Client report — "even after setting default currency, a single Tax/Region, and a default
language in Settings → Billing, I still get defaulted to USA/USD/English in too many sections."
**Status:** Verified accurate. Root cause is architectural, not misconfiguration.

## TL;DR root causes

1. **Currency** — `default_billing_settings.default_currency_code` is persisted but only used as a
   *last-resort fallback* inside `resolveClientBillingCurrency()`. It is **not applied at creation time**
   to new clients/contracts/quotes, and ~150 call sites use a raw `... || 'USD'` instead of the resolver.
2. **Tax/Region** — there is **no org-level "default tax region" setting at all**, and invoice tax
   calculation hardcodes `tax_region: 'US'` (`InvoiceService.ts:~397`). New clients pick the *first active
   tax rate by creation date* rather than a configured default. Address/phone forms also hardcode `US`.
3. **Locale** — the resolution layer is correct and UI/email *language* respects it, but the resolved
   locale is never threaded into **formatters** (dates/numbers/currency render `en-US`), reports, or a
   couple of pre-login pages.

## How this tracker works

- Each `workstream-*.md` file is a checklist owned by **one** subagent. The agent edits only the source
  files listed in its file and checks off `[ ]` → `[x]` as it lands each fix, adding a short note.
- File ownership is **disjoint** across wave-1 agents so they can run in parallel without edit conflicts.
- `backlog-currency-fallbacks.md` is the long tail (deferred to wave 2) — enumerated for completeness.
- Changes are left **uncommitted** (per repo workflow).

## Status dashboard

| # | Workstream | Owner | Files | Status |
|---|------------|-------|-------|--------|
| 1 | [Locale & formatting](workstream-1-locale-formatting.md) | agent-locale | formatters, ReportEngine ×2, ticket email, email-logs UI, 2 auth pages | ☑ done (5/7; 2 auth pages → DD-4) |
| 2 | [Tax / Region](workstream-2-tax-region.md) | agent-tax-region | InvoiceService, shared tax setup | ☑ done (org-default setting → DD-1) |
| 3 | [Report & schema USD hardcodes](workstream-3-reports-schemas.md) | agent-reports | reporting defs, API/billing schemas, service model | ☑ reports fixed; schemas held → DD-2 |
| 4 | [Currency applied at creation](workstream-4-currency-creation.md) | agent-currency-create | client create + billing config + manual invoice | ☑ done (backfill → DD-3) |
| — | [Backlog: display/engine `\|\| 'USD'` sweep](backlog-currency-fallbacks.md) | wave 2 | ~150 sites | ☐ deferred |

Legend: ☐ pending · ◐ in progress · ☑ done · ⚠ needs design decision

## Wave-1 outcomes (2026-06-18)

**Landed (uncommitted, in working tree):**
- **Tax region** — `InvoiceService.create()` no longer hardcodes `'US'`; new `resolveTaxRegion()` helper does
  client default region → tenant's single active region → `'US'` last resort. `createDefaultTaxSettings` now
  makes a single-region tenant always inherit that region.
- **Currency at creation** — new clients (UI create, CSV import, workflow `clients.create`) and manual
  invoices now adopt `default_billing_settings.default_currency_code`; `'USD'` only as final fallback. Billing
  config UI initializes from the tenant default.
- **Reports** — removed 9 hardcoded `currency: 'USD'` literals across the 4 report definitions. NOTE: that
  alone only relocated the default to the engine's `formatting.currency || 'USD'`; completed 2026-06-19 (see
  below) by making `ReportEngine.execute` resolve the tenant default currency.
- **Locale formatting** — `formatters.ts`, both `ReportEngine.ts`, `ticketEmailSubscriber.ts`,
  `EmailLogsClient.tsx` no longer hardcode `'en-US'`; they use the system/tenant/UI locale.
- Per-package `tsc --noEmit` passed for `reporting`, `billing`, `clients`, `shared`. Full `server` typecheck
  is slow; spot edits are signature-compatible — **re-run server typecheck before merge.**

**New follow-ups surfaced by the agents:**
- **F-1 (DONE 2026-06-19):** Confirmed the legacy `server/src/lib/reports/` runtime had no production
  importers (EE uses only `core/types.ts` + `builders/QueryBuilder.ts`, kept) and deleted the dead cluster;
  repointed its 2 tests to the live `@alga-psa/reporting` copy. **This exposed a latent bug:** the live
  billing-overview `active_clients_count` metric still joined the deprecated `client_contract_lines` table
  (its deleted twin had been migrated) — ported the fix. Tests + reporting typecheck green.
- **F-2 (DD-2 fast-follow):** Once quote/product create paths call `resolveClientBillingCurrency`, drop the
  Zod `.default('USD')` in the 4 schema files (held this round because no resolver is wired into those
  creates yet — dropping now would persist NULL).
- **F-3:** Ticket emails currently localize dates to the *tenant* default, not the *per-recipient* locale,
  because the subscriber bakes formatted dates into one shared context before the per-recipient send loop.
  Per-recipient localization needs a small refactor (format inside the send loop).

## By concept (cross-reference)

- **Currency at rest is correct, at creation is wrong** → WS4 (creation) + backlog (display fallbacks).
- **No org-level default tax region** → WS2 (this is a feature gap; WS2 makes invoice/new-client use the
  client's configured region instead of `'US'`, and flags the missing org-level setting for a design call).
- **Locale not threaded to formatters** → WS1.
- **Reports always say USD** → WS3 (report metric definitions hardcode `currency: 'USD'`).

## Round 2 outcomes (2026-06-19) — user-directed: "make currency work; don't prefill US tax"

- **Tax (DD-1 deferred by user):** Not introducing an org-level default tax region this round. Invoice tax
  now uses **only the client's configured region** (`getClientDefaultTaxRegionCode`). Removed the `'US'`
  literal last-resort AND the tenant-single-region inference from `resolveTaxRegion` (returns `null` → caller
  skips tax, no fabricated region). Reverted the WS2 single-region inference in
  `shared/billingClients/taxSettings.ts` back to original (same "infer a default region" flavor).
- **Currency creation (DD-2/F-2 DONE):** Dropped `.default('USD')` in `server/.../schemas/quoteSchemas.ts`,
  `server/.../schemas/productSchemas.ts`, `packages/billing/src/schemas/quoteSchemas.ts` and wired tenant/
  client currency resolution into the create paths (`QuoteService.create`, `createQuote`,
  `ProductCatalogService.create`) using a direct `default_billing_settings` read (not the withAuth resolver).
- **Service cost currency (DONE):** `Service.create` (`packages/billing/src/models/service.ts`) — the single
  chokepoint for `serviceActions.createService` and the billingHelpers path — now resolves the tenant default
  for `cost_currency` from the raw input before insert (`provided → tenant default → 'USD'`). The schema's
  `.default('USD')` is kept **for the read path only** (documented inline).
- **Reports actually fixed (DONE):** `ReportEngine.execute` now resolves the tenant default currency once
  (`default_billing_settings.default_currency_code`, defensive try/catch → never fails a report) and threads
  it through `formatMetricValue` → `formatCurrency` as `formatting.currency || defaultCurrency || 'USD'`.
  This closes the gap where removing the definition literals had just shifted the default to the engine's
  `|| 'USD'`. Added a unit test (`ReportEngine.format.test.ts`) asserting a no-currency metric renders in the
  tenant default; all 4 tests + reporting `tsc` green.
- **Currency existing data (DD-3 — DROPPED, won't do):** Decided against a backfill migration. A draft was
  written then removed. Rationale: creation already resolves the tenant default, so new clients inherit it;
  the only residual is tenants that adopt a non-USD default *after* already having clients — a small,
  self-correctable set. An irreversible heuristic flip (can't tell deliberate-USD from defaulted-USD) isn't
  worth the risk. Existing clients that need a non-USD currency are set per-client in their Billing
  Configuration. If a tenant ever needs to convert many existing clients at once, add a non-destructive
  "apply tenant default to all clients" admin action instead of a migration.

## Still open

- **DD-4:** Pre-login pages can't know the user's tenant default language until the tenant is resolved by
  domain. WS1 applies `getTenantLocaleByDomain()` where a domain exists; document where it can't.
- **F-3:** Ticket emails localize dates to the tenant default, not per-recipient (needs send-loop refactor).
- **Wave-2 backlog:** the ~150 display/engine `|| 'USD'` fallbacks (mostly inert once data is populated).

## Files intentionally NOT touched

- `server/src/lib/utils/clientFormValidation.ts` and `packages/validation/src/lib/clientFormValidation.ts`
  — already modified in the working tree by the user. Leave alone.
