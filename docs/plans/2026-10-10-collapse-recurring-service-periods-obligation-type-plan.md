# Collapse `recurring_service_periods.obligation_type` into `cadence_owner` — implementation plan

Ticket: alga0002072, a follow-up to alga0002069 (#2976 / `7088299185`).
Branch: `feature/collapse-recurring-service-periods-obligation-ty`.
Base: `main` @ `b0d0b4dacf`.

This plan is based on the schema and code currently in the worktree. File and line references are as of the base commit.

## 1. Current state (verified)

### Schema
The table is created in `server/migrations/20260318120000_create_recurring_service_periods.cjs`. Later migrations add invoice linkage (`20260318143000`), chargeless claims (`20260904120000`) and the `billing_semantics_mutation` trigger (`20260904130000`).

- `obligation_type varchar(40) NOT NULL` is guarded by `recurring_service_periods_obligation_type_check`. The check allows `contract_line`, `client_contract_line`, `template_line` and `preset_line`.
- `recurring_service_periods_tenant_schedule_period_revision_uidx` is a UNIQUE CONSTRAINT, not a bare index, on `(tenant, schedule_key, period_key, revision)`.
- `recurring_service_periods_tenant_schedule_start_idx` is on `(tenant, schedule_key, service_period_start)`.
- No index includes `obligation_type`.
- The table has no foreign keys in either direction, so its FK closure is just the table itself.
- `invoice_linkage_state_check` requires `invoice_charge_detail_id IS NULL OR lifecycle_state = 'billed'`. This means a linked row can never be superseded, and the merge rules below depend on that.
- On plain PostgreSQL, the `billing_semantics_mutation` trigger takes a per-tenant advisory lock on every write. Distributed Citus tables skip the trigger, and the application takes `lockTenantBilling` instead.

### Citus
No migration in the repo distributes `recurring_service_periods`. If it is distributed in prod, that was done by out-of-band DDL, and nobody can vouch that `truncate_local_data_after_distributing_table` was run afterwards. Its coordinator parent heap may therefore still hold stale pre-distribution rows. Any DDL that scans the parent heap would trip over them: `ADD CONSTRAINT UNIQUE`, `CREATE UNIQUE INDEX`, `SET NOT NULL`. The migration must handle three states: plain PostgreSQL, Citus with the table still local (CI smoke), and Citus with the table distributed (prod).

### Local data
Checked in the `alga-psa-local-test` `server` DB on 2026-10-09:

| obligation_type | cadence_owner | rows |
|---|---|---|
| client_contract_line | client | 2,620 (all lifecycle states) |
| contract_line | contract | 120 |

- The label never disagrees with `cadence_owner`.
- In every row, the label segment of `schedule_key` equals the `obligation_type` column.
- No obligation has more than one `charge_family`.
- No duplicate live periods exist.

The suspected mislabel (client cadence stored as `contract_line`) appears only in test fixtures and in-memory previews:
- `server/src/test/test-utils/recurringTimingFixtures.ts` defaults to `obligationType: 'contract_line'` with `cadenceOwner: 'client'`.
- The UI authoring previews and the EE simulator do the same, in memory only.

No current production writer produces that pair. All four insert paths write the canonical pair:
- repair: `recurringServicePeriodActions.ts:694`
- contract materialization: `contractCadenceServicePeriodMaterialization.ts:336`
- client regeneration: `clientCadenceScheduleRegeneration.ts:400`
- edit/skip/defer: these copy the parent's ref

Prod could still hold such rows from before the 2026-03-19 cutover. The audit in §3 answers that before deploy.

### Code that treats the label as identity
- **Dual-label OR-ing:** `buildPostDropRecurringObligationCandidates`, used in `billingEngine.ts:~7348` and `isPeriodAlreadyInvoiced.ts:43-68`.
- **`whereIn(POST_DROP_RECURRING_OBLIGATION_TYPES)`:** `invoiceGeneration.ts` (5 sites, plus one with no cadence filter at :1852), `billingEngine.ts:1384/1411`, `clientCadenceWindowMaterialization.ts:68/182`, `invoiceService.ts:192`, `recurringServicePeriodActions.ts:1144`.
- **Label filters with no `cadence_owner` filter:**
  - `invoiceGeneration.ts:1344` uses `'contract_line'` alone.
  - `bucketUsageService.ts:478` filters on the label alone.
  - `billingAndTax.ts:410/471` runs two queries split by label and merges the results.
- **Single-label filters next to `cadence_owner`:** `clientCadenceScheduleRegeneration.ts:289/341/604`, `contractCadenceServicePeriodMaterialization.ts:265/350`, `contractCadenceCoverageAudit.ts:138/148/202/211/322`, `invoiceService.ts:201`, `invoiceGeneration.ts:1462/1614`.
  - `clientCadenceScheduleRegeneration.ts:289` (`loadClientBilledLedgerBoundary`) currently ignores mislabeled billed rows. That is a latent version of the alga0002069 bug class.

### Schedule-key format and its parsers
The key is `schedule:{tenant}:{obligationType}:{obligationId}:{cadenceOwner}:{duePosition}`, built in `shared/billingClients/recurringServicePeriodKeys.ts:17-25`. Three places parse it by hand:
- `recurringServicePeriodActions.ts:382-399`: a 6-segment regex that extracts `obligationType`.
- `invoiceGeneration.ts:1682-1689`: `/:client_contract_line:([^:]+):/`. It throws "missing client-cadence assignment identity" when the label is absent, so **client-cadence generation breaks unless this changes together with the key format**.
- `AutomaticInvoices.tsx:466-470`: label regexes that only decide display text.

### Schedule keys stored or passed outside the column
- **Durable:**
  - `recurring_service_periods.source_run_key` holds `operator-repair:{scheduleKey}:{ts}`. It is a label; nothing parses it.
  - Workflow event payloads (`RECURRING_BILLING_RUN_*` `selectionKey`/`retryKey`) are historical; nothing reads them back.
- **Transient:**
  - `?tab=service-periods&scheduleKey=` deep links (`AutomaticInvoices.tsx:341` → `BillingDashboard.tsx:266` → `RecurringServicePeriodsTab`)
  - sessionStorage `billing-usage-return-selection` (`AutomaticInvoices.tsx:1642/1728`)
  - REST `selector_input.executionWindow.scheduleKey` (`server/src/lib/api/schemas/invoiceSchemas.ts:314-341`)
  - any queued `generate-invoice` job payloads (no production enqueuer found)

## 2. Target end state

- A recurring obligation is identified by `(tenant, obligation_id = contract_line_id, charge_family)`. `cadence_owner` is the only cadence discriminator. Every reader filters on `obligation_id` and/or `cadence_owner`. No reader OR-s candidates.
- The `recurring_service_periods.obligation_type` column and its CHECK are **dropped**, not pinned.
  - Dropping is preferred, and it also acts as a deploy fuse: an old pod still running during rollout fails loudly on any insert or label filter (`column does not exist`). Without the drop, it could silently write old-format keys next to rewritten ones.
- The schedule key becomes `schedule:{tenant}:{obligationId}:{cadenceOwner}:{duePosition}`. Every stored key is rewritten, including superseded revisions.
- Key building and parsing live in **one** module: `shared/billingClients/recurringServicePeriodKeys.ts`. No other file uses a hand-written schedule-key regex.
- Delete:
  - `shared/billingClients/postDropRecurringObligationIdentity.ts` (`CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE`, `POST_DROP_RECURRING_OBLIGATION_TYPES`, `isClientCadencePostDropObligationType`, `build*PostDropObligationRef`, `buildPostDropRecurringObligationCandidates`) and its re-export in `shared/billingClients/index.ts`
  - `RecurringObligationType` and `IRecurringObligationRef.obligationType` in `packages/types`. Nothing uses `template_line` or `preset_line`, so the type goes entirely instead of being narrowed.
- **`charge_family` stays out of the schedule key** (decision). Each contract line has exactly one charge family, and the audit reports any exception. Adding it would be a second identity change and should not ride along with this one.

## 3. Read-only audit (lands first, runs against prod before merge)

The audit logic is defined once in the migration module (§4) as `exports.auditObligationLabelCollapse(knex)`. It is used in two places:
- `server/scripts/audit-recurring-service-period-obligation-labels.cjs`: a standalone, read-only CLI that `require`s the migration module and prints JSON. It is safe to run against prod or a prod snapshot. Its output goes into the PR description.
- The migration's precheck, which logs the same report before any write.

Audit queries (tenant-scoped GROUP BYs; each is a router or multi-shard SELECT, which Citus allows):
1. `obligation_type × cadence_owner × lifecycle_state` counts.
2. Rows whose `schedule_key` disagrees with its own columns: the label segment differs from `obligation_type`, or the id, cadence or due segments differ from `obligation_id`, `cadence_owner` or `due_position`.
3. **Collision groups:** `(tenant, obligation_id, cadence_owner, due_position, period_key)` groups that contain more than one distinct old `schedule_key`. For each group, report:
   - its row count
   - the live rows, meaning `lifecycle_state NOT IN ('superseded','archived')`
   - the linked rows
   - whether more than one row is linked (a double-billed period)
4. **Unique-key collisions after rewrite:** the same count at `(tenant, new_key, period_key, revision)`. This is what the unique constraint will see.
5. **Overlapping live periods** across lineages that collapse to one key but have different `period_key`s. These are reported, not repaired. Today's dual-label readers already select both rows, so behaviour does not change. A non-zero count is an escalation item for the captain.
6. Obligations with more than one `charge_family` per `(obligation_id, cadence_owner, due_position)`, which would invalidate the §2 decision.

Escalation gate: if the prod audit shows any double-billed collision groups (query 3), any overlapping live periods (query 5), or any multi-family obligation (query 6), report it to the XO before merging. The migration still handles each of these deterministically; the gate exists for visibility.

## 4. Migration: `server/migrations/20261010120000_collapse_recurring_service_period_obligation_type.cjs`

The migration sets `exports.config = { transaction: false }`. Citus DDL on distributed tables must run outside a wrapping transaction, and each tenant gets its own transaction. Data access goes through `require('./utils/tenantDb.cjs')`; `recurring_service_periods` is already registered at line 379. Exports: `up`, `down`, `auditObligationLabelCollapse`, `collapseTenant(knex, tenant)` and the pure helpers (`computeCanonicalScheduleKey`, `planCollisionGroup`), so tests can drive each stage.

### `up()`
1. **Guard and short-circuit.**
   - If the table doesn't exist, return.
   - `hasLabel = hasColumn('obligation_type')`.
   - Run the audit (§3) and log it. It needs `obligation_type`, so skip queries 1–3 when `!hasLabel`.
2. **Citus parent-heap cleanup.** This runs before any write, so the unique constraint built later never scans stranded pre-distribution rows. It applies only when Citus is installed (`canCreateDistributedTable`), the table `isDistributed`, **and** `pg_relation_size('recurring_service_periods') > 0`:
   - Walk the recursive FK closure through `pg_constraint` in both directions (`conrelid`/`confrelid`). Abort with a clear error unless every member is in `pg_dist_partition`. Today the closure is just this table, but checking it means a future local FK referrer cannot get its data wiped by the cascading TRUNCATE. This follows the "UNSAFE PATTERN" warning in `20260718234058` and `20260818040000`.
   - `SELECT truncate_local_data_after_distributing_table('public.recurring_service_periods'::regclass)`.
   - Otherwise the step is skipped and logged as a no-op, which also makes it idempotent.
3. **Drop the unique constraint** with `ALTER TABLE ... DROP CONSTRAINT IF EXISTS recurring_service_periods_tenant_schedule_period_revision_uidx`. Dropping it before renumbering revisions avoids transient unique violations while revisions are swapped.
4. **Per-tenant rewrite and merge** with `collapseTenant`. The loop runs over `SELECT DISTINCT tenant FROM recurring_service_periods`; each tenant gets one `knex.transaction` and router-only DML.
   - **Load:** select the tenant's rows: `record_id, schedule_key, period_key, revision, obligation_id, obligation_type (if hasLabel), cadence_owner, due_position, lifecycle_state, invoice_id, invoice_charge_detail_id, supersedes_record_id, source_run_key, created_at, updated_at`.
   - **Compute new keys in Node.** `newKey = schedule:{tenant}:{obligation_id}:{cadence_owner}:{due_position}`, computed from the **columns**, never parsed from the old key. Columns are the canonical truth, and audit query 2 has already flagged any disagreement.
   - **Group** by `(newKey, period_key)`. A group whose rows share one old key is a plain rewrite. A group with more than one distinct old key is a **collision group**. Each old key in a collision group is a "lineage".
   - **Pick the winning lineage deterministically.** Ordering:
     1. it contains an invoice-linked row (`invoice_id IS NOT NULL`)
     2. it contains a `billed` row
     3. its live row's state ranks highest: `locked > edited > generated > skipped`
     4. its label is canonical for the cadence (`client`→`client_contract_line`, `contract`→`contract_line`)
     5. latest `updated_at`
     6. smallest `record_id`, as a final tiebreak
   - **Renumber.** Within the group, order rows by `(row is the winner's live row ? 1 : 0, old revision, created_at, record_id)` and assign `revision = 1..n`. The winner's live row is always the highest revision, and every row's revision is unique.
   - **Supersede losers.** Loser rows whose state is live and that are **not** invoice-linked and not `billed` get `lifecycle_state = 'superseded'` and `reason_code = 'obligation_label_collapse'`. Loser rows that are linked or `billed` keep their state, because `invoice_linkage_state_check` forbids anything else and they are historical invoice truth. They only get a new key and revision, and each one is logged as a double-billed collision. Nothing is deleted.
   - **Chain.** If the winner's live row has `supersedes_record_id IS NULL`, point it at the newest superseded loser row so the history stays navigable.
   - **`source_run_key`.** Replace the embedded old key with the new one (`operator-repair:{old}:` → `operator-repair:{new}:`), so the legacy label survives in no stored field.
   - **Write.** Batched `UPDATE recurring_service_periods AS r SET ... FROM (VALUES (?::uuid, ?, ?, ?, ?, ?, ?::uuid), ...) AS v(...) WHERE r.tenant = ? AND r.record_id = v.record_id`, 500 rows per batch, touching only rows that change. Values are computed in Node and passed as parameters: Citus disallows functions or casts on column references in UPDATE (`AI_coding_standards.md`), and the predicate on the distribution column keeps each statement router-planned. `updated_at` is bound as a Node timestamp, not `now()`.
   - **Idempotency.** On a re-run every row already has its new key, every group has a single key, and no rows change.
5. **Verify** with a tenant-grouped SELECT. Abort with a report if either check fails:
   - (a) no duplicate `(tenant, schedule_key, period_key, revision)`
   - (b) no `schedule_key` still matching the 6-segment legacy shape `^schedule:[^:]+:[^:]+:[^:]+:(client|contract):(advance|arrears)$`
6. **Recreate the unique constraint** if it is missing, checked through `pg_constraint`: `ALTER TABLE ... ADD CONSTRAINT recurring_service_periods_tenant_schedule_period_revision_uidx UNIQUE (tenant, schedule_key, period_key, revision)`. It includes the distribution column, so it is legal on a distributed table. Step 2 guarantees the parent heap is empty.
7. **Drop the label.**
   - `DROP CONSTRAINT IF EXISTS recurring_service_periods_obligation_type_check`.
   - Then `DROP COLUMN` if the column exists. Citus propagates both statements.

`tenant_schedule_start_idx` needs no rebuild; Postgres maintains it through the UPDATEs.

### `down()`
1. Run the Citus parent-heap guard (step 2 of `up()`).
2. If `obligation_type` is missing, add it as nullable `varchar(40)`.
3. Drop the unique constraint.
4. Per tenant, recompute `obligation_type` from `cadence_owner` (`client`→`client_contract_line`, `contract`→`contract_line`) and rewrite `schedule_key` and `source_run_key` back to the 6-segment form. The mapping is injective, so no collisions are possible.
5. `SET NOT NULL`. This is safe because the parent heap was cleaned in step 1, so no `pg_attribute` hack is needed.
6. Restore the original four-value CHECK so the schema is exactly what it was before.
7. Re-add the unique constraint.

Merges are **not** reversed: superseded losers stay superseded with their renumbered revisions. That is documented in the file header. Rolling back means reverting the code at the same time.

### Deploy-window note
Ship the code and the migration in one release. During a rolling deploy, old pods hit `column "obligation_type" does not exist` on recurring writes and on label-filtered reads. Those calls fail loudly and are retried by the next run. This is intended: it is safer than old pods writing old-format keys next to the rewritten ones. Recurring materialization and invoice generation are idempotent per `(schedule_key, period_key)`, so retries are safe.

## 5. Code changes

### Layer 0 — types and keys (the substrate everything else uses)
- **`packages/types/src/interfaces/recurringTiming.interfaces.ts`**
  - Delete `RecurringObligationType` (:26) and the `obligationType` field of `IRecurringObligationRef` (:263-268).
  - Everything that extends or embeds it (`IPersistedRecurringObligationRef`, `sourceObligation` in `IRecurringServicePeriod`, `IRecurringInvoiceDetailTiming`, `IRecurringServicePeriodRecord`, `IRecurringServicePeriodOperationalViewRow`, `ICadenceBoundaryGeneratorInput`) loses the field automatically. The compiler then finds every remaining use.
- **`shared/billingClients/recurringServicePeriodKeys.ts`**
  - `buildRecurringServicePeriodScheduleKey({ tenant, obligationId, cadenceOwner, duePosition })` emits the new format.
  - Add `parseRecurringServicePeriodScheduleKey(key)`, returning `{ tenant, obligationId, cadenceOwner, duePosition, scheduleKey }` in canonical form, or `null`. It also accepts the legacy 6-segment shape and returns the **canonical** key, so transient inputs keep working across the deploy: deep links, sessionStorage selections, external API selector inputs.
  - Legacy keys are accepted only at the input boundary. Nothing ever writes them, and the DB is queried only with the canonical key.
  - The parser must reject `schedule:{tenant}:unresolved:{time|usage}:{id}`, which has five segments like the new format; the `client|contract` and `advance|arrears` enums tell them apart. Add a unit test for this.
  - The legacy branch carries a dated removal note.
- **Delete `shared/billingClients/postDropRecurringObligationIdentity.ts`** and remove its re-export from `shared/billingClients/index.ts`. Callers that built a ref through it build `{ tenant?, obligationId: contractLineId, chargeFamily }` inline.

### Layer 1 — shared billing clients
- **`clientCadenceScheduleRegeneration.ts`**
  - Remove the row-type field, the map, the serialize and the select list (:45/:185/:239/:353).
  - In `loadClientBilledLedgerBoundary` (:289), the existing-record load (:341) and the retire UPDATE (:604), filter on `obligation_id` and `cadence_owner = 'client'` only.
  - :473 uses a plain ref.
- **`bucketUsageService.ts:466-478`**: build a plain ref and filter on `obligation_id` and `cadence_owner = clientPlan.cadence_owner ?? 'client'`. This adds the cadence filter the current code is missing.
- **`materializeClientCadenceServicePeriods.ts:127`, `materializeContractCadenceServicePeriods.ts:154`, `recurringServicePeriodParity.ts:24`**: drop the `obligationType` argument from the key build.
- **`regenerateRecurringServicePeriods.ts:141`**: drop the `obligationType` equality from the protection match.
- Rebuild `shared/dist` if the build pipeline uses it. It is not tracked in git; just confirm the package builds.

### Layer 2 — billing package
- **`invoiceGeneration.ts`**
  - Remove the imports (:88-90).
  - Drop the label filters at :1272/:1387/:1459/:1570/:2802. They keep `cadence_owner = 'client'`.
  - :1344 becomes `obligation_id = ? AND cadence_owner = 'contract'`, adding the missing cadence filter.
  - Drop the label at :1462/:1614.
  - Delete the unscoped `whereIn` at :1852.
  - Replace `parseClientContractLineIdFromScheduleKey` (:1682-1689) with `parseRecurringServicePeriodScheduleKey(key)`, requiring `cadenceOwner === 'client'` and returning `obligationId`.
  - Normalize `selectorInput.executionWindow.scheduleKey` to canonical once, where the selector input enters (`getSelectedRecurringObligationIdFromSelectorInput` and the `schedule_key` lookups at :1266/:1564/:2796). Put this in one helper, not at every site.
- **`billingEngine.ts`**
  - Remove the imports (:90-94).
  - Drop the `whereIn` at :1384/:1411, the select and map at :1397/:1424, and the client-labelled `sourceObligation` at :4951 (replace with a plain ref).
  - Replace the candidate OR-ing at :~7348-7375 with `.where('obligation_id', contractLineId)`.
- **`pricing/isPeriodAlreadyInvoiced.ts:43-68`**: one `.where('obligation_id', contractLineId)`; no candidates.
- **`billingAndTax.ts`**
  - Merge the two label-split due-work queries (:410 and :471, merged at about :521) into one query with no label filter. Downstream already reads `rsp.cadence_owner`.
  - Build the gap-scan keys at :655-662 with the new builder.
  - Drop the synthetic `obligationType` field at :1318.
- **`recurringServicePeriodActions.ts`**
  - Delete `obligationType` from `DbRecordRow`, `ParsedScheduleKey`, the management view and the schedule summary (:63/:110/:143/:173), and from the map and serialize code (:272/:456/:1019/:1046/:1180).
  - Delete the local `parseRecurringServicePeriodScheduleKey` (:382-399) in favour of the shared one.
  - Collapse the two identical label branches in `loadObligationContext` (:486-547). Drop the guard in `loadLiveScheduleContext` (:563-568).
  - Repair (:807) branches on `schedule.cadenceOwner`; callers at :984/:999/:1095 stop passing the label.
  - Repair refs at :761/:857 become plain refs.
  - Drop the select at :648, the `whereIn` at :1144 and the groupBy/select at :1156/:1166.
- **`contractCadenceServicePeriodMaterialization.ts`**: remove the row type, map and serialize (:47/:172/:226), the load filter and select (:265/:277) and the retire filter (:350); `cadence_owner = 'contract'` stays. :549 drops the ref field.
- **`contractCadenceCoverageAudit.ts`**: drop the label predicate from the raw SQL at :138/:148/:202/:211 and the knex filter at :322. Drop the field at :295/:354/:400/:405/:433.
- **`clientCadenceWindowMaterialization.ts:68/182`** and **`services/invoiceService.ts:192/201`**: drop the label filters; the cadence filters stay.
- **`AutomaticInvoices.tsx:466-470`**: use the shared parser (`parse(key)?.obligationId` → "Assigned contract line"). The deep-link builder at :341 passes the canonical key through unchanged.
- **`BillingDashboard.tsx:266` / `RecurringServicePeriodsTab.tsx`**: canonicalize `initialScheduleKey` through the parser, so bookmarked legacy deep links still open the schedule.
- **Previews** (`recurringAuthoringPreview.ts:61`, `wizard-steps/firstInvoiceDate.ts:73`, EE `simulator/hypotheticalPeriods.ts:189`): drop the field.

### Other
- `scripts/fixtures/upgrade-v150.ts:46,49`: drop the column from the INSERT; the key comes from the builder.
- `e2e-tests/fixtures/recurring-billing.ts:96-99` and `invoice-ticket.ts:13-16`: same change.
- `server/scripts/audit-recurring-service-period-obligation-labels.cjs`: new (§3).

## 6. Tests (80/20)

### New
1. **`server/migrations/__tests__/collapseRecurringServicePeriodObligationTypeMigration.integration.test.ts`**
   - Harness: the scratch DB from `consolidateClientTaxIdMigration.integration.test.ts`. Shim migrations earlier than the target into a temp dir, run `createTestDbConnection({ databaseName, migrationsDir, runSeeds: false })`, seed, then `migrate.up({ name: TARGET })`.
   - Fixtures, one tenant each where useful:
     - (a) client cadence stored under the canonical label
     - (b) client cadence stored as `contract_line`, with no collision
     - (c) contract cadence
     - (d) a collision: the same obligation, cadence, due position and period under both labels; the `contract_line` copy is invoice-linked and `billed`, the canonical copy is `generated`, and both lineages have superseded revisions
     - (e) a double-billed collision: both copies linked
     - (f) an `operator-repair:` `source_run_key`
   - Assert:
     - every key equals `buildRecurringServicePeriodScheduleKey(...)` (new format)
     - the column and CHECK are gone and the unique constraint exists
     - (d): the linked row wins with the highest revision, the other row is `superseded` with `reason_code = 'obligation_label_collapse'`, and revisions are unique
     - (e): both rows stay `billed`, revisions are distinct, and the double-billed collision is logged
     - (f): `source_run_key` is rewritten
     - a second `up()` is a no-op
     - `down()` restores the column, the four-value CHECK and the legacy keys; `up()` after `down()` converges again
   - Also add pure unit tests for `planCollisionGroup` (the tiebreak order) and `computeCanonicalScheduleKey`.
   - Register the file in `scripts/verify-citus-execution.mjs` so it also runs on the Citus lane.
2. **Regression: a client-cadence period first persisted as `contract_line` is selected, invoiced and linked exactly once.**
   - Put it in the same migration integration file as a second `describe`. After `up({ name: TARGET })`, add the shims for the remaining later migrations and run `migrate.latest()` so the scratch DB is current.
   - Seed fixture (d), then run client-cadence invoice generation (`generateInvoice` with the canonical selector input from `getAvailableRecurringDueWork`) for that window.
   - Assert:
     - the period is listed once in due work
     - exactly one invoice charge detail is created and linked to the winning `record_id`
     - generating again raises the duplicate-invoice guard and creates no second detail
     - `isPeriodAlreadyInvoiced(contractLineId, period)` is true
   - If running the full billing action stack on a scratch DB proves impractical, fall back to `server/src/test/infrastructure/billing/invoices/clientBillingCycleRecurringServicePeriods.test.ts`: seed the post-migration shape by calling `collapseTenant` on a row written with the legacy key and label through raw SQL, before the column is dropped in that harness. In that case the migration test owns the column-drop assertion.
3. **`shared` unit test for `parseRecurringServicePeriodScheduleKey`**: new format, legacy format canonicalized, unresolved keys rejected, garbage rejected.

### Update (mechanical)
- **Delete** `server/src/test/unit/billing/postDropRecurringObligationIdentity.test.ts`.
- **`server/src/test/test-utils/recurringTimingFixtures.ts`**: remove the default `obligationType`.
- Drop the `obligation_type` seed or assertion, and build keys through `buildRecurringServicePeriodScheduleKey` instead of hand-written strings, in:
  - `billingInvoiceTiming.integration.test.ts` (~46 references; it has its own serialize/map helpers)
  - `recurringDueWorkReader.integration.test.ts`, `recurringServicePeriodActions.test.ts`, `automaticInvoices.recurringDueWork.ui.test.tsx`, `recurringServicePeriodsTab.ui.test.tsx`
  - the infrastructure tests under `server/src/test/infrastructure/billing/invoices/`
  - `calendarMonthEndCloseActions.db.test.ts`, `groupedZeroDollarRecurringClaim.db.test.ts`, `billingEngine.previewFixedAmounts.batchedLoad.test.ts`
  - `shared/__tests__/regenerateRecurringServicePeriods.test.ts`, `recurringServicePeriodRecord.typecheck.test.ts`, `contractSimulator.integration.test.ts`
  - the remaining unit tests listed by `grep -rln "obligation_type\|obligationType\|client_contract_line:" server/src/test packages shared ee e2e-tests`
- **Static source-text tests** must be updated to match the new code: `recurringInvoiceLinkage.static.test.ts` and `systemManagedDefaultAttributionShell.wiring.test.ts`.
- **`recurringServicePeriodsMigration.test.ts`** checks the original migration's DDL, which is unchanged. Leave it alone.

### Must pass
The existing coverage for invoice-generation due selection, `isPeriodAlreadyInvoiced`, client-cadence regeneration (`updateClientBillingSchedule`, `clientBillingCycle*`) and contract-cadence materialization, replenishment and coverage audit must all pass. So must `npm run typecheck`, which is how leftover `obligationType` uses get found.

## 7. Implementation order
1. The audit helper and CLI. Run it against the local `server` DB, and request a prod snapshot run through the XO.
2. Types and key module, then shared clients, then the billing package (let `tsc` drive), then previews, fixtures and scripts.
3. The migration, then its integration test, then the regression test.
4. Test-fixture sweep, then full billing unit and infrastructure suites, the Citus lane and typecheck.
5. Grep gate: `grep -rn "obligation_type\|obligationType\|client_contract_line\|POST_DROP" --include=*.ts --include=*.tsx packages shared server/src ee/server/src` returns only the migration files and the legacy branch of the key parser.

## 8. Risks
- **Prod holds double-billed or overlapping collision groups.** These are never deleted or rewritten as un-billed. The audit gate escalates them before merge.
- **The table is distributed with a stranded parent heap.** The guarded truncate runs only after the FK-closure check, and aborts loudly instead of risking a local cascade.
- **Old keys in transient inputs** (deep links, sessionStorage, API callers): the parser canonicalizes them at the input boundary.
- **Rolling-deploy window.** Old pods fail loudly instead of corrupting data (see §4).
