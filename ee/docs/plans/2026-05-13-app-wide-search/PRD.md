# App-Wide Search — PRD

**Plan ID:** 2026-05-13-app-wide-search
**Owner:** Natallia Bukhtsik
**Status:** Draft (pending scope confirmation)
**Date:** 2026-05-13

---

## 1. Summary

Add a global full-text search bar to the MSP navigation sidebar that finds records across all major entities in the system — clients, contacts, team members, tickets, ticket comments, projects, project tasks and their comments, assets, invoices, contracts/quotes, documents, KB articles, the service catalog, service requests, workflow tasks, schedule entries, interactions, and time-entry notes. The search is powered by a single tenant-scoped index table (`app_search_index`) using PostgreSQL FTS (`tsvector`/GIN) with a `pg_trgm` fuzzy fallback. The index is kept in sync via event-bus-driven incremental updates, with a one-time backfill and a periodic reconciliation job. Per-entity authorization is enforced both via denormalized ACL columns on the index and via record-level checks before snippets are returned.

## 2. Problem Statement

Today there is no way to "just find a thing" in Alga PSA. To locate a record, users must know which area of the app it lives in, navigate to that area, and use entity-specific filters. Cross-entity discovery (e.g., "any record that mentions ACME") is impossible. This costs MSP technicians and dispatchers measurable time on every ticket triage, project lookup, and client phone-call workflow.

## 3. Goals

- **G1 — Single search input** in the MSP sidebar that returns relevant records across all major entity types in under ~300 ms p50 for a tenant of typical size.
- **G2 — Wide entity coverage.** A v1 user can find clients, contacts, team members, tickets, ticket comments, projects, project tasks, project task comments, assets, invoices (incl. line items + annotations), contracts (incl. quote drafts), documents, KB articles, service catalog items, service requests, workflow tasks, schedule entries, interactions, time-entry notes, boards, categories, and tags.
- **G3 — Tenant isolation.** No query ever returns a row from another tenant. Enforced at the schema (tenant in PK + distribution column) and query (mandatory `tenant = ?` predicate) layers.
- **G4 — Permission correctness.** Search never surfaces titles, snippets, or even the existence of records the user cannot read in the app proper. Internal ticket comments stay hidden from non-internal users. Private documents stay hidden.
- **G5 — Fresh-enough index.** Newly created/edited records appear in search within seconds (event-bus indexing latency). Worst-case staleness (during reconciliation lag) is bounded to under 24 hours.
- **G6 — Fuzzy matching.** Users can type partial tokens (`acm`), shortened IDs (`tic-10`), and minor misspellings (`exhcange`) and still get useful results.
- **G7 — Pluggable.** Adding a new entity type to the search index is a single registry entry plus an indexer module; no schema migrations required after v1.

## 4. Non-Goals

- **Client portal search.** Out of scope for v1. Will reuse the index and ACL infrastructure in v2.
- **Semantic / vector / embedding search.** Out of scope. The index table is designed so this can be added later as an additional column without restructuring.
- **Saved searches, search analytics dashboards, or admin tooling** for tuning relevance.
- **Cross-tenant federation** for support admins.
- **Search-driven bulk operations** (e.g., "find all tickets matching X and reassign").
- **Highlighting inside the destination page** beyond a deep-link anchor where one trivially exists (e.g., ticket comment hash).
- **Replacing entity-specific filters.** The existing `/api/v1/*/search` endpoints stay; this is additive.

## 5. Users & Primary Flows

### Personas

- **MSP Technician** — receives a phone call, needs to find a client and their open tickets in seconds.
- **MSP Dispatcher** — needs to find the right ticket/project/asset across hundreds of records to assign or schedule work.
- **MSP Manager** — needs to discover invoices, contracts, or KB articles by partial title or content.

### Primary flows

1. **Type-and-jump.** User clicks the sidebar search (or presses `Cmd/Ctrl+K`), types a few characters, sees grouped results in a dropdown, presses Enter or clicks → navigates directly to the canonical URL of the chosen record.
2. **Find a comment in a ticket.** User searches for a phrase they remember a tech mentioning. A ticket-comment result links to `/msp/tickets/{ticket_id}#comment-{comment_id}`. The destination page scrolls and highlights that comment briefly.
3. **Find a client by partial name.** User types `acm` — sees ACME Corp, ACME Holdings, and any tickets/contracts containing "acme" in their title.
4. **Find by ticket number.** User types `TIC-1023` — gets the ticket as the top result regardless of FTS tokenization.
5. **Empty result.** User searches for something that doesn't exist; sees a clear "no results" state with their query echoed back.

## 6. UX / UI Notes

The primary search surface is a dedicated **results page** at `/msp/search?q=...`. The sidebar input acts as a launcher with a minimal typeahead for the very top hits — it's not the surface users read through. Every search produces a real, shareable URL; every result row is a real anchor so `Cmd/Ctrl+click` opens in a new tab natively.

### 6.1 Sidebar launcher + typeahead

- **Location.** Persistent input at the top of the MSP sidebar (`server/src/components/layout/Sidebar.tsx`). Also openable via `Cmd/Ctrl+K`.
- **Typeahead behavior.** Debounced 200 ms; shows **up to 5 title-only suggestions** (no snippets, no group headers) ranked across all types. The last entry is always `→ See all N results` which navigates to `/msp/search?q=...`.
- **Keyboard.** ↑/↓ to navigate, Enter on a row opens that record, Enter on the input (or on "See all results") goes to the results page, Esc closes.
- **Rows are real `<a>` elements** with `href` pointing at the canonical URL — Cmd/Ctrl+click and middle-click open in new tabs without extra code.
- **Empty state.** Quiet — typeahead just doesn't render until ≥2 chars.

### 6.2 Results page (`/msp/search`)

- **URL is the state.** `?q=`, `?type=` (filter), `?cursor=` (pagination), `?sort=` (relevance | recent). Bookmarkable, shareable, back-button-safe.
- **Layout.** Filter chips across the top (`All`, then one per entity type with a count badge); grouped results below by entity type when `type=All`, flat list when a single type is selected.
- **Each result row** shows entity icon, title, subtitle (e.g., client name for a ticket), `ts_headline` snippet for body matches, and a relative `updated_at` tag.
- **Pagination.** Cursor-based "prev / next"; default 25 rows/page; "Load more" is acceptable as an alternate.
- **Per-row affordances.** Click to navigate, Cmd/Ctrl+click to open in new tab (native anchor behavior), right-click for browser context menu (also free with anchors).
- **Empty state.** Echoes the query, suggests broader filters or removing the type filter, links to entity-type filtered pages.
- **Loading state.** Skeleton rows; debounced server hits at 200 ms while the user types in the results-page input (mirrors the sidebar input).

### 6.3 Shared

- **i18n.** All UI strings go through `useTranslation('msp/core')` under a new `search.*` namespace.
- **Accessibility.** Stable kebab-case `id`s for the UI reflection system; ARIA `combobox` semantics on the sidebar input; ARIA `region` semantics on the results page; high-contrast snippet highlight; keyboard-only flows tested end to end.
- **Snippet HTML.** `ts_headline` HTML is sanitized at the server-action boundary (allow only `<mark>`); the React component renders via a trusted-string wrapper, never `dangerouslySetInnerHTML` of unsanitized output.

## 7. Entity Scope

All of the following are indexed at v1 launch. Adding/removing entities later is one registry entry + one indexer module.

| # | Entity | Source table(s) | Title field | Subtitle / body fields | Deep-link URL pattern | ACL strategy |
|---|---|---|---|---|---|---|
| 1 | Client | `clients` | `client_name` | `email`, `phone_no`, `notes` | `/msp/clients/{client_id}` | Tenant-wide (MSP) |
| 2 | Contact | `contacts` | `full_name` | `email`, `phone_number`, `role` | `/msp/contacts/{contact_name_id}` | Tenant-wide (MSP) |
| 3 | Team member | `users` (internal only) | `first_name last_name` | `username`, `email`, `title` | `/msp/team/{user_id}` | Tenant-wide (MSP); excludes client-type users |
| 4 | Ticket | `tickets` | `title` | `ticket_number`, client name (denormalized) | `/msp/tickets/{ticket_id}` | Ticket permission + board scope |
| 5 | Ticket comment | `comments` (parent: ticket) | parent ticket title | `note` (markdown → text) | `/msp/tickets/{ticket_id}#comment-{comment_id}` | Ticket permission + `is_internal` flag |
| 6 | Project | `projects` | `project_name` | `description` | `/msp/projects/{project_id}` | Project permission + client scope |
| 7 | Project phase | `project_phases` | `phase_name` | `description`, parent project name | `/msp/projects/{project_id}/phases/{phase_id}` | Inherits project ACL |
| 8 | Project task | `project_tasks` | `task_name` | `description` | `/msp/projects/{project_id}/tasks/{task_id}` | Inherits project ACL |
| 9 | Project task comment | `project_task_comments` | parent task name | `markdown_content` (preferred) or BlockNote→text | `/msp/projects/{project_id}/tasks/{task_id}#comment-{task_comment_id}` | Inherits project ACL |
| 10 | Asset | `assets` | `name` | `asset_tag`, `serial_number`, `location`, JSONB `attributes` → flattened | `/msp/assets/{asset_id}` | Tenant-wide; respects client-scope filters |
| 11 | Invoice | `invoices` | `invoice_number` | client name (denormalized), `total`, `status` | `/msp/invoices/{invoice_id}` | Invoice permission |
| 12 | Invoice line item | `invoice_items` | parent invoice number | `description` | `/msp/invoices/{invoice_id}#item-{item_id}` | Inherits invoice ACL |
| 13 | Invoice annotation | `invoice_annotations` | parent invoice number | `content` | `/msp/invoices/{invoice_id}#annotation-{annotation_id}` | Inherits invoice ACL |
| 14 | Contract | `contracts` | `contract_name` | `contract_description`; subtitle="Quote" when `status='draft'` else "Contract" (statuses: `active`, `draft`, `terminated`, `expired`) | `/msp/billing/contracts/{contract_id}` | Contract permission |
| 15 | Client contract | `client_contracts` (joins `contracts` + `clients`) | derived: `{client_name} – {contract_name}` | dates + status | `/msp/clients/{client_id}/contracts/{client_contract_id}` | Inherits client + contract ACL via `client_scope_id` |
| 16 | Document | `documents` (`content` column holds BlockNote JSON) | `document_name` | `content` (BlockNote→text, truncated to 64 KB) | `/msp/documents/{document_id}` | Document permission; tenant-wide visibility at v1 (no internal share mechanism exists); optional `client_scope_id` from `documents.client_id` |
| 17 | KB article | `kb_articles` (FK to `documents`) | document name | document content (BlockNote→text) | `/msp/knowledge-base/{article_id}` | KB read permission |
| 18 | Service catalog item | `service_catalog` | `service_name` | `description`, JSONB `attributes` → flattened | `/msp/billing/services/{service_id}` | Service catalog permission |
| 19 | Service request submission | `service_request_submissions` | `request_name` | `submitted_payload` JSONB → flattened strings | `/msp/service-requests/{submission_id}` | Service request permission |
| 20 | Service request definition | `service_request_definitions` | `name` | `description` | `/msp/service-requests/definitions/{definition_id}` | Admin permission |
| 21 | Workflow task | `workflow_tasks` (note: PK is `task_id` alone, not `(tenant, task_id)`; `tenant` is a regular column) | `title` | `description` | `/msp/workflow-tasks/{task_id}` | Workflow task permission + assignee scope via `assigned_users` jsonb |
| 22 | Interaction | `interactions` | `title` | interaction type name + counterparty (client/contact/ticket); `notes` (BlockNote→text) as body | `/msp/interactions/{interaction_id}` | Interaction permission |
| 23 | Schedule entry | `schedule_entries` | `title` | `notes` | `/msp/schedule/{entry_id}` | Schedule permission + assignee scope |
| 24 | Time entry | `time_entries` | derived (work item + date) | `notes` | links to parent work item | Time-entry permission + owner scope |
| 25 | Board | `boards` | `channel_name` | — | `/msp/tickets?board={board_id}` | Tenant-wide |
| 26 | Category | `categories` | `category_name` | — | `/msp/tickets?category={category_id}` | Tenant-wide |
| 27 | Tag | `tags` | `tag_text` | — | filter link | Tenant-wide |

**Note on quotes.** The codebase has no separate `quotes` table; quotes are draft `contracts`. The indexer flags `status = 'draft'` contracts with `subtitle = "Quote"` so users searching "quote" get sensible results.

## 8. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ MSP UI (Next.js)                                                    │
│  Sidebar.tsx ──► SearchPalette (cmdk) ──► searchAppAction()         │
└─────────────────────────────────────────────────────────────────────┘
                          │ withAuth server action
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Search service (server/src/lib/search/)                             │
│  • buildQuery(query, allowedTypes, user)                            │
│  • runQuery(knex, …)  → FTS + pg_trgm fallback                      │
│  • applyAcl(user, rows) → record-level final filter (defence-in-    │
│    depth on top of denormalized ACL columns)                        │
│  • formatResults() → snippets via ts_headline                       │
└─────────────────────────────────────────────────────────────────────┘
                          │ knex
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Postgres / Citus                                                    │
│  app_search_index  (distributed by tenant)                          │
│  • GIN(search_vector)                                               │
│  • GIN(title gin_trgm_ops), GIN(subtitle gin_trgm_ops)              │
└─────────────────────────────────────────────────────────────────────┘
                          ▲
                          │ upsert / delete
┌─────────────────────────────────────────────────────────────────────┐
│ Indexer framework (server/src/lib/search/indexers/)                 │
│  Registry: { client, contact, ticket, ticket_comment, … }           │
│  Each entry implements:                                             │
│    • async loadOne(tenant, id) → SearchDoc | null                   │
│    • async loadBatch(tenant, cursor, limit) → SearchDoc[]           │
│    • sourceEvents: EventType[]                                      │
└─────────────────────────────────────────────────────────────────────┘
                          ▲
        ┌─────────────────┼──────────────────┐
        │                 │                  │
  ┌──────────┐    ┌──────────────┐   ┌──────────────────┐
  │ Event    │    │ Backfill     │   │ Reconciliation   │
  │ bus      │    │ CLI / job    │   │ pg-boss cron     │
  │ sub      │    │              │   │  (daily diff)    │
  └──────────┘    └──────────────┘   └──────────────────┘
        ▲
        │ event-bus events
  ┌──────────┐
  │ Existing │  TICKET_CREATED, TICKET_UPDATED, TICKET_COMMENT_ADDED,
  │ publish  │  + new: CLIENT_*, CONTACT_*, PROJECT_*, ASSET_*,
  │ sites    │    INVOICE_*, CONTRACT_*, DOCUMENT_*, USER_*, etc.
  └──────────┘
```

## 9. Data Model

### 9.1 `app_search_index` table

```sql
CREATE TABLE app_search_index (
  tenant                uuid        NOT NULL,
  object_type           text        NOT NULL,   -- 'client' | 'ticket' | ...
  object_id             text        NOT NULL,   -- text to accommodate composite ids
  parent_type           text,
  parent_id             text,

  title                 text        NOT NULL,
  subtitle              text,
  body                  text,                   -- capped at 64 KB

  url                   text        NOT NULL,
  metadata              jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Denormalized ACL hints
  visible_to_user_ids   uuid[]      NOT NULL DEFAULT '{}',   -- empty = no per-user restriction
  visible_to_roles      text[]      NOT NULL DEFAULT '{}',   -- empty = no role restriction
  is_internal_only      boolean     NOT NULL DEFAULT false,  -- e.g., internal ticket comments
  is_private            boolean     NOT NULL DEFAULT false,  -- e.g., private documents
  client_scope_id       uuid,                                -- if set, only users with access to this client can see
  required_permission   text,                                -- e.g., 'ticket:read'

  -- Search columns
  search_vector         tsvector    NOT NULL,
  search_lang           text        NOT NULL DEFAULT 'english',

  -- Bookkeeping
  source_updated_at     timestamptz NOT NULL,   -- the source row's updated_at, used by reconciliation
  indexed_at            timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant, object_type, object_id)
);

-- Citus
SELECT create_distributed_table('app_search_index', 'tenant');

-- Indexes
CREATE INDEX app_search_index_vector_gin
  ON app_search_index USING gin (search_vector);

CREATE INDEX app_search_index_title_trgm
  ON app_search_index USING gin (title gin_trgm_ops);

CREATE INDEX app_search_index_subtitle_trgm
  ON app_search_index USING gin (subtitle gin_trgm_ops);

CREATE INDEX app_search_index_recent
  ON app_search_index (tenant, source_updated_at DESC);

CREATE INDEX app_search_index_type
  ON app_search_index (tenant, object_type);
```

### 9.2 `SearchDoc` interface

The indexer-side representation, converted to a row at insert time. Defined in `server/src/lib/search/types.ts`.

```typescript
export interface SearchDoc {
  tenant: string;
  objectType: SearchObjectType;
  objectId: string;
  parentType?: SearchObjectType;
  parentId?: string;
  title: string;
  subtitle?: string;
  body?: string;
  url: string;
  metadata?: Record<string, unknown>;
  acl: {
    visibleToUserIds?: string[];
    visibleToRoles?: string[];
    isInternalOnly?: boolean;
    isPrivate?: boolean;
    clientScopeId?: string;
    requiredPermission?: string;
  };
  sourceUpdatedAt: Date;
}
```

### 9.3 Body normalization

A new utility, `server/src/lib/search/normalize.ts`:

- `flattenBlockNote(json: unknown): string` — walks BlockNote JSON, concatenating text nodes, dropping image data URIs.
- `flattenMarkdown(md: string): string` — strips markdown formatting tokens.
- `flattenJsonbPayload(obj: unknown): string` — recursively pulls string leaves out of a JSONB blob (used for service-request submissions and asset attributes).
- `truncateForIndex(text: string, maxBytes = 65_536): string` — UTF-8-safe byte cap.

The existing `public.process_large_lexemes()` Postgres function is reused as the final cleanser of the body string before `to_tsvector` is computed in the indexer.

## 10. Indexer Framework

Located at `server/src/lib/search/indexers/`. One file per entity type:

```
server/src/lib/search/
  index.ts                         (registry)
  types.ts                         (SearchDoc, SearchObjectType union)
  normalize.ts
  upsert.ts                        (knex upsert into app_search_index)
  query.ts                         (FTS + pg_trgm)
  acl.ts                           (record-level filter helpers)
  ts_headline.ts                   (snippet builder)
  indexers/
    client.ts
    contact.ts
    user.ts
    ticket.ts
    ticket_comment.ts
    project.ts
    project_phase.ts
    project_task.ts
    project_task_comment.ts
    asset.ts
    invoice.ts
    invoice_item.ts
    invoice_annotation.ts
    contract.ts
    client_contract.ts
    document.ts
    kb_article.ts
    service_catalog.ts
    service_request_submission.ts
    service_request_definition.ts
    workflow_task.ts
    interaction.ts
    schedule_entry.ts
    time_entry.ts
    board.ts
    category.ts
    tag.ts
```

Each indexer exports:

```typescript
export const clientIndexer: EntityIndexer = {
  objectType: 'client',
  sourceEvents: ['CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_DELETED'],
  loadOne: async (knex, tenant, id) => { /* … */ return doc | null },
  loadBatch: async (knex, tenant, cursor, limit) => { /* … */ return docs[] },
};
```

The registry exports `getIndexer(objectType)` and `allIndexers()`.

## 11. Indexing Pipeline

### 11.1 Event-driven (real-time)

A new subscriber at `server/src/lib/eventBus/subscribers/searchIndexSubscriber.ts` listens to all configured `sourceEvents`. On each event it:

1. Looks up the indexer via the registry.
2. For `*_DELETED` events, deletes the row from `app_search_index`.
3. For `*_CREATED` / `*_UPDATED` events, calls `indexer.loadOne()` and upserts.

**Cascade events.** Some entities depend on others:
- A ticket update re-indexes the ticket. It also touches all ticket comments because their `parent.title` (denormalized) may have changed → handled by the ticket indexer dispatching `TICKET_COMMENT_REINDEX` for each comment.
- An invoice update re-indexes line items + annotations.
- A project update re-indexes phases + tasks (capped, async).

### 11.2 Gap: new events

The recon shows event-bus emission exists for ticket/comment events but NOT for clients/contacts/projects/assets/invoices/contracts/documents. **The plan adds the missing publishes** (one feature per entity family) at the existing action call sites. Use the schema in `server/src/lib/eventBus/events.ts`.

### 11.3 Backfill (one-time)

A new CLI script `server/src/scripts/search-backfill.ts` (also runnable via npm script `npm run search:backfill`) that:

1. Iterates all tenants (or one specific tenant via flag).
2. For each indexer, pages through `loadBatch()` in chunks of 500 and upserts.
3. Logs progress to stdout and a row count summary per entity type per tenant.
4. Is idempotent — re-running upserts overwrite.

### 11.4 Reconciliation (periodic)

A `pg-boss` job `search:reconcile` scheduled daily:

1. For each tenant and each entity type, SELECT rows from the source table where `updated_at > (max(source_updated_at) for that type)`.
2. Re-index those rows.
3. Also: SELECT source IDs missing from the index → re-index. SELECT index IDs missing from source → delete.

This catches drift from dropped events, manual SQL changes, or bugs.

### 11.5 ACL re-index triggers

Permission/assignment changes need to refresh denormalized ACL columns:

- Ticket reassignment → re-index the ticket and its comments.
- Document permission change → re-index the document.
- User role change → background job re-indexes affected rows for that user's `visible_to_user_ids` membership. (Acceptable to run async; max staleness ~10 min via a pg-boss job triggered by user-update events.)

## 12. Search Server Action

New action at `server/src/lib/actions/searchActions.ts`:

```typescript
export const searchAppAction = withAuth(async (
  user,
  { tenant },
  input: SearchAppInput
): Promise<SearchAppResult> => {
  const { query, types, limit = 30, cursor } = input;
  // 1. Trim/validate query
  // 2. Determine allowedTypes = types ∩ entitiesUserCanRead(user)
  // 3. Build SQL: WHERE tenant = ? AND object_type = ANY(?) AND acl_filter(user)
  //    ORDER BY rank DESC, source_updated_at DESC
  //    LIMIT (limit + ACL_OVERFETCH_BUFFER) OFFSET cursor
  // 4. Run record-level ACL pass for defence-in-depth
  // 5. Format snippets with ts_headline
  // 6. Return grouped results
});
```

### Input

```typescript
interface SearchAppInput {
  query: string;
  types?: SearchObjectType[];   // omit = all the user can see
  limit?: number;               // default 30, max 100
  cursor?: string;              // opaque, encodes (rank, object_id)
}
```

### Output

```typescript
interface SearchResultRow {
  type: SearchObjectType;
  id: string;
  parentId?: string;
  title: string;
  subtitle?: string;
  snippet?: string;             // ts_headline output, sanitized to allow only <mark>
  url: string;
  score: number;
  updatedAt: string;            // ISO
}

interface SearchAppResult {
  results: SearchResultRow[];
  groups: Record<SearchObjectType, number>;   // counts by type, before pagination
  totalCount: number;
  nextCursor?: string;
}
```

### Variants

- `searchAppAction(input)` — full results, used by the results page.
- `searchAppTypeaheadAction(input)` — top-5 title-only suggestions for the sidebar, optimised for sub-100 ms p50. Skips snippet generation and grouping. Reuses the same query builder under the hood, with `limit=5` and `snippet=false`.

## 13. Ranking & Snippets

### 13.1 SQL shape (simplified)

```sql
WITH q AS (
  SELECT websearch_to_tsquery('english', $query) AS tsq,
         $query AS raw
)
SELECT
  s.object_type, s.object_id, s.parent_id, s.title, s.subtitle, s.url,
  s.source_updated_at,
  ts_rank_cd(s.search_vector, q.tsq) AS fts_rank,
  GREATEST(
    similarity(s.title,    q.raw),
    similarity(s.subtitle, q.raw)
  ) AS trgm_rank,
  ts_headline('english', s.body, q.tsq,
              'MaxFragments=2,StartSel=<mark>,StopSel=</mark>') AS snippet
FROM app_search_index s, q
WHERE s.tenant = $tenant
  AND s.object_type = ANY($allowedTypes)
  AND acl_predicate(s, $user)
  AND (
    s.search_vector @@ q.tsq
    OR s.title    % q.raw          -- pg_trgm fuzzy
    OR s.subtitle % q.raw
  )
ORDER BY
  -- Weighted composite: prefer FTS hits, then trigram, then recency
  (fts_rank * 1.0 + trgm_rank * 0.4)
    * exp(-EXTRACT(epoch FROM (now() - source_updated_at)) / (90 * 86400))
  DESC,
  s.source_updated_at DESC,
  s.object_id
LIMIT $limit OFFSET $offset;
```

### 13.2 Field weighting

Per indexer, body strings are composed before `to_tsvector` is computed:

```typescript
search_vector =
  setweight(to_tsvector('english', title    ), 'A')   -- highest
  || setweight(to_tsvector('english', subtitle), 'B')
  || setweight(to_tsvector('english', body    ), 'C');
```

### 13.3 Identifier matches

Short identifier matches (ticket numbers, invoice numbers, asset tags) are handled by a separate exact-match branch: if `query` matches `^[A-Z]+-?\d+$` it is also probed against denormalized `metadata->>'identifier'` and pinned at the top.

### 13.4 Time decay

Multiplier `exp(-age_days / 90)` floor 0.05. Tunable per object type later via metadata; not configurable in v1.

## 14. Permissions & ACL

### 14.1 Two-layer filter

1. **SQL-level filter via denormalized columns** (`is_internal_only`, `is_private`, `visible_to_user_ids`, `visible_to_roles`, `client_scope_id`, `required_permission`). This is the load-bearing layer for pagination correctness.
2. **Record-level final pass in app code.** A `verifyResultVisibility(user, rows)` call runs each row through the same permission helpers used by the entity's primary actions (e.g., `assertTicketReadable`). Mismatches are dropped and logged (telemetry for index drift, not user-facing).

### 14.2 ACL strategy per entity (v1)

| Entity | SQL filter | Record-level final check |
|---|---|---|
| Client | `required_permission='client:read'` checked via `hasPermission` | none extra |
| Contact | `required_permission='contact:read'` | none extra |
| Team member | `required_permission='user:read'` | none extra |
| Ticket | `required_permission='ticket:read'` AND board scope via `visible_to_roles` | `assertTicketReadable(user, ticket_id)` |
| Ticket comment | inherits ticket ACL; if `is_internal_only=true`, requires internal user | parent ticket check + comment-internal check |
| Project | `required_permission='project:read'` AND `client_scope_id` | `assertProjectReadable` |
| Project phase/task/task-comment | inherits project ACL | parent project check |
| Asset | `required_permission='asset:read'` AND optional `client_scope_id` | none extra |
| Invoice (+ items, annotations) | `required_permission='invoice:read'` AND `client_scope_id` | none extra |
| Contract (+ client_contract) | `required_permission='contract:read'` AND optional `client_scope_id` | none extra |
| Document | `required_permission='document:read'`; optional `client_scope_id` derived from `documents.client_id` when set (no internal share-list mechanism exists in CE — documents are otherwise tenant-wide) | none extra |
| KB article | `required_permission='kb:read'` | none extra |
| Service catalog | `required_permission='service_catalog:read'` | none extra |
| Service request submission | `required_permission='service_request:read'` AND optional `client_scope_id` | none extra |
| Service request definition | `required_permission='admin'` | none extra |
| Workflow task | `required_permission='workflow_task:read'`; `visible_to_user_ids` for assignee scope | none extra |
| Interaction | `required_permission='interaction:read'` | none extra |
| Schedule entry | `required_permission='schedule:read'` AND `visible_to_user_ids` for owner scope | none extra |
| Time entry | `required_permission='time:read'`; `visible_to_user_ids` for owner scope | none extra |
| Board / Category / Tag | `required_permission='ticket:read'` | none extra |

### 14.3 Defence-in-depth fail-safe

If the SQL filter and the record-level check disagree, the row is dropped AND a telemetry counter (server log + Sentry) increments `search.acl_drift`. Drift > 0 is treated as a bug.

## 15. Multi-Tenancy & Citus Considerations

- `app_search_index` is **distributed by `tenant`**. All inserts, updates, deletes go via tenant-included WHERE clauses.
- The indexer framework requires the caller to pass `tenant` explicitly; nothing relies on `app.current_tenant` GUC.
- No joins across tables in the search query path; the index is fully denormalized. This avoids cross-shard join concerns.
- The reconciliation job operates one tenant at a time.

## 16. Rollout & Migration

- **Single release.** Ships in CE main branch; EE inherits automatically. No PostHog flag.
- **Backfill order on deploy.**
  1. Apply migration adding `app_search_index` table + indexes + `pg_trgm` extension if not present.
  2. Deploy code with subscriber **disabled** by env var `SEARCH_INDEX_LIVE=false`.
  3. Run `npm run search:backfill` against production for each tenant.
  4. Flip `SEARCH_INDEX_LIVE=true` and roll the workers; subscriber begins indexing.
  5. Enable the sidebar UI via merge to main.
- **Reconciliation job** is enabled day-1; first run catches anything missed during the backfill ↔ live-flip window.
- **No DB downtime required.** Index build can run `CONCURRENTLY` after table creation.

## 17. Acceptance Criteria / Definition of Done

A user can do all of the following from a clean prod-like environment with a seeded multi-tenant dataset:

1. Open the sidebar input, type `acme`, see ACME Corp as the top typeahead suggestion within 500 ms.
2. Press Enter from the sidebar input → land on `/msp/search?q=acme` with full grouped results.
3. Cmd/Ctrl+click any result row on the results page → opens in a new tab; original page state is preserved.
4. Type `TIC-1023` (or partial `tic-10`) and find the matching ticket as the top result.
5. Type a phrase known to appear only in a single ticket comment; click the result and land on the ticket page with the comment highlighted.
6. Type a phrase known to appear only in an internal ticket comment as an internal user — the comment is in the results.
7. Repeat (6) as a non-internal user — the comment is NOT in the results.
8. As user A, search for a project user A has no access to — the project does NOT appear.
9. As user A (client-scoped, no access to client X), search for a document whose `documents.client_id = X` — the document does NOT appear in results.
10. Type a misspelled client name (`exhcange` for `Exchange`) and still get the right top result via pg_trgm fallback.
11. Create a new ticket; within 5 seconds it appears in search.
12. Delete a record; within 5 seconds it disappears from search.
13. Run `npm run search:backfill` on a fresh DB and verify a sampled record from each of the 27 entity types is searchable.
14. Run the reconciliation job manually after deleting an index row directly via SQL → the row reappears.
15. Search across multiple tenants in a load test; no cross-tenant leak in 1M queries.
16. All search UI strings render correctly in `pseudo` locale (`xx`) — confirming i18n coverage.
17. Sidebar typeahead AND results page are fully keyboard-navigable (Tab, arrows, Enter, Esc).
18. The results-page URL with `?q=`, `?type=`, `?cursor=`, `?sort=` is bookmarkable: opening it cold renders the same results without the user re-typing.

## 18. Risks & Open Questions

### Risks

- **R1 — Permission leakage.** Mitigated by two-layer ACL, exhaustive permission tests per entity (one positive + one negative test minimum), and drift telemetry.
- **R2 — Index size.** With ~27 entity types and documents/comment bodies, the index could be large for big tenants. Mitigations: 64 KB body cap, `process_large_lexemes` stripping, GIN compression. Budget: target index ≤ 20% of total DB size on a typical tenant.
- **R3 — Event-bus reliability.** If events drop, search goes stale. Mitigated by daily reconciliation job and the `source_updated_at` watermark.
- **R4 — Backfill duration on big tenants.** Single-tenant backfill could take hours. Mitigation: paged loads + parallel per-type workers; backfill runs offline before subscriber goes live.
- **R5 — Ranking quality.** Time-decay constants are guesses. Plan: ship the formula, add a `metadata.boost_score` per object type later when we have telemetry. Out of scope for v1.
- **R6 — BlockNote schema changes.** If document format changes, the flattener breaks. Mitigation: snapshot tests on real BlockNote payloads + version detection.

### Open questions

All resolved 2026-05-13:

- **Q1 — Snippet HTML sanitization → Server-side rebuild.** The query path emits `ts_headline` with controlled `<mark>` sentinels; the search service splits on sentinels, HTML-escapes each text segment, re-wraps match segments in `<mark>`, returns a string the client can render via a trusted-string component. No DOMPurify dependency on the client.
- **Q2 — Query length cap → 200 chars.** Enforced in Zod input schema.
- **Q3 — `time_entries.notes` → Index only when non-empty** (`notes IS NOT NULL AND notes <> ''`). No minimum-length threshold.
- **Q4 — Board/Category/Tag → Result rows, not filter chips.** Surfaced as normal results.
- **Q5 — `interactions` → Uses current schema.** Per migration `20250530000000_improve_interactions_schema.cjs`, `description` was renamed to `title` and a new `notes` text column was added. `notes` stores BlockNote JSON. Indexer: title=`title`, body=`flattenBlockNote(notes)` truncated to 64 KB, subtitle=interaction type name + counterparty.

---

## 19. CE / EE Extension Mechanism

The entire search subsystem ships in CE. EE never forks any of these files; it extends via a single hook.

### 19.1 Registry merge

`server/src/lib/search/index.ts` imports two indexer arrays and merges them:

```typescript
import { ceIndexers } from './indexers';                       // CE indexers (27 entries at v1)
import { eeIndexers } from 'ee/server/src/lib/search/indexers'; // STUBBED in CE (returns [])

const registry = new Map<string, EntityIndexer>(
  [...ceIndexers, ...eeIndexers].map(i => [i.objectType, i])
);

export function getIndexer(objectType: string): EntityIndexer | undefined {
  return registry.get(objectType);
}

export function allIndexers(): EntityIndexer[] {
  return [...registry.values()];
}

export function registeredObjectTypes(): string[] {
  return [...registry.keys()];
}
```

In CE builds, the import path `ee/server/src/lib/search/indexers` resolves to a stub file (existing CE/EE stub pattern in the repo) that exports `export const eeIndexers: EntityIndexer[] = []`. In EE builds, it resolves to the real EE module with EE-specific indexers (e.g., chat history, AI conversations, extension content).

### 19.2 Schema is shared

`app_search_index.object_type` is a plain `text` column, **not an enum**. CE and EE share the same table. CE-only deploys simply have no rows where `object_type` is an EE-only type.

### 19.3 Event subscriber is registry-driven

`searchIndexSubscriber` subscribes to the union of `sourceEvents` from `allIndexers()`. In CE, that union excludes EE event types. In EE, the same code (no fork) subscribes to additional event families because EE's indexers brought them in.

### 19.4 UI is data-driven

The results page filter chips and group headers iterate over `registeredObjectTypes()` so EE entity types appear automatically in EE builds without any UI code change. i18n keys for EE entity labels live in the EE locale namespace and are looked up by `search.filters.{objectType}` / `search.groups.{objectType}` — CE renders a fallback (humanized object_type) if the key is missing in CE.

### 19.5 Orphan safety on edition transition

If a deploy transitions from EE to CE (or an EE feature is removed), index rows whose `object_type` no longer has a registered indexer become invisible: the query layer always restricts `object_type = ANY(registeredObjectTypes())`. The orphans sit harmlessly in the table. Reconciliation skips object_types without registered indexers — it does NOT attempt to load the source row, because it has no indexer to do so. A maintenance script (out of v1 scope) can purge these rows on demand.

### 19.6 What EE must implement

For each EE-only entity that should be searchable, EE provides:

1. An entry in `ee/server/src/lib/search/indexers/index.ts` (`export const eeIndexers: EntityIndexer[]`).
2. A per-entity indexer module under `ee/server/src/lib/search/indexers/<entity>.ts`, following the same `EntityIndexer` interface as CE indexers.
3. Event types in `packages/event-schemas` (or wherever EE event extensions live) with Zod payload schemas, plus publishes at the relevant EE action sites.
4. i18n entries for the entity's filter/group label in the EE locale namespace.

EE does **not** touch the CE registry file, the subscriber, the search action, the query builder, or the UI.

---

**End of PRD.**
