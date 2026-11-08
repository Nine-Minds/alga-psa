# Many-to-one QuickBooks Online item mappings

Date: 2026-10-27. Ticket: alga-2026-0002899. Status: design proposal; product questions below remain open.

## Problem and acceptance criteria

Several Alga services/products must be able to export through one QuickBooks Online (QBO) item. This supports accounting catalogs organized into a few GL-routing items rather than one item per Alga catalog entry.

- Two distinct services in one tenant and QBO realm can save mappings to the same item through single create, bulk create, edit, and explicit relink.
- Two clients in that realm still cannot map to the same QBO customer. Invoice and payment targets remain unique. One mapping per Alga entity per realm remains mandatory, including tombstoned rows.
- An invoice containing charges from both services exports two lines with the same `ItemRef.value`. Amounts, descriptions, ordering, and per-service metadata remain independent.
- Unmapping one service leaves the other mapping live and exportable. It neither unlinks the other service nor deletes the remote item.
- The bulk grid can suggest an already-used shareable item. It continues to exclude targets held exclusively by other mappings.
- QBO item import cannot select an arbitrary service or overwrite its catalog fields because an item has multiple mappings.
- Migrated-schema DB tests prove saving, uniqueness guards, unlink isolation, rollback refusal, and invoice export behavior.

## Verified code and baseline

The branch started at `44629a24f1a172e7c2fd25824413d00908f1200e`, equal to the local `origin/main` tracking ref. The local branch named `main` is older (`dfd9dd55c6`); references below describe the checked-out `origin/main` baseline, not that stale local branch. No remote refresh was performed.

| Seam | Current behavior and evidence |
| --- | --- |
| QBO live mapping writes | `packages/integrations/src/components/qbo/qboLiveMappingModules.ts:185` creates the service module. Its create/update/remove paths delegate to shared actions; helpers at `:553`, `:582`, and `:618` pass `integration_type: quickbooks_online`, type `service`, Alga service ID, QBO item ID, and realm. Bulk results at `:602` are keyed by **Alga entity**, not external item, so shared items need no result deduplication. |
| Actual create blocker | `packages/integrations/src/actions/externalMappingActions.ts:892` defines private `sharesExternalTarget`, currently only Xero account targets and Desktop service/discount/tax-code targets. The live-target check at `:1050` therefore rejects a second QBO service mapping before INSERT or tombstone revival. The shared single/bulk create helper starts at `:915`, with its transaction at `:960`. |
| Error translation | `packages/integrations/src/lib/externalMappingUniqueViolation.ts:21` produces “This target is already mapped to another entity in this organisation. Choose a different target.” `mapUniqueViolation` at `:59` distinguishes the target index from the entity index. Create calls it at `externalMappingActions.ts:1209`; update at `:1545`. `uniqueViolationIndex` at `externalMappingUniqueViolation.ts:10` already strips Citus shard suffixes. |
| Schema blocker | `server/migrations/20261027130000_exclude_tombstones_from_external_mapping_unique_indexes.cjs:40` defines the key and three predicates. `up` at `:51` excludes Xero accounts, Desktop service/discount/tax codes, and tombstones, but leaves QBO services exclusive. The Alga-side index deliberately stays total because upserts infer it. |
| Bulk suggestions | `packages/integrations/src/components/accounting-mappings/AccountingMappingBulkGrid.tsx:135` treats every kind-less module as exclusive; QBO live modules have no `externalTarget` config. `suggestMappingTargets.ts:158` also removes all exact suggestions when several Alga rows choose one target, even if sharing is legal. Its fuzzy pool excludes all exact claims at `:173`. |
| Export prompt | `packages/billing/src/actions/quickBooksExportMappingActions.ts:64` and `:91` reject adapters outside `QUICKBOOKS_FILE_ADAPTERS`. That list at `quickBooksExportMappingRules.ts:4` contains only Desktop and CSV. Commit `5f5ddf44db` does **not** block QBO live mapping; no change to this file-export flow is needed. |
| Forward export resolution | `packages/billing/src/adapters/accounting/quickBooksOnlineAdapter.ts:486` resolves each charge by its Alga service ID, or the automatic-discount mapping for a serviceless discount. `:508` copies the resolved external ID into `ItemRef`. `packages/billing/src/services/accountingMappingResolver.ts:55` caches by tenant/adapter/realm/**service ID** and `:60` looks up that local entity. Category fallback at `:76` is also forward resolution. There is no reverse item-to-service lookup in this adapter path. |
| Unlink scope | `externalMappingActions.ts:1624` tombstones mappings by tenant, integration, **Alga entity type and ID**, then realm. It does not unlink by shared external target. |
| Reverse lookup hazard: import | `packages/billing/src/services/accountingSync/qboItemResolver.ts:207` constructs `Map<external ID, one mapping>`; last input row wins. At `:238` it resolves that item to one service and computes catalog updates. `qboItemImportService.ts:263` separately calls `ledger.findByExternalId('service', item.Id, realm)`, whose implementation at `syncMappingLedger.ts:91` returns `.first()` at `:108`. These assumptions must change before shared mappings ship. |
| Import liveness/tax | `qboItemImportService.ts:139` loads service mappings without filtering `deleted_at`. `:105` builds a reverse tax-code-to-rate map, also without a live filter, and `:129` overwrites duplicate external-code entries. This matters to the tax-code scope decision. |
| Inbound sync | `packages/integrations/src/lib/qbo/qboClientService.ts:598` requests CDC for Customer, Payment, Invoice, CreditMemo, and RefundReceipt. `packages/types/src/interfaces/accountingExportAdapter.interfaces.ts:28` has the same change-entity union; Item is absent. `accountingSyncCycleService.ts:212` dispatches customer changes and the subsequent payment/document handlers. There is no current Item CDC applier to fan out; item import is the concrete reverse consumer. |

The service module loads both services and products with `item_kind: 'any'` (`qboLiveMappingModules.ts:231`); products use the same `service` mapping type. Discounts use an Item target (`:465`), but only the fixed `automatic_discount` entity exists (`packages/types/src/constants/accountingDiscountMapping.ts:8`). The external unique key includes `alga_entity_type`, so one discount can already share an item with a service. Relaxing discount target uniqueness does not permit a second automatic-discount mapping; the Alga-side index and action validation still prevent that.

## Proposed sharing policy

Introduce a small pure policy in `packages/types/src/constants/accountingMappingTargetPolicy.ts`, exported through the existing constants barrel. Both browser and server already consume `@alga-psa/types`, so it adds no billing/integrations dependency cycle. It accepts integration, entity type, and target metadata, and answers whether the target is shareable. No server imports or UI configuration enter this function.

| Provider/target | Proposed policy |
| --- | --- |
| Xero with `metadata.xeroTargetKind === 'account'` | Shareable, preserving the existing predicate exactly, including its current entity-type scope. Missing/null target kind remains item/exclusive. |
| QuickBooks Desktop `service`, `discount`, `tax_code` | Shareable, unchanged. |
| QBO `service` | Shareable, required. |
| QBO `discount` | Recommend shareable, subject to question 1. |
| QBO `tax_code` | Recommend retaining uniqueness for this change, subject to question 2. |
| Everything else | Exclusive. QBO client, invoice, payment, payment term, and service category are not widened. |

The migration freezes the corresponding SQL literals instead of importing mutable application code. Test the runtime policy against actual DB acceptance/rejection so these two representations cannot silently drift.

## Migration and rollback

Add `server/migrations/20261028120000_allow_shared_quickbooks_online_item_targets.cjs` (recheck the newest timestamp before implementation). Keep this exact key:

```sql
tenant, integration_type, alga_entity_type, external_entity_id,
COALESCE(external_realm_id, '')
```

The precedents are `server/migrations/20261013120000_allow_shared_xero_account_mapping_targets.cjs` (duplicate-refusing rollback and guarded Citus local-data cleanup) and `server/migrations/20261017150000_allow_shared_quickbooks_desktop_account_targets.cjs` (carry earlier exclusions into the next partial predicate). Preserve those semantics, while replacing their transactional/plain index-build shape with the current concurrent-DDL requirements.

Carry the three existing predicates forward verbatim. Add the fourth, proposed below with service and discount sharing; its final entity list follows the product decisions.

```sql
WHERE (integration_type <> 'xero' OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account')
  AND (integration_type <> 'quickbooks_desktop' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))
  AND deleted_at IS NULL
  AND (integration_type <> 'quickbooks_online' OR alga_entity_type NOT IN ('service', 'discount'))
```

`up` only loosens the target invariant. It needs no data deduplication, mapping deletion, or remapping. Do not change `idx_unique_alga_mapping`, its expression key, or the invoice upserts that depend on it.

### Lint-safe index replacement

The current tombstone migration fails R1 at `:54`: `CREATE UNIQUE INDEX` lacks **both** `CONCURRENTLY` and `IF NOT EXISTS`. It already sets `exports.config = { transaction: false }` at `:92`; non-transactional configuration alone does not satisfy R1. Confirmed with `node scripts/ci/migration-lint.mjs --last 1 --json` (exit 1, one R1 violation). The checker at `scripts/lib/migration-lint.mjs:1043` requires all three conditions on an existing table.

Use standalone `knex.raw` statements with `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS` and `DROP INDEX CONCURRENTLY IF EXISTS`, and `exports.config = { transaction: false }`. Do not wrap concurrent DDL in `knex.transaction`, a `DO` block, or one multi-statement raw query. Use literal index/table names so lint can resolve them. Timestamp must be later than the newest base migration. No suppression is needed for the new migration.

Keep a valid unique index throughout replacement, since customer/invoice/payment targets must remain protected while writes continue:

1. Build a temporary guard index, `idx_unique_external_mapping_qbo_guard`, concurrently with the destination key and predicate. Validate it before proceeding.
2. Drop the canonical `idx_unique_external_mapping` concurrently.
3. Build the canonical index concurrently with the destination definition. Validate it.
4. Drop the guard concurrently. Final state has only the canonical index.

This uses the same create/drop operations on PostgreSQL and Citus and avoids depending on distributed index rename behavior. During `up`, the older stricter index remains authoritative until step 2. The guard protects all still-exclusive entity types after that. Recognize the guard name as a target index in `mapUniqueViolation`, including its Citus shard suffix, so concurrent exclusive-target errors retain the correct message.

`IF NOT EXISTS` is not evidence that an interrupted concurrent index is usable. Inspect index validity, key, and predicate before trusting either name. On retry, reuse a matching valid guard, repair an invalid index only while another valid index protects the required invariant, and fail clearly on an unexpected definition. A canonical index already at the destination definition permits cleanup of a leftover matching guard. Never remove the last valid protective index. Exercise interruptions after each DDL phase in tests.

### Citus requirements

Keep tenant in every unique key and duplicate grouping. Execute DDL through the coordinator so Citus propagates it to shards; do not create triggers or change distribution/colocation. Run concurrent builds outside transactions on both providers. Citus documents [concurrent index creation and distribution-column uniqueness](https://learn.microsoft.com/en-us/postgresql/citus/reference-ddl?view=citus-14#adding-and-removing-indices).

Retain the Xero rollback precedent's guarded handling of inaccessible coordinator-local rows: probe for `pg_catalog.pg_dist_partition`, confirm this relation is distributed, then use `truncate_local_data_after_distributing_table` before rebuilding unique indexes if stale coordinator data remains. Never truncate the distributed relation or delete live mappings to make a build pass. Citus documents the [stale local-data constraint trap](https://learn.microsoft.com/en-us/postgresql/citus/reference-ddl?view=citus-14#distributing-coordinator-data). Verify against a real Citus coordinator, not a stub `pg_dist_partition` table.

### Rollback

`down` restores exactly the three-predicate tombstone-aware index. Before any index replacement or cleanup, count duplicate groups using the unchanged key and **only the old Xero, Desktop, and live predicates**. Do not apply the new QBO exclusion to this query: shared live QBO targets are precisely what it must detect. Tombstones and already-shareable Xero/Desktop targets must not block rollback.

If duplicate groups exist, throw an actionable error reporting the count and asking for distinct QBO targets before retrying. Leave indexes and mappings intact. Never choose a winner, delete mappings, or silently remap them.

On clean data, use the same guard-first replacement with the old destination predicate. A racing new shared mapping can make the stricter guard build fail; report that failure while retaining the canonical relaxed index. Only after the stricter guard is valid may `down` drop the relaxed canonical index. This closes the race between the precheck and restored enforcement.

## Action, grid, and import changes

1. **Create/bulk/relink:** replace private `sharesExternalTarget` with the shared policy. Skip only the target-holder check for shareable mappings. Keep entity-side checks, provider existence validation, connected-realm validation, permissions, transaction boundaries, audit, and cache invalidation. Bulk requests remain keyed and reported per Alga ID; never deduplicate them by external ID.
2. **Edit and 23505:** edit needs no new precheck; the migrated index accepts sharing. Keep real 23505 errors visible and keep target/entity messages distinct, including for the guard index. Never swallow a 23505 just because a type should be shareable: it can indicate deployment/schema drift or another constraint. Correct `externalMappingUniqueViolation.ts:55` comments that currently describe every non-Xero row as exclusive and tombstones as outside both indexes; the Alga-side index is total.
3. **Bulk grid:** use module adapter/entity plus target-kind metadata to consult the policy when constructing `unavailableExternalIds`. For Xero, translate kind to the existing `xeroTargetKind` metadata and retain prefixed option IDs. Replace the policy content of `isExclusiveKind` with this shared decision, keeping catalog addressing separate. Do not add a QBO multi-catalog kind picker merely to express cardinality. The QBO module's existing create/createMany delegation stays intact.
4. **Suggestion engine:** supply a provider-neutral target-exclusivity callback derived by the grid from the shared policy. Apply it to existing target exclusion, duplicate exact claims, and exclusion of exact claims from the fuzzy pool. Multiple rows may retain exact suggestions to a shareable item. Do not let input ordering choose which row wins an exclusive target; retain conservative ambiguity behavior there. Keep fuzzy ranking, thresholds, and manual review behavior. Catalog entries remain unique by external option ID; mapping rows remain unique by local entity ID. Reverse input order in tests to prove stable results.
5. **Import, subject to question 3:** group live mappings by external item instead of collapsing them into one map entry. Return an explicit skip reason for an item with multiple live service mappings; preview already renders `reason` (`packages/billing/src/components/accounting/QboItemImportStep.tsx:101`). Do not fall through to SKU/name matching, create another service, update any mapped service, or fan out catalog fields for an ambiguous item. Preserve single-target import behavior.
6. **Import apply safety:** filter tombstones in the item and tax mapping reads. Replace the external-ID `.first()` upsert with a plural lookup and an exact local-entity mapping update. Recheck the mapping set within the per-item transaction before any catalog mutation, so a changed preview/resolution does not select a different entity. Use a shared tenant/realm/target-scoped transaction advisory lock for QBO service mapping create, target edit, relink, unlink, and import apply; acquire multiple old/new target locks in a stable order when editing. Import must re-resolve or reject a stale target set under that lock before writing. Merely adding `.forUpdate()` to existing rows cannot prevent a new mapping insert. Direct import ledger writes must participate in the same lock discipline.

The advisory lock protects import's decision about a changing set, not ordinary uniqueness; the unique indexes still enforce exclusive targets across all writers. No Item CDC subscription or generic sync-engine fanout is added. If product chooses fanout instead of skip, revise import resolution/apply and its tests before implementation; do not ship the current arbitrary-winner behavior.

## Tests and verification

Use behavioral tests and real migrated DB constraints. A migration-shape test supplements DB coverage; it must execute exported `up`/`down` with a recording Knex executor and test DDL sequencing/configuration and refusal behavior, rather than assert migration source strings or import presence.

| Test group | Required proof |
| --- | --- |
| Migration shape and lint | Concurrent, idempotent, non-transactional DDL; guard validated before canonical drop; positive duplicate count prevents all DDL; PostgreSQL/Citus probe paths; interrupted-build retry handling. Run the lint engine/CLI on the new file. |
| Migration DB suite | Add `server/migrations/__tests__/sharedQboItemTargetsMigration.integration.test.ts`, using an isolated database. Execute `up`; inspect actual valid catalog indexes and use direct inserts to prove shared QBO services, unique QBO client/invoice/payment targets, and total Alga-side uniqueness. Include metadata NULL/missing, realm NULL/empty equivalence, different tenants/realms, existing Xero account sharing/item uniqueness, Desktop sharing, and tombstone target release. Test `down` refusal leaves data/indexes intact; after removing only test-owned shared rows, clean rollback restores old behavior; `up` works again. No silent early-return when rollback cannot be tested. |
| Action DB integration | Extend `packages/integrations/src/actions/externalMappingActions.db.test.ts`. Create **two services in the same tenant** (existing `serviceA`/`serviceB` fixtures belong to different tenants). Save both to one connected QBO item, read both, edit a third mapping onto it, unlink one, assert the other stays live, and relink the tombstone in place. Bulk-save both with per-entity successes. Assert repeat mapping for one Alga service still fails. Two same-tenant clients to one customer reject with the target error and no extra audit/mapping row. Keep tenant/realm isolation coverage. |
| Update old expectations | Convert the QBO service uniqueness negatives at `externalMappingActions.db.test.ts:1168` and `:1277` to exclusive client targets, retaining their error/audit assertions. Historical Xero migration tests intentionally execute an older index definition; keep those historical expectations scoped to that migration. Every suite that changes a global index must restore the latest schema, not an obsolete predicate, before later suites run. |
| Export DB integration | Add a DB-backed QBO adapter case with one invoice, two invoice charges from the mapped services, real mapping resolver and repository, and a fake QBO transport. Call transform **and deliver**. Assert two exported lines retain their distinct amount/description/order and both carry the shared `ItemRef.value`; assert the invoice mapping persists. Unlink one service and confirm the other's mapping remains resolvable. The remote transport may be mocked; mapping lookup and persistence may not. |
| Policy/grid behavior | Table-driven policy coverage for every provider/type/kind in the matrix. Render the bulk grid with an existing shared QBO mapping and assert another exact match remains suggested and saves. Two same-name Alga services can retain the shared exact suggestion; exclusive targets remain unavailable/ambiguous. Keep Xero prefixed item/account behavior and Desktop/CSV behavior. Reverse input order. |
| Import safety | Extend resolver/import tests and add DB-backed preview/apply coverage: two live mappings to one item produce an explicit skip, unchanged catalogs and ledgers, and no new service; reversed mapping order gives the same result. One live mapping plus a tombstone is unambiguous. Single-mapping imports still update the correct service. Interleave a mapping creation/target edit with import apply to prove serialization prevents stale resolution from overwriting either service. Include discounts if approved. |

Run DB files serially through `server/vitest.workspace-db.config.ts`; its global setup and several helpers recreate `test_database`, so do not point it at the wired development database. Run migration DB cases on PostgreSQL and an actual Citus-distributed mapping table. The integrations helper's dummy `public.pg_dist_partition` does not prove Citus compatibility. Exercise global index restoration in suite teardown, even on failure.

Implementation validation commands will include the new migration's lint invocation, the workspace DB lane selecting the affected action/migration/adapter/import files, and focused unit/component suites for policy, unique-error translation, QBO modules, grid suggestions, and import resolution. Do not claim these pass until implementation exists and they have run. The already-failing main migration audit is baseline evidence, not a passing gate for this work.

## Open questions

1. **Include QBO discounts in the sharing rule?** Recommend yes (`service`, `discount`) because both export as ItemRefs. This does not add multiple discount entities: the existing singleton and per-Alga uniqueness remain. Sharing an item between that singleton and a service is already allowed because their entity types differ.
2. **Also allow QBO tax-code targets to be shared now?** Recommend defer and keep `tax_code` unique in this change. Outbound tax mapping is forward and US TAX/NON are natural shared targets, but import currently reverse-maps a QBO code to one Alga rate. Enabling sharing requires an explicit ambiguous-tax import policy and DB tests; copying Desktop's three-type list would make that choice implicitly.
3. **How should importing a shared QBO item affect Alga services?** Recommend skip that item with an explanation while importing unrelated items normally. Generic accounting bucket names/prices must not overwrite either service or fan out into all of them. Single-mapping imports keep current behavior. Product must choose this versus intentional fanout or a designated import-owned entity before implementation.

## Delivery boundaries

This design commits one plan document. It does not change schema/application code, run migrations against the wired environment, create a ticket, change board state, push, open a PR, or implement unresolved product choices. The pre-existing `package-lock.json` modification is outside this assignment.

Implementation does not need line aggregation by QBO item, new items in QBO, a new mapping UI, payment/customer many-to-one behavior, Item CDC, or a broad refactor of accounting sync. A separate repair of the existing tombstone migration's main-audit lint failure is not included; the new migration must pass independently and cannot make that older file lint-clean by following it.
