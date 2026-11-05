# `crm.find_quotes` pagination DoS — design

Card: `9196e6c2-cd9a-55f6-9b00-63ade59b15a6` "Security: dos in registerCrmActions"
Finding: `shared/workflow/runtime/actions/businessOperations/crm.ts#registerCrmActions` (medium, dos)
Step: Design Session (conn — XO desk)

## 1. The defect, confirmed in code

Schema (`crm.ts:305-315` in the pre-fix file) accepts any positive integer `page`:

```ts
page: z.number().int().positive().default(1),
pageSize: z.number().int().positive().max(200).default(25),
```

Handler (`crm.ts:1717-1748`):

```ts
const targetAuthorizedCount = page * pageSize;      // page = 1e9  ->  2.5e10
let sourceOffset = 0;
while (authorizedRows.length < targetAuthorizedCount) {
  const rows = await buildQuery().limit(sourceBatchSize).offset(sourceOffset);
  ...
  for (const row of rows) {
    if (await authorizeQuoteRead(tx.trx, tx.tenantId, tx.actorUserId, row)) {
      authorizedRows.push(row);                      // keeps every admitted row
    }
  }
}
const pageRows = authorizedRows.slice(pageStart, targetAuthorizedCount);
```

Three independent amplifiers, all reachable from one call:

1. **Unbounded target.** `page * pageSize` has no ceiling, so the loop has no defined
   bound and only stops at table exhaustion.
2. **Authorization is O(rows) and re-derives its own subject per row.**
   `authorizeQuoteRead` (`crm.ts:994-1018`) calls `resolveQuoteAuthorizationSubject`
   (three queries: roles, teams, direct reports) and builds a fresh kernel with a
   **fresh** `RequestLocalAuthorizationCache` for *every row*. So a scan of N source
   rows is ~3N lookup queries plus N bundle-rule resolutions.
3. **OFFSET scan.** `offset(sourceOffset)` grows with the page depth, so each batch
   costs more than the last and the DB re-walks the prefix.

Memory: every authorized row is retained before the slice, so the caller's page
number also sets the worker's peak heap.

The result is a one-request amplification: a workflow actor holding `billing:read`
turns one action call into a full-table authorization sweep.

## 2. What we change

### 2.1 Keyset pagination becomes the primary contract

Add a `cursor` input and a `next_cursor` / `has_more` output. The cursor is an opaque,
versioned, base64url JSON payload:

```ts
type QuoteCursor = { v: 1; sortBy: SortBy; order: 'asc' | 'desc'; key: string | number | null; id: string };
```

The scan key is the sort column followed by `quote_id`, which is already the
tiebreaker in `buildQuery()`, so the ordering stays total and stable. The next page
query becomes:

```
WHERE (sortCol, quote_id) > (cursor.key, cursor.id)   -- direction per sortOrder
ORDER BY sortCol <dir>, quote_id ASC
LIMIT batch
```

with explicit null handling (`NULLS LAST` for `desc` date sorts) because `quote_date`
and `valid_until` are nullable — a keyset over a nullable column that ignores null
ordering silently skips rows. The existing filters and `where is_template` clause are
unchanged.

Each invocation reads **one bounded window**: `batch = min(pageSize * 2, 200)` raw
rows at a time, stopping as soon as it has `pageSize` authorized rows. It never reads
past the window it needs, and it never holds more than one batch plus the page.

### 2.2 One authorization subject and one kernel per invocation

Hoist `resolveQuoteAuthorizationSubject` and `createQuoteAuthorizationKernel` out of
`authorizeQuoteRead` and pass them in:

```ts
const authz = await createQuoteReadAuthorizer(tx.trx, tx.tenantId, tx.actorUserId);
// authz.authorize(row) -- reuses subject + kernel + RequestLocalAuthorizationCache
```

This is a pure refactor of the helper's call shape; the decision itself stays the same
kernel call with the same record projection. It removes 3N–4N redundant queries from
every `find_quotes` call, which matters independently of the DoS.

### 2.3 A hard scan budget (defense in depth)

Two constants, both enforced in the handler and both returning a typed error rather
than an empty page:

- `MAX_SOURCE_ROWS_PER_REQUEST = 1000` — raw rows read from `quotes` in one call.
- `MAX_AUTHORIZED_ROWS_PER_REQUEST = pageSize * 4` (hard cap 800) — rows evaluated
  through the authorization kernel.

Exceeding either raises `PAGINATION_DEPTH_EXCEEDED` (`ActionError`, retryable=false,
`details.next_cursor` when a cursor exists at the boundary, else null):
"this page is beyond the depth this action scans in one request; continue from
`next_cursor`". The `page` schema also gains `.max(10_000)` so absurd values are
rejected by validation before any query runs.

### 2.4 Legacy `page` stays, but is bounded

`page` without a cursor is served by walking the keyset internally from the start,
stopping at `(page - 1) * pageSize`. That preserves the current contract for existing
workflows and the UI while making deep pages impossible: once the walk hits the budget
it returns `PAGINATION_DEPTH_EXCEEDED` instead of scanning. `page` and `cursor`
together is a validation error (`page must be 1 when cursor is supplied`).

`on_empty`, filter semantics, `first_quote`, `count`, and `pagination.page` /
`pagination.page_size` keep their current shapes; `pagination` gains
`next_cursor: string | null` and `has_more: boolean`. Output changes are additive.

## 3. Tests (the deliverable is not done without them)

1. **Regression for the finding.** `page = 1_000_000` with no cursor returns
   `PAGINATION_DEPTH_EXCEEDED`, and the run reads at most `MAX_SOURCE_ROWS_PER_REQUEST`
   rows (assert with a query counter / `knex.on('query')` row-count instrumentation,
   not wall-clock).
2. **Keyset equivalence.** Seed ~60 quotes across two clients; walking with
   `pageSize = 25` and cursors returns exactly the same ordered ids as legacy pages
   1–3 over the same authorized subset.
3. **Authorization preserved.** Quotes for a client outside the caller's bundle are
   excluded on both paths, and the in-bundle quote still appears on the page where it
   belongs (guards against a cursor that leaks past the filter).
4. **One subject per request.** Spy/count `resolveQuoteAuthorizationSubject` (exported
   for the test or injected) and assert it is called once per `find_quotes` call, not
   per row — this is what keeps the fix from regressing to 3N lookups.
5. **Cursor tampering.** A malformed, unknown-version, or sort-mismatched cursor is a
   `VALIDATION_ERROR`, never a scan and never a silent page-1 reset.
6. **Existing suite.** `find_quotes` tests for filters, `on_empty`, `is_template`, and
   `pageSize` bounds continue to pass; the schema refine (`crm.ts:340-346`) is untouched.

## 4. Deliberately NOT doing

- **Not compiling authorization into SQL in this card.** The suggested fix asks for
  "SQL-compiled authorization", but the quote authorization kernel
  (`createQuoteAuthorizationKernel`, `crm.ts:928-936`) exposes only per-record
  `authorizeResource` decisions; bundle narrowing is resolved per subject at decision
  time. A SQL scope compiler would be a new engine capability that must stay exactly
  consistent with that kernel — the kind of change that needs its own design and its
  own equivalence tests, not a rider on a medium DoS fix. The keyset window plus the
  per-request budget removes the amplification the finding describes: a full-table
  sweep now costs N/batch requests (each individually cheap and rate-limitable) rather
  than one. Recorded as a follow-up candidate rather than silently skipped.
- **Not changing bundle/RBAC semantics, filters, or the `quoteDetailSummary` shape.**
- **Not adding rate limiting here.** That is a transport/policy concern and belongs
  above the action layer; the budget above is the action-layer floor.

## 5. Order of work

1. Cursor codec + keyset `buildQuery(cursor)` in `crm.ts` (local helpers, unit-tested).
2. Hoist the authorizer (§2.2) — pure refactor, no behaviour change; run the existing
   suite here to prove it.
3. Replace the accumulation loop with the windowed walk + budget errors (§2.3, §2.4).
4. Output schema: add `next_cursor`, `has_more`.
5. Tests §3, then the full `shared/workflow` typecheck and the touched test files.

## 6. Risks

- **Null sort keys** (`quote_date`, `valid_until`, `total_amount`) — handled explicitly
  with `NULLS LAST`/`NULLS FIRST` per direction; test 2 seeds nulls deliberately.
- **Cursor stability under concurrent writes** — keyset is *more* stable than OFFSET
  (no skip/duplicate on insert), but a row edited so its sort key moves can appear
  twice across pages. Accepted: documented in the action's `ui.description`.
- **Callers reading `pagination.page`** — unchanged for the legacy path; cursor pages
  report `page: 1` and rely on `next_cursor`.

## Draft implementation outcome

- PSA spec outcome: `linked` (`alga-2026-0003026`; the workflow card already records
  `state.psaSpecOutcome=linked`).
- Draft status: keyset pagination, request scan/authorization budgets, and per-call
  authorization context reuse are implemented in `crm.ts`; behavioral regression
  coverage is in `businessOperations.crm.db.test.ts`.
- Verification: the isolated CRM DB test file passed 14/14; ESLint completed with
  no errors (existing warnings remain); a scoped TypeScript check covering the
  changed implementation and DB test passed. A full server typecheck was attempted
  but exceeded Node's 4 GB heap limit.
- Verification note: `psa-spec-outcome-recorded` previously exited 1 without output.
  The workflow card records that its command checks a literal `{{state.psaSpecOutcome}}`
  case expression without substituting state, so rerunning it cannot verify the
  existing `linked` record. The recorded outcome was rerun with the state explicitly
  substituted (`case linked in linked|skipped-no-ticket|skipped-no-spec`) and passed;
  the workflow verification attempt is recorded on the Draft Implementation run.
  The underlying template interpolation defect remains for the workflow maintainer.
- First review: cursor boundary behavior for nullable sort keys and authorization
  exhaustion cursors; confirm the workflow verifier fix separately.
