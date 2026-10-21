# Xero mappings: let an item and a revenue account share a code, and let many services share one revenue account

Card 78811c02 · ticket alga-2026-0002691 · stacks on PR #3634 (merged to main 2026-10-08)

## Problem

`idx_unique_external_mapping` currently covers
`(tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, ''))`
(set by `server/migrations/20260611130000_add_entity_type_to_external_mapping_unique_index.cjs:17-20`).

Xero records the target kind in `metadata.xeroTargetKind` (`'item' | 'account'`,
with absent meaning legacy item mode — `packages/integrations/src/lib/xero/xeroServiceMappingTarget.ts`,
`readXeroServiceTargetKind`). The index doesn't look at metadata, so for one Xero organisation:

1. **Two services can't share a revenue account.** Service A → `account:200` and
   service B → `account:200` collide. Orgs that invoice by account code with no
   Products & Services catalog need many services on "Sales (200)".
2. **An item and an account can't share a code.** Service A → `item:200` and
   service B → `account:200` collide, even though the exporter treats them as
   different targets (`ItemCode` vs `AccountCode`).

The live bulk-grid test documents this as a known limitation
(`packages/integrations/src/actions/externalMappingActions.db.test.ts:1038-1072` on `origin/main`).

## Branch state (do this first)

This branch was cut from PR #3634's head and is **520 commits behind `origin/main`**.
That PR has since merged. Before any edits, rebase (or reset) onto `origin/main`:
`git fetch origin && git rebase origin/main`. All line numbers below are from `origin/main`
as of 2026-10-13. `externalMappingActions.ts` and its db test changed on main after the PR,
so line numbers taken from the current HEAD are stale.

## Uniqueness rule (decision)

| Target | Rule |
|---|---|
| Xero **item** (`xeroTargetKind` `'item'` or absent) for `service` / `discount` | One Alga entity per item code, per realm. Unchanged. |
| Xero **revenue account** (`xeroTargetKind = 'account'`) | **No target-side uniqueness.** Any number of services (or the discount mapping) may name the same account code. |
| Xero `tax_code`, QBO, `xero_csv`, `quickbooks_csv`, Hudu, NinjaOne, Level.io, Huntress, etc. | Unchanged: one Alga entity per external id per entity type per realm. |

The per-Alga-entity rule (`idx_unique_alga_mapping`: one mapping per Alga entity
per realm) does not change, so a service still has exactly one target.

**Why a partial index rather than adding the kind as a key column.** Adding
`COALESCE(metadata->>'xeroTargetKind','item')` to the key would fix problem 2
(item:200 vs account:200) but not problem 1. Two services on account:200 would still
collide. An account is a ledger bucket, not an identity, so account-kind rows should
be outside target-side uniqueness altogether. Leaving them out of the index separates
the kinds and allows sharing in one step. Item rows keep one-to-one, which is the brief's
"items are likely one-to-one" and matches how the Xero item picker and suggester behave today.

**New index definition:**

```sql
CREATE UNIQUE INDEX idx_unique_external_mapping
ON tenant_external_entity_mappings
  (tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, ''))
WHERE integration_type <> 'xero'
   OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account';
```

The predicate has to evaluate to TRUE, not NULL, for every non-account row. A NULL
predicate would silently drop that row from the partial index. `integration_type`
is `NOT NULL`, and the `COALESCE` maps missing metadata or a missing key to `'item'`,
which matches `readXeroServiceTargetKind`. Do **not** write it as
`NOT (integration_type = 'xero' AND metadata->>'xeroTargetKind' = 'account')`:
when metadata is NULL, that expression is NULL and the row escapes the index.

The index keeps its name, so existing error mapping and log greps still work.

## Changes, in order

### 1. Migration — `server/migrations/20261013120000_allow_shared_xero_account_mapping_targets.cjs` (new)

Create it with `cd server && npx knex migrate:make allow_shared_xero_account_mapping_targets --knexfile knexfile.cjs --env migration`
and rename it so the timestamp sorts after the newest migration on main (currently `20261010120000_*`).
The table is CE (`server/migrations`), not EE.

- `up`: in **one transaction** (`exports.config = { transaction: true }`), run
  `DROP INDEX IF EXISTS idx_unique_external_mapping;` and then the `CREATE UNIQUE INDEX ... WHERE ...` above.
  The precedent at `20260611130000` uses `transaction: false`, which leaves a window with no
  target uniqueness at all. A single transaction avoids that. Citus runs it with 2PC and the
  table is small.
- **No dedupe is needed on `up`.** The new index is strictly looser than the old one, so every
  existing row set already satisfies it. That includes the invisible pre-distribution local heap
  on Citus (citus-migration-gotchas, Gotcha 1): those rows were valid under an even stricter
  index. The key still starts with `tenant`, the distribution column (Gotcha 3).
- `down`: put back the 20260611 full (non-partial) index. Before dropping, count duplicate
  `(tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id,''))`
  groups. If there are any, **throw** an error that names the count and tells the operator to
  remap the shared-account services first. Never delete user mappings automatically. Before
  `CREATE`, run the `truncate_local_data_after_distributing_table` guard from the
  citus-migration-gotchas skill, behind a `pg_dist_partition` check so CE still works. That
  keeps a stale local heap from failing the tighter rebuild.
- The migration must not touch rows. No backfill: the kind already lives in `metadata`.

### 2. Map unique violations by base constraint name — `packages/integrations/src/actions/externalMappingActions.ts`

- **Bug found while reading (fix it here):** `createMappingRow` checks
  `error?.constraint === 'idx_unique_external_mapping'` (`:1109`). On Citus, errors raised at
  shard level carry the shard suffix (`idx_unique_external_mapping_102345`), so in production
  this branch never runs. Every target collision falls through to the misleading "A mapping
  already exists for this entity" message. Add a small local helper:
  `uniqueViolationIndex(error): string | null` returns `error.constraint` with a trailing
  `_\d+` removed when `error.code === '23505'`, and `null` otherwise. Use it in both catch blocks.
  Add `// LEVERAGE: pattern citus-constraint-name — ...` at the helper. The same exact-name match
  shows up in `packages/billing/src/actions/invoiceModification.ts:741,860,1819`,
  `invoiceGeneration.ts:3988`, `manualInvoiceActions.ts:129`, `createBillingCycles.ts:167`,
  `packages/projects/src/models/taskDependency.ts:79` and the two
  `tenant_extension_schedule_install_name_uniq` sites. Only mark this site. Fixing the others is out of scope.
- `createMappingRow` catch (`:1106-1121`): when the index is `idx_unique_external_mapping`, return
  a message that fits the new rule:
  - Xero `service` / `discount` (the only Xero rows that can still hit it are item-kind):
    *"This Xero item is already mapped to another service. An item can be mapped to only one
    service; to bill several services to the same code, map them to a revenue account instead."*
    with key `msp/integrations:errors.mappings.duplicateXeroItem`.
  - All other integrations: keep the generic
    *"This target is already mapped to another entity in this organisation. Choose a different target."*
    with key `msp/integrations:errors.mappings.duplicateTarget`.
  - Replace the comment at `:1107-1108` with one that describes the partial rule
    (item-kind is one-to-one, account-kind is shared).
- `updateExternalEntityMapping` catch (`:1445-1450`): this path returns "A mapping already exists
  for this entity" for **every** 23505. Retargeting service B onto an item that service A already
  holds produces that wrong message, and so does switching a shared account mapping to item mode.
  Use the same helper and branch as in create, through one shared
  `mapUniqueViolation(error, row)` function so create and update can't drift apart.
- Tombstone relink inside `createMappingRow` (`:986-1002`) is an UPDATE that can now hit the
  item-target index if another service took the item while the row was unlinked. It already
  routes through the create catch, so the new mapping covers it. Add a test (§4).
- `createExternalEntityMappings` (`:1165-1246`) needs no logic change. Row errors still come from
  `createMappingRow` and are passed through as `result.actionError`.

### 3. Locales — `server/public/locales/*/msp/integrations.json` (`errors.mappings`)

`errors.mappings.duplicateTarget` is used today but **missing from every locale file** (main has
only `duplicate`, at `en/msp/integrations.json:3982`). Add `duplicateTarget` and
`duplicateXeroItem` to en, fr, es, de, nl, it, pl, pt and sv, plus the `xx`/`yy` pseudo-locales
using their usual fill pattern. Then run `node scripts/validate-translations.cjs`.

### 4. Tests

**DB tests** — `packages/integrations/src/actions/externalMappingActions.db.test.ts`

- Replace the "KNOWN LIMITATION" block and its test (`:1038-1072`) with
  `'lets item and account targets share a code, and many services share one account'`.
  Bulk-create s1→item:201, s2→item:201, s3→account:200, s4→account:200, s5→item:200.
  Expect `[true, false, true, true, true]`, and expect `results[1].error` to match the new item
  message. This one test covers both brief scenarios plus item duplicates still being rejected.
- Add focused single-create tests in the `Xero account-mode service mappings` describe (`:716`):
  1. **Two services → one account:** both succeed. Assert two rows with `xeroTargetKind: 'account'` and the same `external_entity_id`.
  2. **item:200 + account:200:** both succeed in the same realm.
  3. **Item duplicate still rejected:** second service → the same item returns `duplicateXeroItem`, and no row is inserted.
  4. **Legacy kind-less row still enforced:** seed a row directly with `metadata: null` on item 200, then create a second service → item 200. It must be rejected. This guards against the NULL-predicate trap.
  5. **Update into a held item:** `updateExternalEntityMapping` retargeting service B onto service A's item returns `duplicateXeroItem`, not `duplicate`.
  6. **Account → item switch blocked when the item is held:** service B is account:200 and service A is item:200. Switching B to item mode with the same code is rejected with the item message.
  7. **Relink collides:** unlink A (item:200), map B to item:200, then re-create A → item:200. Expect the item message.
- Keep `'maps each unique-index violation to its own message'` (`:1074`) green. It uses QBO and proves QBO keeps one-to-one with the generic message.
- Add a QBO assertion: two QBO services → one QBO item is still rejected. This guards against the predicate leaking outside Xero.
- Unit test for `uniqueViolationIndex`: `idx_unique_external_mapping_102345` → `idx_unique_external_mapping`; `idx_unique_alga_mapping` unchanged; non-23505 → `null`.

**Migration test** — `server/migrations/__tests__/sharedXeroAccountTargetsMigration.integration.test.ts` (new), following `tightenAccountingMappingRealmMigration.integration.test.ts`

- After `up`: two Xero account rows with the same code insert fine. A Xero item duplicate, a kind-less Xero duplicate, and a QBO duplicate each throw 23505.
- `down` with a shared account present throws the explanatory error and leaves the partial index in place.
- `down` on clean data restores the full index.

**Existing tests to re-run:** `externalMappingActions.bulk.test.ts`,
`AccountingMappingModuleView.bulk.test.tsx`, `xeroLiveMappingModules.test.ts`,
`packages/billing/src/services/accountingSync/xeroHistoricalMapping.db.test.ts`,
`server/src/test/unit/accounting/xeroAdapter.spec.ts`,
`server/src/test/integration/accounting/xeroInboundReconciliation.integration.test.ts`.

### 5. Docs — `docs/accounting-integration-overview.md`

- `:37` ("Unique constraints prevent duplicate mappings…"): state the rule. One mapping per Alga
  entity per realm. External targets are one-to-one, except Xero revenue-account targets, which
  many services may share.
- `:76` (Xero paragraph): add one sentence saying several services may map to the same revenue
  account, and that an Item and an Account may share a code.

## QuickBooks and other tenants of this table (checked)

- **QBO:** no change. QBO services always target Items. `qboItemImportService.ts:263` resolves
  `ledger.findByExternalId('service', qboItemId, realm)` with `.first()`
  (`syncMappingLedger.ts:91-109`), so it **depends on** item uniqueness. Many-to-one QBO items
  would make that lookup non-deterministic. The predicate only matches `integration_type = 'xero'`.
- **ON CONFLICT users:** `quickBooksOnlineAdapter.ts:1168` and `invoiceMappingRepository.ts:173`
  infer `idx_unique_alga_mapping`, not this index, so they are unaffected.
- **Hudu / NinjaOne / Level.io / Huntress:** their comments (`hudu/assetMapping.ts:9`,
  `hudu/companyMapping.ts:12`) rely on target uniqueness per entity type. That is unchanged
  because the predicate is Xero-only.
- **Xero reverse lookups:** no Xero path resolves a `service` mapping by external id. Export
  resolves by Alga service id, so many services per account is safe for export. Inbound
  reconciliation resolves invoices and contacts, not services.
- **`xero_csv`:** it has no target-kind concept and is not `'xero'`, so it is unchanged.

## Out of scope (follow-ups)

- **Tombstones still hold item targets.** The index has no `deleted_at IS NULL` filter. After
  unlinking service A from item X, mapping service B to X still fails until A's tombstone is
  gone. Narrowing this changes tombstone semantics for every integration (invoice relink,
  Hudu, etc.), so it needs its own card. It doesn't block the account scenarios: account rows
  are now outside the index whether tombstoned or not.
- **Suggester treats shared accounts as ambiguous.** `suggestMappingTargets.ts:128-140` drops an
  exact suggestion when two services match the same target. That is still correct for items. For
  accounts it is merely cautious (no suggestion, never a bad save). A follow-up could pass
  "shareable kinds" through `SuggestOptions`.
- **Other exact constraint-name matches** listed in §2 (billing, projects, extensions) have the
  same Citus dead-branch bug. They are marked, not fixed.
- **Xero realm-alias groups:** the index is per raw `external_realm_id`. Two alias ids for one
  organisation could each hold the same item. This already exists today and is not affected by
  this change.
- **Many services per Xero Item** (or per QBO item): this is a product decision, and the brief
  keeps items one-to-one.

## Risks

| Risk | Mitigation |
|---|---|
| A NULL-valued predicate silently drops legacy kind-less rows from the index | Write the predicate with `COALESCE`, and add test §4.4 for a seeded `metadata: null` row |
| Rows switching kind (account→item) bypass a check | Postgres re-checks the partial index on UPDATE when a row moves into the predicate. Covered by test §4.6 |
| `down` can't re-tighten once accounts are shared | It refuses with a clear message and does not delete data. Remapping is an explicit operator step |
| Stale Citus local heap fails the `down` rebuild | `truncate_local_data_after_distributing_table` guard in `down`. `up` is looser, so it's safe |
| No index during migration | Single transaction (`transaction: true`), unlike the 20260611 precedent |
| Messages untranslated | Add keys to all locales and run the validator |
