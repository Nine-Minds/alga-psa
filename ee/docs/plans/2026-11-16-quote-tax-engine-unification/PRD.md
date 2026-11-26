# PRD — One tax engine for quotes and invoices

- Slug: `quote-tax-engine-unification`
- Date: `2026-11-16`
- Status: Draft
- Surfaced by: the design review of `ee/docs/plans/2026-11-16-quote-accept-and-pay` (ticket alga-2026-0002958)

## Summary

Quote tax is calculated by a copy of the tax engine, and the workflow worker carries a second copy. Both have
drifted from `TaxService`, which invoices use. A quote can therefore show a tax that an invoice for the same
lines would compute differently, and a quote converted to an invoice carries the quote's figure.

This plan moves the calculation into one engine that takes an explicit connection and tenant, has no side
effects, and is safe to import from the workflow worker. `TaxService`, quote recalculation and the worker's
quote recalculation all call it. The two copies are deleted.

## Problem

There are three implementations of the same calculation:

- `TaxService` (`packages/billing/src/services/taxService.ts`), used by invoices.
- `calculateTaxWithConnection` and its helpers (`packages/billing/src/services/quoteCalculationService.ts:84-270`),
  used by quote recalculation and the public quote view.
- A third copy in `shared/workflow/runtime/actions/businessOperations/crmWorkerDal.ts` (:200-376), used by
  workflow quote actions.

The copies were made in commit `e77488432b` to keep the workflow worker's import graph free of the session and
tenant-context modules that `TaxService` pulls in through `createTenantKnex`.

They differ from `TaxService` in four ways:

| Case | `TaxService` (invoices) | Quote copies |
| --- | --- | --- |
| Region has no active rate | Raises `NO_TAX_RATE` | Tax is 0, silently |
| Rate has a cap (`cap_amount`) | Each rate's contribution is capped | Caps are never read |
| Threshold brackets | Each bracket is taxed against the original base, so a non-zero first minimum or a gap stays untaxed | Brackets are taxed on a shrinking remainder, so a non-zero first minimum is taxed |
| Composite rate with a compound component | A non-compound component is always taxed on the net amount | Components after a compound one are taxed on the inflated base, compound or not |

Most quotes take the region path, where only the first two rows apply. The last two apply when a line has no tax
region and the client's default rate is used.

Two further differences are not about amounts:

- `TaxService` inserts a default `client_tax_settings` row when it finds none while calculating. A calculation
  should not write.
- The copies read `client_tax_settings` by client alone. Settings are stored per billing profile.

Consequences today:

- A staff quote for a capped, bracketed or compound-taxed client shows the wrong tax, and Convert to Invoice
  copies it onto the invoice.
- A quote for a taxable line in a region with no rate shows 0 tax with no warning, and converts to an invoice
  that the invoice engine itself would have refused.
- Every tax rule change has to be made three times. The discount-before-tax change already was
  (`LEVERAGE: pattern quote-recalc-dup`).

## Goals

1. One implementation of tax calculation, used by invoices, quotes and the workflow worker.
2. For the same client, amount, date, region and currency, a quote and an invoice get the same tax.
3. The engine takes its connection and tenant as arguments, writes nothing, and can be imported by the workflow
   worker.
4. A taxable quote line whose region has no rate is visible to staff as unresolved, not shown as 0.
5. Invoice tax results do not change.

## Non-goals

- Changing any tax rule. `TaxService` is the reference; where the copies differ, the copies are wrong.
- External tax sources. Lines under an external tax source keep carrying no internal tax.
- The other duplicated quote logic in `crmWorkerDal.ts` (quote expiry, the quote item DAL, quote-to-contract
  conversion). Each has its own `LEVERAGE` marker.
- Quote accept-and-pay. That plan does not depend on this one, but its feature flag should not be enabled for
  tenants that use caps, brackets or compound rates until this has shipped.

## Users and Primary Flows

- **MSP sales or account manager** builds a quote. The tax on each line and the quote total match what an
  invoice would charge. A taxable line in a region with no rate is marked "No tax rate for <region>" and its
  tax is shown as 0.
- **MSP billing admin** converts an accepted quote to an invoice. A quote with an unresolved line is refused
  with the same message invoice generation gives for a missing rate.
- **Client** opens a sent quote. If the corrected tax differs from what the link last showed, submitting returns
  the existing "this quote has changed" result and the client reviews the new total.
- **Workflow author** uses the quote actions in a workflow. Totals match the same quote edited in the app.

## UX / UI Notes

Use existing components first (`docs/AI_coding_standards.md`).

- **Quote line editor** (`QuoteLineItemsEditor.tsx`): a line with unresolved tax shows a warning badge with the
  text "No tax rate for <region name>". Display the region's name, never its id.
- **Quote totals:** when any included line is unresolved, a note under the tax total says tax could not be
  calculated for some lines.
- No change to the public quote page or the quote PDF.

## Requirements

### Functional Requirements

**R1 — The engine**

- A module under `shared/billingClients/` holds the calculation. It must not import `@alga-psa/db` session
  helpers, `createTenantKnex`, or anything in `packages/billing`.
- Every entry point takes `knexOrTrx` and `tenant` explicitly.
- It covers what `TaxService.calculateTax` covers: tax exemption, reverse charge, the region path with per-rate
  caps, the client default rate, composite rates, threshold brackets, tax holidays, date and currency filters.
- Rate arithmetic is the `TaxService` arithmetic, moved, not rewritten (`regionalTaxAmount`, `applyCap`, bracket
  and component functions).
- It returns a result that distinguishes a calculated amount from an unresolved one:
  - resolved: tax amount, rate, and the applied components or brackets
  - unresolved: the reason (`no_rate`), the region and the date
- It writes nothing. A client with no `client_tax_settings` row is read as having default settings.
- Client tax settings are resolved per billing profile, defaulting to the client's default profile, as
  `ClientTaxSettings.get` does.

**R2 — `TaxService` on the engine**

- `TaxService.calculateTax` and `calculateTaxForPeriod` resolve the session connection and tenant once and call
  the engine.
- An unresolved result is raised as `NO_TAX_RATE` with the same message and details as today.
- Callers of `TaxService` are unchanged, and their results are unchanged.
- `createDefaultTaxSettings` and `ensureDefaultTaxSettings` stay as explicit provisioning calls. The calculation
  path no longer calls them.

**R3 — Quotes on the engine**

- `quoteCalculationService` resolves row tax through the engine. `calculateTaxWithConnection`,
  `calculateThresholdBasedTax`, `calculateComponentTax` and the holiday helper in that file are deleted.
- `crmWorkerDal.ts` quote recalculation calls the engine. Its tax copy is deleted and the
  `quote-recalc-dup` marker is updated to say what, if anything, is still duplicated.
- The workflow worker's import validation (`services/workflow-worker/scripts/validate-runtime-imports.mjs`)
  passes with the engine imported.

**R4 — Unresolved tax on quotes**

- New column `quote_items.tax_unresolved boolean not null default false`.
- Recalculation sets it for a taxable row whose tax the engine could not resolve, stores the row's tax as 0, and
  clears it otherwise.
- The quote still saves and can still be sent.
- Converting a quote to an invoice (action, REST and workflow paths) refuses while an included one-time row is
  unresolved, with the `NO_TAX_RATE` message for that region.

### Non-functional Requirements

- **No change to invoice tax.** Proven by running the existing `TaxService` and invoice tax tests unchanged.
- **Citus:** the migration is one additive column with a constant default.

## Data / API / Integrations

- Migration: `quote_items.tax_unresolved`.
- Quote item reads (actions and REST) include `tax_unresolved`.
- No API inputs change.

## Rollout / Migration

Not flagged. The change is a correction, and a flag would keep the wrong figures selectable.

What tenants will see:

- **No change** for quotes taxed by simple regional rates without caps, which is the common case.
- **Draft quotes** for clients with caps, threshold brackets or compound components get corrected tax on their
  next recalculation.
- **Sent quotes** affected by a correction return "this quote has changed" once when the client submits, because
  the public view's fingerprint covers per-row tax.
- **Quotes with a rate-less region** start showing the unresolved warning, and their conversion to an invoice is
  refused until a rate exists or the line is marked non-taxable.

The PR description lists these four effects. Before release, count how many tenants have rates with a cap,
threshold brackets or composite rates, to size the second and third effects.

## Open Questions

1. **Refusing invoice conversion for an unresolved line** is a behaviour change for staff. It matches what
   invoice generation already does for the same data. Current answer: refuse.
2. **Recalculating existing drafts.** Corrections appear when a draft is next recalculated. Should a one-time job
   recalculate open drafts so totals do not change under an editor's hands? Current answer: no; the next save
   recalculates, and the PR notes it.

## Acceptance Criteria (Definition of Done)

- `quoteCalculationService.ts` and `crmWorkerDal.ts` contain no tax arithmetic.
- For a capped rate, bracketed rates with a non-zero first minimum, and a composite rate mixing compound and
  non-compound components, a quote line and an invoice line with the same inputs carry the same tax.
- Calculating tax for a client with no settings row inserts nothing.
- A taxable quote line in a region with no rate is flagged in the editor, and the quote cannot be converted to
  an invoice until it is resolved.
- The existing `TaxService` and invoice tax tests pass unchanged.
- The workflow worker's import validation passes.
