# Plan — Products contract line save fails on base_rate_basis check

Card: c319eda8 · ticket alga-2026-0002714 · branch feature/products-contract-line-save-fails-on-base-rate-b


Card: c319eda8 · CloudVBS (Lynda Gaiao) · target ticket alga-2026-0002714 (existing; do not create a new one)
Worktree read: `/home/robert/alga-copies/feature-products-contract-line-save-fails-on-base-rate-b` @ d62e7d901a (main + #3849 merge)

## Asked
A Products contract line cannot be saved: the member update violates the pair CHECK
`(base_rate IS NULL) = (base_rate_basis IS NULL)` from migration `20261012000001`. Produce the
implementation design for the fix, not the fix itself.

## What the code actually does (verified by reading, not by the ticket text)

The ticket named the update path. Reading it end to end shows **three** layers that each let the
pair split, in this order of causality:

1. **Client invents a basis for a null rate** — `packages/billing/src/components/billing-dashboard/contracts/ContractLines.tsx:946-951`
   (inline Contract Lines editor):
   ```ts
   if (editData.base_rate !== undefined) {
     typeConfig.base_rate = editData.base_rate;                       // may be null
     typeConfig.base_rate_basis = serviceConfig.typeConfig?.base_rate_basis ?? 'per_unit';
   }
   ```
   A product member is stored `base_rate NULL, base_rate_basis NULL` (post-#3836 inherited shape), so
   `?? 'per_unit'` stamps a basis onto an explicit `null` rate. `editData.base_rate !== undefined` is
   true for `null`.

2. **Service strips the rate but not its basis** — `packages/billing/src/services/contractLineServiceConfigurationService.ts:399-401`:
   ```ts
   const { base_rate, effective_period_start, ...restFixed } = incoming ?? {};
   typeConfig = restFixed;      // base_rate_basis survives here
   ```
   On the recurring-unit (`pricing_basis = 'unit'`) revision path the dated revision owns the price,
   so `base_rate` is removed — but `base_rate_basis` is left in the patch. This is the split pair that
   reaches the model.

3. **The model will happily persist a basis alone** — `packages/billing/src/models/contractLineServiceFixedConfig.ts:144-152`:
   the `base_rate`-present branch routes through `resolveFixedMemberRateWrite` (which already refuses
   to state a basis without a rate), but the `else if (data.base_rate_basis !== undefined)` branch
   writes `base_rate_basis` by itself. That is the exact SQL in the incident (update of config 528f0a17
   setting `base_rate_basis='per_unit'` against a NULL `base_rate`), and it is the hole that makes the
   other two layers dangerous rather than merely sloppy.

Everything else in the incident report checks out: the timing change commits first (save is not
transactional) and the client returns early on error without reloading members — that is why the
products appeared to vanish. No data was lost.

## The fix, in order

**Layer 3 first — make the split pair unrepresentable (the durable fix).**
`ContractLineServiceFixedConfig.update`: a patch that states `base_rate_basis` without `base_rate` is
resolved against the *stored* rate rather than written raw:
- read `base_rate`, `pricing_basis`, `base_rate_basis` for the config;
- feed them through `resolveFixedMemberRateWrite({ base_rate: stored.base_rate, base_rate_basis: patch.base_rate_basis, pricing_basis, storedBasis })`;
- a stored non-null rate ⇒ legitimate basis change (`per_unit` ↔ `share`), pair written together;
- a stored NULL rate ⇒ **throw a named error** (`A fixed member base_rate_basis requires base_rate`),
  matching the resolver's existing philosophy of naming the writer's mistake instead of letting the
  DB CHECK reject it anonymously.
Result: no caller, present or future, can persist a basis without a rate.

**Layer 2 — the revision path drops the pair.**
`:399` becomes `const { base_rate, base_rate_basis, effective_period_start, ...restFixed } = incoming ?? {};`
(The revision's price policy is computed just above and passed to `scheduleRecurringUnitRevisionInTransaction`;
the basis in the inline patch is already stale by construction.)

**Layer 1 — the client stops inventing a basis.**
`ContractLines.tsx:946-951`: send `base_rate_basis` only when the rate is a number. `base_rate: null`
means "use catalog price / inherited", which has no basis by definition.

**Then a sweep** of the other `base_rate_basis` writers, checking each for the null-rate case:
`contractLinePresetActions.ts:707` and `:1031` (already guarded), `contractWizardActions.ts:221`
(always carries `service.unit_rate`; still add the null guard), `rateReviewActions.ts:451` (writes
NULL/NULL — correct). No other basis-only writer exists in the tree.

## Tests (DB-backed, against the real constraint — no mocks)

1. **Model invariant:** `update(configId, { base_rate_basis: 'per_unit' })` on a NULL-rate member throws
   the named error and leaves the row unchanged. Same call on a rate-carrying member succeeds and
   changes the pair together.
2. **Service, timing-only save:** Products line (NULL rate, NULL basis, `pricing_basis 'unit'`), change
   billing timing only → commits, members still `inherited`/catalog, `billing_timing = 'advance'`.
3. **Service, quantity change:** a revision is scheduled at the boundary, members are not pinned to
   today's catalog rate, and the pair stays NULL/NULL on the current row.
4. **Client mapping:** a null rate produces a payload with no `base_rate_basis`.
5. **Regression of the incident shape:** replaying the old split patch is rejected with the named error
   rather than SQLSTATE 23514.

## Not doing (deliberately)

- **Making the save transactional** — that is the stacked follow-up card 085ecc17 ("Make Contract Lines
  save transactional"). This card stays on the constraint bug; touching save semantics here would
  collide with that card's design.
- **Any customer notice** — Robert sends Biz Buddy drafts as replies to Lynda; nothing is posted here.
- **#3873 billing-timing labels** — confirmed not involved.
- No new ticket: link the existing alga-2026-0002714.

## Risks
- The model now throws where it used to corrupt. Any unmigrated caller would surface a 500 instead of
  corrupting data — intended, and layer 2 + the sweep remove the two known callers.
- The revision path: dropping `base_rate_basis` from the inline patch must not change the basis of the
  *scheduled* revision — verify in test 3 (the revision carries its own price policy from
  `resolveEffectiveRecurringUnitPricingInTransaction`).
- The inline editor's early-return-on-error behaviour (screen vs DB mismatch) remains until the
  transactional card lands; the fix removes the error, it does not make the save atomic.
