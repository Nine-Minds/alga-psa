# Prorated recurring service periods: link by identity, fail loudly

**Branch:** `fix/prorated-recurring-service-periods`
**Ticket:** alga0002069 — Billing: prorated recurring service periods never re-link to invoices — duplicate ~$9.05 invoices and undeletable invoices (Maloughney Cloud Solutions)

## Problem

When a subscription starts mid-period, the billing engine prorates the charge using the
covered/activity window, and the charge carries the *covered* start date rather than the
period's full `service_period_start`. After invoice generation,
`linkRecurringServicePeriodToInvoiceDetail` (`packages/billing/src/services/invoiceService.ts:65-189`)
matches `recurring_service_periods` rows by **strict equality** on `service_period_start`
(`:171`). For prorated charges the UPDATE matches 0 rows, and both call sites (`:956`, `:1101`)
ignore the returned count. One bug, three symptoms:

1. **Undeletable invoices** — the invoice has `invoice_charge_details` rows but no linked
   `recurring_service_periods` row; that exact state trips the delete guard
   (`packages/billing/src/actions/invoiceModification.ts:1084-1091`).
2. **Duplicate invoices** — the period row keeps `invoice_id = NULL` and stays in due-selection
   states, and the duplicate guard (`invoiceGeneration.ts:284-331`) only checks
   `whereNotNull('invoice_id')`. Every billing run mints another near-identical invoice.
3. **Digest-masked errors** — the guard messages are thrown as plain `Error`, which Next.js
   masks in production, so the customer saw the generic digest banner instead of
   "Cancel the invoice instead of deleting it."

## Settled design decisions

- **Link by identity**: thread the `recurring_service_periods.record_id` from the engine
  through the charge to persistence; the link UPDATE targets the row by primary key.
- **Hard fail**: a recurring charge that persists a detail row but cannot link its period
  throws inside the generation transaction — the invoice is never created. Invariant:
  *a recurring invoice exists only if its periods are linked*.
- **Duplicate guard defense in depth**: in addition to the RSP `invoice_id` probe, detect an
  existing live invoice for the same obligation + invoice window via its charge details, so
  already-damaged tenants stop minting duplicates before any data repair.
- **Typed results, no magic**: `hardDeleteInvoice` and its wrappers return an explicit
  discriminated union for expected guard outcomes instead of throwing; callers render the
  message. No sentinel-envelope framework layer.
- **Out of scope**: production data repair for the affected tenants (separate effort);
  the `withAuth`-level error envelope pattern (explicitly rejected).

## Implementation steps

### Step 1 — Thread `servicePeriodRecordId` from engine to charges

Types:

- `packages/types/src/interfaces/billing.interfaces.ts` — add
  `servicePeriodRecordId?: string | null` to the `IBillingCharge` base (fields live at
  `:84-86` next to `servicePeriodStart`/`servicePeriodEnd`/`billingTiming`). All recurring
  families (`IFixedPriceCharge`, `IProductCharge`, `ILicenseCharge`) inherit it.
- `server/src/interfaces/billing.interfaces.ts` is a divergent legacy duplicate the engine
  does not import; mirror the field only if typecheck requires it.
- `packages/billing/src/lib/billing/billingEngine.ts` —
  `ResolvedRecurringChargeTiming` (`:81-88`) gains `servicePeriodRecordId: string | null`;
  `PersistedRecurringTimingSelectionRecord` (`:105-108`) gains the record id (extend the
  `Pick` of `IRecurringServicePeriodRecord` or add the field explicitly, matching that
  interface's id field name).

Persisted-selection path (the production invoice-generation path):

- Due-rows query (`billingEngine.ts:443-466`): add `record_id` to the `select`.
- `loadPersistedRecurringTimingSelections` mapping (`:478-502`): carry the id into the
  record objects.
- `buildRecurringTimingSelectionsFromPersistedRecords` (`:2625-2678`): set
  `servicePeriodRecordId` on the built selection. The existing multi-row rollout guard
  (`:2632-2636`, throws on two rows for one lineId) already enforces uniqueness — keep it.

Computed/derived path (previews and legacy flows):

- Add a resolver helper on the engine, e.g.
  `resolvePersistedRecordIdForTiming({ obligation, invoiceWindowStart, invoiceWindowEnd })`:
  query `recurring_service_periods` for the obligation candidates + exact invoice window +
  due lifecycle states + `invoice_charge_detail_id IS NULL`. Exactly one row → return its
  `record_id`; zero rows → return `null` (previews run before materialization and never
  persist, so null is safe); multiple rows → throw, mirroring the rollout-guard error.
- Wire it wherever derived selections are produced: the derived-selections build in
  `calculateBillingForPreparedPeriod`'s dispatch (`:735-755` / `buildRecurringTimingSelections`
  `:2597-2623`) and the per-family fallbacks `resolveRecurringChargeTiming` (`:2546-2569`) /
  `resolveServiceDrivenChargeTiming` (`:2571-2595`) when they compute a fresh selection.
  These fallbacks are currently sync; making the resolution a single async post-pass over
  the selections map is acceptable if plumbing async through the fallbacks ripples too far —
  the requirement is only that any charge produced from a derived selection during a real
  generation run carries the record id before persistence.

Attach to charges:

- Fixed: the uniform timing spread at `:2492-2497` (`chargesWithMeta`) adds
  `servicePeriodRecordId` from the resolved timing.
- Product/license: `calculateRecurringQuantityCharges` attaches timing at `:3927-3956`;
  add the field there.

### Step 2 — Link by `record_id`, hard fail on failure

`packages/billing/src/services/invoiceService.ts`:

- `linkRecurringServicePeriodToInvoiceDetail` (`:65-189`) — params gain
  `servicePeriodRecordId?: string | null`. Replace the date-reconstruction matcher
  (obligation candidates + `service_period_start` equality + window equality, `:150-180`)
  with an UPDATE keyed on `record_id`, retaining as sanity predicates: tenant scoping via
  `tenantScopedTable`, `lifecycle_state IN ('generated','edited','locked')`, and
  `whereNull('invoice_charge_detail_id')`. Delete the now-dead helpers this orphans
  (e.g. the obligation-candidate matching and the `service_period_end` inclusive/exclusive
  dance) if nothing else uses them.
- Failure semantics (both call sites, fixed at `:956-970` and product/license at
  `:1101-1115`): when the charge is a recurring family and has service-period data,
  a missing `servicePeriodRecordId` **or** an UPDATE affecting 0 rows throws an `Error`
  naming the invoice, charge, and record id. This runs inside the generation transaction,
  so the invoice rolls back. Keep the existing silent skip only for the legitimately
  non-recurring cases (no config/contract-line, no period dates, no billing timing —
  the current `:96-98` early return).
- `invoice_charge_details.service_period_start/end` keep storing the covered/prorated
  dates — they describe what was billed. The durable linkage direction remains
  `recurring_service_periods.invoice_charge_detail_id`. **No schema migration.**

### Step 3 — Duplicate guard: second probe

`packages/billing/src/actions/invoiceGeneration.ts`,
`findExistingRecurringInvoiceForSelectionInput` (`:284-331`):

- Keep both existing RSP `invoice_id` probes unchanged.
- Add a fallback probe when the RSP probe finds nothing: does a **live** invoice
  (`invoices.status <> 'cancelled'`) already exist for this selection's invoice window
  with recurring charge details for the same obligation?
  - `contract_cadence_window` kind: `invoices` where `billing_period_start/end` match the
    window, joined `invoice_charges` → `invoice_charge_details` →
    `contract_line_service_configuration` on `config_id`, filtered to
    `contract_line_id = executionWindow.contractLineId`.
  - `client_cadence_window` kind: same window match on `invoices` for the selection's
    client, requiring at least one `invoice_charge_details` row (recurring detail),
    scoped as tightly as the selector input allows.
- Regeneration must stay legal: hard-deleted invoices leave no rows (probe finds nothing);
  cancelled invoices are excluded by the status filter. Only recurring-generated invoices
  set `invoices.billing_period_start/end`, which keeps manual invoices out of the probe;
  verify that assumption in code while implementing and tighten the predicate if not.

### Step 4 — Typed results for delete/reverse actions

- New shared type (e.g. `packages/billing/src/actions/invoiceActionResults.ts`):

  ```ts
  export type InvoiceMutationResult =
    | { ok: true }
    | { ok: false; code: 'SYNCED_TO_ACCOUNTING' | 'RECURRING_PERIODS_UNLINKED' | 'CONTRACT_HAS_INVOICES'; message: string };
  ```

  Codes cover the known guard outcomes; extend as guards are converted. Messages are
  written for end users (these are what the customer sees instead of the digest banner).
- `hardDeleteInvoice` (`invoiceModification.ts:1026`) returns `InvoiceMutationResult`.
  The accounting-sync guard (`:1046`) and the canonical-periods guard (`:1084-1091`)
  return `{ ok: false, ... }` instead of throwing. The canonical-periods guard currently
  lives inside the `withTransaction` callback — restructure so blocked outcomes
  short-circuit cleanly (check-then-return before destructive work). Permission failures
  and genuinely unexpected errors still throw.
- Propagate through the wrappers in `billingCycleActions.ts`:
  `reverseRecurringInvoice` (`:628`), `hardDeleteRecurringInvoice` (`:639`),
  `removeBillingCycle` (`:325`), `hardDeleteBillingCycle` (`:353`) — each returns the
  union (or surfaces the blocked result) instead of `Promise<void>`. Grep for all their
  callers and update each.
- UI callers render `message` when `ok === false`:
  `AutomaticInvoices.tsx` `handleReverseBillingCycle` (`:1597-1620`) and
  `handleDeleteRecurringInvoice` (`:1622-1646`) feed it into the existing `errors` state;
  `DraftsTab.tsx` delete handler (`:670`) does the equivalent in its error UI.

### Step 5 — Operation-specific error banner

- `AutomaticInvoices.tsx:2057-2060` — the banner header is hardcoded to the finalize
  wording. Track which operation produced the current `errors` state (finalize / delete /
  reverse) and pick the header accordingly.
- New i18n keys (e.g. `automaticInvoices.errors.titleFinalize`, `.titleDelete`,
  `.titleReverse`) in the `msp/invoicing` namespace across all 10 locales under
  `server/public/locales/<locale>/msp/invoicing.json` (en, de, es, fr, it, nl, pl, pt,
  and the xx/yy pseudo-locales).

### Step 6 — Tests

Unit (mocked-knex harnesses, follow the existing style in each file):

- `server/src/test/unit/billing/invoiceService.fixedPersistence.test.ts` — link UPDATE
  is keyed by `record_id`; 0-row link result throws; non-recurring charges still skip.
- `server/src/test/unit/billing/billingEngine.persistedRecurringSelections.test.ts` —
  persisted selections carry `servicePeriodRecordId`; multi-row guard unchanged.
- `server/src/test/unit/billing/invoiceGeneration.duplicate.test.ts` — fallback probe
  finds a live invoice with unlinked RSP rows (the Maloughney shape); cancelled invoices
  are ignored; nothing found after hard delete.
- `packages/billing/tests/invoiceModification.recurringDeletionGuard.test.ts` /
  `invoiceModification.manualRecurringGuard.test.ts` — guards now return
  `{ ok: false, code, message }`; unexpected errors still throw.

Integration (real DB, style of
`server/src/test/integration/billingInvoiceTiming.integration.test.ts`) — the regression
test reproducing the ticket end-to-end:

1. Contract line starting mid-period (activity window narrower than the service period),
   periods materialized.
2. Generate the invoice → the prorated charge links: RSP row `lifecycle_state = 'billed'`,
   `invoice_id`/`invoice_charge_detail_id` set; the invoice amount is the prorated value.
3. Hard delete succeeds (no false "canonical periods" block) and releases the period
   back to due state.
4. Regenerate → exactly one invoice; a second generation run returns the existing invoice
   instead of a duplicate.

### Verification

- `npm run typecheck` (or the repo's CI typecheck target) across `packages/billing`,
  `packages/types`, `server`.
- Targeted vitest runs for the files in Step 6.
- Manual smoke on the dev stack (this worktree's server runs on port 3923): create a
  contract line starting mid-cycle, generate, confirm single invoice + working delete,
  and confirm a blocked delete shows the real guard message, not the digest banner.
