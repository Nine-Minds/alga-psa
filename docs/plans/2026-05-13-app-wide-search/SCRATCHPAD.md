# Scratchpad — App-Wide Search

Rolling notes, decisions, links, and gotchas. Append, don't rewrite history.

---

## Decisions (with rationale)

- **2026-05-13 — Single global index table `app_search_index`** rather than per-table `tsvector` columns.
  *Why:* one query searches everything; uniform ranking; one GIN index to maintain; lets us denormalize ACL columns alongside content. Trade-off: re-index needed on permission changes — accepted.

- **2026-05-13 — Postgres FTS + pg_trgm**, not Meilisearch/Typesense.
  *Why:* no new infra; respects Citus tenant sharding natively; simpler ACL story. Can graduate later if relevance becomes the bottleneck — the indexer interface won't change.

- **2026-05-13 — MSP portal only for v1.** Client portal deferred to v2.
  *Why:* tighter ACL surface area; the same index table can be queried from client portal later with a stricter filter.

- **2026-05-13 — CE codebase, EE inherits.** No edition-conditional code at v1.
  *Why:* EE is a superset of CE; new EE entities (extensions, etc.) can register their own indexers later without touching the core.

- **2026-05-13 — No PostHog feature flag.**
  *Why:* user choice. Implies the test suite must be the gate; ACL leakage tests in particular must be exhaustive.

- **2026-05-13 — Denormalized ACL columns on the index** (`visible_to_user_ids`, `visible_to_roles`, `is_internal_only`, `is_private`, `client_scope_id`, `required_permission`).
  *Why:* filtering in SQL is the only way pagination/ranking stay correct without massive over-fetch. Cost: ACL changes require re-index — handled by the existing event-driven indexer.

- **2026-05-13 — Two-layer ACL** (denormalized SQL filter + record-level final pass).
  *Why:* defence in depth; record-level pass catches drift bugs and is logged as `search.acl_drift` telemetry.

- **2026-05-13 — 64 KB body cap.**
  *Why:* FTS quality plateaus past this; documents and long comment threads would bloat the index without recall benefit.

- **2026-05-13 — Time-decay ranking** `exp(-age_days / 90)`, floor 0.05.
  *Why:* MSP users almost always want recent records; pure `ts_rank_cd` ignores recency. Constants are best-guess; revisit with telemetry.

- **2026-05-13 — Reuse existing `public.process_large_lexemes()`** Postgres function as the body cleanser (strips base64 data URIs, caps to 500 KB) before `to_tsvector`.
  *Why:* it already exists and was written for exactly this hazard.

---

## Recon findings

### Sidebar / nav

- Main MSP sidebar: `server/src/components/layout/Sidebar.tsx`
- Sub-components: `SidebarMenuItem.tsx`, `SidebarSubMenuItem.tsx`, `SidebarBottomMenuItem.tsx`
- `cmdk@^1.0.4` is already in `package.json` but no command palette is rendered yet.
- i18n namespace `msp/core` (`server/public/locales/en/msp/core.json`); add `search.*` keys.

### Entity tables (CE)

| Entity | Table | PK | Tenant in PK |
|---|---|---|---|
| Client | `clients` | `client_id` | yes |
| Contact | `contacts` | `contact_name_id` | yes |
| User | `users` | `user_id` (+ email) | yes |
| Ticket | `tickets` | `ticket_id` | yes |
| Ticket comment | `comments` | `comment_id` | yes — `is_internal` boolean present |
| Project | `projects` | `project_id` | yes |
| Project phase | `project_phases` | `phase_id` | yes |
| Project task | `project_tasks` | `task_id` | yes |
| Project task comment | `project_task_comments` | `task_comment_id` | yes — body is **BlockNote JSON** in `note` + `markdown_content` |
| Asset | `assets` | `asset_id` | yes |
| Invoice | `invoices` | `invoice_id` | yes |
| Invoice item | `invoice_items` | `item_id` | yes |
| Invoice annotation | `invoice_annotations` | `annotation_id` | yes |
| Contract | `contracts` | `plan_id` | yes |
| Contract line | `contract_lines` | (composite) | yes |
| Client contract | `client_contracts` | `contract_id` | yes |
| Document | `documents` | `document_id` | yes — `content` is **BlockNote JSON** |
| KB article | `kb_articles` | `article_id` | yes — FK to `documents` |
| Service catalog | `service_catalog` | `service_id` | yes |
| Service request submission | `service_request_submissions` | `submission_id` | yes — `submitted_payload` JSONB |
| Service request definition | `service_request_definitions` | `definition_id` | yes |
| Workflow task | `workflow_tasks` | `task_id` (string) | **NOT in PK** — verify |
| Interaction | `interactions` | `interaction_id` | yes |
| Schedule entry | `schedule_entries` | `entry_id` | yes |
| Time entry | `time_entries` | `entry_id` | yes |
| Board | `boards` | `channel_id` | yes (renamed from `channels`) |
| Category | `categories` | `category_id` | yes |
| Tag | `tags` | `tag_id` | yes |

**TODO** — verify `workflow_tasks` distribution column. If it's not distributed by tenant, joining/upserting from the indexer needs extra care.

### Existing FTS code

- **CE migrations:** zero `tsvector` columns or GIN indexes today.
- **EE migrations:** tsvector indexes already exist on `tickets.title`, `comments.note`, `documents.content` (in `ee/server/migrations/202410291100_create_ai_schema.cjs`) — these are for AI/chat features, **not** to be confused with the new `app_search_index`.
- **`public.process_large_lexemes()`** function exists (added in `20260302031500_strip_data_image_payloads_from_comment_search_vector.cjs`). Strips base64 data URIs, caps input at 500 KB. Reuse as-is.

### Event bus

- Publisher: `server/src/lib/eventBus/publishers/index.ts` — `publishEvent()`.
- Existing events covering our entities:
  - `TICKET_CREATED`, `TICKET_UPDATED`, `TICKET_CLOSED`, `TICKET_ASSIGNED`
  - `TICKET_COMMENT_ADDED`
- **Missing events** that the plan must add (one feature per family):
  - `CLIENT_CREATED` / `_UPDATED` / `_DELETED`
  - `CONTACT_*`
  - `USER_*` (probably already exists for auth — verify)
  - `PROJECT_*`, `PROJECT_PHASE_*`, `PROJECT_TASK_*`, `PROJECT_TASK_COMMENT_*`
  - `ASSET_*`
  - `INVOICE_*`, `INVOICE_ITEM_*`, `INVOICE_ANNOTATION_*`
  - `CONTRACT_*`, `CLIENT_CONTRACT_*`
  - `DOCUMENT_*`, `KB_ARTICLE_*`
  - `SERVICE_CATALOG_*`
  - `SERVICE_REQUEST_SUBMISSION_*`, `SERVICE_REQUEST_DEFINITION_*`
  - `WORKFLOW_TASK_*` (verify which already exist)
  - `INTERACTION_*`
  - `SCHEDULE_ENTRY_*`
  - `TIME_ENTRY_*`
  - `BOARD_*`, `CATEGORY_*`, `TAG_*`
- **Add events at the corresponding actions** under `server/src/lib/actions/` and any model save points. Use Zod schemas in `server/src/lib/eventBus/events.ts`.

### withAuth example

- Canonical reference: `server/src/app/msp/service-requests/actions.ts` lines 67–74.
- Pattern: `withAuth(async (user, { tenant }): Promise<T> => { ... })`, imported from `@alga-psa/auth`.

---

## Architecture file layout (new)

```
server/src/
  lib/
    search/
      index.ts                         # registry export
      types.ts                         # SearchDoc, SearchObjectType
      normalize.ts                     # BlockNote/Markdown/JSONB → text + truncate
      upsert.ts                        # writes to app_search_index
      query.ts                         # SQL builder for FTS + pg_trgm
      acl.ts                           # SQL predicate builder + record-level verifier
      ts_headline.ts                   # snippet helper
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
    eventBus/
      subscribers/
        searchIndexSubscriber.ts       # NEW
    actions/
      searchActions.ts                 # NEW — withAuth wrapper around query.ts
  scripts/
    search-backfill.ts                 # NEW — CLI; also wired into package.json
  components/
    search/                            # NEW
      SearchPalette.tsx                # cmdk command palette
      SearchResultRow.tsx
      SearchResultGroup.tsx
      useSearch.ts                     # debounce + server action hook
    layout/
      Sidebar.tsx                      # add search trigger at top
  app/
    msp/
      search/
        page.tsx                       # NEW — "see all results" page
        SearchPageClient.tsx
  migrations/
    NNNN_create_app_search_index.cjs   # NEW migration
```

---

## Migration sketch

```js
// server/migrations/NNNN_create_app_search_index.cjs
exports.up = async (knex) => {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  await knex.raw(`
    CREATE TABLE app_search_index (
      tenant uuid NOT NULL,
      object_type text NOT NULL,
      object_id text NOT NULL,
      parent_type text,
      parent_id text,
      title text NOT NULL,
      subtitle text,
      body text,
      url text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      visible_to_user_ids uuid[] NOT NULL DEFAULT '{}',
      visible_to_roles text[] NOT NULL DEFAULT '{}',
      is_internal_only boolean NOT NULL DEFAULT false,
      is_private boolean NOT NULL DEFAULT false,
      client_scope_id uuid,
      required_permission text,
      search_vector tsvector NOT NULL,
      search_lang text NOT NULL DEFAULT 'english',
      source_updated_at timestamptz NOT NULL,
      indexed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant, object_type, object_id)
    )
  `);

  // Citus distribution — only if Citus is the active backend
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') THEN
        PERFORM create_distributed_table('app_search_index', 'tenant');
      END IF;
    END$$;
  `);

  await knex.raw('CREATE INDEX app_search_index_vector_gin ON app_search_index USING gin (search_vector)');
  await knex.raw('CREATE INDEX app_search_index_title_trgm ON app_search_index USING gin (title gin_trgm_ops)');
  await knex.raw('CREATE INDEX app_search_index_subtitle_trgm ON app_search_index USING gin (subtitle gin_trgm_ops)');
  await knex.raw('CREATE INDEX app_search_index_recent ON app_search_index (tenant, source_updated_at DESC)');
  await knex.raw('CREATE INDEX app_search_index_type ON app_search_index (tenant, object_type)');
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS app_search_index');
};
```

---

## Commands / runbook

```bash
# Run the migration locally
npm run migrate

# Backfill all tenants
npm run search:backfill

# Backfill one tenant, one entity type
npm run search:backfill -- --tenant=<uuid> --type=ticket

# Manually run reconciliation
npm run search:reconcile -- --tenant=<uuid>

# Inspect index health for a tenant
psql -c "SELECT object_type, count(*), max(indexed_at) FROM app_search_index WHERE tenant = '<uuid>' GROUP BY 1 ORDER BY 1"

# Sample row
psql -c "SELECT object_type, object_id, title, left(body, 80) AS snippet FROM app_search_index WHERE tenant = '<uuid>' AND title ILIKE '%acme%' LIMIT 5"

# Drop-and-rebuild one tenant's index
psql -c "DELETE FROM app_search_index WHERE tenant = '<uuid>'" && \
  npm run search:backfill -- --tenant=<uuid>
```

## Implementation log

- **2026-05-13 — F001 complete.** Added migration file `server/migrations/20260513120000_create_app_search_index.cjs`. The file already includes the planned table/index/down-migration body because those pieces are inseparable from a useful migration skeleton. Validation: `node --check server/migrations/20260513120000_create_app_search_index.cjs`.
- **2026-05-13 — F002 complete.** Migration enables fuzzy matching support with `CREATE EXTENSION IF NOT EXISTS pg_trgm`. Validation: `rg "CREATE EXTENSION IF NOT EXISTS pg_trgm" server/migrations/20260513120000_create_app_search_index.cjs`.
- **2026-05-13 — F003 complete.** Migration creates `app_search_index` with PRD §9.1 columns, UUID/text ACL hint arrays, `tsvector` search column, timestamps, and primary key `(tenant, object_type, object_id)`. Validation: `node --check ...` plus targeted `rg` for table, PK, ACL, and search-vector columns.
- **2026-05-13 — F004 complete.** Migration checks `pg_extension` for `citus`, checks `pg_dist_partition` for pre-existing distribution, and only then calls `create_distributed_table('app_search_index', 'tenant')`. It exports `transaction: false` because Citus distribution cannot run in a transaction block.
- **2026-05-13 — F005 complete.** Migration creates `app_search_index_vector_gin` using `gin (search_vector)` for FTS matching. Validation: targeted `rg` on the migration.
- **2026-05-13 — F006 complete.** Migration creates `app_search_index_title_trgm` and `app_search_index_subtitle_trgm` using `gin_trgm_ops` for the fuzzy fallback branch. Validation: targeted `rg` on both index names/opclasses.
- **2026-05-13 — F007 complete.** Migration creates `app_search_index_recent` on `(tenant, source_updated_at DESC)` and `app_search_index_type` on `(tenant, object_type)` for recency sorting and type filtering. Validation: targeted `rg` on both definitions.
- **2026-05-13 — F008 complete.** Migration down step uses `knex.schema.dropTableIfExists('app_search_index')`. Validation: targeted `rg` on `exports.down` and the drop call.
- **2026-05-13 — F009 complete.** Added `server/src/lib/search/types.ts` with `SEARCH_OBJECT_TYPES` covering the 27 CE v1 entity types and deriving `SearchObjectType` from that tuple. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/types.ts`.
- **2026-05-13 — F010 complete.** `SearchDoc` now models tenant/type/id, optional parent, title/subtitle/body/url, metadata, required ACL metadata, and `sourceUpdatedAt`. Validation: targeted `rg` on the interface fields.
- **2026-05-13 — F011 complete.** `AclMetadata` covers `visibleToUserIds`, `visibleToRoles`, `isInternalOnly`, `isPrivate`, `clientScopeId`, and `requiredPermission` for indexer-produced ACL hints. Validation: targeted `rg` on the interface fields.
- **2026-05-13 — F012 complete.** Added `flattenBlockNote(json)` in `server/src/lib/search/normalize.ts`. It parses JSON strings when needed, walks BlockNote `content`/`children`/`items`, collects visible text leaves, supports unexpected plain text fallback, and strips image data URIs. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/normalize.ts`.
- **2026-05-13 — F013 complete.** Added `flattenMarkdown(md)` to strip headings, list markers, links/images, bold/italic/code markers, code fences, blockquotes, and HTML tags while preserving readable text. Validation: targeted `rg` on function and replacement rules.
- **2026-05-13 — F014 complete.** Added `flattenJsonbPayload(obj)` to recursively concatenate string leaves from objects/arrays, skip secret-like keys (`password|secret|token|api_key|authorization`), strip image data URIs, and ignore scalar top-level input. Validation: targeted `rg` on function, secret regex, and object traversal.
- **2026-05-13 — F015 complete.** Added `truncateForIndex(text, maxBytes = 65_536)` using `Buffer.byteLength` and `for...of` code-point iteration so truncation respects UTF-8 byte limits without splitting characters. Validation: targeted `rg` on the function and byte-length loop.
- **2026-05-13 — F016 complete.** Added `server/src/lib/search/sql.ts` with `buildTsvectorSql(title, subtitle, body)`. It returns a bound SQL fragment with title/subtitle/body weights A/B/C and runs all inputs through `public.process_large_lexemes()` before `to_tsvector('english', ...)`. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/sql.ts`.
- **2026-05-13 — F017 complete.** `EntityIndexer` in `types.ts` defines `objectType`, `sourceEvents`, `loadOne`, and paged `loadBatch` methods. `sourceEvents` is typed as `readonly EventType[]` from `@alga-psa/event-schemas`; loaders accept an explicit `tenant`. Validation: targeted `rg` on the interface.
- **2026-05-13 — F018 complete.** Added `server/src/lib/search/index.ts` registry with `getIndexer`, `allIndexers`, and `registeredObjectTypes`. Added empty CE `ceIndexers` export and a CE-side `@ee/lib/search/indexers` stub returning `eeIndexers = []` under `packages/ee/src`, matching the repo's current alias pattern. Note: the later F131 stub-registration cleanup should reconcile this with the plan's `ee/server/src/...` wording if needed. Validation: targeted `rg` on registry exports and imports.
- **2026-05-13 — F019 complete.** Added `upsertSearchDoc(knex, doc)` in `server/src/lib/search/upsert.ts`. It inserts all denormalized search/ACL columns, computes `search_vector` server-side with `buildTsvectorSql`, and updates existing rows via `ON CONFLICT (tenant, object_type, object_id)`. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/upsert.ts`.
- **2026-05-13 — F020 complete.** Added `deleteSearchDoc(knex, tenant, objectType, objectId)` in `upsert.ts`; it deletes by `(tenant, object_type, object_id)` and is naturally a no-op when the row is absent. Validation: targeted `rg` on function and WHERE/delete chain.
- **2026-05-13 — F021 complete.** Added typed `composeAclHints(opts)` in `server/src/lib/search/acl.ts` and wired `upsertSearchDoc` through it. Defaults: user/role arrays empty, internal/private booleans false, optional `clientScopeId` and `requiredPermission` passed through. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/acl.ts server/src/lib/search/upsert.ts`.
- **2026-05-13 — F022 complete.** Added `clientIndexer` with `loadOne`/`loadBatch` against `clients`, title=`client_name`, subtitle=`email | phone_no`, body=`notes`, URL `/msp/clients/{client_id}`, and ACL `requiredPermission='client:read'`. Registered it in `ceIndexers`. Current source events use existing `CLIENT_CREATED`, `CLIENT_UPDATED`, and `CLIENT_ARCHIVED`; F049 should add/swap in `CLIENT_DELETED` when that event exists. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/client.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F023 complete.** Added `contactIndexer` with title=`full_name`, subtitle=`email | phone_number | role`, URL `/msp/contacts/{contact_name_id}`, ACL `requiredPermission='contact:read'`, and tenant-scoped `loadOne`/`loadBatch`. Registered it in `ceIndexers`. Current source events use existing `CONTACT_CREATED`, `CONTACT_UPDATED`, and `CONTACT_ARCHIVED`; F050 should add/swap in delete semantics if needed. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/contact.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F024 complete.** Added `userIndexer` for internal users only (`user_type='internal'`), title from first/last name with username/email/id fallback, subtitle=`username | email | role`, URL `/msp/team/{user_id}`, and ACL `requiredPermission='user:read'`. Registered it in `ceIndexers`. Current schema has `role` but no separate `title` column; F051 should add `USER_*` source events and can adjust subtitle if a title column exists by then. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/user.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F025 complete.** Added `ticketIndexer` with client join, title=`tickets.title` fallback to ticket number/id, subtitle=`client_name | ticket_number`, URL `/msp/tickets/{ticket_id}`, `metadata.identifier=ticket_number`, and ACL `requiredPermission='ticket:read'`. Registered it in `ceIndexers` and included current ticket events including `TICKET_DELETED`. Gap: no current board-role ACL table/column was found, so `visibleToRoles` remains default-empty until the ACL/query layer or a board-scope source is identified. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/ticket.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F026 complete.** Added `ticketCommentIndexer` joining `comments` to `tickets`, title from parent ticket title/number, parent pointer `(ticket, ticket_id)`, body=`flattenMarkdown(note)`, URL `/msp/tickets/{ticket_id}#comment-{comment_id}`, ACL `requiredPermission='ticket:read'`, and `isInternalOnly` from `comments.is_internal`. Registered it in `ceIndexers`. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/ticket_comment.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F027 complete.** Added `projectIndexer` with title=`project_name`, body=`description`, URL `/msp/projects/{project_id}`, ACL `requiredPermission='project:read'`, and `clientScopeId` from `projects.client_id`. Registered it in `ceIndexers`. Current events use existing `PROJECT_CREATED`, `PROJECT_UPDATED`, and `PROJECT_STATUS_CHANGED`; F052 should add delete/child publishes. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/project.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F028 complete.** Added `projectPhaseIndexer` joining phases to parent projects, title=`phase_name`, subtitle=`project_name`, body=`description`, URL `/msp/projects/{project_id}/phases/{phase_id}`, parent pointer `(project, project_id)`, and inherited project ACL/client scope. Registered it in `ceIndexers`. `sourceEvents` is empty until F052 adds project phase events. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/project_phase.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F029 complete.** Added `projectTaskIndexer` joining tasks through phases to projects, title=`task_name`, subtitle=`project_name`, body=`description`, URL `/msp/projects/{project_id}/tasks/{task_id}`, parent pointer `(project, project_id)`, and inherited project ACL/client scope. Registered it in `ceIndexers`. Source events use existing project-task event names. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/project_task.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F030 complete.** Added `projectTaskCommentIndexer` joining comments through task/phase/project, title from parent task, subtitle project name, body preferring `markdown_content` with `flattenBlockNote(note)` fallback, URL `/msp/projects/{project_id}/tasks/{task_id}#comment-{task_comment_id}`, parent pointer `(project_task, task_id)`, and inherited project ACL/client scope. Registered it in `ceIndexers`; source events use existing `TASK_COMMENT_*` names. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/project_task_comment.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F031 complete.** Added `assetIndexer` with title=`name`, subtitle=`asset_tag | serial_number`, body=`location | flattenJsonbPayload(attributes)`, URL `/msp/assets/{asset_id}`, `metadata.identifier=asset_tag`, ACL `requiredPermission='asset:read'`, and optional `clientScopeId`. Registered it in `ceIndexers`; source events use existing `ASSET_CREATED/UPDATED/ASSIGNED/UNASSIGNED`. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/asset.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F032 complete.** Added `invoiceIndexer` joining invoices to clients, title=`invoice_number`, subtitle=`client_name | status | total_amount`, URL `/msp/invoices/{invoice_id}`, `metadata.identifier=invoice_number`, ACL `requiredPermission='invoice:read'`, and `clientScopeId` from `invoices.client_id`. Registered it in `ceIndexers`; source events use existing invoice lifecycle events until F054 adds CRUD-specific events. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/invoice.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F033 complete.** Added `invoiceItemIndexer` joining invoice items to invoices, title parent invoice number, body item description, URL `/msp/invoices/{invoice_id}#item-{item_id}`, parent pointer `(invoice, invoice_id)`, and inherited invoice ACL/client scope. Registered it in `ceIndexers`. `sourceEvents` is empty until F054 adds invoice-item events. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/invoice_item.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F034 complete.** Added `invoiceAnnotationIndexer` joining annotations to invoices, title parent invoice number, body annotation content, URL `/msp/invoices/{invoice_id}#annotation-{annotation_id}`, parent pointer `(invoice, invoice_id)`, and inherited invoice ACL/client scope. It also maps `invoice_annotations.is_internal` to `isInternalOnly` as a conservative visibility hint. Registered it in `ceIndexers`; `sourceEvents` is empty until F054 adds invoice-annotation events. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/invoice_annotation.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F035 complete.** Added `contractIndexer` against `contracts`, title=`contract_name`, body=`contract_description`, subtitle=`Quote` for `status='draft'` else `Contract`, URL `/msp/billing/contracts/{contract_id}`, `metadata.identifier=contract_name`, and ACL `requiredPermission='contract:read'`. Registered it in `ceIndexers`; source events use existing `CONTRACT_CREATED/UPDATED/STATUS_CHANGED`. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/contract.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F036 complete.** Added `clientContractIndexer` joining `client_contracts`, `clients`, and `contracts`, title=`{client_name} – {contract_name}`, body with start/end dates and active state, URL `/msp/clients/{client_id}/contracts/{client_contract_id}`, parent pointer `(contract, contract_id)`, ACL `requiredPermission='contract:read'`, and `clientScopeId=client_id`. Registered it in `ceIndexers`; `sourceEvents` is empty until F055 adds client-contract events. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/client_contract.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F037 complete.** Added `documentIndexer` with title=`document_name`, body=`truncateForIndex(flattenBlockNote(content))`, URL `/msp/documents/{document_id}`, ACL `requiredPermission='document:read'`, and optional `clientScopeId` from `documents.client_id`. It intentionally does not set `isPrivate` or `visibleToUserIds` because CE has no internal per-user document share model in v1. Registered it in `ceIndexers`; source events use existing document lifecycle/association events. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/document.ts server/src/lib/search/indexers/index.ts`.
- **2026-05-13 — F038 complete.** Added `kbArticleIndexer` joining `kb_articles` to `documents`, title=`documents.document_name`, body from flattened/truncated document content, URL `/msp/knowledge-base/{article_id}`, parent pointer `(document, document_id)`, and ACL `requiredPermission='kb:read'`. Registered it in `ceIndexers`; `sourceEvents` is empty until F056 adds KB events. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/kb_article.ts server/src/lib/search/indexers/index.ts`.

---

## Gotchas

- **`comments.note` is plain text or markdown, not BlockNote.** The ticket-comment indexer uses `flattenMarkdown`, not `flattenBlockNote`. Confirmed via `server/src/interfaces/comment.interface.ts`.
- **`project_task_comments.note` IS BlockNote.** Prefer `markdown_content` if non-null; else flatten BlockNote.
- **`documents.content` is BlockNote.** Always flatten + truncate.
- **`service_request_submissions.submitted_payload` is JSONB form data.** Flatten string leaves; skip keys named `password`, `secret`, `token`, `api_key`.
- **Quotes are draft contracts.** Indexer marks `subtitle = 'Quote'` when `contracts.status = 'draft'`.
- **`channels` was renamed to `boards`.** Use the current table name; column is `channel_name`, column key is `channel_id` (the rename was table-only).
- **Citus distribution column must be `tenant`.** If we ever try to `JOIN app_search_index s ON s.tenant = t.tenant AND s.object_id = t.ticket_id`, that join must include `t.tenant` to stay co-located.
- **`ts_headline` output contains HTML.** Render via a sanitized component, never `dangerouslySetInnerHTML` of raw output.
- **`process_large_lexemes()` is a Postgres function, not a Node helper.** Call it via `to_tsvector('english', process_large_lexemes($body))` inside the indexer's SQL.

---

## Open follow-ups (to verify at implementation time)

- [ ] Confirm existing `USER_*` event semantics — do we already publish on user create/update/delete? Check `server/src/lib/eventBus/events.ts` and `packages/event-schemas/src/schemas/eventBusSchema.ts`. If yes, just reuse; if no, add per F051.
- [ ] Workflow task PK: confirmed below in §Schema reference — `workflow_tasks.task_id` is the only PK column; `tenant` is a regular text column. Indexer must include `tenant` in every WHERE clause anyway.

## Resolved (2026-05-13)

- **Snippet sanitizer → controlled-sentinel rebuild on the server.** Emit `ts_headline` with unique sentinel tokens (e.g., `«MARK»` / `«/MARK»`), split the response on sentinels, HTML-escape each text segment, re-wrap match segments in `<mark>`. No DOMPurify dep on the client; the field is safe by construction.

- **Query length cap → 200 chars.** Enforced in Zod input.

- **`time_entries.notes` indexing rule → `notes IS NOT NULL AND notes <> ''`.** No length threshold beyond non-empty.

- **Board / Category / Tag → keep as result rows**, not filter chips.

- **`interactions` schema → `title` (renamed from `description`) + `notes` (BlockNote JSON).** Confirmed by migration `server/migrations/20250530000000_improve_interactions_schema.cjs` lines 6–13. Sample `notes` payload (from user):
  ```
  [{"id":"f3e01073-…","type":"bulletListItem","content":[{"type":"text","text":"Added Sciton Tribrid Laser\n",…}]},…]
  ```
  Indexer behavior:
  - `title` ← `interactions.title`
  - `body` ← `flattenBlockNote(notes)` (truncated to 64 KB; falls back to raw text if `notes` is unexpectedly plain text)
  - `subtitle` ← derived from `interaction_types.type_name` + counterparty (client, contact, or linked ticket)
  - `acl.requiredPermission` = `'interaction:read'`

## Local DB availability

The MCP `my-private-server` query tool resolves to `alga-psa-postgres-1` inside a docker network, but the local stack is stopped (`alga-test-postgres` exited 8w ago, no `alga-psa-postgres-1` container running). To use it during implementation:

```bash
# bring the dev stack up
docker compose -f docker-compose.base.yaml -f docker-compose.ce.yaml up -d postgres
# verify
docker ps --format '{{.Names}}\t{{.Status}}' | grep postgres
```

---

## Schema reference (column-level, derived from migrations)

The implementer should not need to grep migrations to know what to query. Below is a copy-pastable cheat sheet of the columns each indexer touches. If anything here diverges from reality at implementation time, the migration files are authoritative — but recheck rather than assume.

### Core entity columns

```
clients               PK (tenant, client_id)
  client_id, client_name, email, phone_no, notes, url, properties (jsonb), ...
  (renamed from `companies`; see 20251003000001_company_to_client_migration.cjs)

contacts              PK (tenant, contact_name_id)
  contact_name_id, full_name, client_id, email, phone_number, role,
  is_client_admin, notes_document_id, created_at, updated_at

users                 PK (tenant, user_id, email)
  user_id, username, first_name, last_name, email, user_type, hashed_password,
  auth_method, created_at, updated_at
  → user_type='internal' for MSP team members; 'client' for client-portal users

tickets               PK (tenant, ticket_id)
  ticket_id, ticket_number, title, channel_id (board), client_id, contact_name_id,
  assigned_to, status_id, priority_id, category_id, created_at, updated_at

comments              PK (tenant, comment_id)
  comment_id, ticket_id, user_id, contact_name_id,
  note, is_internal (boolean), is_resolution, is_initial_description,
  created_at, updated_at, metadata (jsonb)
  → `note` is plain text or markdown (NOT BlockNote)

projects              PK (tenant, project_id)
  project_id, project_name, description, client_id, status, contact_name_id,
  start_date, end_date, created_at, updated_at

project_phases        PK (tenant, phase_id)
  phase_id, project_id, phase_name, description, ...

project_tasks         PK (tenant, task_id)
  task_id, phase_id, task_name, description, assigned_to, ...

project_task_comments PK (tenant, task_comment_id)
  task_comment_id, task_id, user_id, author_type,
  note (BlockNote JSON), markdown_content, created_at, updated_at, edited_at
  → prefer markdown_content; fall back to flattenBlockNote(note)

assets                PK (tenant, asset_id)
  asset_id, type_id, client_id, asset_tag, serial_number, name, status,
  location, attributes (jsonb), created_at, updated_at
```

### Billing / invoicing

```
invoices              PK (tenant, invoice_id)
  invoice_id, client_id, invoice_number, invoice_date, due_date,
  total_amount, status, custom_fields (jsonb), billing_period, created_at, updated_at

invoice_items         PK (tenant, item_id)
  item_id, invoice_id, service_id, description, quantity, unit_price, total_price

invoice_annotations   PK (tenant, annotation_id)
  annotation_id, invoice_id, user_id, content, is_internal, created_at

contracts             PK (tenant, contract_id)
  contract_id, contract_name, contract_description,
  billing_frequency, is_active, status, created_at, updated_at
  → status ∈ {'active','draft','terminated','expired'}; 'draft' = the "quote" tag
  (renamed/restructured by 20251008000001_rename_billing_to_contracts.cjs +
   202510161430_add_contract_status_column.cjs)

contract_lines        PK (tenant, contract_line_id)
  contract_line_id, plan_name, description, billing_frequency, is_custom,
  plan_type, created_at, updated_at
  → formerly `billing_plans`

client_contracts      PK (tenant, client_contract_id)
  client_contract_id, client_id, contract_id, start_date, end_date, is_active,
  created_at, updated_at
  → join with contracts + clients to build a search title
```

### Documents / KB / service

```
documents             PK (tenant, document_id)
  document_id, document_name, type_id, user_id, contact_name_id, client_id,
  ticket_id, created_by, edited_by, entered_at, updated_at,
  content (BlockNote JSON), shared_type_id

document_associations PK (tenant, association_id)
  association_id, document_id, entity_id, entity_type ∈ {'ticket','client',
  'contact','schedule','project_task','quote','asset', ...}, created_at
  → NOT an internal user-share table. Used to attach docs to entities.

document_share_links  PK (tenant, share_id)
  share_id, document_id, token, share_type, password_hash, expires_at,
  max_downloads, is_revoked, created_by, created_at
  → EXTERNAL token-based shares only; NOT used for internal ACL.

kb_articles           PK (tenant, article_id)
  article_id, document_id (FK), ...
  → body comes through the FK to `documents.content`

service_catalog       PK (tenant, service_id)
  service_id, service_name, description, service_type, default_rate,
  unit_of_measure, category_id, attributes (jsonb), created_at, updated_at

service_request_definitions   PK (tenant, definition_id)
  definition_id, name, description, icon, category_id, form_schema (jsonb),
  execution_provider, visibility_provider, lifecycle_state,
  published_by, published_at, created_at, updated_at

service_request_submissions   PK (tenant, submission_id)
  submission_id, definition_id, definition_version_id, requester_user_id,
  client_id, contact_id, request_name, submitted_payload (jsonb),
  execution_status, created_ticket_id, created_at, updated_at
```

### Workflow / activity

```
workflow_tasks        PK (task_id)  ← STRING ONLY, tenant is a column not in PK
  task_id (string), tenant (string), execution_id, event_id, task_definition_id,
  title, description, status, priority, due_date, context_data (jsonb),
  assigned_roles (jsonb), assigned_users (jsonb), created_at, updated_at,
  claimed_at, claimed_by, completed_at, completed_by, response_data (jsonb)
  → assigned_users is JSON array of user_ids; parse to uuid[] for visible_to_user_ids

interactions          PK (tenant, interaction_id)
  interaction_id, type_id, contact_name_id, client_id, user_id, ticket_id,
  title, notes (BlockNote JSON), interaction_date, duration, status_id,
  start_time, end_time, created_at, updated_at
  → `description` was renamed to `title` AND new `notes` column added in
    20250530000000_improve_interactions_schema.cjs

interaction_types     PK (tenant, type_id)
  type_id, type_name, ...
  → join from interactions.type_id for the subtitle

schedule_entries      PK (tenant, entry_id)
  entry_id, title, work_item_id, work_item_type, user_id (owner),
  scheduled_start, scheduled_end, status, notes, created_at, updated_at

time_entries          PK (tenant, entry_id)
  entry_id, user_id (owner), start_time, end_time, notes,
  work_item_id, work_item_type, billable_duration,
  approval_status, created_at, updated_at
  → index ONLY when notes IS NOT NULL AND notes <> ''
```

### Metadata / structural

```
boards                PK (tenant, channel_id)
  channel_id, channel_name, ...
  → renamed from `channels` in 20250930000001_rename_channels_to_boards.cjs
  → column is still `channel_name`

categories            PK (tenant, category_id)
  category_id, category_name, description, ...
  → there is also `ticket_categories` (renamed from `service_categories`).
    Confirm which one the UI uses; default to `categories` for v1.

tags                  PK (tenant, tag_id)
  tag_id, channel_id, tag_text, tagged_id, tagged_type
```

---

## Code patterns the implementer needs

### Event bus

Canonical event publish (used at action call sites):

```typescript
import { publishEvent } from 'server/src/lib/eventBus/publishers';
// publishEvent omits id + timestamp; the publisher fills them in.

await publishEvent({
  eventType: 'CLIENT_UPDATED',
  payload: { tenant, client_id, changed_fields: [...] },
});
```

Event types live in `packages/event-schemas/src/schemas/eventBusSchema.ts`. Each event has a matching Zod schema. To add a new event family:

1. Add the event type literal to the `EventTypeEnum` union.
2. Add a Zod payload schema for it.
3. Register the schema in the `EventPayloadSchemas` mapping.

### Subscriber registration

Subscribers go under `server/src/lib/eventBus/subscribers/`. The new `searchIndexSubscriber.ts` registers in `server/src/lib/eventBus/initialize.ts` alongside the existing subscribers (`ticketEmailSubscriber`, `internalNotificationSubscriber`, etc.). Follow the pattern in those files.

### pg-boss job registration

- Scheduler entry: `server/src/lib/jobs/jobScheduler.ts`
- Handler registry: `server/src/lib/jobs/jobHandlerRegistry.ts`

Pattern:

```typescript
import { JobHandlerRegistry } from 'server/src/lib/jobs/jobHandlerRegistry';
import { JobScheduler } from 'server/src/lib/jobs/jobScheduler';

JobHandlerRegistry.register({
  name: 'search:reconcile',
  handler: async (jobId, data: { tenantId: string }) => {
    // reconciliation logic per tenant
  },
  retry: { maxAttempts: 3 },
});

const scheduler = await JobScheduler.getInstance(/* … */);
await scheduler.scheduleRecurringJob('search:reconcile', '24 hours', { tenantId });
```

### withAuth pattern

```typescript
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';

export const searchAppAction = withAuth(async (user, { tenant }, input: SearchAppInput) => {
  const { knex } = await createTenantKnex();
  // ...
});
```

Reference example: `server/src/app/msp/service-requests/actions.ts` lines 67–74.

### Tests

- Runner: **Vitest** (config at `server/vitest.config.ts`)
- Unit test example: `server/src/test/unit/workflowEmptyPayloadSchema.unit.test.ts`
- Integration test example: `server/src/test/client-owned-contracts-resource-semantics.test.ts`
- Commands (per CLAUDE.md):
  - `npm run test:unit`
  - `npm run test:integration`
  - `npm run test:e2e`
  - `npm run test:local` (all)

### i18n key convention

`server/public/locales/en/msp/core.json` uses nested camelCase, e.g.:

```json
{
  "nav": { "home": "Home", "tickets": "Tickets" },
  "sidebar": { "searchPlaceholder": "Search" }
}
```

For the search namespace, mirror the structure:

```json
{
  "search": {
    "placeholder": "Search clients, tickets, documents…",
    "shortcutHint": "⌘K",
    "noResults": "No results for \"{{query}}\"",
    "loading": "Searching…",
    "seeAllResults": "See all {{count}} results",
    "filters": {
      "all": "All",
      "clients": "Clients",
      "tickets": "Tickets",
      "documents": "Documents",
      "..."
    },
    "groups": { "...": "..." }
  }
}
```

Run the lang-pack pipeline (`generate-pseudo-locales.cjs` + `validate-translations.cjs`) once after adding English keys to propagate to all locales.

---

## CE / EE extension — quick reference

Full spec is in PRD §19. The short version for the implementer:

- **CE owns the infrastructure.** `app_search_index` table, registry, subscriber, query builder, search action, UI all live in CE. EE never duplicates these.
- **Registry merges two arrays:** `ceIndexers` (from `./indexers`) + `eeIndexers` (from `ee/server/src/lib/search/indexers`, stubbed to `[]` in CE).
- **CE stub file** is created as part of F131. Match the existing repo CE/EE stub pattern — see `ee/server/src/lib/storage/providers/` or any other `ee/server/src/...` that already has a CE stub for the convention. The `ce-ee-stub-fixer` skill describes the build-time alias mechanism.
- **`object_type` is `text`**, not an enum. Schema is identical CE↔EE.
- **EE adds its own event types** in `packages/event-schemas` (or the EE event-schema extension point). The CE subscriber doesn't care — it dispatches by `object_type` via the merged registry.
- **Orphan rows** (e.g., a CE deploy holding an old EE row): filtered out at query time via `object_type = ANY(registeredObjectTypes())`. Reconciliation also skips unregistered types — so it won't error trying to load an EE source row that doesn't exist in CE.
- **What EE writes** (per entity): one indexer module + one event family + i18n keys for filter/group labels. EE does not touch CE files.

Known likely EE entities (out of scope for CE v1): chat history (`ee/server/migrations/20260407163000_add_chat_history_search_indexes.cjs`), AI conversations/messages (`ee/server/migrations/202410291100_create_ai_schema.cjs`). EE planning is separate.

---

## Document ACL — v1 scope is intentional

CE has **no internal per-user document permission mechanism**. Two related tables exist but neither is the right primitive:

- `document_associations` — links a document to an entity (ticket, client, contact, …). Used for "show me docs attached to this entity," not for "user A can read this doc."
- `document_share_links` — external token-based public shares with revoke/expiry. Not internal ACL.

**Decision for v1:** documents are tenant-wide with `required_permission='document:read'` and optional `client_scope_id` derived from `documents.client_id`. The unused index columns `is_private` and `visible_to_user_ids` remain available for v2 if/when an internal share model is added — no schema change required at that time.

---

## Concrete deploy runbook

```bash
# 1. Apply migration
npm run migrate

# 2. Deploy code with subscriber disabled
#    Set in env / helm values:
#      SEARCH_INDEX_LIVE=false

# 3. Backfill all tenants
npm run search:backfill

# 4. Flip env to enable live indexing
#    SEARCH_INDEX_LIVE=true
#    Roll workers + server

# 5. Reconciliation job runs daily from launch; first run catches anything
#    missed between (3) and (4).

# 6. Enable the sidebar UI by merging the feature branch to main.
```

---

## Implementation log

- **2026-05-13 — F039 service catalog indexer.** Added `serviceCatalogIndexer` and registered it in the CE indexer array. It indexes `service_catalog.service_name` as title, combines `description` with flattened `attributes` JSONB for the body, links to `/msp/billing/services/{service_id}`, and sets `requiredPermission='service_catalog:read'`. `sourceEvents` stays empty until the service-catalog event family is added in F057. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/service_catalog.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F040 service request submission indexer.** Added `serviceRequestSubmissionIndexer` and registered it. It indexes `request_name`, flattens `submitted_payload` via the secret-skipping JSONB flattener, links to `/msp/service-requests/{submission_id}`, sets `requiredPermission='service_request:read'`, and carries `client_id` into `clientScopeId`. `sourceEvents` remains empty until F058 adds the service-request event family. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/service_request_submission.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F041 service request definition indexer.** Added `serviceRequestDefinitionIndexer` and registered it. It indexes `service_request_definitions.name` and `description`, links to `/msp/service-requests/definitions/{definition_id}`, and sets the admin-only ACL hint with `requiredPermission='admin'`. Event hooks remain empty until F058. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/service_request_definition.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F042 workflow task indexer.** Added `workflowTaskIndexer` with explicit `tenant` predicates on both `loadOne` and `loadBatch`, even though `workflow_tasks.task_id` is the only PK in the current schema. It indexes `title` and `description`, links to `/msp/workflow-tasks/{task_id}`, sets `requiredPermission='workflow_task:read'`, and parses `assigned_users` JSONB into de-duplicated `visibleToUserIds` from string arrays or object arrays (`user_id`, `userId`, `id`). Event hooks remain empty until F059. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/workflow_task.ts server/src/lib/search/indexers/index.ts`.

---

## Implementation order suggestion (not prescriptive)

Roughly:

1. Migration + indexes (F001–F008).
2. Types, normalize utilities, registry skeleton (F009–F021).
3. One indexer end-to-end as a vertical slice: clients (F022) → upsert → query → typeahead → see results in dev.
4. Remaining 26 indexers (F023–F048) in parallel-friendly batches.
5. Event publishes that don't exist yet (F049–F062). Many of these are 5–15 line additions at existing action sites.
6. Subscriber (F063–F067) + cascades (F068–F072).
7. Backfill CLI (F073–F078).
8. Reconciliation (F079–F083).
9. Query builder + ACL + snippets (F084–F099).
10. Server actions (F100–F103).
11. UI (F104–F117) + a11y/i18n (F118–F123).
12. Telemetry, deploy notes, hash-anchor scroll (F124–F130).
