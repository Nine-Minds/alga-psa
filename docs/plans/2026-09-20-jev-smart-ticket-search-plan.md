# Smart search: Jev reranks the chip-filtered Tickets and Projects lists

**Card:** `9a7c9699-48af-4a57-bfbd-8c2525cd776a`
**Branch:** `feature/jev-smart-ticket-search`
**Date:** 2026-09-20
**Plan provenance:** Design session with Robert on 2026-09-20. The decisions are his; the design below is what the branch implements.

## Status and brief for the next steps

**Implemented on this branch.** The design session ran long: Robert asked for the plan to be implemented inline, then extended it three times (ticket facts in the state, release-flag and add-on gating, the same search on Projects) and had it smoke-tested live. Seven commits on top of `main` carry the whole change; the tip at the time of writing is `5af8433b89`. This document is the spec that diff was written to, rewritten once at the end so it matches what landed rather than what was first drafted.

- **Draft Implementation:** there is nothing left to build. Treat this step as verification. Run the checks in "Verification" below, confirm the diff against `main` matches the file map in "What is on the branch", and report. Do not restructure, do not push (`state.prUrl` is empty), do not open a PR.
- **Implement (human):** review-and-finish. The only open items are listed under "Follow-ups"; none block the card.
- **Smoke Test:** follow "Smoke test script" below. It names the dev-tenant prerequisites without which the feature is hidden by design.

---

## Problem

The Tickets page search box runs a Postgres full-text, substring, and trigram match over ticket titles, comment bodies, and ticket numbers. It cannot find a ticket whose words differ from the query: "customer can't print" does not surface "Xerox reports offline". Technicians narrow the list with filter chips, then scan by eye. The Projects page has the same box and the same limitation, over project names, task names, and task comments.

## Decisions (settled with Robert)

1. **Where.** The search box on the Tickets page and on the Projects page. Not global search, not "related items" inside a record.
2. **What Jev does.** Reranks. The user pre-filters with the chips, types an English query, presses Enter (or the Smart search button). Jev scores every row in the chip-filtered set for relevance to the query. Jev does **not** interpret the query into filters.
3. **The typed text is the Jev query only.** The candidate set is defined by the chips alone; the keyword filter is not applied in smart mode. Keyword search stays the as-you-type behavior. Clearing the box, Escape, or Reset leaves smart mode.
4. **No cap.** Whatever the chips leave is scored, however many. Scores stream to the browser as they arrive, with a progress indicator, and the user can act on rows before scoring finishes.
5. **Presentation.** Three buckets: **Strong matches**, **Possible matches**, **Unlikely matches** (collapsed by default), then **Could not be scored**. A scored row lands in its bucket and never moves. Within a bucket, order is arrival order. Each row carries a Match percentage.
6. **What Jev reads per row.** Named facts plus text, under a moderate per-row token budget (about 3k), never the whole thread. Tickets: number, title, client, status, closed flag, priority, board, assignee, team, dates, description, then comments newest first. Projects: number, name, client, contact, status, closed and inactive flags, manager, dates, budget, description, then tasks newest-updated first (phase, name, status, priority, assignee, due date, description), then recent task comments.
7. **Gating.** Enterprise edition, the `release-v1-6-feature` flag, the AI Assistant add-on, and a configured platform-wide `TYPESAFE_API_KEY`, in that order after the entity's read permission. The page hides the affordance when any gate fails; the route refuses before spending a token. One shared decision serves both.
8. **Fan-out.** As many parallel TypeSafe requests as the service allows, bounded per search and per process, with the SDK's 429/529 backoff as the backstop. Per-search token usage is logged per tenant.
9. **One engine.** The runner, scoring, budgeting, access decision, route, stream hook, and results panel are written once against an entity definition. Tickets and projects each supply one definition. Adding a third list is one definition, one probe call in its page, and one block of strings.

## TypeSafe facts the design relies on (docs.typesafe.ai, read 2026-09-20)

| Fact | Value |
| --- | --- |
| Endpoint | `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest` (= `jev-1.13.0`) |
| Request shape | one `state` (JSON), a map of named `questions`; every question is evaluated against the state in parallel |
| Rate limits | 1,200 requests/min and 250k tokens/s, account-wide |
| Context | 64k tokens per request; 32k for `state` plus the longest question |
| Price | $0.042 per million input tokens; output free |
| Noul | yes/no question returning `noul` in [0,1], the probability of yes |
| SDK | `@typesafe-ai/sdk` 0.6.0; `client.systemOne({state, questions}, {signal, retry, timeout})`; response carries `usage.input_tokens` and `model`; retries 408/429/5xx honoring `Retry-After` |
| Jaggedness | literal reading; accuracy falls as state fills with unrelated detail |

Consequence: one row per request would cap the whole account at 20 rows/second, so several rows are packed into one request as `state.candidates[i]` with one Noul per candidate, and each request's state is kept modest.

**Finding from the live smoke test:** with large candidates (nine projects, three of them 21-task template projects, about 12k tokens of state) Jev's reading of `candidates[i]` drifted to a neighbour often enough that an empty project scored 77% for a query its neighbour matched. Reproduced outside the app with the same state. Fix: every candidate carries `ref: "c<i>"` as its **first** field and the question names the ref as well as the index, says "judge only that candidate", and says an empty candidate is not evidence of relevance. After the change the empty project scored 3% and the true match 97%. Batches of three also fixed it but cost three times the requests.

---

## Architecture

```
Page server component (server/src/app/msp/{tickets,projects}/page.tsx)
  └─ getSmartSearchAvailability(entity)  ── @enterprise alias ──►  EE action → evaluateSmartSearchAccess
       └─ smartSearchAvailable prop → list component (button + placeholder on first paint)

List component (CE: TicketingDashboard / Projects)
  search Input ──Enter/button──► smart mode (local state, never in the URL)
  <SmartSearchResults>  (CE shell in @alga-psa/ui, next/dynamic → @enterprise/components/smartSearch/SmartSearchResults)
     └─ useSmartSearchStream(entity)  POST /api/smart-search/<entity>/stream  {scope, query}
          SSE frames: started → scored* / batch_failed* → done → [DONE]
          buckets: strong / possible / unlikely (append-only) + unscored (hydrated by the page's by-id loader)

Route (CE delegator server/src/app/api/smart-search/[entity]/stream → EE handler)
  validate {scope, query} with the entity's scope schema → getCurrentUser → evaluateSmartSearchAccess
  └─ runSmartSearch({ definition, tenant, user, scope, query, signal })
       enumerate(scope) → loadCandidates in chunks → packCandidateBatches → scoreBatch (bounded pool)
       → hydrateRows per batch → yield events
```

Code placement follows the credentials-vault precedent: the enterprise implementation under `ee/server/src`, community stubs under `packages/ee/src`, and community packages reach enterprise UI and actions through the edition-swapped `@enterprise` alias. The route is a community delegator that dynamically imports the enterprise handler (the Hudu integration pattern) and answers 404 in community edition. `@typesafe-ai/sdk` is a dependency of `ee/server/package.json` only.

---

## Design

### Wire contract — `packages/ui/src/lib/smartSearch/types.ts`

Entity-neutral, shared by both pages, the route, the engine, and the panel:

- `SmartSearchEntity = 'ticket' | 'project'`; `smartSearchStreamPath(entity)` = `/api/smart-search/<entity>/stream`; `SMART_SEARCH_STREAM_PATH_PREFIX` for the middleware allow-list.
- `SmartSearchRequestBody<TScope> = { scope, query }`. `scope` is whatever defines the candidate set for the entity: the chip filters for tickets, an explicit id list for projects. Query max 500 characters.
- `SmartSearchEvent<TRow, TMetadata>`: `started {searchId, total}` | `scored {items: {row, score, bucket}[], metadata, scored}` | `batch_failed {ids, reason, failed}` | `done {total, scored, failed, requests, inputTokens, model, durationMs}`.
- Error codes: `UNAUTHORIZED`, `FORBIDDEN`, `ENTERPRISE_EDITION_REQUIRED`, `FEATURE_FLAG_OFF`, `ADD_ON_REQUIRED`, `SMART_SEARCH_NOT_CONFIGURED`, `INVALID_REQUEST`, `INTERNAL_ERROR`.
- Each entity keeps a thin flavor: `packages/tickets/src/lib/smartTicketSearch/types.ts` (scope = `ITicketListFilters`, metadata = avatar urls and tags) and `packages/projects/src/lib/smartProjectSearch/types.ts` (scope = `{ projectIds }`, metadata = project tags).

### Engine — `ee/server/src/services/smartSearch/`

- **`entityDefinition.ts`.** `SmartSearchEntityDefinition<TScope, TRow, TMetadata>`: `entity`, `permissionResource`, `noun`, `scopeSchema` (zod), `normalizeScope` (drops any keyword text), `enumerate(scope) → ids`, `loadCandidates(trx, tenant, user, ids)`, `hydrateRows(scope, ids) → {rows, metadata}`, `rowId(row)`, `relevance` (question and criteria). `entities/index.ts` is the registry the route resolves by path segment.
- **`budgets.ts`.** One set of constants for every entity: `tokensPerCandidate` 3,000; `descriptionMaxTokens` 1,200; `stateTokensPerRequest` 16,000; `maxCandidatesPerRequest` 10; `inflightPerSearch` 8; `inflightPerProcess` 16; `candidateLoadChunk` 200; `childRowsPerCandidateFetchLimit` 40. Bucket thresholds `strongMin` 0.75, `possibleMin` 0.35 (first guesses, to tune on tenant data). `approxTokens` is a chars/4 estimate.
- **`candidate.ts`.** `assembleCandidate({ id, head, description, sections })`: the head facts go first, then the description (markdown or BlockNote flattened to plain text, truncated at a sentence boundary to `descriptionMaxTokens`), then each section's children in order until `tokensPerCandidate` is spent. An earlier section takes budget before a later one. The newest child is truncated rather than dropped only while the candidate has no child at all, so the latest state always reaches the model and a later section never gets a meaningless sliver. The id and the token estimate never enter the state.
- **`scoreBatch.ts`.** `packCandidateBatches` (greedy, input order, closes on either budget; an oversized candidate gets its own batch). `buildRelevanceRequest` stamps `ref: c<i>` first on each candidate and asks one Noul per candidate keyed `c<i>` with the entity's question and criteria. `scoreBatch` maps answers back by key, clamps to [0,1], buckets, and returns `inputTokens` and `model`; a missing answer throws.
- **`runSmartSearch.ts`.** Async generator. Resolves the client (throws `SMART_SEARCH_NOT_CONFIGURED` first), normalizes the scope, enumerates (a permission failure throws `FORBIDDEN`), yields `started`. Loads candidates in chunks of `candidateLoadChunk` so the first request leaves before the last row is read; ids the loader did not return are reported as unscored. Batches run through a per-search semaphore and a module-level per-process semaphore; outcomes are queued and yielded in completion order. A batch that fails after the SDK's retries yields `batch_failed` and the search continues. Each scored batch is hydrated through the entity's `hydrateRows`; rows no longer visible are reported as unscored. Abort ends the generator silently. On completion one structured log line per search: tenant, user id, query length, counts, requests, input tokens, model, duration.
- **`access.ts`.** `evaluateSmartSearchAccess(user, { permissionResource, noun })`: read permission → `release-v1-6-feature` (server-evaluated with tenant and user) → AI Assistant add-on (`assertTenantAddOnAccess`, rethrowing anything but `AddOnAccessError`) → configured key. Returns `{allowed: true}` or `{allowed: false, reason, message}`.
- **`typesafeClient.ts`.** Reads `TYPESAFE_API_KEY` through `getSecret` (the `OPENROUTER_API_KEY` chain), memoizes the client per key value, `retry: {maxRetries: 6, backoffMaxMs: 10000}`, `timeout: 20000`, header `X-Alga-AI-Feature: smart-search`. A per-tenant key later is a parameter on this function.

### Entities

- **`entities/ticket.ts`.** Scope is `ITicketListFilters` validated by `ticketListFiltersSchema` with `searchQuery` forced to `''`. Enumerate: `getAllMatchingTicketIds`. Candidates: facts from `tickets` joined to clients, statuses, priorities, boards, users, teams; description from `tickets.attributes.description` (not in the search index); comments from `app_search_index` rows of type `ticket_comment`, newest first, capped per ticket with `ROW_NUMBER`, filtered by `aclPredicateSql` so a client-portal user never sees an internal note; the comment's `metadata.author_kind` names the author as technician, client, or system. Hydrate: `loadTicketListItemsByIds`. The question names the ticket facts and tells Jev to use them only when the query refers to such things.
- **`entities/project.ts`.** Scope is `{ projectIds: uuid[] }` (the Projects list is filtered in the browser over the whole set, so the page sends the ids its chips leave). Enumerate: `authorizeProjectIds` re-authorizes them per row through the same kernel decision `getProjects` applies. Candidates: facts from `projects` joined to clients, contacts, statuses, users; tasks via phases with the status name resolved through the project status mapping (`custom_name`, else the custom or standard status), priority, assignee, due date, description; task comments from `app_search_index` rows of type `project_task_comment`, joined through a derived table of the scoped projects' tasks that carries the uuid as text (the index stores `parent_id` as text). Hydrate: `loadProjectListItemsByIds`.

### Supporting actions and data

- `packages/tickets/src/actions/optimizedTicketActions.ts`: `enrichTicketListItems` extracted from `getTicketsForList`; `loadTicketListItemsByIds(filters, ids)` runs the same base query, authorization, and enrichment as the paginated list and returns rows in the requested order with tags and avatar urls. `getAllMatchingTicketIds` unchanged in behavior.
- `packages/projects/src/actions/projectActions.ts`: `authorizeProjectIds(ids)`, `loadProjectListItemsByIds(ids)` (same joins and manager folding as `getProjects`, plus tags through `TagMapping.getByEntities`), `withAssignedUsers` shared by both. `ProjectModel.getByIds` in `packages/projects/src/models/project.ts`.
- `packages/search/src/indexers/ticket_comment.ts` now writes `metadata.author_kind`; rows indexed earlier read as technician until a backfill or the daily reconcile rewrites them (noted in `docs/deployment/app-wide-search-runbook.md`).

### Route

- Enterprise handler `ee/server/src/app/api/smart-search/[entity]/stream/route.ts`: unknown entity → 404; body validated with `{ scope: definition.scopeSchema, query }` → 400; no session → 401; access denial mapped `FORBIDDEN` 403, `FEATURE_FLAG_OFF` 404, `ADD_ON_REQUIRED` 402, `SMART_SEARCH_NOT_CONFIGURED` 503. The first generator event is pulled before the stream opens so setup failures become status codes, not half-open bodies. Frames are `event: <type>\ndata: <json>\n\n`, a `: keepalive` comment every 15 s, `data: [DONE]` at the end, `event: error` on a mid-stream failure. The request signal and a cancelled body both abort every in-flight TypeSafe call.
- Community delegator `server/src/app/api/smart-search/[entity]/stream/route.ts` with `_ceStub.ts`; community stub `packages/ee/src/app/api/smart-search/[entity]/stream/route.ts` answers 404.
- `server/src/middleware.ts` allow-lists `/api/smart-search/` next to `/api/chat/` (every `/api/*` route otherwise requires an API key).

### Client

- **Availability** is decided in each page's server component: `server/src/app/msp/tickets/page.tsx` and `server/src/app/msp/projects/page.tsx` call `getSmartSearchAvailability(entity)` from `@enterprise/lib/actions/smartSearchActions` (community stub answers false; any failure resolves false) and pass `smartSearchAvailable` down, so the placeholder and button are right on first paint.
- **`ee/server/src/components/smartSearch/useSmartSearchStream.ts`.** Generic over scope, row, and metadata. `run(scope, query)` POSTs to the entity's stream path, parses SSE frames (exported `parseSseFrames`), applies events through the exported `applySmartSearchEvent` reducer (append-only buckets), reports non-2xx JSON errors and `event: error`, and marks a stream that closes without `done` as interrupted. A generation counter and AbortController guard against late frames.
- **`ee/server/src/components/smartSearch/SmartSearchResults.tsx`.** Props: `id`, `entity`, `i18nNamespace`, `scope`, `query`, `runToken`, `scopeStale`, `onRerun`, `columns`, `relevanceColumnIndex`, `rowId`, `hydrateRows`, optional `rowClassName`, `onRowClick`, `onVisibleRowsChange`, `onRowMetadata`, `onExit`. Status strip (scored X of Y, summary, cancelled, error with Retry, "Filters changed. Run again" when the scope key changed, Cancel while running, Back to list otherwise), progress bar, three bucket sections rendered through `DataTable` with the page's own columns plus a Match column, unscored rows hydrated once the stream settles. DataTable is passed `pageSize={rows.length}` because it slices to the page size even with pagination off.
- **`packages/ui/src/components/SmartSearchResults.tsx`** is the community shell (`next/dynamic` to the enterprise panel; `packages/ee/src/components/smartSearch/SmartSearchResults.tsx` renders nothing).
- **Tickets page** (`packages/tickets/src/components/TicketingDashboard.tsx`): smart mode is local state `{active, query, runToken, filtersKey}`; entering it clears the container's keyword filter and selection; the scope is the export filter assembly with `searchQuery: ''`; the panel replaces the table inside the shortcut region and shares columns, row click, selection, and visible-row tracking; streamed metadata is merged into the tag and avatar stores. Select-all-matching now uses the same filter assembly as export (a small fix: the old inline copy dropped the custom due-date range).
- **Projects page** (`packages/projects/src/components/Projects.tsx`): the filter memo is split into `chipFilteredProjects` (chips only) and `filteredProjects` (keyword on top); the scope is the chip-filtered ids and a chip change offers a rerun; the debounced index search is skipped while smart mode is on and resumes on exit; streamed tags are merged into the tag store. Projects has no row selection, so the panel's selection hooks are unused there.
- **Strings**: `smartSearch.*` and a `searchSmart` placeholder in `features/tickets` and `features/projects` for en, de, es, fr, it, nl, pl, pt, plus generated `xx`/`yy`. The panel reads them from the page's namespace so each entity names itself.

### Configuration and docs

- `.env.example` and `ee/server/.env.example` document `TYPESAFE_API_KEY`. Hosted deployments supply it the same way as `OPENROUTER_API_KEY`; no Helm change (the OpenRouter key has none either). Local dev reads secrets from the environment (`SECRET_READ_CHAIN` unset), so the key goes in the server env.
- `docs/deployment/app-wide-search-runbook.md`: what smart search reads from the index and the `author_kind` backfill note.

---

## What is on the branch (file map)

Enterprise engine and handler: `ee/server/src/services/smartSearch/{access,budgets,candidate,entityDefinition,runSmartSearch,scoreBatch,typesafeClient}.ts`, `entities/{index,ticket,project}.ts`; `ee/server/src/app/api/smart-search/[entity]/stream/route.ts`; `ee/server/src/lib/actions/smartSearchActions.ts`; `ee/server/src/components/smartSearch/{SmartSearchResults.tsx,useSmartSearchStream.ts}`; `ee/server/package.json` (+ `@typesafe-ai/sdk`), `package-lock.json`.

Community stubs and delegator: `packages/ee/src/app/api/smart-search/[entity]/stream/route.ts`, `packages/ee/src/components/smartSearch/SmartSearchResults.tsx`, `packages/ee/src/lib/actions/smartSearchActions.ts`; `server/src/app/api/smart-search/[entity]/stream/{route,_ceStub}.ts`; `server/src/middleware.ts`.

Shared contract and shell: `packages/ui/src/lib/smartSearch/types.ts`, `packages/ui/src/components/SmartSearchResults.tsx`.

Tickets: `packages/tickets/src/actions/optimizedTicketActions.ts`, `packages/tickets/src/components/{TicketingDashboard,TicketingDashboardContainer}.tsx`, `packages/tickets/src/lib/smartTicketSearch/types.ts`, `server/src/app/msp/tickets/page.tsx`, `packages/search/src/indexers/ticket_comment.ts`.

Projects: `packages/projects/src/actions/projectActions.ts`, `packages/projects/src/models/project.ts`, `packages/projects/src/components/Projects.tsx`, `packages/projects/src/lib/smartProjectSearch/types.ts`, `server/src/app/msp/projects/page.tsx`.

Strings, config, docs: `server/public/locales/*/features/{tickets,projects}.json`, `.env.example`, `ee/server/.env.example`, `docs/deployment/app-wide-search-runbook.md`, this plan.

Tests: `ee/server/src/__tests__/services/smartSearch.{access,candidate,scoreBatch,runner,ticketEntity,projectEntity}.test.ts`, `ee/server/src/__tests__/unit/smartSearchStream{,.route}.test.ts`, `server/src/test/unit/api/smartSearchStream.delegator.test.ts`, `server/src/test/unit/app/smartSearchAvailabilityPages.contract.test.ts`, `server/src/test/unit/middleware.apiKeyAuth.test.ts`, `packages/tickets/src/components/TicketingDashboard.{smartSearch.contract,i18n}.test.ts`, `packages/tickets/src/actions/optimizedTicketActions.tenantScopedAuth.contract.test.ts`, `packages/projects/src/components/{Projects.smartSearch.contract,projects-i18n-audit}.test.ts`.

---

## Data flow, end to end

1. The page's server component evaluates the gates and renders the list with `smartSearchAvailable`.
2. The user narrows with chips, types "printer keeps going offline", presses Enter. The page enters smart mode (local state), clears the keyword filter, and bumps `runToken`.
3. The panel's hook POSTs `{ scope, query }` to `/api/smart-search/<entity>/stream`.
4. The delegator hands off to the enterprise handler, which validates, authenticates, re-evaluates the gates, and pulls the first event.
5. The runner enumerates the scope (tickets: the chip filters; projects: the posted ids, re-authorized), loads candidate JSON in chunks, packs batches under the token budget, and scores them through a bounded pool. Each scored batch is hydrated through the page's own by-id loader and yielded with the metadata the table needs.
6. The hook appends each scored row to its bucket as it arrives; the strip counts up; Cancel aborts the fetch, which aborts every pending TypeSafe request server-side.
7. `done` closes the stream after one structured log line per search.

## Error handling

| Situation | Behavior |
| --- | --- |
| Community edition | Page never shows the affordance; route answers 404 `ENTERPRISE_EDITION_REQUIRED`. |
| Gate fails (permission, flag, add-on, key) | Affordance hidden; route answers 403 / 404 / 402 / 503 with the reason before any token is spent; the panel shows a friendly line for the add-on and key cases. |
| Bad body | 400 `INVALID_REQUEST`. |
| Enumeration or hydration permission failure | Thrown before the first event → 403; mid-stream → `event: error` and the panel offers Retry. |
| One batch fails after SDK retries | `batch_failed`; the rest continue; the rows appear under "Could not be scored", hydrated after the stream settles. |
| Row vanished between scoring and hydration | Reported as unscored. |
| Client cancels or closes the tab | Abort propagates to every in-flight request; the search ends without `done`; scored rows stay on screen. |
| Connection drops without `done` | Panel keeps what arrived and reports the stream as interrupted. |
| Chips change after a run | Strip offers "Filters changed. Run again"; nothing reruns until clicked. |

---

## Verification

All of the following pass on the branch tip. The Draft Implementation step should run them and report, not rebuild.

```
cd ee/server && NODE_OPTIONS='--max-old-space-size=12288' npx tsc --noEmit
cd ee/server && npx vitest run src/__tests__/services/smartSearch src/__tests__/unit/smartSearchStream.test.ts src/__tests__/unit/smartSearchStream.route.test.ts
cd server && NODE_OPTIONS='--max-old-space-size=12288' npx tsc --noEmit
cd server && npx vitest run src/test/unit/api/smartSearchStream.delegator.test.ts src/test/unit/middleware.apiKeyAuth.test.ts src/test/unit/app/smartSearchAvailabilityPages.contract.test.ts
cd packages/tickets && npx tsc --noEmit && npx vitest run src/components/TicketingDashboard.smartSearch.contract.test.ts src/components/TicketingDashboard.i18n.test.ts src/actions/optimizedTicketActions.tenantScopedAuth.contract.test.ts src/components/TicketingDashboardContainer.urlSync.contract.test.tsx
cd packages/projects && npx tsc --noEmit && npx vitest run src/components/Projects.smartSearch.contract.test.ts src/components/projects-i18n-audit.test.ts src/actions/projectActionsTenantScoped.contract.test.ts src/actions/projectAuthorization.contract.test.ts src/models
cd packages/ui && npx tsc --noEmit
node scripts/validate-translations.cjs
```

What the tests cover: candidate budgeting and truncation; batch packing, the ref-anchored request shape, bucket thresholds, answer mapping; the runner against a fake entity (normalized scope, permission failure, streaming and counts, batch failure continuation, unloadable and vanished rows, per-search and per-process concurrency caps, abort); the access decision order per entity; both entity definitions (state shape, scope normalization, hydration reshaping, question wording with an inline snapshot for tickets); the route (unknown entity, validation, 401, denial-to-status mapping, streaming frames and `[DONE]`, abort propagation); the delegator in both editions; the SSE parser and bucket reducer; the middleware allow-list; and source contracts on both pages and both page server components.

---

## Smoke test script

The feature is hidden on a tenant that fails any gate, and the seeded dev tenant fails two of them by default. Prerequisites on the card's dev stack (port 3008):

1. `TYPESAFE_API_KEY` present in `server/.env.local` (gitignored). Never print it.
2. The AI Assistant add-on on the dev tenant: one row in `tenant_addons` with `addon_key = 'ai_assistant'` for tenant `6d178771-ad9a-4d43-8809-83992745f8f9`. Present as of the design session.
3. `DISABLE_FEATURE_FLAGS=true` in `server/.env.local` (release flags default off without PostHog). Present as of the design session. The dev server reloads `.env.local` on change without a restart.

Note: editing a file under `ee/server/src` while the page is open triggers a fast refresh that reloads the page and drops smart mode (local state). Do the flows without editing code.

Flows, each with a screenshot:

1. **First paint.** Load `/msp/tickets` and `/msp/projects`. The search box placeholder ends with "Enter for smart search" and a Smart search button sits beside it as soon as the heading renders (no pop-in).
2. **Projects search.** On `/msp/projects` with default chips, type `road building and territory expansion`, press Enter. Expected: the panel replaces the table; "Scored 9 projects"; the seeded expansion project is the single Strong match (about 97%); every other project under Unlikely at 6% or below (expand "Unlikely matches" to show them). The server log carries one `[smart-search:project] completed` line with `requests: 1`.
3. **Projects, second query.** Back to list, type `api credentials and monitoring setup`, Enter. Expected: the three template projects carrying an "API Credentials" task and an "Activate Monitoring" task land in Strong or high Possible; the rest Unlikely.
4. **Tickets search.** On `/msp/tickets` with default chips (open tickets), type `email not being received`, Enter. Expected: "Scored 54 tickets" in about six requests; the sender-authentication and inbound-email probe tickets appear in Possible with Match percentages; a `[smart-search:ticket] completed` log line.
5. **Act on partial results.** On tickets, select two rows across buckets and run a bulk status change from the bulk bar: it applies to exactly those rows.
6. **Cancel.** Start a tickets search and press Cancel within the first second: the strip reads "Search cancelled after N of 54 tickets", scored rows remain, no further `[smart-search:ticket]` lines follow.
7. **Chip change.** With results showing, change a chip (a board or status on tickets, a status on projects): the strip shows "Filters changed. Run again"; nothing reruns until clicked; clicking reruns over the new set.
8. **Leave smart mode.** Clear the box: the normal list returns with keyword search live. Escape does the same. Reset filters does the same.
9. **Gate off.** Remove the `tenant_addons` row (or unset `DISABLE_FEATURE_FLAGS`), reload either page: no button, ordinary placeholder. A direct `POST /api/smart-search/ticket/stream` from the page context answers 402 (or 404 for the flag). Restore afterwards.

Simulators or mocks: none. The searches above run against the real TypeSafe API and the real dev database.

## Acceptance

1. In enterprise with every gate passing, Enter in either list's search box scores every row the chips match and shows them in Strong / Possible / Unlikely buckets that fill in as scores arrive, with a progress indicator and a working cancel.
2. Rows never move between or within buckets once placed.
3. On tickets, row click, selection, and every bulk action work on bucket rows exactly as on the main table.
4. The keyword filter is not applied in smart mode; clearing the box restores normal behavior.
5. When any gate fails, or in community edition, nothing about the page changes, and the route refuses before spending a token.
6. A closed tab or cancel stops all TypeSafe requests for that search within one in-flight batch.
7. One structured log line per completed search records tenant, counts, model, input tokens, and duration.
8. No cap on candidate count; a 2,000-row filter completes without error (on the order of a minute at current limits).
9. The affordance is present in the server-rendered page, not added after a client probe.

## Follow-ups (not blocking)

- Bucket thresholds (0.75 / 0.35) are first guesses; tune on tenant data.
- The dev stack's app initialization aborts on a missing `CREDENTIAL_ENCRYPTION_KEY` before it rotates the dev login password. Pre-existing; unrelated to this card; worth its own fix.
- `DataTable` slices to its page size even with pagination off (`LEVERAGE: friction datatable-pagination-false-still-slices` in the panel).
- The ticket description is not in `app_search_index` for keyword search; a real gap, worth its own card.

## Out of scope (deliberately)

- Interpreting the query into filter chips.
- Per-tenant TypeSafe keys and gateway-metered billing (the resolver is shaped for it).
- Client-portal lists.
- Persisting or sharing smart-search results, or URL-encoding smart mode.

## History

The plan was first written for tickets only, with the handler in a community route file and a client-side availability probe. During the same session Robert asked for: ticket facts (status, closed flag, priority, board, assignee, dates) in what Jev reads; gating on `release-v1-6-feature` and the AI Assistant add-on with the handler in the enterprise tree; the same search on Projects, which made the engine entity-neutral; and the availability decision in the page server components. The live smoke test surfaced the text-versus-uuid join on project comments and the index-addressing drift, both fixed. Each of these is recorded as a fact on the card.
