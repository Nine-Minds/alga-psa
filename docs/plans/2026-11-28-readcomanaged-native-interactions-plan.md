# Bound co-managed interaction reads: SQL keyset pagination instead of materialising the whole table

Status: design for review · card `b5485bd5-83c2-5a5d-ad62-ccdf9e772bef` · PSA alga-2026-0003031

Security finding `dos · medium`: `readCoManagedNativeInteractions` selects every interaction id for the tenant,
authorises and materialises every row, then sorts and slices for the requested page. A page‑1 / pageSize‑10
request therefore does work proportional to the entire interaction history.

## 1. Problem (verified at `292280a750`)

- `packages/co-managed/src/nativeInteractionRead.ts:38-40` selects the whole `interactions` table
  (`orderBy('interaction_id')` then `select('interaction_id')`) without applying any caller filter.
- `packages/co-managed/src/nativeInteractionRead.ts:41-82` loops the full id set: for each row it runs
  `retainScheduleSource` (authorisation), a `forShare` lock+refetch, four label lookups, a type lookup, a
  status lookup, and (for non-schedule rows) `nativeInteractionMeetingView`.
- `packages/co-managed/src/nativeInteractionRead.ts:84-86` sorts the accumulated corpus and slices
  `(page-1)*pageSize .. page*pageSize` — sorting and paging happen only after the whole table is authorised.
- The caller `getInteractionsPage` (`packages/clients/src/actions/interactionActions.ts:293-314`) is an
  authenticated `interaction:read` action that delegates its filters verbatim to this provider at
  `interactionActions.ts:302`. No filter, `page`, or `pageSize` reaches the SQL before the full id scan.

This is the same fetch-all/authorise/slice shape as `nativeScheduleRead.ts` and `nativeMeetingRead.ts`, but
those are **out of scope** here (see §4).

## 2. Prior art: PR #4193 (branch `feature/security-dos-in-readcomanagednativeinteractions`)

PR #4193 (head `93b001e05e5f`) contains a working implementation of this exact fix. Decision: **port the
core, redo the wiring against current `main`, drop the rest.**

- **Port (4 files + migration + tests):** `nativeInteractionCandidates.ts`, `nativeInteractionCursor.ts`,
  `pageAuthorizedRows.ts`, the `nativeInteractionRead.ts` rewrite, and the migration
  `server/migrations/20261101120000_interactions_pagination_index.cjs` (index `interactions_tenant_date_id_page_idx`
  on `(tenant, interaction_date DESC NULLS LAST, interaction_id ASC)` built `CONCURRENTLY`). The DB precision
  test (`nativeInteractionCandidates.precision.db.test.ts`) also ports.
- **Redo (against current `main`, not the stale branch):** the branch forks from `7c2e4ccd` (2026‑11‑01) and is
  missing ~15k lines added since, including the client read-scope feature (`resolveInteractionReadScope`,
  added post-fork in `d2d2974b74`). The branch's diff *removes* `readScope` from the fallback
  `InteractionModel` path and removes `isRecordCreateDeniedError`/`getInteractionById`; those are stale-fork
  artifacts, **not** part of the fix, and must not be reproduced. The UI wiring is also re-done on top of the
  current feed (which still loads clients/contacts the current way) rather than the branch's unrelated
  `clients` prop refactor.
- **Drop (unrelated branch content):** drawer provider scoping (`DrawerContext` history, `e5dd6cca`..`93b001e`),
  the HMR reload capture harness, webpack/turbo dev config, `@blocknote/server-util` externalisation, and the
  `applyTemplates` predicate edits. None of these address the DoS finding.

## 3. Design

### 3.1 SQL pushdown of structural filters + keyset pagination

A new `nativeInteractionCandidates(owner, filters, after, options, limit)` builds the tenant-scoped candidate
query **before any row is authorised**:

- Apply the directly-comparable filters in SQL: `userId→user_id`, `contactId→contact_name_id`,
  `clientId→client_id`, `statusId→status_id`, `typeId→type_id`, `dateFrom→interaction_date >=`,
  `dateTo→interaction_date <=`, plus `entity` (`contact_name_id` / `client_id` / `ticket_id`) and
  `options.id` (`interaction_id = id`).
- Order by the existing native sort, made explicit and DB-side: **`interaction_date DESC NULLS LAST`** with
  tiebreak **`interaction_id ASC`** (this preserves `nativeInteractionRead.ts:84`, which sorts date-desc then
  id-ascending).
- Keyset predicate on the tuple `(interaction_date, interaction_id)` with the same `NULLS LAST` handling:
  after a null-date row, only null dates with a larger id follow; after a non-null date, rows with a strictly
  earlier date, or the same date with a larger id, or null dates.
- Select **only** `interaction_id` plus `interaction_date::text AS interaction_date_sort_key`. The raw
  `::text` form carries exact timestamp microseconds; `node-postgres` parses `timestamptz` columns into
  millisecond `Date` objects, which would collide on sub-millisecond values across a page boundary. The text
  key is opaque to the browser — it never leaves the sealed cursor — so no `interaction_date` field is
  returned to the client from this query.
- `LIMIT` the window. Free-text `search` is deliberately **not** pushed down: it matches on
  `title`/`notes`/`contact_name`/`client_name`/`user_name`, and the three label fields are hidden/redacted
  per-row (authorised), so matching them in SQL would turn hidden labels into a filter oracle.

The window size and window budget live in one shared helper (§3.3), not in the provider.

### 3.2 Authorisation ordering: at most one page plus a bounded over-fetch

`readCoManagedNativeInteractions` refactors its per-row body (current lines 41-82) into a single `authorize`
callback that is called **only on candidate rows pulled by §3.1**:

1. `retainScheduleSource` authorises the interaction itself; a denied/absent row returns `null` and is simply
   **skipped** — it is never materialised into the result, never counts toward `total`, and the keyset cursor
   advances past it.
2. `forShare` lock + refetch, hidden-field redaction, and the four label lookups / type / status lookups run
   only for rows that survive step 1.
3. The `online_meeting` dependent read (`nativeInteractionMeetingView`) is **deferred**: the `authorize`
   callback leaves it unset, and it is filled in only for the final returned page rows after pagination. This
   removes a per-row dependent read from the scan loop.
4. Structural filters (`userId`/`contactId`/`clientId`/`statusId`/`typeId`, `entity`, date range) are
   re-checked against the *authorised* view in `matches` — the SQL pre-filter in §3.1 never wrongly excludes a
   visible row, and this re-check guarantees a redacted field can't leak or act as an oracle. Free-text
   `search` runs in `searchMatches`, always post-authorisation.

Rows the caller cannot see therefore simply disappear from both the page and the count, exactly as they do
today (today's `try/catch` skips them), but the work is bounded.

### 3.3 Shared bounded keyset helper `pageAuthorizedRows`

The scan/count loop is extracted into `packages/co-managed/src/pageAuthorizedRows.ts`:

- `AUTHORIZED_ROW_WINDOW_SIZE = 50`, `AUTHORIZED_ROW_MAX_WINDOWS = 4`, `AUTHORIZED_ROW_MAX_PAGE = 10_000`.
- It walks keyset windows via `fetchCandidates(after, 50)`, calls `authorize` + `matches` + `searchMatches`
  per candidate, and returns the requested page slice, the position after the last returned row, whether the
  candidate set was exhausted, and a `total`/`totalExact` pair. A caller may only *lower* the window budget,
  never raise it. This is the single paging idiom; `nativeScheduleRead` and `nativeMeetingRead` will reuse it
  when those findings are scheduled — they are not changed here.

The interaction read runs **two** bounded passes:

- a **result** pass (`maxWindows: 3`, pageSize = requested) that returns the page rows and the `nextAfter`
  position;
- an **independent count** pass (`maxWindows: 1`, pageSize `100`) that yields `total` and `totalExact` (exact
  only when that one window exhausted the candidate set).

Each pass therefore authorises at most 50 candidates; the whole request authorises at most `3×50` result
candidates + `1×50` count candidates, never the whole table.

### 3.4 Continuation token (`nativeInteractionCursor.ts`)

The `nextAfter` keyset position is sealed into a cursor the browser can safely round-trip:

- AES‑256‑GCM with a key derived (`sha256` over a fixed domain string + secret) from
  `getSecret('native_interaction_cursor_encryption_key', 'NEXTAUTH_SECRET')` (`@alga-psa/core/secrets`).
- AAD binds the token to `(tenant, subject, query scope)` where scope is the normalised filter/id/entity
  tuple; a forged, malformed, cross-tenant, or cross-query token is rejected. The payload carries only
  `interaction_id` and `interaction_date_sort_key`, so the client receives no denied or redacted keyset
  field.

`getInteractionsPage` exposes `nextCursor` / `hasMore` to the client and re-sends `cursor` on continuation
(`page` is forced to 1 for a cursor continuation).

### 3.5 Index migration

New migration `server/migrations/20261101120000_interactions_pagination_index.cjs`, `config: { transaction: false }`:

- `CREATE INDEX CONCURRENTLY IF NOT EXISTS interactions_tenant_date_id_page_idx
   ON interactions (tenant, interaction_date DESC NULLS LAST, interaction_id ASC)`.
- Follow the existing mixed-direction convention (`20261109120100_add_tickets_tenant_due_date_index.cjs` /
  `20261107120000_add_asset_audits_client_started_index.cjs`): keep a valid index, rebuild an interrupted
  concurrent DDL (Citus 12.1 can invalidate a coordinator index even under `IF NOT EXISTS`). `tenant` leads
  for Citus distribution. The index **does not exist on `main`** today (verified — no
  `*interactions*pagination*` migration is present).

### 3.6 Behavior parity for `getInteractionsPage` consumers

- **Sort order** — unchanged for the native path (`interaction_date DESC`, `interaction_id ASC`). Note: the
  fallback `InteractionModel.getInteractionsPage` sorts `interaction_id DESC` (models/interactions.ts:338);
  that pre-existing discrepancy is out of scope and not widened here.
- **Total counts** — `total` remains the number of *authorised, matched* rows, but for a large history the
  bounded count pass returns a lower bound with `totalExact: false`. The contract and UI must surface this
  instead of presenting a partial count as exact.
- **Page boundaries** — pages are delimited by the opaque cursor, not by offset; a denied row no longer
  shifts a page.
- **Empty windows** — a bounded window can be empty even when more matching rows exist later (e.g. a
  free-text search whose first 50 candidates all fail `searchMatches`). The feed must keep the `DataTable`
  mounted (and `Next` reachable) on an empty page when `hasMore` is true, and keep `Previous` reachable on a
  terminal empty page; `Next` disables only on the terminal page.
- The fallback (non-co-managed) path is unchanged except to return the new fields it always knew:
  `totalExact: true`, `nextCursor: null`, `hasMore: page*pageSize < total`.

Contract edits: `InteractionPageFilters` gains `cursor?`; `InteractionPageResult` gains `totalExact`,
`nextCursor?`, `hasMore?`; `SharedWorkInteractionProvider.readInteractions` return type gains the same three
fields. `DataTable`/`Pagination` gain `totalItemsExact` and `hasMorePages` to render the incomplete total and
the cursor-driven `Next`.

## 4. Explicitly not doing

- **No broadening** to the same-shape fetch-all readers in `nativeScheduleRead.ts` / `nativeMeetingRead.ts`
  (or anywhere else). This card fixes the interaction read only; those become their own findings and will
  reuse `pageAuthorizedRows` later.
- No change to the fallback `InteractionModel.getInteractionsPage` / `getRecentInteractions` /
  `getForEntity` SQL or to `resolveInteractionReadScope` (client read scoping stays exactly as on `main`).
- No port of the branch's drawer provider scoping, HMR capture, webpack/turbo dev config, BlockNote
  externalisation, `applyTemplates` edits, or the `clients` prop refactor of the feed.
- No search-oracle change: free-text search remains post-authorisation on the authorised view.

## 5. Tests

- `packages/co-managed/src/__tests__/pageAuthorizedRows.test.ts` — helper contract: page slicing, window
  budget ceiling, `totalExact`/`exhausted`, `nextAfter`, empty windows, denied rows skipped (authorize→null),
  `page`/`pageSize` bound rejection.
- `packages/co-managed/src/__tests__/nativeInteractionCandidates.test.ts` — structural filter pushdown,
  entity/id filters, keyset continuation predicate (date desc nulls-last + id asc), `LIMIT` enforcement, and
  that the candidate query selects only `interaction_id` + the text sort key (no interaction fields).
- `packages/co-managed/src/__tests__/nativeInteractionRead.paging.test.ts` — end-to-end provider behavior on
  the refactor: page boundaries, denied-row skip, filter/search parity with the pre-fix behavior, sort order.
- `packages/co-managed/src/__tests__/nativeInteractionCandidates.precision.db.test.ts` (real Postgres, via
  `server/test-utils/dbConfig` `wireLocalTestDbEnv` + `describeWithDb` + `knexFactory`, as in the branch) —
  microsecond/sub-millisecond timestamps order identically across SQL windows and sealed continuations, and a
  forged/cross-scope cursor is refused.
- **DB-level cost test** (real Postgres): seed a tenant with a large interaction history and assert the
  candidate query's plan/execution does not scan the whole table — concretely that `pageAuthorizedRows`
  issues a bounded number of candidate fetches regardless of total row count (window count ≤ `maxWindows`),
  not work proportional to the row count. This is the regression that fails on the current fetch-all code.
- Existing UI feed + drawer pagination suites keep passing: the feed cursor walk
  (`OverallInteractionsFeed` Next/Previous/empty-window/terminal-page), the interaction-list contract tests,
  and the drawer open/close coverage.
- `packages/co-managed` typecheck and the co-managed `vitest run`; `packages/clients` and `packages/ui`
  builds for the contract/UI edits.

## 6. Acceptance criteria

1. `readCoManagedNativeInteractions` performs no whole-table select: candidate SQL is filtered + keyset +
   `LIMIT`-bounded, and authorisation/`forShare`/label lookups/meeting views run only on bounded windows and
   the returned page.
2. A page‑1 pageSize‑10 request against a large history authorises at most `4×50` candidates total (3 result
   windows + 1 count window), evidenced by the cost test.
3. `totalExact` is surfaced end-to-end; the feed presents incomplete totals as such and keeps `Next` reachable
   on empty bounded windows, disabling it only on the terminal page.
4. The concurrent index migration is present, valid on Citus, and matches the exact keyset order.
5. Cursor continuations are unforgeable and tenant+query-scoped; forged/cross-scope tokens are refused.
6. `getInteractionsPage` consumers see the same sort order, and denied rows do not shift page boundaries.
