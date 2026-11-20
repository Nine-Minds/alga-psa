# Block duplicate time sheets per user and period

Ticket: alga-2026-0002898. Branch: `feature/time-sheets-rest-block-duplicate-sheet-per-user`.

Status: design proposal. The REST duplicate response remains open for product review.

## Problem and acceptance criteria

`POST /api/v1/time-sheets` currently creates another DRAFT sheet when the target
user already has a sheet for the requested period. A sheet's logical identity is
`(tenant, user_id, period_id)`, regardless of approval status or the actor who
opens it. Duplicate sheets split time entry and approval history.

The change must ensure:

- A second POST for the same logical identity creates no additional row and
  returns the response selected below, documented in the API changelog.
- Concurrent creates cannot persist two rows. Different users, periods, and
  tenants remain independent.
- The effective owner is `data.user_id ?? context.userId`. Existing delegation
  and human-owner checks run before looking up or returning another user's sheet.
- Existing sheet IDs, lifecycle state, entries, comments, and review history are
  preserved. A duplicate request never resets an existing sheet to DRAFT.
- Database-backed integration tests exercise both HTTP responses and persisted
  row counts against the migrated schema.

## Verified current behavior

| Evidence | Finding |
| --- | --- |
| `server/src/lib/api/services/TimeSheetService.ts:344` | `create()` opens its transaction at line 347, checks delegation at 350 and human ownership at 362, then inserts unconditionally at 374. There is no user/period lookup. |
| `server/src/lib/api/services/TimeSheetService.ts:381` | Creation publishes after commit, then calls `getWithDetails()` at 395. Duplicate handling must exit before creation-only side effects. |
| `server/src/lib/api/services/TimeSheetService.ts:415` | State conflicts already use `ConflictError`; period overlap uses it at 855 and period-setting unique violations at 115. |
| `server/src/lib/api/middleware/apiMiddleware.ts:93` | `ConflictError` carries HTTP 409 and code `CONFLICT`. Application errors serialize at 550; raw PostgreSQL `23505` becomes a generic 409 at 573. |
| `server/src/lib/api/controllers/ApiBaseController.ts:327` | Inherited create authenticates, checks create permission and validates the body, then always wraps successful service results in HTTP 201 at 347. Its message-based conflict conversion at 349 can discard custom error details. |
| `server/src/app/api/v1/time-sheets/route.ts:20` | POST calls `ApiTimeSheetController.create()`, inherited from that base controller. |
| `packages/scheduling/src/components/time-management/time-entry/TimeTracking.tsx:176` | Selecting a period calls `fetchOrCreateTimeSheet(subjectUserId, period_id)` and opens the returned ID. |
| `packages/scheduling/src/actions/timeSheetOperations.ts:357` | The UI action checks delegation at 367 and calls `findOrCreateTimeSheetRow()` at 371. |
| `packages/scheduling/src/lib/timeSheetResolution.ts:22` | The resolver looks up tenant/user/period at 30, returns the existing row in any status, and inserts DRAFT only when absent at 37. It has the same concurrency gap. |
| `packages/scheduling/src/lib/timeEntrySaveAdapter.ts:71` | Time entry Save uses the UI fetch-or-create action and then rejects a non-editable sheet at 75. |
| `packages/scheduling/src/lib/timeSheetResolution.ts:100` | Server work-date resolution reuses the same resolver; the stopwatch calls work-date resolution in `lib/stopwatch/stopwatchCore.ts:399`. |
| `server/migrations/202409071803_initial_schema.cjs:549` | All three logical-key columns are NOT NULL. Only `(tenant, id)` is unique. There is no creation timestamp to use for an "oldest sheet" rule. |
| `server/migrations/20260904120000_enforce_availability_scope_uniqueness.cjs:10` | Existing Citus dedupe/index precedent runs without an enclosing migration transaction because DDL cannot follow distributed-table DML in the same transaction. Indexes include tenant (line 72); configuration is at 95. |
| `docs/architecture/citus-migration-best-practices.md:14` | Migrations belong in the normal migration chain. No separate Citus-only migration directory. |

A read-only check of the wired `alga-psa-local-test` database on 2026-10-27 found:
zero duplicate groups, zero excess rows, and only `time_sheets_pkey (tenant, id)`.
This database is plain PostgreSQL (`pg_extension` has no Citus extension).
Its foreign keys referencing sheets come from `time_entries` and
`time_sheet_comments`. These observations do not establish production data
cleanliness or Citus runtime compatibility. No data or schema was changed.

## Open product question: conflict or fetch-or-create?

| Contract | Advantages | Costs and required behavior |
| --- | --- | --- |
| **409 Conflict** | Matches the REST create operation and existing service conflict style. Distinguishes a newly created resource from a retry or competing writer. Keeps the inherited 201 success path. | Clients must recover by reading the existing sheet, for example GET with `user_id` and `period_id` filters when authorized. The UI action still returns an existing sheet, so the two interfaces share the invariant but have different duplicate responses. |
| **Return existing sheet** | Matches the UI fetch-or-create action directly. Retries and competing creates can converge on one ID without error handling. | Use 201 for insertion and 200 for reuse. The current base controller always returns 201, so this needs a time-sheet-specific response path with creation/reuse metadata. Preserve existing state and skip creation events on reuse. Apply read authorization before returning a pre-existing sheet; create permission alone must not expand read access. |

**Recommendation: 409 Conflict.** Retain the UI's one-sheet invariant and its
fetch-or-create action while keeping REST POST explicit about whether it created
a resource. This is a recommendation, not an approved decision. Implementation
must record the selected contract before fixing assertions and publishing docs.

If 409 is selected, use the same response for the transaction lookup and an
insert race:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "A time sheet already exists for this user and period"
  }
}
```

First creation remains HTTP 201 with the existing detailed `data` payload.
No custom error details are required; this avoids changing the shared
controller's message-based conversion. Conflict applies to every sheet status.
If reuse is selected instead, replace the duplicate expectation everywhere with
HTTP 200 and the existing sheet's detailed payload and ID, without changing it.

## Transaction guard and race handling

1. Keep the existing delegation and human-owner checks inside `create()`'s
   transaction. Resolve the effective owner once, then use it for both lookup
   and insertion. Use `tenantDb(trx, context.tenant)` throughout.
2. After those checks and before insertion, query `time_sheets` by `user_id` and
   `period_id`. If present, take the selected duplicate-response path. Do not
   limit the check to DRAFT sheets.
3. Add the database uniqueness guard below. A lookup, even inside a transaction,
   cannot lock a row that does not yet exist and cannot close the insert race.
4. Insert with the explicit conflict target
   `.onConflict(['tenant', 'user_id', 'period_id']).ignore().returning('*')`.
   An empty result takes the same duplicate path as the lookup. This targets
   only the logical-key conflict and keeps the transaction usable. Do not use
   an untargeted ignore, a merge that resets status, or catch `23505` and read
   again inside an already-aborted transaction.
5. Under the reuse alternative, fetch the winning row in a subsequent statement
   after a conflict. Distinguish inserted/reused results so only inserted rows
   publish creation events after commit. Keep the detailed read after commit.
   Handle a winner deleted before the follow-up read explicitly rather than
   dereferencing an absent row.

The shared UI resolver needs the same targeted insert-ignore and follow-up read
when the index is introduced. This preserves its existing behavior when two UI
requests, the stopwatch, or REST and UI race. Keep its authorization boundary in
its callers. This compatibility change is limited to resolving this identity;
no new scheduling framework or broad service refactor is needed.

## Unique index and existing-data cleanup

Recommend enforcing the invariant for every writer with a full unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS time_sheets_tenant_user_period_unique
  ON time_sheets (tenant, user_id, period_id);
```

Including the tenant distribution key makes uniqueness local to each tenant's
shard and preserves cross-tenant independence. Do not make this a DRAFT-only
partial index. Put the change in a new timestamped `server/migrations/*.cjs`
file, following the existing tenant-inclusive index convention in
`docs/AI_coding_standards.md` under CitusDB Compatibility. No redistribution or
manual catalog changes are needed for this index.

Cleanup belongs in the **same migration file before index creation** so upgrading
a database does not depend on an undocumented prior script. It must be
conservative because sheets can contain approval and billing history:

1. Inventory duplicate groups across tenants using the query below. Classify
   every member before deleting anything. A discardable member is DRAFT, has
   null submission/approval metadata, and has no entries, comments, change
   requests, or other references discovered during the reference audit.
2. Preserve the sole non-discardable sheet in a group. If all members are
   discardable, preserve the lowest ID as a deterministic tie-break. UUID order
   does not imply creation order. Remove only the other discardable members.
3. If a group contains multiple non-discardable sheets, fail the preflight before
   cleanup writes with actionable diagnostics for reconciliation. Do not choose
   a winning approval status, move billable entries, delete comments, or rewrite
   review history automatically. The upgrade can resume after explicit repair.
4. Check references in `time_entries` (initial migration line 581),
   `time_sheet_comments` (`202409112215_create_timesheet_comments.cjs:13`), and
   `time_entry_change_requests` (`20260314120000_create_time_entry_change_requests.cjs:12`).
   The last table stores a sheet ID without a sheet FK, so FK discovery alone
   is insufficient. Audit other persisted references before implementation.
5. Use tenant-qualified keys for all cleanup queries and bound literal IDs for
   mutations. Recheck discardability at deletion. Follow
   `20260904120000_enforce_availability_scope_uniqueness.cjs` with
   `exports.config = { transaction: false }`: finish cleanup transactions before
   index DDL. Make cleanup retryable and verify an existing index's definition
   rather than treating a matching name as proof of enforcement.
6. Quiesce sheet writers across REST, UI and background ingestion for the cleanup
   and index window. Separate DML/DDL transactions leave a gap; a concurrent
   duplicate must make index creation fail visibly, never leave the migration
   reported successful without enforcement. Retry after resolving the data.
7. Validate index creation and write rejection on plain PostgreSQL and a real
   tenant-distributed Citus database. Verify coordinator and shard enforcement.
   `down` drops only this index; removed pristine drafts are not resurrected.

```sql
SELECT tenant, user_id, period_id, count(*) AS sheet_count
FROM time_sheets
GROUP BY tenant, user_id, period_id
HAVING count(*) > 1;
```

The current local database needs no cleanup, but the schema permits duplicates
and the reported REST behavior demonstrates that upgraded databases may contain
them. Do not assume production is clean from the local result.

## Implementation and validation checklist

All items below remain unimplemented in this design deliverable.

- [ ] Record the product choice and finalize the duplicate response.
- [ ] Add the transaction lookup and selected response in `TimeSheetService.create()`.
- [ ] Add conservative cleanup, the unique index, and resolver race compatibility.
- [ ] Add database-backed HTTP integration coverage for two POSTs to the real
  route/controller/service chain. Use a fresh period with no preseeded sheet,
  valid caller and create permission. Assert first 201, second 409 with the
  exact documented code/message (or approved 200 reuse), and exactly one row
  for the tenant/effective-owner/period. Mix omitted and explicit self
  `user_id`. The stored ID and status must be unchanged.
- [ ] Extend `server/src/test/integration/api/timeSheetService.createUpdate.integration.test.ts`
  for concurrent creates using independent transactions/connections and a
  deterministic synchronization point at the insert boundary. Assert one
  persisted row, one creation-only event, and the approved result for the loser.
  Cover an existing non-DRAFT sheet and delegated target ownership; a caller
  lacking delegation still receives 403 before duplicate detection.
- [ ] Exercise independence: another user in the same period, the same user in
  another period, and identical user/period UUIDs in another tenant can each
  create a sheet. A direct duplicate database insert must fail with `23505`.
- [ ] Exercise the UI resolver race against the migrated schema, including use
  from a caller-owned transaction: concurrent calls return the same sheet ID
  without aborting the caller's transaction or resetting state.
- [ ] Add migration integration coverage for clean data, all-pristine duplicate
  groups, a meaningful sheet plus pristine extras, and multiple meaningful
  sheets. Verify preservation of entries/comments/change requests, refusal of
  ambiguous cleanup before writes, repeatability after partial completion, and
  actual index enforcement. Run the migration and insert/concurrency cases on
  both plain PostgreSQL and distributed Citus. Do not substitute source-text
  assertions for executing the migration.
- [ ] Document the selected contract in `docs/api/CHANGELOG.md`: affected POST,
  logical key including tenant and effective owner, first/duplicate statuses,
  exact conflict body or reuse behavior, client recovery, and preservation of
  existing sheet state. Add the corresponding operation description and
  response in `server/src/lib/api/openapi/routes/workManagementV1.ts:465` and
  `responsesFor()` at 627. Currently no duplicate-specific response is declared.

For the HTTP integration suite, keep persistence, transaction behavior,
controller response serialization and middleware real. The existing create/update
suite mocks the known-broken creation publisher at lines 17–25; that transport
boundary can also be stubbed for the in-process HTTP regression, with event
counts asserted. A service-only exception assertion does not prove POST status.
The existing API E2E harness in `server/src/test/e2e/api/time-sheets.e2e.test.ts`
is also available for live HTTP checks once the publisher permits that path.
Use an isolated test database with migrated schema; `createTestDbConnection()`
can recreate databases and must not target the wired application database.

## Scope boundaries and known adjacent issues

This plan changes duplicate sheet creation and its integrity guarantees. It does
not change time period materialization, approval transitions, time entry billing,
REST action routing, or general RBAC behavior.

The following findings were left untouched:

- `TimeSheetService.ts:381` explicitly records a known unregistered
  `TIME_SHEET_CREATED` publication defect (alga-2026-0002675). Its failure occurs
  after commit and can prompt retries, which further motivates duplicate safety.
  Repairing the event catalog/transport is separate work.
- `packages/scheduling/src/actions/inboundActions.ts:295` has another
  lookup-then-insert path; its insert at 308 still writes absent
  `created_at`/`updated_at` columns. The unique index will protect data, but
  repairing ingestion timestamps and its retry UX is separate work. Assess
  index compatibility during implementation without folding unrelated fixes in.
- `server/src/lib/api/schemas/timeSheet.ts:47` accepts `notes`, while the sheet
  schema has no notes column. This is separate from duplicate prevention.
- The checkout already has an unrelated modification to `package-lock.json`.
  It is excluded from the plan commit.

No application code, schema, API changelog, or tests were changed or executed for
this design. Verification comprised source inspection and read-only local
schema/data queries. Production and distributed Citus data were not inspected.
