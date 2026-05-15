# App-Wide Search System

App-wide search is a federated, full-text search over every major entity in the
product (tickets, comments, clients, contacts, documents, projects, invoices,
assets, KB articles, etc.). It is backed by a single denormalized PostgreSQL
table, `app_search_index`, kept in sync by an event-driven subscriber with a
nightly reconcile sweep and an on-demand backfill script.

This document describes the architecture, data model, query semantics, access
control, configuration, and operations. For first-time environment rollout
steps, see the deploy runbook: `docs/deployment/app-wide-search-runbook.md`.

## Core Features

### Federated search

A single query returns ranked results across all registered object types. The
results page (`/msp/search`) groups hits by type with per-type counts; the
sidebar palette shows a typeahead dropdown plus a "See all N results" link.

### Typeahead

`searchAppTypeaheadAction` returns the top 5 rows (no snippets) for the sidebar
palette. It also returns an accurate `totalCount` computed by a separate count
query so the "See all N results" link reflects the true match count rather than
the 5-row display cap.

### Partial / prefix matching

Queries match three ways, OR-combined:

1. **Full-text** — `websearch_to_tsquery('english', q)` against `search_vector`
   (stemmed lexeme match, supports phrases/operators).
2. **Prefix** — the query is tokenized, sanitized, and turned into a
   `to_tsquery('english', 'tok1:* & tok2:*')` so `wond` matches `Wonderland`.
3. **Substring / fuzzy** — `title`/`subtitle` `ILIKE '%q%'` plus `pg_trgm`
   similarity (`%`) for typo tolerance.

### Identifier search

Queries shaped like `TIC-1023` or `LAP0042` are detected by regex. Exact
identifier matches are pinned with score `1000`; prefix identifier matches with
`900`. The identifier is read from `metadata->>'identifier'`.

### Relevance ranking

Non-identifier rows are scored by:

```
( ts_rank_cd(search_vector, tsq)
  + ts_rank_cd(search_vector, prefix_tsq) * 0.7        -- when prefix query present
  + GREATEST(similarity(title, q), similarity(subtitle, q)) * 0.4
) * GREATEST( exp(-age_in_seconds / (90 days)), 0.05 )  -- recency decay, floored
```

Sort modes: `relevance` (score desc) or `recent` (`source_updated_at` desc).
Both use keyset pagination on `(score, source_updated_at, object_id)` or
`(source_updated_at, object_id)`.

## Architecture

### Components

| Path | Responsibility |
|---|---|
| `server/src/lib/search/types.ts` | `EntityIndexer`, `SearchDoc`, `SearchObjectType` contracts |
| `server/src/lib/search/index.ts` | Indexer registry (`allIndexers`, `getIndexer`, `registeredObjectTypes`) — merges CE + EE |
| `server/src/lib/search/indexers/*` | One indexer per object type (CE set) |
| `packages/ee/src/lib/search/indexers/index.ts` | EE indexer set (currently empty stub in CE builds) |
| `server/src/lib/search/upsert.ts` | `upsertSearchDoc` / `deleteSearchDoc` |
| `server/src/lib/search/sql.ts` | `buildTsvectorSql` — weighted `tsvector` builder |
| `server/src/lib/search/query.ts` | `runSearchQuery`, `runSearchTypeaheadQuery`, `countSearchMatches`, `countSearchMatchesByType`, cursor + headline helpers |
| `server/src/lib/search/acl.ts` | ACL principal resolution, SQL predicate, per-row visibility verifiers |
| `server/src/lib/actions/searchActions.ts` | `'use server'` actions: `searchAppAction`, `searchAppTypeaheadAction` |
| `server/src/lib/actions/searchActionShared.ts` | Schemas, types, `SearchRateLimitError` (non-async exports kept out of the `'use server'` file) |
| `server/src/lib/eventBus/subscribers/searchIndexSubscriber.ts` | Live indexing from entity events |
| `server/src/lib/jobs/handlers/searchReconcileHandler.ts` | Nightly reconcile sweep |
| `server/src/lib/jobs/handlers/searchVisibleUserReindexHandler.ts` | Re-index rows affected by a user's permission change |
| `server/src/scripts/search-backfill.ts` | One-shot backfill CLI (`npm run search:backfill`) |
| `server/src/components/search/SearchPalette.tsx` | Sidebar typeahead UI |
| `server/src/app/msp/search/` | Results page (`page.tsx` + `SearchPageClient.tsx`) |

### Indexing pipeline

There are three write paths into `app_search_index`:

1. **Live (event-driven)** — `searchIndexSubscriber` subscribes to entity
   events (e.g. `TICKET_COMMENT_ADDED`, `CLIENT_UPDATED`, `DOCUMENT_DELETED`).
   The event bus is Redis Streams based, so indexing runs **off the request
   hot path**. Gated by `SEARCH_INDEX_LIVE` (see Configuration). Delete events
   call `deleteSearchDoc`; all others call `upsertSearchDoc`.
2. **Reconcile (scheduled)** — `search:reconcile` pg-boss job, cron
   `0 6 * * *` per tenant. Re-indexes rows newer than the indexed watermark,
   deletes index rows whose source row is gone, and inserts source rows missing
   from the index.
3. **Backfill (manual)** — `npm run search:backfill` walks every indexer for
   every (or one) tenant and upserts in batches of 500. Used for first-time
   population and after indexer changes.

> Live indexing covers **new writes only**. Rows that predate the feature (or
> predate an indexer fix) require a reconcile pass or a backfill.

## Database Schema

### app_search_index

Migration: `server/migrations/20260513120000_create_app_search_index.cjs`.
Primary key `(tenant, object_type, object_id)`. On Citus, distributed by
`tenant` (co-located writes).

| Column | Type | Notes |
|---|---|---|
| `tenant` | uuid | Tenant scope (always in `WHERE`) |
| `object_type` | text | e.g. `ticket`, `document` |
| `object_id` | text | Source row id |
| `parent_type` / `parent_id` | text | e.g. a `ticket_comment`'s parent `ticket` |
| `title` | text | Weight A in `search_vector` |
| `subtitle` | text | Weight B |
| `body` | text | Weight C (flattened content) |
| `url` | text | Result deep link |
| `metadata` | jsonb | `identifier` lives here for identifier search |
| `visible_to_user_ids` | uuid[] | ACL hint |
| `visible_to_roles` | text[] | ACL hint |
| `is_internal_only` | boolean | ACL hint (e.g. internal comments) |
| `is_private` | boolean | ACL hint |
| `client_scope_id` | uuid | ACL hint |
| `required_permission` | text | e.g. `ticket:read` |
| `search_vector` | tsvector | Weighted, generated via `process_large_lexemes` |
| `search_lang` | text | `english` |
| `source_updated_at` | timestamptz | Recency ranking + reconcile watermark |
| `indexed_at` | timestamptz | Last index write |

Indexes: GIN on `search_vector`; GIN trigram on `title` and `subtitle`;
btree `(tenant, source_updated_at DESC)`; btree `(tenant, object_type)`.

### search_vector construction

`buildTsvectorSql` produces:

```
setweight(public.process_large_lexemes(title),    'A')
|| setweight(public.process_large_lexemes(subtitle),'B')
|| setweight(public.process_large_lexemes(body),    'C')
```

`public.process_large_lexemes(text) RETURNS tsvector` already calls
`to_tsvector('english', …)` internally after stripping base64 image data URIs,
dropping oversized lexemes, and capping input at 500 KB. **Do not** wrap its
result in `to_tsvector` again.

## Indexers

### Indexer contract

```ts
interface EntityIndexer {
  objectType: SearchObjectType;
  sourceEvents: string[];                       // event-bus triggers
  loadOne(knex, tenant, id): Promise<SearchDoc | null>;
  loadBatch(knex, tenant, cursor, limit): Promise<SearchDoc[]>;
}
```

`loadOne` powers live indexing and reconcile spot-checks; `loadBatch` powers
backfill and reconcile sweeps (keyset paginated by the source id).

### Registered indexers (CE)

28 object types: `asset`, `board`, `category`, `client`, `client_contract`,
`contact`, `contract`, `document`, `interaction`, `invoice`, `invoice_item`,
`invoice_annotation`, `kb_article`, `service_catalog`,
`service_request_definition`, `service_request_submission`, `status`, `tag`,
`user`, `ticket`, `ticket_comment`, `project`, `project_phase`, `project_task`,
`project_task_comment`, `schedule_entry`, `time_entry`, `workflow_task`.

EE indexers merge in via `@ee/lib/search/indexers` (empty in CE builds).

### Content extraction

Body text is normalized before indexing (`server/src/lib/search/normalize.ts`):

- `flattenBlockNote(json)` — walks BlockNote JSON extracting `text`/`content`,
  strips base64 image URIs; also accepts a plain string (returns it normalized).
- `flattenMarkdown(md)` — strips markdown syntax to plain text.
- `flattenJsonbPayload(obj)` — flattens arbitrary jsonb, skipping secret-like keys.
- `truncateForIndex(text, 65536)` — byte cap on indexed body.

Content lives in different places per entity, so indexers must read the right
source:

- **Documents** — content can live in `documents.content`,
  `document_content.content` (plain text side table), or
  `document_block_content.block_data` (BlockNote jsonb). The document indexer
  joins all three and concatenates.
- **Ticket comments** — `comments.note` may be plain text **or** BlockNote
  JSON; the readable text is mirrored in `comments.markdown_content`. The
  indexer prefers `markdown_content` (via `flattenMarkdown`), else uses
  `flattenBlockNote` for JSON notes / `flattenMarkdown` for plain notes.
- **Tags** — `tag_definitions` rows share the same `tag_text` across different
  `tagged_type`s (e.g. a "Urgent" ticket tag vs. a "Urgent" project-task tag).
  The indexer sets `subtitle` to a humanized `tagged_type` label
  (e.g. "Ticket tag", "Project task tag") so otherwise-identical tag titles are
  distinguishable in results. `tagged_type` is also kept in `metadata`.
- **Status** — only **ticket** statuses are indexed (project / project_task /
  interaction statuses have no global "all items in status X" destination, so
  they were dead-end results and are excluded). Ticket statuses are
  board-scoped, so the same name (e.g. "Open") exists once per board; the
  indexer **dedupes by name** (`DISTINCT ON (name)`, one row per distinct
  name, `object_id = name`) to mirror the ticketing dashboard, which groups
  its status filter by name. The result links to the dashboard's own
  name-based filter value
  (`/msp/tickets?statusId=__status_name__:<encodedName>`, built via
  `URLSearchParams` — no `boardId`); the prefix constant is mirrored from
  `packages/tickets/src/lib/ticketStatusFilter.ts`. Because `object_id` is the
  name, `loadOne` resolves by `status_id` **or** `name` (live-event path vs.
  reconcile's delete-sweep), and the `status` visibility verifier matches on
  `name` + `status_type='ticket'`.

> Indexer column lists must match the live schema. Several columns differ from
> intuition: tickets use `entered_at` (not `created_at`); `clients` has
> `billing_email` (no `email`/`phone_no`); `contacts` has no `phone_number`;
> `users` has no `role` column (roles are a join table); `documents` has no
> `client_id` (associations live in `document_associations`).

## Query Semantics

`runSearchQuery` builds a single CTE query:

- `q` CTE computes `tsq` (websearch), `prefix_tsq` (nullable prefix tsquery),
  `raw`, and `identifier`.
- `ranked` CTE applies the match predicate, computes score, and (for full
  search) a sanitized `ts_headline` snippet.
- Outer query applies the keyset cursor predicate, ORDER BY, LIMIT/OFFSET.

`countSearchMatches` / `countSearchMatchesByType` run the same match predicate
without ranking/limit to produce accurate totals and per-type group counts.
These intentionally skip the per-row visibility verifier (the SQL-level ACL
predicate already enforces the bulk of access control), so counts may slightly
over-count in rare ACL-drift cases — an acceptable trade for accurate totals.

### Snippet safety

`ts_headline` is configured with module-constant sentinels
(`__SEARCH_MARK_START__` / `__SEARCH_MARK_STOP__`). `sanitizeHeadline`
HTML-escapes the raw headline and only converts the sentinel pairs into
`<mark>` tags, so result snippets cannot inject HTML.

## Access Control

Three layers, all tenant-scoped:

0. **Coarse type gate** (`filterTypesByPermission` + `TYPE_REQUIRED_PERMISSION`
   in `searchActions.ts`) — before querying, an object type is included only
   if the principal holds at least one of its required permissions. The map
   value is `string | readonly string[]`; types whose rows can require
   different permissions list all of them (e.g. `status` →
   `['ticket:read', 'project:read']`) so no class of user is wrongly excluded.
   This is only a pre-filter to shrink the query — the authoritative check is
   the per-row `required_permission` enforced below.
1. **SQL-level predicate** (`aclPredicateSql`) — a static SQL fragment with
   bound parameters, ANDed into every search/count query. Enforces
   `required_permission` membership, `visible_to_user_ids`,
   `visible_to_roles`, `is_internal_only`, `is_private`, and
   `client_scope_id` against the resolved principal.
2. **Per-row visibility verifiers** (`verifyResultVisibility`) — a defensive
   second pass for object types that need a live source check (e.g.
   `document` verifies existence + client access via `document_associations`;
   `workflow_task` checks assignment). Applied to the fetched result page only
   (not to counts).

The principal is resolved once per action via `resolveSearchAclPrincipal`
(MSP vs client-portal aware). When a user's permissions change, enqueue
`searchVisibleUserReindexHandler` to refresh affected rows' ACL hints.

### Client scoping (`ClientAccess`)

`client_scope_id` scopes a row to one client so client-portal users only see
their own client's data. The principal carries a `ClientAccess` value, the
single source of truth resolved by `resolveClientAccess(user)`:

- `{ mode: 'scoped', clientIds }` — client-portal users (their one client).
- `{ mode: 'all' }` — internal/MSP users (currently always unrestricted).

`mode: 'all'` makes the client-scope clause a no-op `TRUE` with **no array
binding** — internal users do **not** trigger a `clients` table scan, and no
large UUID array is bound into the (3×) per-search queries. This is the
single seam for future **ABAC per-internal-user client restrictions**: when
those land, `resolveClientAccess` returns `{ mode: 'scoped', clientIds }` for
restricted internal users and both the SQL predicate and the per-row verifier
enforce it automatically — no `isInternal` shortcut to audit, and the SQL
predicate / verifier can never disagree (the prior empty-array overload, where
`= ANY('{}')` meant "none" in SQL but "all" in the verifier, is gone).

## Configuration

| Setting | Default | Effect |
|---|---|---|
| `SEARCH_INDEX_LIVE` | `false` | When `true`, the event subscriber writes to the index on entity events. When unset/false the subscriber acknowledges events without DB writes — index only updates via reconcile/backfill. Helm: `server.searchIndexLive`. |
| Full-search rate limit | 10 / sec / user | `searchAppAction`; exceeding throws `SearchRateLimitError` (HTTP 429, `retryAfterMs`). |
| Typeahead rate limit | 30 / sec / user | `searchAppTypeaheadAction`. |
| Search query length cap | 200 chars | `parseQuery` throws `SearchQueryError('query_too_long')`. |
| Page size | 25 | `/msp/search` fetches `limit + 1` for cursor detection. |
| Reconcile cron | `0 6 * * *` per tenant | `scheduleSearchReconcileJob`. |

## Operations

### Backfill

```bash
# All tenants, all indexers
npm run search:backfill

# One tenant
npm run search:backfill -- --tenant=<tenant_uuid>

# One object type
npm run search:backfill -- --tenant=<tenant_uuid> --type=ticket_comment
```

The script logs and continues per indexer (one failing indexer does not abort
the run) and prints a failure summary at the end. It connects via
`server/knexfile.cjs` using the standard `DB_*` env / secrets; point
`DB_HOST`/`DB_PORT` at the target database when running outside the container
network.

### Reconcile

`search:reconcile` runs nightly per tenant. To force an immediate run, enqueue
an immediate pg-boss job with `{ "tenantId": "<uuid>" }` on the
`search:reconcile` queue (handler: `searchReconcileHandler`). The handler is
registered in `registerAllHandlers.ts`.

### Health check

```sql
SELECT object_type, count(*), max(indexed_at)
FROM app_search_index
WHERE tenant = '<tenant_uuid>'
GROUP BY object_type
ORDER BY object_type;
```

## Telemetry

`searchActions` emit structured logs via `logger.info('[Search] metric', …)`:

- `search.query.count` — every query (variant: `full` | `typeahead`).
- `search.query.empty` — query returned zero results.
- `search.query.latency_ms` — wall-clock latency, always emitted (finally).

ACL drift (a row passing the SQL predicate but failing a per-row verifier) is
reported via `emitAclDrift`.

## Security Considerations

- **SQL injection** — all user input reaches SQL exclusively as bound
  parameters (`?`). The only string-interpolated SQL fragments are
  module constants, boolean-selected static literals (sort/snippet branches),
  and `aclPredicateSql`'s static fragment. No user input is concatenated.
- **Prefix tsquery** — user input is lower-cased and stripped to
  `\p{L}\p{N}\s` before being turned into `tok:*` terms, so it cannot inject
  `to_tsquery` operators.
- **XSS** — snippets are HTML-escaped; only sentinel-delimited spans become
  `<mark>`.
- **Tenant isolation** — every search/count query includes
  `s.tenant = ?::uuid`; on Citus the table is distributed by `tenant`.
- **Permission gating** — `required_permission` + ACL hints filter at SQL
  level; per-row verifiers add a defensive check on the result page.

## Frontend

- **Sidebar palette** (`SearchPalette.tsx`) — debounced typeahead (200ms),
  shows ≤5 rows + "See all N results" linking to `/msp/search?q=…`.
- **Results page** (`SearchPageClient.tsx`) — debounced URL sync; "All" view
  groups by type (≤10 rows/section) with per-type count chips; single-type
  view shows the full page (≤25) with cursor prev/next. The query input is the
  source of truth while typing; URL→input resync only occurs on external
  navigation (back/forward), guarded by a `previousInitialQueryRef` so an
  in-flight server re-render cannot clobber typed characters.

## Testing

Unit + contract tests live in `server/src/test/unit/search*.test.ts`
(query/SQL/ACL/indexers/actions/subscriber/backfill/reconcile, plus contract
tests for i18n, hash anchors, migration, deploy, UI). Integration tests
(`server/src/test/integration/*search*`) require a live database.

Run the unit suite:

```bash
cd server && npx vitest run src/test/unit/search*.test.ts
```

## Known Limitations

- Counts skip per-row visibility verifiers (slight over-count under ACL drift).
- The "All" results view caps each type section at 10 rows; use the type chip
  for the full, paginated per-type list (deliberate federated-search UX — the
  grouped view is not globally paginated).
- Live indexing must be explicitly enabled (`SEARCH_INDEX_LIVE=true`);
  otherwise the index only updates nightly or via backfill.
- Only **ticket** statuses are searchable. Project / project_task /
  interaction statuses are intentionally not indexed (no global per-status
  destination); discovering them by name is a projects-module faceting
  concern, not global search.
