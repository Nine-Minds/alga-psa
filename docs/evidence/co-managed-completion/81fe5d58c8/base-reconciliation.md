# Base reconciliation: `origin/main` 8120314513 merged into `feature/co-managed-it`

Candidate for this document: **`b96b4c2ae077e7cb63dfa51dff354401297edcd0`** — the merge commit. Every
command below was run with that commit checked out. Later commits in this round do not
re-establish these results.

## 1. Card state was stale; measured state

The commissioning snapshot said `CONFLICTING`. Measured before merging:

```
$ gh pr view 3363 --json mergeable,mergeStateStatus,headRefOid,baseRefName,state,isDraft
{"baseRefName":"main","headRefOid":"618019c3e3563f729684163c1abd8f5ad312e5dd",
 "isDraft":false,"mergeStateStatus":"BEHIND","mergeable":"MERGEABLE","state":"OPEN"}

$ git rev-list --left-right --count origin/main...HEAD
7	349
```

`MERGEABLE` / `BEHIND`, 7 behind and 349 ahead. `CONFLICTING` was stale.

## 2. What was taken

`origin/main` = `8120314513cb27ea5e61d8c80beccb709e03e437`; merge base = `2b6330e7e4`.

```
8120314513 Merge pull request #3425 from Nine-Minds/feature/make-tax-caps-configurable-in-the-tax-rates-ui
dc7d173ab6 fix(test): account for tax cap service-period fixtures
e9936a20fc fix(i18n): keep pseudo-locales current during unit tests
7243b3c33d Fix billing test project boundary cycle
86549137a2 fix(i18n): resolve tax cap heading from shared catalog
846dcfb521 Merge origin/main into feature/make-tax-caps-configurable-in-the-tax-rates-ui
91e3f6a69b feat(billing): configure currency-aware tax rate caps
```

70 files, +12747 / -4124. `git merge origin/main` reported **no conflicts**. Per this branch's
history that is not evidence of a correct merge, so three further checks were run.

## 3. Check A — `scripts/audit-merge-drops.mjs`, both directions

```
$ node scripts/audit-merge-drops.mjs --added-by origin/main --against 618019c3e3 --result HEAD
fork point 2b6330e7e4 | 4 contested files | 0 with dropped content

$ node scripts/audit-merge-drops.mjs --added-by 618019c3e3 --against origin/main --result HEAD
fork point 2b6330e7e4 | 4 contested files | 0 with dropped content
```

Necessary, not sufficient: the script only inspects files **both** sides touched, and its
`meaningful()` filter drops comments, short lines and lone punctuation. It has missed real drops
twice. Checks B and C exist because of that.

## 4. Check B — direct diff of every file main touched, against `origin/main`

All 70 files main touched between `2b6330e7e4` and `origin/main` were diffed from `HEAD` to
`origin/main`. **66 of 70 are byte-identical to `origin/main`.** The 4 that differ are exactly the
contested set, and each difference is accounted for below.

| File | Difference from `origin/main` | Justification |
| --- | --- | --- |
| `packages/billing/src/lib/billing/billingEngine.ts` | −134/+17 | Pre-existing branch change from an earlier co-managed commit. Verified independently: `git diff 618019c3e3 HEAD` on this file shows **only** main's two tax-cap hunks (`"cap_amount"` added to the rate select at line 971 and `capAmount: rate.cap_amount ?? null` at line 981) and nothing else. Main's effect is present, not just its declaration. |
| `packages/billing/src/lib/billing/compute/computeTimeBasedCharges.ts` | +19/−4 | Branch's co-managed `work_source_*` qualified-source snapshot work. Main's only hunk in this file — replacing `clientContractLine.currency_code \|\| "USD"` with `contractCurrency` at the tax-rate call — is present at line 350. |
| `packages/types/src/interfaces/billing.interfaces.ts` | +4 | Branch adds `sourceTenant` / `relationshipId` / `workReferenceId` to `InvoiceTimeEntrySnapshotData`. Main's `ITaxRate` changes (the reworded `cap_amount` doc comment and the new `currency_code?: string \| null`) are present at lines 787–790. |
| `server/src/test/unit/docs/servicePeriodFirstBillingPlan.contract.test.ts` | +27/−4 | Branch adds co-managed allow-list entries and an `ee/temporal-workflows/.../integration` scan root. Main's two new entries (`taxCapInvoiceCompute.test.ts`, `taxRateCaps.db.test.ts`) are present at lines 265–266. |

The specific `1064ee7384` failure mode — keeping a declaration while dropping its use — was checked
by hand in `billingEngine.ts`: both the `cap_amount` column selection and the `capAmount` mapping
that consumes it survived. A declaration without its use would have shown here.

## 5. Check C — run the tests main added in the commits just taken

This is how the last two silent drops were caught.

```
$ cd server && SKIP_DB_TESTS=1 npx vitest run \
    src/test/unit/billing/TaxCapFields.test.tsx \
    src/test/unit/billing/TaxRateDialog.test.tsx \
    src/test/unit/billing/taxCapForm.test.ts \
    src/test/unit/billing/taxCapInvoiceCompute.test.ts \
    src/test/unit/billing/taxRateSchemas.test.ts \
    src/test/unit/docs/servicePeriodFirstBillingPlan.contract.test.ts
  Test Files  6 passed (6)       Tests  164 passed (164)

$ cd packages/billing && npx vitest run tests/creditsNamespaceAndRoute.i18n.test.ts
  Test Files  1 passed (1)       Tests  4 passed (4)

$ node scripts/run-workspace-db-tests.mjs \
    src/test/unit/billing/taxRateCaps.db.test.ts \
    ../packages/billing/src/services/taxService.rateSelection.db.test.ts
  Workspace DB suite: 2 required files
  Test Files  2 passed (2)       Tests  69 passed (69)
```

237 tests, all passing on the merged tree. The two `*.db.test.*` files were run through the same
`scripts/run-workspace-db-tests.mjs` entry point CI uses for that lane, against a migrated
PostgreSQL at `127.0.0.1:5472`, not skipped.

`taxRateCaps.db.test.ts` includes `verifies the migrated shared tax schema and negative-cap
constraint in PostgreSQL` and the three `T018` real-generation cases; those passed, so main's
migration and its consumers both landed.

## 6. Post-merge mergeability

Re-checked after pushing the merge; see `base-reconciliation-postpush.md` in this directory for the
recorded value at the pushed head.

## 7. What this does *not* establish

- No claim about mandatory CI at the merged head. Integration shard 1 was failing at
  `618019c3e3` for the CF002–CF004 requester-deferral defect and this merge does not address it.
- Only the tests main added were run. The full suites were not rerun for this merge.
- `productionReady` and `humanReviewReady` remain **false**.
