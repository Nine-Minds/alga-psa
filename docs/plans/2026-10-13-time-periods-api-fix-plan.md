# Time Periods API fix plan

Card b093c1b9 · PSA ticket alga-2026-0002689 · branch `feature/time-periods-api-post-api-v1-time-periods-500s-i`
(base: `origin/main` @ d6dc22c273, which already contains #3661, so no rebase is expected).

## Problem

`/api/v1/time-periods` is broken in four ways:

1. **POST always returns 500.** `createTimePeriodSchema` defaults `is_current` to `false`. `TimeSheetService.createTimePeriod` then spreads the parsed body into the `time_periods` insert, but `time_periods` has no `is_current` column. PUT fails the same way when a client sends `is_current`.
2. **The response contract is false.** `timePeriodResponseSchema` and the time sheet `time_period` sub-object declare `is_current: boolean` as required, but no read path returns it. The DATE columns are serialized as server-local-midnight timestamps (`"2026-08-16T04:00:00.000Z"` on an America/New_York host; see `~/.alga-xo/reviews/feature-3206-time-period-end-date/evidence/smoke/14-api-get-period.json`). On a host east of UTC that becomes the previous day.
3. **Close and reopen do nothing to the period.** Both routes call `ApiTimeSheetController.update()`, the time *sheet* update flow, with a period id.
4. **Dead and wrong code, plus a bad date contract.** `generateTimePeriods` has no route and produces inclusive-end periods with one-day gaps. `dateSchema` requires full datetimes for DATE columns, so the OpenAPI text's own `end_date 2026-08-23` example is rejected.

## Code facts the plan relies on

| Fact | Where |
|---|---|
| `time_periods` columns: `tenant, period_id, start_date DATE, end_date DATE, is_closed bool default false, created_at, updated_at`. `type_id` was dropped by `20241012014248`. | `server/migrations/202409071803_initial_schema.cjs:516`, `20251214120000_time_entry_work_date.cjs:56-60` |
| `is_closed` is never read or written anywhere in app code. Every row is `false` unless someone hand-edited it. | `git grep is_closed` (only ticket/project/interaction statuses) |
| A model layer already does whitelisted, half-open, tenant-scoped writes: `TimePeriod.create/update/findOverlapping/findById/isEditable`. The API service re-implements all of it with `...data` spreads. | `packages/scheduling/src/models/timePeriod.ts:69-208` |
| The UI update path refuses edits when the period has time sheets (`isEditable`). The API PUT path has no such check. | `packages/scheduling/src/actions/timePeriodsActions.ts:611`, vs `TimeSheetService.ts:773-823` |
| pg has no type parser for DATE (OID 1082), so DATE comes back as a JS `Date` at server-local midnight. | `packages/db/src/lib/knexfile.ts:27-29` |
| The controller takes the id from the last URL segment (`req.url.split('/')`). For `/close` that segment is `"close"`, so new methods must read `req.params`. | `ApiTimeSheetController.ts:1091-1093` (same pattern at 1322, 1395) |
| `createUpdateSchema` is `.partial()`, so PUT only injects `is_current` when the client sends it. | `server/src/lib/api/schemas/common.ts:129-132` |
| `common.dateSchema` is `z.string().datetime().optional()`, so create currently treats `start_date`/`end_date` as optional at the schema level. | `common.ts:13` |
| A source-text contract test pins the old insert line (`const [period] = await tenantDb(trx, context.tenant).table('time_periods')`). | `server/src/test/unit/api/timeSheetServiceCommentsPeriodsTenantScoped.contract.test.ts:27` |

## Decisions

- **D1. Writes go through the `TimePeriod` model.** The model is the column whitelist. The API service calls `TimePeriod.findOverlapping`, `create` and `update` instead of its own spreads. This also removes a duplicate of the half-open overlap rule.
- **D2. `is_current` is derived on read, not dropped.** It is computed as `start_date <= today < end_date`, where `today` is the UTC calendar date (`new Date().toISOString().slice(0,10)`), the same "today" `getCurrentTimePeriod` already uses. It is not tenant-timezone aware, which matches the existing `/current` behaviour. On input, `is_current` is **accepted and ignored** for backward compatibility. It stays in the schema as `z.boolean().optional()` with no default, is described as "Ignored; derived on read", and never reaches the model.
- **D3. Dates on the wire are `YYYY-MM-DD`.** Both input and output use date strings. Input accepts `YYYY-MM-DD` or an RFC 3339 datetime. A datetime is **truncated textually** to its first 10 characters, which is the calendar date the client wrote, not its UTC date. Every input is validated as a real calendar date with `Temporal.PlainDate.from`. Output always uses `YYYY-MM-DD`. `end_date` stays exclusive, with #3661's wording kept verbatim.
- **D4. Real close/reopen.** New `TimePeriod.setClosed(trx, tenant, id, closed)` → `TimeSheetService.closeTimePeriod/reopenTimePeriod` → new controller methods `closeTimePeriod()/reopenTimePeriod()`. They use the same API-key, tenant, internal-user and manual-product-access gates as `updateTimePeriod`, plus the **`time_period:update`** permission. Both are idempotent: closing an already-closed period returns 200 with the current state, and an unknown id returns 404. Both return the period in the D2/D3 shape.
- **D5. What "closed" blocks.** While a period is closed, **date edits (PUT) and deletion are rejected with 409** (`Time period is closed; reopen it first`). The rule is enforced in both entry points: the API service, and the UI server actions `updateTimePeriod`, `deleteTimePeriod` and bulk delete in `timePeriodsActions.ts`. A rule that holds on only one path is not a rule. Closing does **not** block time entries, time sheet submit/approve, or overlap checks: a closed period still occupies its date range. Locking time entry to a closed period is a separate product decision (see Out of scope). Today the rule only fires for periods closed through the API, because the UI cannot close a period.
- **D6. API PUT matches the UI: reject date edits on periods with time sheets (409).** This uses the same `TimePeriod.isEditable` guard. Moving a period's bounds under existing time sheets leaves their entries outside the period. The UI already forbids it, and the API was the hole. *This goes slightly beyond the brief; captain may veto, and it is one guarded line to drop.*
- **D7. Delete `generateTimePeriods` from the API layer.** It has no route, and its semantics (inclusive end, +1-day step) are wrong. The product already has a correct generator: `timePeriodsActions.generateTimePeriods` and `ensureTimePeriodCoversDate`, driven by `time_period_settings`. A second generator is pure duplication. No route is wired.
- **D8. No migration.** All required columns exist. `is_current` is never stored.

## Changes

### 1. Schemas: `server/src/lib/api/schemas/timeSheet.ts`

- Add `timePeriodDateInputSchema` (local to this file, or in `common.ts` next to `isoDateSchema:14` if a second caller appears). It is `z.union([isoDateSchema, z.string().datetime({ offset: true })])`, transformed to `value.slice(0,10)` and refined with a `Temporal.PlainDate.from` validity check. Add an output `timePeriodDateSchema = isoDateSchema`.
- `:124-128` `createTimePeriodSchema`: `start_date: timePeriodDateInputSchema` (required), `end_date: timePeriodDateInputSchema.describe(TIME_PERIOD_END_DATE_DESCRIPTION)` (required), `is_current: z.boolean().optional().describe('Ignored. is_current is derived from the dates on read; accepted for backward compatibility.')`. Add a refine that `start_date < end_date` so the 400 comes from validation.
- `:130` `updateTimePeriodSchema`: stays `createUpdateSchema(...)`. The refine moves to a `superRefine` that only fires when both dates are present. The service re-checks against stored values.
- `:132-143` `timePeriodResponseSchema`: dates → `timePeriodDateSchema`. Keep `is_current: z.boolean()`, now true. Add `is_closed: z.boolean()`. Add `duration_days`, `week_number`, `month_name` and `year` as optional, since they are already returned.
- `:95-100` time sheet `time_period` sub-object: same date and `is_current` treatment, and add `is_closed`.
- `:274-279` remove `generateTimePeriodsSchema`, and `:372` remove `GenerateTimePeriodsData` (D7). Keep `timePeriodFrequencySchema`, which settings still use.
- `dateSchema` is still imported for the list filters (`:48-51`). Those filters compare against DATE columns too, but changing them is out of scope.

### 2. Model: `packages/scheduling/src/models/timePeriod.ts`

- `update` (`:177-208`): also set `updated_at: knex.fn.now()`, which neither path sets today.
- Add `setClosed(knexOrTrx, tenant, periodId, closed): Promise<ITimePeriod | null>`. It updates `is_closed` and `updated_at`, uses `returning('*')`, and returns `null` when there is no row.
- Add `is_closed?: boolean` to `DbTimePeriod` (`:10-15`) and to `ITimePeriod` in `packages/types/src/interfaces/timeEntry.interfaces.ts:99-103`. It is optional so existing constructors still type-check.
- Leave `// LEVERAGE: friction pg-date-parsing`, because `fromDbDate` (`:35-40`) uses `toISOString().slice(0,10)` on a local-midnight `Date`. That is wrong on hosts east of UTC, and so is the API service's version. The real fix is a global 1082 type parser (see Risks). It is not fixed here.

### 3. Service: `server/src/lib/api/services/TimeSheetService.ts`

- New private `toApiTimePeriod(row, today)`. It normalizes `start_date`/`end_date` to `YYYY-MM-DD`: strings pass through, and `Date` values are formatted with **local** getters, which correctly reverses pg's local-midnight construction. It derives `is_current` with string comparison (`start <= today && today < end`). It computes `duration_days`, `week_number`, `month_name` and `year` from `Temporal.PlainDate`, not `new Date()`. It returns `is_closed: !!row.is_closed`. New private `todayUtc()`, which `getCurrentTimePeriod` (`:693`) also uses.
- `getTimePeriods` (`:682-688`): map rows through `toApiTimePeriod`. Today it returns raw rows with no derived fields at all.
- `getTimePeriod` (`:707-730`): replace the ad hoc mapping with `toApiTimePeriod`. `getWithDetails` (`:234`) and `getCurrentTimePeriod` (`:703`) both go through it, so the time sheet sub-object and `/current` pick this up for free.
- `createTimePeriod` (`:733-770`): use the inputs already normalized by the schema. `TimePeriod.findOverlapping(trx, tenant, start, end)` returns 409. `TimePeriod.create(trx, tenant, { start_date, end_date })` uses explicit fields only. Return `getTimePeriod(id)` **using `trx`**: thread an optional knex through `getTimePeriod` so the read happens inside the same transaction, because today the read uses a separate connection. Delete the `...data` spread.
- `updateTimePeriod` (`:773-823`): load with `TimePeriod.findById(trx, …)` (404). Then reject if `is_closed` (409, D5). Then, if dates are changing, reject when `!TimePeriod.isEditable` (409, D6). Then check `TimePeriod.findOverlapping(..., excludeId)` (409) and validate `start < end` against the merged values (400). Then `TimePeriod.update(trx, tenant, id, { start_date?, end_date? })`. Delete the `...data` spread. A body that is only `{ is_current }` (or empty) is a no-op that returns the current period with 200.
- `deleteTimePeriod` (`:826-855`): add the closed-period 409 before the existing time sheet check.
- New `closeTimePeriod(id, ctx)` / `reopenTimePeriod(id, ctx)` → `setTimePeriodClosed(id, closed, ctx)`. These run in a transaction, use `TimePeriod.setClosed` (404 on null), and return `getTimePeriod`.
- Delete `generateTimePeriods` (`:858-886`) and `calculatePeriodEnd` (`:1496-1521`). Drop the `GenerateTimePeriodsData` import (`:25`). Delete `getWeekNumber` (`:1490`) too if `toApiTimePeriod` replaces its only caller.

### 4. Controller: `server/src/lib/api/controllers/ApiTimeSheetController.ts`

- Add `closeTimePeriod()` and `reopenTimePeriod()`, built like `updateTimePeriod()` (`:1274-1352`) with the same gates and `time_period:update`. Read the id from `await req.params` (`{ id }`), not the URL tail, validate it with `uuidSchema` (400), and call the new service method. They do not read a body. They return `createSuccessResponse(period)` (200).
- Delete `generateTimePeriods()` (`:1423-1505`) and the `generateTimePeriodsSchema` import (`:25`).
- `// LEVERAGE: pattern api-key-auth-preamble`: each of the roughly 25 methods in this file repeats the same ~30-line API-key, tenant, user and RBAC preamble, and the two new methods add two more copies. Do not extract it here.

### 5. Routes

- `server/src/app/api/v1/time-periods/[id]/close/route.ts:15` → `controller.closeTimePeriod()(req)`.
- `server/src/app/api/v1/time-periods/[id]/reopen/route.ts:15` → `controller.reopenTimePeriod()(req)`.

### 6. Server actions (D5 parity): `packages/scheduling/src/actions/timePeriodsActions.ts`

- In `updateTimePeriod` (~`:605`), `deleteTimePeriod` (~`:478`) and bulk delete (~`:548`), after `findById`, throw a user-facing error when `period.is_closed`. Use the existing `timePeriodActionErrorFrom` mapping and add an i18n key `msp/time-entry:errors.timePeriod.closed` (en, plus the other locales with English placeholder text, following repo convention).

### 7. OpenAPI: `server/src/lib/api/openapi/routes/workManagementV1.ts`

- `:409` create: "Creates a time period. start_date/end_date accept YYYY-MM-DD (datetimes are truncated to their date). is_current is ignored on input and derived on read. Returns 409 when it overlaps an existing period; periods that touch (one's end_date equals the next's start_date) are allowed." Keep the #3661 exclusive-end sentence.
- `:410` current: "Returns the period containing today (UTC) or ?date=, via getCurrentTimePeriod(). When no period covers today it may materialize one from time period settings."
- `:413` update: mention 409 for closed periods and for periods with time sheets, and that `is_current` is ignored.
- `:411` delete: mention 409 when closed or when time sheets exist.
- `:414-415` close/reopen: "Sets is_closed true/false (idempotent). A closed period rejects edits and deletion until reopened; time entry is not affected."
- `:440-442`: remove the three time-period ops from `mismatchOps`.
- `:507`: give `post /api/v1/time-periods` and `put /api/v1/time-periods/{id}` real body schemas (registered from `createTimePeriodSchema`/`updateTimePeriodSchema`) instead of `GenericBody`, and give close/reopen no body. If 409 is not already added for these ops in `responsesFor`, add it.
- Regenerate the artifacts: `npm --prefix sdk run openapi:generate` (`sdk/docs/openapi/*.json|yaml`, `docs/openapi/*`) and `npm run mcp:registry:generate` (`ee/server/src/chat/registry/apiRegistry.generated.ts`).

## Tests

**Integration, new file `server/src/test/infrastructure/time-periods/timePeriodsApiService.test.ts`.** Real DB, `TestContext`, exercising `TimeSheetService` directly:

1. Create with date-only input: returns the period, the row is persisted, and there is no column error. Create with a datetime input truncates it (`2026-08-16T23:30:00-05:00` → `2026-08-16`). Create with `is_current: true` in the body is ignored and does not error.
2. Overlap returns 409. A touching period (`end_date == next.start_date`) is accepted. `start >= end` returns 400. An invalid calendar date (`2026-02-30`) returns 400 from the schema.
3. PUT with and without `is_current` succeeds and persists only the dates. PUT on a period with time sheets returns 409. PUT and DELETE on a closed period return 409.
4. Close then reopen flips `is_closed` in the DB, and both are idempotent. An unknown id returns 404.
5. `is_current` at the boundaries, with time frozen: `today == start_date` → true, `today == end_date - 1` → true, `today == end_date` → false.
6. Response shape: `start_date`/`end_date` are `YYYY-MM-DD`, `timePeriodResponseSchema.parse(result)` passes, and the time sheet `getWithDetails().time_period` passes the sub-schema.

**Schema unit tests in `server/src/test/unit/api/`:** the input normalizer accepts both formats, rejects garbage, and ignores `is_current`.

**E2E in `server/src/test/e2e/api/time-periods.e2e.test.ts`,** modelled on `time-entries.e2e.test.ts` (`ApiTestClient`, `grantTestUserPermission`): POST 201 → GET shows it, close/reopen round-trip, and 403 without `time_period:update`.

**Contract test update:** `timeSheetServiceCommentsPeriodsTenantScoped.contract.test.ts:27`. Replace the pinned insert line with assertions that the periods section has no `...data` spread into `time_periods` and that it uses `TimePeriod.`. Keep the tenant-scoping assertions.

**Existing suites must stay green:** `server/src/test/infrastructure/time-periods/*.test.ts` and the scheduling unit tests (`packages/scheduling`).

**Live check on devOrigin `:3808`, with an API key:** POST `{"start_date":"2026-11-01","end_date":"2026-11-08"}` → 201 with `is_current:false` and date-only fields. GET by id and list both show it. POST `/close` → `is_closed:true`, PUT → 409, `/reopen` → PUT succeeds.

## Out of scope

- Blocking time entries or time sheet transitions in closed periods. That needs a product decision, and would mean touching `timeEntry`/`timeSheet` actions and the UI. File it as a follow-up.
- Any UI for close/reopen or for showing closed state.
- Tenant-timezone-aware "today" for `is_current` and `/current`.
- The global pg DATE type parser (see Risks), and the `fromDbDate` east-of-UTC bug in the model. A LEVERAGE marker is left for both.
- The `period_start_*`/`period_end_*` time sheet list filters, which still use the `dateSchema` datetime.
- Extracting the controller auth preamble (LEVERAGE marker only).

## Risks

- **Response date format changes** from `"2026-08-16T04:00:00.000Z"` to `"2026-08-16"`. This is a visible contract change. The old value was host-timezone-dependent and contradicted the docs' own example, and POST never worked, so no write clients exist. A read client parsing with `new Date()` still works, though it gets UTC midnight. Call it out in the PR and release notes.
- **D5 adds new 409s to the UI** only for rows with `is_closed = true`. No code path has ever set that flag, but a hand-edited row would become uneditable in the UI until reopened through the API. Check before merge: `select count(*) from time_periods where is_closed` on a prod replica. If it is non-zero, decide whether to reset those rows first.
- **D6 is a new restriction on API PUT.** It matches the UI, but it is a behavior change for any client that edits periods that have time sheets. It is easy to drop if the captain prefers.
- **Local-getter date formatting** assumes the pg driver builds DATE values as local midnight, which is the driver default with no 1082 parser. If someone later adds a 1082 parser that returns strings, the string branch handles it. If they add one that returns UTC-midnight `Date`s, the local getters would be off by a day west of UTC. The helper has a unit test pinning both branches.
- **Generated OpenAPI and chat-registry artifacts** must be regenerated or CI drift checks fail.
- **Deleting `generateTimePeriods`** removes a public-looking controller method, but nothing references it: no route, no test, no registry entry.
