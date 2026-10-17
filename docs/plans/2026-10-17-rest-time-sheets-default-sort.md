# REST `GET /api/v1/time-sheets` default sort: implementation plan

- Card: 85f0167a-5199-4004-ac48-1b190706a5a5
- Sources: GitHub #3205 (reporter hodyhq), AlgaPSA ticket alga0002285
- Branch: `feature/rest-get-api-v1-time-sheets-500s-internal-config` (base `7e8d87a948`)

## 1. Root cause (verified)

`time_sheets` has never had a `created_at` column. It was created in
`server/migrations/202409071803_initial_schema.cjs:549-563` with these columns:
`tenant, id, user_id, period_id, approval_status, submitted_at, approved_at, approved_by`.
The only later change, `20241019194900_update_time_period_fields_to_timestamp.cjs:46`,
alters `submitted_at` and `approved_at` and adds nothing. I also checked the live
`alga-psa-local-test` database through pgbouncer :6472; `information_schema.columns`
lists only those eight columns.

When `GET /api/v1/time-sheets` is called without `?sort=`, the request never gets past
the default ORDER BY:

1. `server/src/lib/api/schemas/common.ts:20`: `paginationQuerySchema.sort` defaults to
   `'created_at'`. `timeSheetListQuerySchema` (`schemas/timeSheet.ts:73`) is built from it with
   `createListQuerySchema`, so the controller always receives `sort='created_at'`.
2. `server/src/lib/api/controllers/ApiBaseController.ts:257-258`: `ApiTimeSheetController` inherits
   `list()` from here. It uses `validatedQuery.sort`, and falls back to `'created_at'` if that is missing.
3. `server/src/lib/api/services/TimeSheetService.ts:226-228`:
   `const sortField = options.sort || 'created_at'` is followed by
   `query.orderBy(\`time_sheets.${sortField}\`, ...)`. The caller's string goes straight into a
   column reference with no allowlist.
4. Postgres raises `42703 undefined_column`. `apiMiddleware.ts:~590` maps that error to
   `INTERNAL_CONFIGURATION` (500).

This happens on every tenant. It is a code defect, not hosted schema drift.

### Every site that assumes `time_sheets.created_at` on the read path

| Site | Effect |
|---|---|
| `TimeSheetService.ts:115` (`defaultSort: 'created_at'`) | Wrong BaseService default. |
| `TimeSheetService.ts:226` (`options.sort \|\| 'created_at'`) | The failing ORDER BY. |
| `ApiBaseController.ts:258` + `schemas/common.ts:20` | Inject `'created_at'` for every resource (shared layer). |
| `GET /api/v1/time-sheets/search` (`app/api/v1/time-sheets/search/route.ts`) | Calls `controller.list()`, so it **fails the same way**. |
| `GET /api/v1/time-sheets/export` (`ApiTimeSheetController.ts:881`) | Calls `timeSheetService.list({}, …)`, so the sort is undefined, falls to `'created_at'`, and **fails the same way**. |
| `GET /api/v1/time-sheets/{id}/entries` | Not affected. It orders `time_entries.start_time` (`TimeSheetService.ts:1394`), which exists. |

### Further defects in the same `list()` method (found during inspection)

- **Filters are silently dropped.** `ApiBaseController.list()` passes filters as `options.filters`
  (`ApiBaseController.ts:271-272`). `TimeSheetService.list(options, context, filters?)` only reads
  its third argument, which this path never supplies. As a result `?user_id=`, `?approval_status=`
  and the other filters have no effect, and the endpoint returns every sheet in the tenant.
- **Duplicate `time_periods` join.** Once filters are honoured, any `period_*` filter
  inner-joins `time_periods` (lines 159-176), and the code then left-joins `time_periods`
  again without a condition (line 197). Postgres raises `42712` ("table name specified more than
  once"), which is another 500. The `query.toString().includes('time_periods')` check only
  removes duplicates among the filter branches.
- **Non-deterministic pagination.** Any sensible default key (the period) is shared by every
  user's sheet for that period. Without a unique tie-break, LIMIT/OFFSET pages can repeat or skip
  rows.

These are in scope (§2, step 3) because they are in the method being fixed, and the endpoint is
not usable until they are fixed.

## 2. The fix

### Decision: sort on the joined period, using an allowlist like the tickets list

`list()` already left-joins `time_periods` and returns `period_start` and `period_end`. A time sheet
is identified by its period, and that is how the UI orders sheets. The default is therefore
**`period_start DESC`, then `time_sheets.id DESC`** as the unique tie-break.

Adding a `created_at` column with a migration was rejected. Backfilling it would stamp every
existing sheet with the migration timestamp, which is a fabricated value. Postgres cannot recover
real creation times, and the card explicitly asks for an existing column.

This follows the existing precedent in `TicketService.ts:167-201`
(`TICKET_LIST_API_SORT_SQL` + `TICKET_LIST_API_SORT_ALIASES` + `resolveTicketListApiSort` throwing
`ValidationError`) and its OpenAPI enum (`openapi/routes/workManagementV1.ts:84-110`).

### Step 1: sort resolver (`TimeSheetService.ts`)

```ts
type TimeSheetSortSpec = { column: string; nullable?: boolean };

const TIME_SHEET_LIST_SORT_SQL: Record<string, TimeSheetSortSpec> = {
  period_start:    { column: 'time_periods.start_date' },
  period_end:      { column: 'time_periods.end_date' },
  submitted_at:    { column: 'time_sheets.submitted_at', nullable: true },
  approved_at:     { column: 'time_sheets.approved_at',  nullable: true },
  approval_status: { column: 'time_sheets.approval_status' },
};
// The shared list schema/controller inject 'created_at' when the caller omits ?sort=.
// time_sheets has no created_at; treat it as the legacy alias of the default.
const TIME_SHEET_LIST_SORT_ALIASES: Record<string, string> = { created_at: 'period_start' };
export const TIME_SHEET_LIST_SORT_KEYS = Object.keys(TIME_SHEET_LIST_SORT_SQL).sort();
export const TIME_SHEET_LIST_DEFAULT_SORT = 'period_start';

export function resolveTimeSheetListSort(sort: string | undefined): { field: string; spec: TimeSheetSortSpec } {
  const requested = sort ?? TIME_SHEET_LIST_DEFAULT_SORT;
  const field = TIME_SHEET_LIST_SORT_ALIASES[requested] ?? requested;
  const spec = TIME_SHEET_LIST_SORT_SQL[field];
  if (!spec) throw new ValidationError(`Unknown sort field: ${requested}. Supported values: …`);
  return { field, spec };
}
```

- `ValidationError` comes from `apiMiddleware` (400 `VALIDATION_ERROR`), the same import TicketService uses.
- Change the constructor to `defaultSort: TIME_SHEET_LIST_DEFAULT_SORT`.
- Put `// LEVERAGE: pattern api-list-sort-allowlist`
  at the resolver. This is the fifth hand-rolled sort allowlist: Ticket, Financial, ContractLine, Team, and now TimeSheet.
  Add `// LEVERAGE: friction list-default-sort-created-at` at `schemas/common.ts:20` and
  `ApiBaseController.ts:258`. Those lines hard-code a column that not every table has. Do not change them in this card.

### Step 2: apply the sort in `list()`

Replace lines 225-228 with:

```ts
const { spec } = resolveTimeSheetListSort(options.sort);
const direction = options.order === 'asc' ? 'asc' : 'desc';
query.orderBy(spec.column, direction, spec.nullable ? 'last' : undefined);
query.orderBy('time_sheets.id', direction);   // unique tie-break for stable pagination
```

Resolve the sort **before** any query runs, so a bad `sort` is rejected without touching the database.
NULLS LAST applies to the nullable timestamps, so unsubmitted or unapproved sheets do not crowd the top of a `desc` sort.

### Step 3: honour filters and join `time_periods` once

- At the top of `list()`: `const effectiveFilters = filters ?? (options.filters as TimeSheetFilterData | undefined);`.
- Move the existing `time_periods` left join (line 197) **above** the filter block, so it runs exactly once.
  Then make the four `period_*` branches plain `query.where('time_periods.…', …)` calls and delete the
  `toString().includes` checks. The users/approvers joins stay where they are.
- The count query (`query.clone().clearSelect().clearOrder()`) keeps working unchanged. It now
  includes the left join, which does not multiply rows because `(tenant, period_id)` is the PK of `time_periods`.
- Keys from the shared `baseFilterSchema` (`search`, `created_from`, `is_active`, …) are still ignored,
  as they are today. This plan does not add support for them (see §5).

### Step 4: API contract (schema + OpenAPI)

- `schemas/timeSheet.ts:73` becomes
  `createListQuerySchema(timeSheetFilterSchema).extend({ sort: z.enum([...TIME_SHEET_LIST_SORT_KEYS, 'created_at']).optional().default('period_start') })`.
  The controller then rejects a bad `sort` with a 400 at query validation
  (`ApiBaseController.ts:174-175`). Because the default is now `period_start`, `created_at` is only
  used when a caller sends it explicitly. Keep the service-level resolver as well, because `export()`
  calls `list({})` without going through the schema.
  To avoid importing the service into the schema module, define the key list in a
  shared constant module such as `server/src/lib/api/schemas/timeSheetSort.ts`.
- `openapi/routes/workManagementV1.ts`: register `WorkV1TimeSheetListQuery`, modelled on
  `TicketListQuery`. It should contain the `sort` enum, a description stating the default
  (`period_start` desc, ties broken by id) and the `created_at` alias, and the filter params. Wire it as
  `req.query` for `GET /api/v1/time-sheets` and `/search`, next to the ticket wiring at line ~497.
- Regenerate the SDK spec with `cd sdk && npm run openapi:generate`, and commit the
  `sdk/docs/openapi/alga-openapi*.{json,yaml}` diff.

**Contract and pagination implications**

- Nothing that worked before is broken, because every no-sort and `sort=created_at` call failed with a 500.
- `sort=<any other time_sheets column>` (for example `user_id` or `period_id`) used to "work", since the
  string went straight into the ORDER BY. These now return 400 unless they are in the allowlist.
  This is deliberate: the request is validated up front instead of failing as a database error (see `docs/AI_coding_standards.md`, "Failure Handling Philosophy").
  Raw `id` is not exposed as a sort key; it is only the tie-break.
- The response `meta.sort` will echo `period_start` instead of `created_at`.
- Pages are deterministic because of the `(sort key, id)` ordering.
- Filters that were silently ignored now take effect. A caller who sent `?user_id=X` and got every
  user's sheets (in the unlikely case that worked) will now get only X's sheets. That is the documented behaviour.

## 3. Tests

1. **Unit** (`server/src/test/unit/api/timeSheetListSort.test.ts`), pure, no DB:
   `resolveTimeSheetListSort(undefined)` → `period_start`; `'created_at'` → `period_start`;
   each allowlisted key maps to the expected column; `'bogus'`, `'created_at; drop table x'`,
   `'user_id'` → throw `ValidationError` (statusCode 400). Also `timeSheetListQuerySchema.parse({})`
   → `sort === 'period_start'`, and `.parse({ sort: 'bogus' })` throws a ZodError.
2. **Infrastructure / real DB** (`server/src/test/infrastructure/time-sheets/timeSheetListApiService.test.ts`),
   modelled on `server/src/test/infrastructure/time-periods/timePeriodsApiService.test.ts` (TestContext,
   `getKnex` spy, seeded periods/users). **This is the regression test that would have caught the 500.**
   - Seed two periods and three sheets (two users share the newer period).
   - `service.list({}, ctx)` resolves (no 42703). Rows are ordered newer period first, and the shared-period pair is ordered by id desc.
     `period_start` and `period_end` are populated, and `total === 3`.
   - `service.list({ sort: 'created_at' }, ctx)` gives the same order as the default.
   - `sort: 'submitted_at', order: 'desc'` puts the submitted sheet first and the null rows last.
   - `sort: 'bogus'` rejects with `ValidationError`.
   - `limit: 1` across pages 1-3 returns three distinct ids, with no repeats.
   - `{ filters: { user_id } }` via `options` (the controller shape) returns only that user's sheets.
   - `{ filters: { period_start_from, period_end_to } }` resolves (no 42712) and narrows correctly.
   - `export` path: `service.list({}, ctx)` is the same call, so it is covered by the first case.
3. **HTTP e2e** (`server/src/test/e2e/api/time-sheets.e2e.test.ts`), modelled on
   `time-periods.e2e.test.ts` (`setupE2ETestEnvironment`, `ApiTestClient`):
   `GET /api/v1/time-sheets` returns 200 with paginated data; `?sort=bogus` returns 400 `VALIDATION_ERROR` (not 500);
   `GET /api/v1/time-sheets/search` returns 200; `GET /api/v1/time-sheets/export` returns 200.
   This test needs a running server. CI picks it up through the e2e lane, and locally it runs against the dev server at
   `http://feature-rest-get-api-v1-time-sheets-500s-internal-config.localhost:3000`.
4. **Live smoke** after the change, with an API key on the local stack: `curl` the three GET routes (no
   sort, `sort=approved_at&order=asc`, `sort=nope`) and record the status codes on the card.

## 4. Ordering

1. Write test 1 and test 2 first. Run them and watch test 2 fail with 42703; that is proof of the regression.
2. Step 1 (resolver) and Step 2 (apply). The default-sort and `created_at` cases in test 2 now pass.
3. Step 3 (filters and a single join). The filter cases now pass.
4. Step 4 (schema enum, OpenAPI, SDK regen). Test 1's schema cases pass.
5. Add the e2e test (test 3), then do the live smoke (step 4 of §3).
6. `npm run lint` and typecheck for `server`. Then run the existing time-sheet suites
   (`timePeriodsApiService.test.ts`, `timeSheetService*.test.ts`), which must stay green.
7. Close-out: per the card, close #3205 only after this card **and** the products `currency_code`
   card have both shipped.

## 5. Deliberately NOT done (each should become its own card)

- **REST time-sheet mutations write columns that do not exist.** This is the same class of bug and a separate contract decision.
  `create` writes `created_at` and `updated_at` (`TimeSheetService.ts:305-306`). `update` (355), `submitTimeSheet` (451, plus
  `submission_notes`), `approveTimeSheet` (499, plus `approval_notes`), `requestChanges` (556) and
  `reverseApproval` (635) all write `updated_at` and/or `*_notes` to `time_sheets`, and none of those columns exist.
  Every one of these REST mutations therefore fails with 42703 / INTERNAL_CONFIGURATION. The fix involves a product decision about where notes
  should go (most likely `time_sheet_comments`). **Recommend the XO opens a sibling card.**
- **`TimeSheetService.search()`** defaults to `time_sheets.notes` (line ~1271), which does not exist, and accepts
  arbitrary `fields`. The `/search` route does not call it (it calls `list()`), so it is dead code today. Include it
  in the sibling card.
- **Response schemas** `timeSheetResponseSchema` (`schemas/timeSheet.ts:85-86`) and the with-details variant
  declare required `created_at` and `updated_at`, which the API never returns. This is OpenAPI drift and belongs in the sibling card.
- **Export is capped at 25 rows** (`list({})` uses the default `limit`) and ignores the export query's filters.
  This is a separate correctness bug, recorded but not fixed here.
- **Shared layer:** the global `'created_at'` default in `paginationQuerySchema` and `ApiBaseController.list()`.
  Changing it affects every resource. It gets a LEVERAGE friction marker only. The real fix (each resource
  declares its sortable keys and default, and the base controller enforces them) should go through the `leverage` skill.
- No new `user_name` sort key (it is a CONCAT expression). It can be added later if anyone asks for it.
- No migration and no schema change to `time_sheets`.

## 6. Risks

- **Citus:** `ORDER BY` on a joined, tenant-co-located `time_periods` column with a `tenant` predicate is
  router-executable. There is no cross-shard sort concern beyond what the existing join already has.
- **Callers relying on arbitrary `sort=<column>`** will now get a 400. This is low risk: the endpoint has 500'd with
  the default for its whole life, and the allowlist covers every meaningful column.
- **Filters are now honoured**, which changes result sets for any caller who was passing filters that had no effect.
  This is the intended contract and is called out in the release note / PR body.
- **Base-schema `.extend` typing:** `createListQuerySchema(...)` returns a merged ZodObject, so `.extend`
  is valid. Confirm with `tsc` that `validatedQuery.sort` still narrows to a string in `ApiBaseController`.
- **SDK regen noise:** the regenerated OpenAPI files may include unrelated drift from main. Commit only what
  the generator emits, and mention it in the PR if the diff is wider than expected.
