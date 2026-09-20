# Rerank the filtered ticket list with Jev (smart ticket search)

**Card:** `9a7c9699-48af-4a57-bfbd-8c2525cd776a`
**Branch:** `feature/jev-smart-ticket-search`
**Date:** 2026-09-20
**Plan provenance:** Design session with Robert on 2026-09-20. Decisions below are his; code citations were verified against this worktree.

---

# Design — Jev-scored relevance over the chip-filtered ticket set

## Problem

The Tickets page search box (`packages/tickets/src/components/TicketingDashboard.tsx:2267`) runs a Postgres full-text, substring, and trigram match over ticket titles, comment bodies, and ticket numbers (`applyTicketListIndexedSearchFilter`, `packages/tickets/src/actions/optimizedTicketActions.ts:1556`). It cannot find a ticket whose words differ from the query: "customer can't print" does not surface "Xerox reports offline". Technicians narrow the list with filter chips, then scan by eye.

## Decisions (settled in the design session)

1. **Where.** The Tickets page search box. Not global search, not in-ticket "related tickets".
2. **What Jev does.** Reranks. The user pre-filters with the chips, types an English query, presses Enter (or the smart-search button). Jev scores every ticket in the chip-filtered set for relevance to the query. Jev does **not** interpret the query into filters.
3. **The typed text is the Jev query only.** In smart mode the keyword filter is cleared; the candidate set is defined by the chips alone. Keyword search stays the as-you-type behavior. Clearing the box leaves smart mode.
4. **No cap.** Whatever the chips leave is scored, however many. Scores stream to the browser as they arrive, with a progress indicator, and the user can act on rows before scoring finishes.
5. **Presentation.** Three buckets: **Strong matches**, **Possible matches**, **Unlikely matches**. A scored ticket lands in its bucket and never moves. Within a bucket, order is arrival order.
6. **Per-ticket state.** Title, ticket number, client, description, and as many comments as fit a moderate per-ticket token budget, newest first, oldest dropped. Not the whole thread.
7. **Edition and key.** Enterprise only. One platform-wide `TYPESAFE_API_KEY` app secret, read the same way as `OPENROUTER_API_KEY`. The feature hides itself when the key is absent. Per-search token usage is logged per tenant. The resolver is shaped so a per-tenant key later is a config change.
8. **Fan-out.** As many parallel TypeSafe requests as the service allows, with the SDK's 429/529 backoff as the backstop.

## TypeSafe facts the design relies on (docs.typesafe.ai, read 2026-09-20)

| Fact | Value |
| --- | --- |
| Endpoint | `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest` (= `jev-1.13.0`) |
| Request shape | one `state` (string or JSON), a map of named `questions`; every question is evaluated against the state in parallel |
| Rate limits | 1,200 requests/min and 250k tokens/s, account-wide, adjusting without notice |
| Context | 64k tokens per request; 32k for `state` plus the longest question |
| Price | $0.042 per million input tokens; output free |
| Noul | yes/no question returning `noul` in [0,1], the probability of yes; no separate confidence |
| SDK | `@typesafe-ai/sdk` 0.6.0, Node 20+; `client.systemOne({state, questions}, {signal, retry, timeout})`; response carries `usage.input_tokens`; retries 408/429/5xx with backoff honoring `Retry-After`; `maxRetries` default 2, per-attempt `timeout` default 10s |
| Jaggedness | literal reading; accuracy falls as state fills with unrelated detail; does not count or do arithmetic |

Consequence: one ticket per request (the rerank cookbook's shape) would cap the whole account at 20 tickets/second, so a 500-ticket set would take 25 seconds and starve other tenants. We pack several tickets into one request as `state.candidates[i]` with one Noul per candidate, and keep each request's state modest to respect the "unrelated detail" jaggedness. Batch size and budgets are constants in one place.

---

## Architecture

```
TicketingDashboard (CE package)                      server (CE route file, edition-gated)
  search Input  --Enter-->  smartSearch mode           POST /api/tickets/smart-search/stream
  <SmartTicketSearchResults>  (CE shell)                 ├─ getCurrentUser, hasPermission ticket:read
     └─ next/dynamic → @enterprise/.../SmartTicketSearchResults (EE)   ├─ @ee/services/smartTicketSearch/runSmartTicketSearch
          └─ useSmartTicketSearchStream(filters, query)                    ├─ getAllMatchingTicketIds (existing)
               fetch(..., {signal}) → SSE reader                           ├─ loadSmartSearchCandidates (tickets + app_search_index comments)
               buckets: strong / possible / unlikely / unscored            ├─ packCandidateBatches (token budgets)
                                                                            ├─ scoreBatch via TypeSafeClient (bounded concurrency)
                                                                            └─ loadTicketListItemsByIds → emit SSE `scored` events
```

Code placement follows the credentials-vault precedent: EE implementation under `ee/server/src`, CE stubs under `packages/ee/src`, and the CE tickets package reaches the EE UI through `next/dynamic` on an `@enterprise/...` alias (`packages/tickets/src/components/ticket/TicketCredentialsSection.tsx`). The SSE route is a CE route file that gates on edition and lazily imports `@ee/...`, like `server/src/app/api/chat/v1/completions/stream/route.ts`. The `@typesafe-ai/sdk` dependency lands only in `ee/server/package.json`; the CE stub never imports it.

---

## What changes, in order

### 1. **TypeSafe client resolver** — `ee/server/src/services/smartTicketSearch/typesafeClient.ts` (new)

- `export async function resolveTypeSafeClient(): Promise<TypeSafeClient | null>`. Reads `TYPESAFE_API_KEY` through `getSecret('TYPESAFE_API_KEY', 'TYPESAFE_API_KEY', '')` from `@alga-psa/core/secrets`, the chain `chatProviderResolver.ts:54` uses. Returns `null` when the key is blank. Memoize the client per key value (the secret provider can rotate).
- Client config: `retry: { maxRetries: 6, backoffMaxMs: 10_000 }`, `timeout: 20_000`, `defaultHeaders: { 'X-Alga-AI-Feature': 'smart-ticket-search' }`, `logLevel: 'warn'`. Model stays the SDK default `jev-latest`; the response's `model` field is logged per search so a future alias move is visible.
- `export async function isSmartTicketSearchConfigured(): Promise<boolean>` = client resolves. This is the only place the key is read.
- Per-tenant keys later: this function grows a `tenantId` parameter and a lookup; nothing else changes.
- CE stub `packages/ee/src/services/smartTicketSearch/typesafeClient.ts`: `resolveTypeSafeClient` returns `null`, `isSmartTicketSearchConfigured` returns `false`.

### 2. **Candidate text loader** — `ee/server/src/services/smartTicketSearch/loadSmartSearchCandidates.ts` (new)

- `export async function loadSmartSearchCandidates(trx, tenant, user: IUserWithRoles, ticketIds: string[]): Promise<SmartSearchCandidate[]>` where
  ```ts
  interface SmartSearchCandidate {
    ticketId: string;
    ticketNumber: string;
    title: string;
    clientName: string | null;
    description: string;          // plain text, already trimmed to budget
    comments: Array<{ author: 'technician' | 'client' | 'system'; text: string }>;  // newest first
    approxTokens: number;
  }
  ```
- Ticket fields come from `tickets` joined to `clients` (title, ticket_number, `attributes->>'description'`, client_name). Description is stored as raw text/markdown in `attributes.description` (`shared/models/ticketModel.ts:925-928`) and is **not** in `app_search_index` (`packages/search/src/indexers/ticket.ts` sets no `body`). Normalize it with `flattenMarkdown` / `flattenBlockNote` from `packages/search/src/normalize.ts` so the same plain-text rules apply as for comments.
- Comments come from `app_search_index` rows with `object_type = 'ticket_comment'` and `parent_id = ANY(ticketIds)`, ordered by `source_updated_at DESC`, filtered by `aclPredicateSql(principal)` from `packages/search/src/acl.ts:96` with the principal from `resolveSearchAclPrincipal(trx, user)` (`acl.ts:127`). This reuses the exact visibility rules keyword search applies (internal-only comments hidden from client users, etc.). The comment indexer records only `is_internal` today (`packages/search/src/indexers/ticket_comment.ts:12,54`), not who wrote it. Extend its `toSearchDoc` to put `author_kind` (`technician` | `client` | `system`, derived from `comments.author_type`/`user_id`) into `metadata`, and treat a missing value as `technician` for rows indexed before the backfill; note the backfill in the runbook (`docs/deployment/app-wide-search-runbook.md`). Query it in one statement for the whole batch of ids, tenant-scoped (Citus co-located on `tenant`).
- Budgeting, all in `smartSearchBudgets.ts`:
  ```ts
  export const SMART_SEARCH_BUDGETS = {
    tokensPerTicket: 3_000,        // title + description + comments
    descriptionMaxTokens: 1_200,   // description truncated first, comments fill the rest
    stateTokensPerRequest: 16_000, // sum of candidates in one TypeSafe request
    maxTicketsPerRequest: 10,
    inflightPerSearch: 8,
    inflightPerProcess: 16,
  } as const;
  export const approxTokens = (text: string) => Math.ceil(text.length / 4);
  ```
  Fill each ticket newest-comment-first until `tokensPerTicket` is hit; a comment that does not fit is truncated at a sentence boundary if it is the first one, else dropped along with everything older. `approxTokens` is a chars/4 estimate; the hard 32k server limit leaves ample headroom at these numbers.
- Placed in EE because only the EE path calls it. The SQL is written with `tenantScopedDerivedTableSql` like the existing search legs so it is pushdown-safe on Citus.

### 3. **Batch packing and the relevance question** — `ee/server/src/services/smartTicketSearch/scoreCandidates.ts` (new)

- `export function packCandidateBatches(candidates: SmartSearchCandidate[]): SmartSearchCandidate[][]`: greedy in input order; a batch closes when adding the next candidate would exceed `stateTokensPerRequest` or `maxTicketsPerRequest`. Pure, unit-tested.
- `export function buildRelevanceRequest(query: string, batch: SmartSearchCandidate[]): SystemOneRequest` producing
  ```ts
  state: { query, candidates: batch.map(toCandidateState) }   // candidate state omits ticketId and approxTokens
  questions: Object.fromEntries(batch.map((_, i) => [`c${i}`, noul(
    { question: `Is the support ticket at \`candidates[${i}]\` about the problem, request, person, device, or subject described by \`query\`?` },
    { true: 'The ticket concerns what the query describes, even when it uses different words, a product name instead of a category, or describes a symptom of the same underlying problem.',
      false: 'The ticket is about a different problem, request, or subject; sharing a client, a technician, or a few incidental words does not make it relevant.' }
  )]))
  ```
  One narrow Noul per candidate, phrased so high means yes, with criteria that name the boundary cases (matches the Noul guidance and the literal-reading jaggedness). The question id `c{i}` is for code only and maps back to `batch[i].ticketId`.
- `export async function scoreBatch(client, query, batch, signal): Promise<{ scores: Array<{ticketId, score}>; usage: {inputTokens}; model: string }>`. Calls `client.systemOne(request, { signal })`. Any thrown error propagates; the runner decides.
- Bucket thresholds live here too: `export const SMART_SEARCH_BUCKETS = { strongMin: 0.75, possibleMin: 0.35 } as const` and `export function bucketFor(score): 'strong' | 'possible' | 'unlikely'`. Thresholds are a first guess to be tuned on real tenant data; they are constants for that reason.

### 4. **Search runner with bounded fan-out** — `ee/server/src/services/smartTicketSearch/runSmartTicketSearch.ts` (new)

- `export async function* runSmartTicketSearch(input: { tenant; user; filters: ITicketListFilters; query: string; signal: AbortSignal }): AsyncGenerator<SmartSearchEvent>` where
  ```ts
  type SmartSearchEvent =
    | { type: 'started'; searchId: string; total: number; model: string }
    | { type: 'scored'; items: Array<{ ticket: ITicketListItem; score: number; bucket: 'strong'|'possible'|'unlikely' }>; scored: number }
    | { type: 'batch_failed'; ticketIds: string[]; reason: string; scored: number }
    | { type: 'done'; scored: number; failed: number; inputTokens: number; durationMs: number }
  ```
- Steps: `getAllMatchingTicketIds(filters)` with `searchQuery` forced to `''` (decision 3) → if zero, emit `started {total: 0}` then `done`. Load candidates in chunks of 200 ids (one SQL round trip per chunk, not per ticket). Pack batches. Run batches through a small promise pool: `inflightPerSearch` per search, and a module-level semaphore `inflightPerProcess` shared by every search in the process so one tenant cannot monopolize the account's 1,200 req/min (in a multi-replica deployment this is per pod; the SDK's `Retry-After` handling is the true backstop, and the semaphore just smooths bursts). Each finished batch loads its `ITicketListItem` rows (change 6) and yields one `scored` event, so the browser receives rows in the order batches complete.
- Failure policy: a batch that still fails after SDK retries yields `batch_failed` with its ticket ids and continues; the search as a whole does not die because one request did. An `APIUserAbortError` (client went away) ends the generator silently. Any other error before the first batch (permission, missing key, DB) throws so the route returns a proper status rather than a half-open stream.
- On `done`, write one structured log line via the server logger: tenant, user_id, query length (not the query), total, scored, failed, requests, input tokens, model, duration. This is the "per-search token usage logged per tenant" from decision 7.
- CE stub `packages/ee/src/services/smartTicketSearch/runSmartTicketSearch.ts` throws an error with `code: 'ENTERPRISE_EDITION_REQUIRED', statusCode: 403`, the same shape as `packages/ee/src/lib/actions/credentials/credentialActions.ts:10`.

### 5. **SSE route** — `server/src/app/api/tickets/smart-search/stream/route.ts` (new)

- `export const dynamic = 'force-dynamic'`; `POST(req: NextRequest)`. Body `{ filters: ITicketListFilters; query: string }`, validated with `ticketListFiltersSchema` (the zod schema `optimizedTicketActions.ts:47` uses) plus `query: z.string().trim().min(1).max(500)`.
- Auth exactly as the chat stream route: `getCurrentUser()` from `@alga-psa/user-composition/actions`, 401 without a session; `hasPermission(user, 'ticket', 'read')` → 403. Edition gate → 404 (same pattern as `document-assist/route.ts:57`). `isSmartTicketSearchConfigured()` false → 503 with `{ code: 'SMART_SEARCH_NOT_CONFIGURED' }`.
- Stream: lazily `import('@ee/services/smartTicketSearch/runSmartTicketSearch')`, iterate the generator inside `runWithTenant(user.tenant, ...)`, encode each event as `event: <type>\ndata: <json>\n\n`, finish with `data: [DONE]\n\n`. Copy the `StreamControllerState` / `tryEnqueue` / `tryClose` guards from `server/src/app/api/chat/v1/completions/stream/route.ts:252-290` and pass `req.signal` into the runner so a closed tab aborts every in-flight TypeSafe call. Send a `: keepalive\n\n` comment every 15 s while a batch is pending so proxies do not drop the idle connection.
- Headers: `text/event-stream; charset=utf-8`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- Register the route in the OpenAPI registry only if the repo's route-registry contract test requires it (check `server/src/lib/api/openapi/routes/*.ts` conventions during implementation; the chat stream route is registered at `routes/chat.ts:97`).

### 6. **List rows by id** — `packages/tickets/src/actions/optimizedTicketActions.ts`

- Extract the row-shaping tail of `getTicketsForList` (`mapTicketListItems` at `optimizedTicketActions.ts:2063` followed by the avatar, tag, and client-logo enrichment at `:2067-2157`) into `async function buildTicketListItems(trx, tenant, user, rows): Promise<ITicketListItem[]>`, and have `getTicketsForList` call it. Behavior unchanged; the existing `getTicketsForList` tests cover it.
- Add `export const loadTicketListItemsByIds = withAuth(async (user, {tenant}, filters: ITicketListFilters, ticketIds: string[]) => Promise<ITicketListItem[]>)`: `buildTicketListBaseQuery` + `applyTicketReadAuthorizationSql` (or the in-memory fallback) + `whereIn('t.ticket_id', ticketIds)` + `buildTicketListItems`. Returns rows in the order of `ticketIds`. Used by the runner so streamed rows carry the same columns the table already renders. `// LEVERAGE: pattern ticket-list-rows-by-ids` is not needed once this exists; it *is* the layer.

### 7. **Availability probe** — `ee/server/src/lib/actions/smartTicketSearchActions.ts` (new) + CE stub `packages/ee/src/lib/actions/smartTicketSearchActions.ts`

- `'use server'`; `export const getSmartTicketSearchAvailability = withAuth(async (user) => ({ available: boolean }))`: true when `isSmartTicketSearchConfigured()` and the user has `ticket:read`. CE stub returns `{ available: false }`.
- `packages/tickets/src/components/useSmartTicketSearchAvailability.ts` (new, CE): mirrors `packages/clients/src/components/clients/useCredentialsVaultTab.ts`: `isEnterprise` from `@alga-psa/core` short-circuits to hidden; otherwise dynamic-imports `@enterprise/lib/actions/smartTicketSearchActions` and calls the probe once per mount; any throw ⇒ hidden. Returns `{ available, loading }`.

### 8. **Stream consumer hook** — `ee/server/src/components/tickets/smartSearch/useSmartTicketSearchStream.ts` (new)

- `useSmartTicketSearchStream(): { run(filters, query): void; cancel(): void; state }` with
  ```ts
  interface SmartSearchState {
    status: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
    total: number; scored: number; failed: number;
    buckets: { strong: ScoredRow[]; possible: ScoredRow[]; unlikely: ScoredRow[] };  // append-only
    unscored: ITicketListItem[] | null;   // rows from batch_failed, hydrated lazily (see below)
    error: string | null;
  }
  ```
- `run` aborts any previous run (AbortController per run, generation counter guard like `Chat.tsx:928`), POSTs to the route with `signal`, and consumes the body with a small SSE line reader modelled on `ee/server/src/components/chat/readAssistantContentFromSse.ts` but dispatching on `event:` names. `scored` items are appended to their bucket array in arrival order and never re-sorted (decision 5). `batch_failed` ids are collected; when the stream finishes, they are hydrated with `loadTicketListItemsByIds` (change 6) into `unscored`, so the user still sees every ticket the chips matched.
- Errors: a non-2xx response reads the JSON body and sets `status: 'error'` with the code (`SMART_SEARCH_NOT_CONFIGURED`, 403, etc.). A dropped connection mid-stream sets `error` but keeps the buckets already received.

### 9. **Results panel** — `ee/server/src/components/tickets/smartSearch/SmartTicketSearchResults.tsx` (new) + CE shell `packages/tickets/src/components/SmartTicketSearchResults.tsx` (new)

- CE shell: `next/dynamic(() => import('@enterprise/components/tickets/smartSearch/SmartTicketSearchResults'), { ssr: false, loading: () => null })`, same as `TicketCredentialsSection.tsx`. Props are the contract between the dashboard and the EE panel:
  ```ts
  interface SmartTicketSearchResultsProps {
    id: string;
    filters: ITicketListFilters;       // chips only; searchQuery already ''
    query: string;
    runToken: number;                  // dashboard bumps it to (re)run
    columns: ColumnDefinition<ITicketListItem>[];   // the dashboard's memoized columns incl. selection column
    rowClassName; onRowClick;          // same handlers as the main table
    onVisibleRowsChange: (ids: string[]) => void;   // feeds select-all
    onExit: () => void;
    t: (key: string, fallback: string) => string;
  }
  ```
- EE panel layout, top to bottom:
  - **Status strip**: while running, a progress bar plus "Scored 143 of 512 tickets" and a **Cancel** button (`${id}-smart-search-cancel`); when done, "Scored 512 tickets · 12 strong · 40 possible" and a **Back to list** button (`${id}-smart-search-exit`). If `failed > 0`, a warning line "N tickets could not be scored" linking to the unscored group. On `error`, an inline error with the code text and a **Retry** button.
  - **Three sections** in fixed order: Strong matches, Possible matches, Unlikely matches, each a header with count and a `DataTable` (`@alga-psa/ui/components/DataTable`) with `pagination={false}`, `manualSorting={false}`, the dashboard's `columns`, `rowClassName`, `onRowClick`. Unlikely is collapsed by default with a "Show N unlikely matches" toggle (`${id}-smart-search-show-unlikely`); strong and possible are always open. An empty section shows a one-line placeholder rather than disappearing, so the user knows scoring covered it.
  - **Could not be scored** section, only when non-empty.
  - Each row gets a small relevance chip in the leading column area (`Math.round(score * 100)` shown as a percentage, styled with the badge CSS variables per `docs/AI_coding_standards.md`). Implement as a wrapper `rowClassName` plus a leading-column decorator rather than a new column so the dashboard's column definitions are reused untouched.
- `onVisibleRowsChange` is called with the union of all rendered rows so the existing select-all banner and `BulkTicketActionBar` keep working on bucket rows; selection state stays in `useTicketsRouteState()` and is untouched by this change.
- All interactive elements carry `id`s per the reflection-UI rule; all colors via CSS variables; verify in dark mode.

### 10. **Dashboard wiring** — `packages/tickets/src/components/TicketingDashboard.tsx`

- New local state `smartSearch: { active: boolean; query: string; runToken: number }` and `const { available: smartSearchAvailable } = useSmartTicketSearchAvailability()`.
- Search `Input` (`:2267`): add `onKeyDown`. On Enter with `smartSearchAvailable` and a non-blank value: `preventDefault`, set `smartSearch` active with the trimmed value and `runToken + 1`, and call `onFilterChange({ searchQuery: '' })` so the keyword filter is cleared (decision 3). The debounced keyword emit effect (`:569`) must be suppressed while `smartSearch.active` so the typed text does not leak back into the keyword filter; the effect gets an `if (smartSearch.active) return` guard. Without Enter, typing behaves exactly as today.
- A **Smart search** button beside the input (`${id}-smart-search-run`, sparkle icon, `variant="outline"`), rendered only when `smartSearchAvailable`, doing the same as Enter. It gives the feature a visible affordance; the placeholder text does not change in CE.
- When the input is cleared (`value === ''`) while active → `smartSearch.active = false`. Escape in the input does the same.
- Any chip change while active does **not** auto-rerun (each run spends tokens). The status strip shows "Filters changed. Run again" with a button that bumps `runToken`; implement by passing a `filtersStale` boolean derived from a hash of the chip filters captured at run time.
- Render: when `smartSearch.active`, render `<SmartTicketSearchResults …/>` in place of the `<DataTable>` block at `:2607-2634` (inside the same `ShortcutActiveRegion`), passing `columns`, `rowClassName`, `onRowClick`, `handleVisibleRowsChange`, and the chip-only filters assembled the way `handleSelectAllMatchingTickets` (`:1081-1122`) assembles them. Extract that filter assembly into `const chipFilters = useMemo(() => buildListFilters({...}), [...])` so both call sites share it (this is the second copy of that shape; extracting it is the leverage fix, cheap and obviously right).
- The main table's pagination controls and the view-presentation toggles are hidden while active; the filter chips, bulk bar, and reset button stay.
- URL state: smart mode is **not** mirrored into the URL (a reload should not silently spend tokens). `handleResetFilters` also exits smart mode.

### 11. **Strings** — `server/public/locales/*/features/tickets.json` (all languages incl. `xx`, `yy`)

New keys under `smartSearch.*`: `run` "Smart search", `scoring` "Scored {{scored}} of {{total}} tickets", `summary` "Scored {{total}} tickets", `cancel` "Cancel", `exit` "Back to list", `retry` "Retry", `rerun` "Filters changed. Run again", `strong` "Strong matches", `possible` "Possible matches", `unlikely` "Unlikely matches", `showUnlikely` "Show {{count}} unlikely matches", `unscored` "Could not be scored", `emptyBucket` "None yet", `notConfigured` "Smart search is not configured on this server", `relevance` "{{percent}}% relevant". Every `t()` call passes the inline English default, and `TicketingDashboard.i18n.test.ts` is extended for the dashboard-side keys.

### 12. **Configuration and docs**

- `ee/server/package.json`: add `@typesafe-ai/sdk@^0.6.0`.
- `.env.example` EE AI block (`:238-254`) and `ee/server/.env.example`: add `TYPESAFE_API_KEY=` with a comment that it enables smart ticket search. Filesystem secret name `typesafe_api_key` in `docs/security/config/DOCKER_SECRET_PROVIDER_CONFIG.md`; Helm `helm/templates/secret.yaml` gets the optional entry next to `OPENROUTER_API_KEY`.
- `docs/deployment/app-wide-search-runbook.md`: note that smart search reads comment text from `app_search_index`, so tenants with an unbuilt index will score on title and description only until `search:backfill` runs. This is a documented limitation, not a failure.

---

## Data flow, end to end

1. User sets chips (board, status, client…), types "printer keeps going offline", presses Enter.
2. Dashboard clears the keyword filter, enters smart mode, renders the EE panel, which POSTs `{ filters: chipFilters, query }` with an abort signal.
3. Route authenticates, checks permission, edition, key; opens the SSE stream.
4. Runner enumerates ids via `getAllMatchingTicketIds` (bundled view returns masters only, as the list does), loads candidate text in 200-id chunks, packs batches under the token budgets, and scores batches through a pool of 8 in-flight requests (16 per process).
5. Each finished batch hydrates its rows with `loadTicketListItemsByIds` and yields `scored`; the panel appends rows to buckets in arrival order and updates the progress strip.
6. Failed batches yield `batch_failed`; their rows appear under "Could not be scored" after the stream ends.
7. `done` carries totals and token usage; the server logs one line per search.
8. Cancel, clearing the box, Escape, Back to list, reset filters, or closing the tab aborts the fetch; the route's `req.signal` cascades into every pending SDK call.

## Error handling

- Missing key → route 503 `SMART_SEARCH_NOT_CONFIGURED`; the panel shows the not-configured string. (The button should already be hidden by the probe; this covers a key removed after page load.)
- No permission → 403; edition mismatch → 404; both shown as an inline error with Retry hidden.
- TypeSafe 429/529 → SDK backoff with `Retry-After`; after 6 retries the batch is reported failed and the search continues.
- TypeSafe 422 (malformed question or over-limit state) → treated as a programming error: the batch fails, the reason is logged at error level with the batch's token estimate so the budgets can be corrected. Budgets are sized so this should not happen; the log makes it visible if it does.
- DB or auth errors before the first batch → thrown; route returns 500 JSON, no stream.
- Client disconnect → `AbortError` ends the generator; no log line is written as a completed search, a debug line records the abort.

## Testing

Unit (vitest, `ee/server/vitest.config.ts` for EE code, `packages/tickets/vitest.config.ts` for CE):
- `packCandidateBatches`: respects `stateTokensPerRequest` and `maxTicketsPerRequest`; a single oversized candidate still forms its own batch; order preserved.
- Candidate budgeting: newest comments kept, oldest dropped, description truncated first, `approxTokens` never exceeds `tokensPerTicket`.
- `buildRelevanceRequest`: one Noul per candidate, ids `c{i}`, state contains no `ticketId`; snapshot the question text so wording changes are deliberate.
- `bucketFor` at the thresholds.
- `runSmartTicketSearch` with a fake client (`vi.stubGlobal('fetch', …)` returning canned `/v1/systemone` bodies, per the vendor-client tests in `ee/packages/workflows/src/runtime/actions/__tests__/`): events arrive in batch-completion order; a 500 that exhausts retries yields `batch_failed` and later batches still score; abort stops further requests; the done event sums `usage.input_tokens`.
- Concurrency: with 30 batches and a fake client that resolves on demand, never more than `inflightPerSearch` outstanding; two concurrent searches never exceed `inflightPerProcess`.
- Route: `new Request(...)` + dynamic `import { POST }` like `server/src/test/unit/api/chatCompletionsStream.route.events.test.ts`; asserts 401/403/404/503 paths and that events are framed `event:`/`data:` with a `[DONE]` sentinel.
- Hook: fake `Response` with a `ReadableStream` of encoded frames (pattern from `server/src/test/unit/readAssistantContentFromSse.test.ts`); buckets append in order; `batch_failed` ids are hydrated after end; a second `run` aborts the first.
- `loadTicketListItemsByIds`: returns rows in requested order, excludes tickets the user cannot read, tenant-scoped (contract test in the style of `optimizedTicketActions.tenantScopedAuth.contract.test.ts`).
- Dashboard contract test (source-text style, like `TicketingDashboard.moveBulk.contract.test.ts`): Enter handler exists on the search input; keyword emit effect is guarded by `smartSearch.active`; `SmartTicketSearchResults` replaces the `DataTable` when active.
- i18n test extension for the new dashboard keys; locale files for all languages carry the leaves.

Manual verification on the dev stack (board service on port 3008, compose project `alga-psa-local-test`):
1. With `TYPESAFE_API_KEY` unset: no Smart search button; Enter in the box does nothing beyond keyword search.
2. Set the key (filesystem secret `typesafe_api_key`), restart; button appears for a user with ticket read; absent for a user without it.
3. Filter to one board, type a paraphrase of a known ticket, press Enter: rows stream into buckets; the known ticket lands in Strong; the progress strip counts up; keyword filter chip is not applied.
4. Select rows across buckets, run a bulk status change: it applies to exactly those rows.
5. Cancel mid-run: no further network requests from the SDK (check server log line count); rows already scored remain.
6. Change a chip mid-run: strip shows "Filters changed. Run again"; nothing reruns until clicked.
7. Clear the box: normal list returns with keyword search live again.
8. Dark mode pass over the strip, chips, and section headers.

## Acceptance

1. In enterprise with the key configured, Enter in the ticket search box scores every ticket matching the chips and shows them in Strong / Possible / Unlikely buckets that fill in as scores arrive, with a progress indicator and a working cancel.
2. Rows never move between or within buckets once placed.
3. Row click, selection, and every bulk action work on bucket rows exactly as on the main table.
4. The keyword filter is not applied in smart mode; clearing the box restores normal behavior.
5. Without the key, or in community edition, nothing about the page changes.
6. A closed tab or cancel stops all TypeSafe requests for that search within one in-flight batch.
7. One structured log line per completed search records tenant, counts, model, input tokens, and duration.
8. No cap on candidate count; a 2,000-ticket filter completes without error (may take on the order of a minute at current limits).

## Out of scope (deliberately)

- Interpreting the query into filter chips (a separate feature; the request/response plumbing here would carry it).
- Per-tenant TypeSafe keys and gateway-metered billing (resolver is shaped for it; see change 1).
- Adding the ticket description to `app_search_index` for keyword search (a real gap, `packages/search/src/indexers/ticket.ts`; worth its own card).
- Client-portal ticket list.
- Persisting or sharing smart-search results, or URL-encoding smart mode.
