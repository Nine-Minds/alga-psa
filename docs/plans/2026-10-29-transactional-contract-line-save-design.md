# Contract Lines: save the whole edit as one server-side transaction

Card `085ecc17` (stacked on `c319eda8`) · PSA `alga-2026-0002714` (`84feb4ad-04f1-4040-8565-1ee8703220c4`)

## Problem

`handleSaveContractLine` (`packages/billing/src/components/billing-dashboard/contracts/ContractLines.tsx:866`)
runs the save from the **browser** as a sequence of independent server actions, each opening its own
transaction:

1. `updateContractLine(...)` — line fields (`billing_timing`, `cadence_owner`, `minimum_billable_time`,
   `round_up_to_nearest`, `location_id`, `invoice_line_description`, start/end). It also rematerializes
   service periods **from what is, at that moment, only the line's own new state**.
2. `updateConfiguration(...)` once per member (quantity, rate, Hourly/Usage/Fixed config,
   `effective_period_start`).
3. `applyContractLineServiceMembershipChanges(...)` for additions/removals.
4. `upsertContractLineServiceBucketConfigurationAction` / `deleteBucketOverlay` once per service.

Consequences, all observed in production on 2026-10-27:

- **Partial commit.** A failure after step 1 leaves the earlier steps committed — Lynda's billing-timing
  change landed while her products update rolled back. The client returned early without reloading and
  her products appeared to vanish.
- **Rematerialized too early.** Service periods are rebuilt in step 1, before member/membership changes,
  contradicting the comment at the top of the save that says the intent is one rematerialization from
  the final state.
- **The browser owns storage decisions** it should not: per-member `base_rate_basis`, effective-boundary
  handling, and the shape of the write. That is precisely how the browser and the service's revision
  path disagreed in the stacked parent bug (`c319eda8`).

## Direction

Replace the browser-side sequence with one server action that takes the user's **intent for the whole
edit** and applies it atomically.

### Server: `saveContractLineEdit`

New action in `packages/billing/src/actions/` (e.g. `contractLineSaveAction.ts`), exported with
`withAuth`-style tenant scoping as the existing line actions are:

```ts
interface ContractLineEditDraft {
  line: { billing_timing?, cadence_owner?, minimum_billable_time?, round_up_to_nearest?,
          location_id?, invoice_line_description?, start_date?, end_date? };
  members: Array<{ config_id?: string; service_id: string;
                   quantity?: number; custom_rate?: number | null; /* null = use catalog price */
                   hourly_rate?: number; base_rate?: number; bucket_overlay?: BucketOverlayInput | null;
                   effective_period_start?: string }>;
  removed_config_ids: string[];
  added_service_ids: string[];
  removed_service_ids: string[];
  effective_boundary?: string | null;
  /** Optimistic concurrency token from the line as the editor loaded it. */
  expected_version: string;
}
```

One `createTenantKnex()` transaction, one ordering:

1. **Validate and resolve first, write nothing.** Load the line and its current members; check
   `expected_version`; resolve each member's effective rate through the existing shared resolver
   (`shared/billingClients/recurringMemberRate.ts` + the catalog-rate lookup) — including
   `base_rate_basis`, which becomes a *derived* value from the resolved rate rather than a browser
   input. Any invalid input (c319eda8's "fixed member base_rate_basis requires base_rate" is the
   canonical case) fails here, before a single row changes.
2. **Line fields** through the internals of `updateContractLine`, with rematerialization suppressed.
3. **Members** — update existing configs, create added ones, delete `removed_config_ids`; then apply
   membership changes.
4. **Bucket overlays** upsert/delete.
5. **Rematerialize service periods exactly once** from the final line + member state.
6. Commit. Return the fresh line projection the editor reloads from.

### Threading `trx`

Each piece that currently calls `createTenantKnex()` itself gains an optional `trx` parameter:
`ContractLineServiceConfigurationService.updateConfiguration`, the membership-change helper, the bucket
overlay compat layer, and the `updateContractLine` internals. Knex nests `transaction()` on an existing
trx as a savepoint, so the change is mechanical — but pass the trx explicitly rather than relying on
nesting, and never call `createTenantKnex()` inside a helper that received one.

The existing single-purpose actions stay as thin wrappers that open their own transaction, so
`FixedServiceConfigPanel`, the wizard and template flows are unaffected.

### Optimistic concurrency

The inline editor schedules recurring-unit revisions with `expectedVersion: null`, so today it can only
create at an empty boundary. Derive the token from the line's `updated_at` (ISO string) at load and
require it on save: a mismatch returns a typed `contract-line-conflict` error, the client keeps the
draft and offers reload. The token is a *version*, not a lock — nothing is held between load and save.

### Client

`handleSaveContractLine` becomes: build `ContractLineEditDraft` from `editLineData` + `editServiceConfigs`
+ pending add/remove sets, call once, then either reload the line or show the error with the draft
intact. The `pricingOnly` shortcut disappears into the draft (send only the fields the user edited).
**No reload on failure, no partial-failure path** — the whole edit either happened or did not.

### Citus

Every table involved is distributed by `tenant`, so a single-tenant transaction stays on one shard.
Bind timestamps as parameters; never `now()` inside `CASE`/`COALESCE` in the statements this touches.

## Deliberately not doing

- Not changing the invoice engine or the rate chain — the save composes the resolver, it does not
  re-implement it.
- Not adding a general "unit of work" abstraction: one action, one transaction, explicit trx threading.
  If a third caller needs the same composition later, extract it then.
- Not changing the shape of the read/projection the Contract Lines tab loads.
- Not fixing c319eda8's model validation here — it lands in the parent; this card removes the class of
  partial saves behind it and derives `base_rate_basis` from the resolved rate.

## Tests (DB-backed against the real schema)

- A save where a later member update fails leaves line, members, memberships and bucket overlays exactly
  as they were (assert every table before/after).
- A combined edit (timing + quantity + added member + bucket overlay) commits atomically and
  rematerializes service periods **once** (count rematerializations, not just the end state).
- A stale `expected_version` is rejected with a conflict and nothing is written.
- A pricing-only edit still succeeds and does not rematerialize.

Smoke: on a mixed contract (products + hourly + bucket), make a multi-part edit and save; then force a
failure (invalid rate) and confirm nothing changed and the editor kept the draft.
