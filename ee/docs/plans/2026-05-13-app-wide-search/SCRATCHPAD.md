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

## Implementation log — 2026-05-14

- **F061 — Schedule/time-entry search events.**
  - Added missing `TIME_ENTRY_CREATED`, `TIME_ENTRY_UPDATED`, `TIME_ENTRY_DELETED`, and `TIME_ENTRY_CHANGES_REQUESTED` event types to `packages/event-schemas/src/schemas/eventBusSchema.ts`; kept existing `TIME_ENTRY_SUBMITTED` and `TIME_ENTRY_APPROVED`.
  - Relaxed `TimeEntryEventPayloadSchema` to match real payloads from both REST services and server actions (`workItemType` is stored as lowercase DB values and `workItemId` can be non-ticket/non-project values).
  - Wired `scheduleEntryIndexer.sourceEvents` to `SCHEDULE_ENTRY_CREATED/UPDATED/DELETED` and `timeEntryIndexer.sourceEvents` to all time-entry CRUD/status events.
  - Existing schedule actions already publish schedule events; added schedule-entry publishes for the `TimeSheetService` schedule mutation path.
  - Added time-entry publishes to `packages/scheduling/src/actions/timeEntryCrudActions.ts` for create/update/delete and approval status transitions. Event publish failures are logged and do not block the user-facing action, matching the action-layer pattern used elsewhere.
  - Validation: `npm -w @alga-psa/event-schemas run typecheck`, `npm -w @alga-psa/scheduling run typecheck`, `git diff --check`.

- **F062 — Board/category/tag search events.**
  - Added `BOARD_CREATED/UPDATED/DELETED`, `CATEGORY_CREATED/UPDATED/DELETED`, and `TAG_DEFINITION_DELETED` to `packages/event-schemas/src/schemas/eventBusSchema.ts`. Existing `TAG_DEFINITION_CREATED/UPDATED` workflow events are reused for tag index upserts.
  - Wired `boardIndexer`, `categoryIndexer`, and `tagIndexer` `sourceEvents` to the relevant event families.
  - Added board event publishes to `server/src/lib/api/services/BoardService.ts`; added board/category import/delete publishes to `packages/reference-data/src/actions/referenceDataActions.ts`.
  - Added tag-definition update/delete publishes to both the package actions (`packages/tags/src/actions/tagActions.ts`) and REST API service (`server/src/lib/api/services/TagService.ts`) so tag definition changes re-index the `tag_definitions` row.
  - Note: the category indexer remains scoped to the `categories` table per the existing F047 implementation and PRD source-table choice; `ticket_categories` API mutations are not wired to avoid emitting event IDs the current indexer cannot load.
  - Validation: `npm -w @alga-psa/event-schemas run typecheck`, `npm -w @alga-psa/tags run typecheck`, `npm -w @alga-psa/reference-data run typecheck`, `git diff --check`.

- **F063 — Search index subscriber shell.**
  - Added `server/src/lib/eventBus/subscribers/searchIndexSubscriber.ts` with register/unregister lifecycle hooks and idempotent registration state.
  - Registered the subscriber in `server/src/lib/eventBus/subscribers/index.ts` so normal event-bus initialization invokes it.
  - Deliberately kept event handling out of this commit; F064-F067 own event resolution, writes/deletes, and the `SEARCH_INDEX_LIVE` gate.

- **F064 — Registry-driven subscriber resolution.**
  - `searchIndexSubscriber` now builds an event-type map from `allIndexers()` and subscribes to the union of every registered indexer's `sourceEvents`.
  - Added `resolveSearchIndexersForEvent(eventType)` so the event handler resolves each event to one or more indexers by registry metadata rather than a hard-coded switch.
  - Handler currently logs the resolved object types only; F065/F066 add upsert/delete behavior.

- **F065 — Subscriber upsert path.**
  - Non-delete events now extract `tenantId` plus an object-type-specific source ID from the event payload, call `indexer.loadOne(knex, tenant, id)`, and pass the resulting `SearchDoc` to `upsertSearchDoc`.
  - ID extraction is centralized in `OBJECT_ID_FIELDS` in `searchIndexSubscriber.ts`; this absorbs the mixed camelCase/snake_case payload names used across the current event publishers.
  - Delete events are detected and explicitly skipped for now; F066 wires `deleteSearchDoc`.

- **F066 — Subscriber delete path.**
  - Delete-style events (`*_DELETED` plus `TAG_DEFINITION_DELETED`) now call `deleteSearchDoc(knex, tenant, objectType, objectId)` for each resolved indexer.
  - Missing IDs on delete events are logged and skipped, matching the non-delete path's defensive behavior.

- **F067 — Live-indexing gate.**
  - Added `isSearchIndexLiveEnabled()` to `searchIndexSubscriber.ts`; it returns true only when `SEARCH_INDEX_LIVE === 'true'`, so the default/unset behavior is disabled.
  - The event handler resolves and acknowledges events but returns before opening a DB connection or writing rows when live indexing is disabled.
  - The env var is read at event-handling time, so future events see a changed value without code changes; process env propagation still depends on the deployment/runtime.

- **F068 — Ticket comment cascade.**
  - On `TICKET_UPDATED`, after the ticket document is upserted, the subscriber selects all comment IDs for the same `(tenant, ticket_id)` and re-upserts each `ticket_comment` document.
  - Rationale: ticket-comment search rows denormalize the parent ticket title, so ticket title edits must refresh existing comment rows even when comment bodies did not change.

- **F069 — Invoice child cascade.**
  - On `INVOICE_UPDATED`, after the invoice document is upserted, the subscriber re-upserts invoice item and invoice annotation rows for the same `(tenant, invoice_id)`.
  - Rationale: item/annotation rows denormalize invoice number and invoice client ACL hints from their parent invoice.

- **F070 — Project child cascade.**
  - On `PROJECT_UPDATED`, after the project document is upserted, the subscriber pages through phases, tasks, and task comments for the project in 500-row batches and re-upserts each child document.
  - Rationale: phase/task/comment rows denormalize parent project information and inherit project ACL hints, so project edits must refresh children.
  - This is implemented inside the async event-bus handler rather than a separate pg-boss job for now; the work is paged and bounded per batch to avoid a single large read.

- **F071 — Document-association re-index.**
  - Already covered by the F056 event publishes plus F065 subscriber upsert path: `DOCUMENT_ASSOCIATED` and `DOCUMENT_DETACHED` carry `documentId`, and `documentIndexer.sourceEvents` includes both events.
  - When those events arrive with `SEARCH_INDEX_LIVE=true`, the subscriber resolves the `document` indexer and reloads/upserts the document row.

- **F072 — User role-change ACL refresh job.**
  - Added `server/src/lib/jobs/handlers/searchVisibleUserReindexHandler.ts` with job name `search-visible-user-reindex`.
  - The job pages through `app_search_index` rows for a tenant where `visible_to_user_ids` contains the changed user, re-runs the registered indexer for each row, upserts refreshed ACL/content, and deletes stale index rows when the source row no longer loads.
  - Registered the job in both `registerAllJobHandlers()` and the legacy `initializeScheduler()` path, and exposed `scheduleSearchVisibleUserReindexJob()`.
  - `searchIndexSubscriber` now enqueues this job after processing `USER_ROLES_UPDATED`, gated behind `SEARCH_INDEX_LIVE` with the rest of live indexing. Enqueue failures are logged but do not fail the original search-index event handling.
  - Tightened several cascade queries from object-style `.where({ ... })` to chained column predicates because the server typecheck reached those earlier subscriber lines and rejected the overload.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F073 — Search backfill CLI entrypoint.**
  - Created `server/src/scripts/search-backfill.ts` with a typed `parseSearchBackfillArgs()` and `runSearchBackfill()` entrypoint.
  - The file is intentionally a scaffold in this commit; F074-F077 fill tenant discovery, indexer selection, paging, and idempotent upsert behavior in separate commits.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F074 — Backfill tenant selection.**
  - `search-backfill.ts` now opens the server Knex config, discovers all tenants from the `tenants` catalog by default, and accepts `--tenant=<uuid>` / `--tenant <uuid>` to run a single tenant.
  - `runSearchBackfill()` accepts an optional existing Knex instance for future tests and destroys only connections it creates itself.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F075 — Backfill indexer selection.**
  - The CLI now resolves indexers through the search registry: default is `allIndexers()`, and `--type=<object_type>` / `--type <object_type>` narrows to one registered indexer.
  - Unknown object types fail fast with a typed error before any backfill loop runs.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F076 — Backfill paging.**
  - Added a 500-row backfill loop that calls each indexer's `loadBatch(knex, tenant, cursor, 500)` and advances the cursor from the last returned `SearchDoc.objectId`.
  - The loop logs per-batch progress and stops on an empty or short page. Writes are intentionally deferred to F077.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F077 — Idempotent backfill upserts.**
  - The backfill loop now calls `upsertSearchDoc(knex, doc)` for every loaded `SearchDoc`, using the existing `(tenant, object_type, object_id)` `ON CONFLICT` path.
  - Re-running the CLI overwrites the same index rows with source-derived content/ACLs rather than creating duplicates.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F078 — Root backfill npm script.**
  - Added root `package.json` script `search:backfill` -> `tsx server/src/scripts/search-backfill.ts`.
  - This matches the deployment runbook command and supports passthrough args such as `npm run search:backfill -- --tenant=<uuid> --type=client`.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F079 — Search reconciliation job registration.**
  - Added `server/src/lib/jobs/handlers/searchReconcileHandler.ts` with job name `search:reconcile` and registered it in both `registerAllJobHandlers()` and the legacy scheduler initialization.
  - The handler is a shell in this commit; F080-F082 add watermark re-indexing, missing-row inserts, and stale-index deletion.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F080 — Reconcile rows updated after index watermark.**
  - `searchReconcileHandler` now resolves tenants and indexers, computes `max(source_updated_at)` from `app_search_index` per `(tenant, object_type)`, scans source rows through `indexer.loadBatch()`, and upserts any `SearchDoc` whose `sourceUpdatedAt` is newer than the watermark.
  - The implementation intentionally uses the indexer contract instead of per-table SQL so every entity keeps its own source joins, normalization, URL, and ACL logic.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F081 — Reconcile stale index deletes.**
  - Reconciliation now scans existing `app_search_index` rows for each registered `(tenant, object_type)`, calls `indexer.loadOne()` for each `object_id`, and deletes the index row when the source no longer loads.
  - This also removes rows for sources that still exist but no longer qualify for indexing (for example, a time entry whose notes became empty).
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F082 — Reconcile missing index inserts.**
  - Reconciliation now scans source docs in 500-row batches, loads existing `app_search_index.object_id`s for the same batch, and upserts any source doc missing from the index.
  - This covers backfill gaps and direct SQL deletes of index rows even when the source row's `sourceUpdatedAt` is older than the current indexed watermark.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F083 — Daily search reconciliation schedule.**
  - Added `scheduleSearchReconcileJob(tenantId, cron='0 6 * * *')` and scheduled it once per tenant from `initializeScheduledJobs()`.
  - The deploy runbook below now calls out that `search:reconcile` runs daily at 6:00 AM per tenant after scheduled jobs initialize.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F084 — Query parsing.**
  - Added `server/src/lib/search/query.ts` with `parseQuery(raw)`.
  - The parser collapses whitespace, trims, rejects empty input, enforces the 200-character cap, detects `^[A-Z]+-?\d+$` identifier-style queries case-insensitively, and lowercases identifier keys for later metadata matching.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F085 — FTS search query branch.**
  - Added `runSearchQuery()` in `server/src/lib/search/query.ts`.
  - The initial SQL path uses `websearch_to_tsquery('english', ?)` and `ts_rank_cd(s.search_vector, q.tsq)` with mandatory `tenant = ?`, `object_type = ANY(?::text[])`, and `search_vector @@ tsq` predicates.
  - Results are ordered by FTS rank, recency, and object ID. ACL, trigram fallback, identifier pinning, snippets, and cursor pagination are intentionally left to F086-F093/F089-F092.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F086 — pg_trgm fallback.**
  - `runSearchQuery()` now includes `s.title % q.raw` and `coalesce(s.subtitle, '') % q.raw` fallback predicates in addition to FTS.
  - The returned score now combines `ts_rank_cd` with `GREATEST(similarity(title), similarity(subtitle)) * 0.4` so fuzzy-only hits can rank while still favoring FTS matches.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F087 — Identifier match pinning.**
  - `parseQuery()` already detects identifier-style input and lowercases the key; `runSearchQuery()` now probes `lower(metadata->>'identifier')` for exact matches when that key is present.
  - Exact identifier matches are included even if FTS/trigram do not match and receive score `1000`, pinning tickets/assets/invoices/contracts with matching identifiers above normal relevance results.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F088 — Time-decayed relevance.**
  - Non-identifier search scores now multiply the FTS/trigram composite by `GREATEST(exp(-age_seconds / (90 * 86400)), 0.05)`.
  - Exact identifier matches keep the explicit high score so identifier lookup remains pinned above decayed relevance results.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F089 — Opaque search cursors.**
  - Added `encodeSearchCursor()` / `decodeSearchCursor()` in `server/src/lib/search/query.ts`. The cursor is base64url JSON containing score, updated timestamp, and object ID.
  - `runSearchQuery()` now accepts `cursor`; when present it applies keyset pagination against `(score DESC, source_updated_at DESC, object_id ASC)` and ignores offset.
  - Malformed cursors throw `SearchQueryError('invalid_cursor')` instead of falling through to a 500-prone parse path.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F090 — Snippet generation.**
  - `runSearchQuery()` now returns optional `snippet` text and includes `ts_headline('english', coalesce(body, ''), tsq, 'MaxFragments=2,StartSel=<mark>,StopSel=</mark>')` when snippets are enabled.
  - Added `includeSnippets` query option, defaulting to true; F092 uses it to skip snippets for typeahead.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F091 — Snippet sanitization.**
  - `ts_headline` now emits controlled sentinel strings instead of literal HTML tags.
  - Added `sanitizeHeadline()` to HTML-escape every text segment and re-wrap only sentinel-delimited matches in `<mark>`.
  - Malformed/unpaired sentinel output falls back to fully escaped text, preventing arbitrary HTML from surviving snippet generation.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F092 — Typeahead skips snippets.**
  - Added `runSearchTypeaheadQuery()` wrapper around `runSearchQuery()` that forces `limit=5` and `includeSnippets=false`.
  - The future typeahead server action can use this path without emitting `ts_headline` in its SQL.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F093 — ACL SQL predicate helper.**
  - Added `aclPredicateSql(user)` in `server/src/lib/search/acl.ts`.
  - The helper returns a parameterized SQL fragment covering `required_permission`, `visible_to_user_ids`, `visible_to_roles`, `is_internal_only`, `is_private`, and `client_scope_id`.
  - `is_private` is treated as share-list-only via `visible_to_user_ids`; CE v1 document rows do not set it, but the predicate is wired for future private rows.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F094 — Single permission-set resolution.**
  - Added `resolveSearchAclPrincipal(knex, user, accessibleClientIds)` in `server/src/lib/search/acl.ts`.
  - It calls `User.getUserRolesWithPermissions()` once, filters role/permission applicability by MSP vs client user type, and returns unique `resource:action` strings for the SQL `required_permission = ANY(?::text[])` predicate.
  - It also returns role names and `isInternal` for the rest of the ACL predicate.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F095 — Per-user visibility overlap predicate.**
  - Covered by the F093 ACL predicate: rows with non-empty `visible_to_user_ids` require `visible_to_user_ids && ARRAY[user_id]::uuid[]`.
  - Empty `visible_to_user_ids` remains unrestricted by user ID and is controlled by the other ACL columns.
  - Validation: `git diff --check`; `npm -w server run typecheck` from F094 still covers the helper.

- **F096 — Internal/private/client-scope ACL predicates.**
  - Covered by the F093 ACL predicate: `is_internal_only` requires an internal user, `is_private` requires membership via `visible_to_user_ids`, and `client_scope_id` must be in `accessibleClientIds`.
  - For CE v1 documents, `is_private` remains false by indexer policy; the column is still enforced for future rows or synthetic tests.
  - Validation: `git diff --check`; `npm -w server run typecheck` from F094 still covers the helper.

- **F097 — Record-level visibility pass framework.**
  - Added `registerSearchVisibilityVerifier(objectType, verifier)` and `verifyResultVisibility(knex, user, rows)` to `server/src/lib/search/acl.ts`.
  - Rows without a registered verifier pass through; rows with a verifier are kept only when the authoritative per-entity verifier returns true.
  - F098 wires concrete entity verifiers; F099 adds drift telemetry for dropped rows.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F098 — Concrete record-level visibility verifiers.**
  - No existing `assertTicketReadable` / `assertProjectReadable` helpers were found by recon; implemented equivalent source-table verifiers in `acl.ts`.
  - Ticket verifier checks source existence; ticket-comment verifier checks source existence, parent ticket existence, and internal-comment visibility.
  - Project, phase, task, and task-comment verifiers check source existence plus parent project client scope; document verifier checks source existence plus `documents.client_id` scope; workflow-task verifier checks source existence plus `assigned_users` membership.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F099 — ACL drift telemetry.**
  - `verifyResultVisibility()` now emits `search.acl_drift` when a row passed SQL ACL filtering but failed the record-level verifier.
  - Telemetry is a server warning log with metric/object/user/tenant fields, plus an optional global `Sentry.captureMessage()` call when a Sentry client is present in the runtime.
  - The repo currently has no direct Sentry package dependency, so the Sentry path is intentionally optional and dependency-free.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F100 — Full search server action.**
  - Added `server/src/lib/actions/searchActions.ts` with `searchAppAction` wrapped in `withAuth`.
  - The action resolves registered object types, loads a single ACL principal/permission set, runs `runSearchQuery()` with snippets and SQL ACL filtering, applies `verifyResultVisibility()`, and returns `SearchAppResult` rows plus grouped counts and next cursor.
  - Current grouped counts are computed from the visible fetched page; a broader count query can be expanded when the results page work needs full pre-pagination counts.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F101 — Typeahead search server action.**
  - Added `searchAppTypeaheadAction` in `searchActions.ts`.
  - It uses the same registered-type and ACL resolution path as full search, but calls `runSearchTypeaheadQuery()` and returns at most five rows with `snippet` stripped.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F102 — Search action input schema.**
  - Added `searchAppInputSchema` in `searchActions.ts` with Zod validation for `query` (trimmed, 1-200 chars), `types` (`SearchObjectType` enum values), `limit` (1-100), and optional `cursor`.
  - Both full search and typeahead actions parse input at the action boundary before touching the database.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F103 — Search action output schemas.**
  - Added Zod schemas for `SearchResultRow`, `SearchAppResult`, and the typeahead result in `server/src/lib/actions/searchActions.ts`.
  - Both authenticated search actions now parse their returned payloads at the action boundary, keeping result URLs, ISO timestamps, score values, group counts, and optional cursors under the documented contract.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F104 — SearchPalette component.**
  - Added `server/src/components/search/SearchPalette.tsx` as a client component using `cmdk` for the sidebar search input and suggestion list.
  - The component debounces typeahead queries by 200 ms against `searchAppTypeaheadAction`, suppresses the popup before two trimmed characters, supports a collapsed icon button, and renders title-only suggestion rows.
  - Native anchor behavior, the global shortcut, and sidebar insertion remain separate feature checkpoints (F105-F108).
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F105 — Cmd/Ctrl+K search shortcut.**
  - Added a global keydown listener to `SearchPalette`.
  - `Cmd+K` / `Ctrl+K` prevents the browser default, focuses the sidebar search input when expanded, and requests sidebar expansion before focusing when collapsed.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F106 — Native-anchor typeahead rows.**
  - Typeahead suggestions now render at most five rows and each row is a real `<a href={result.url}>` inside `cmdk`.
  - This preserves browser-native Cmd/Ctrl-click, middle-click, and context-menu behavior while keeping title-only suggestion text.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F107 — See-all typeahead row.**
  - Added a permanent last `cmdk` row linking to `/msp/search?q={query}` once the query has at least two trimmed characters.
  - The row uses the typeahead action's `totalCount` value and remains a native anchor, so users can open the full results page in a new tab.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F108 — Sidebar launcher insertion.**
  - Replaced the old commented-out sidebar search placeholder in `Sidebar.tsx` with the new `SearchPalette`.
  - The collapsed sidebar renders an icon button that expands the sidebar; the expanded sidebar renders the full typeahead input above the nav.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F109 — Search results route.**
  - Added `server/src/app/msp/search/page.tsx` as a dynamic server component.
  - It reads `q`, `type`, `cursor`, and `sort` from `searchParams`, calls `searchAppAction()` for non-empty queries, and renders initial SSR result anchors.
  - The `sort` param is read and reflected in page data for URL-state continuity; query-layer sort behavior is still the F117 checkpoint.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F110 — Search page URL-state client shell.**
  - Added `server/src/app/msp/search/SearchPageClient.tsx` and moved the route's rendered shell into it.
  - The results-page input is controlled from the URL's `q` value and debounces `router.replace()` for 200 ms on edits, preserving `type` and non-default `sort` while resetting cursor on new text input.
  - The server page still fetches initial data so cold `/msp/search?...` URLs render with results in SSR output.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F111 — Results filter chips.**
  - Added anchor-based filter chips to `SearchPageClient`: `All` plus one chip for every object type present in the returned `groups` record.
  - Each chip shows a count badge and builds a shareable `/msp/search` URL preserving `q` and non-default `sort` while setting or clearing `type`.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F112 — Grouped all-types results.**
  - When the active type filter is `All`, `SearchPageClient` now groups visible results by entity type and caps each rendered group at 10 rows.
  - Group headings use `search.groups.{objectType}` with a humanized fallback and show the corresponding group count from the server action result.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F113 — Single-type flat results.**
  - The search route passes a valid `type` query parameter through to `searchAppAction`, so single-type URLs fetch only that entity type.
  - `SearchPageClient` renders the non-`All` branch as a flat list of result anchors instead of grouped sections.
  - Validation: covered by the F112 typecheck run; no code change required beyond recording the checkpoint.

- **F114 — Cursor pagination controls.**
  - Added previous/next pagination links to `SearchPageClient` using the query layer's opaque `nextCursor`.
  - The page now accepts a lightweight `cursorStack` URL parameter so a previous link can reconstruct the prior cursor boundary while keeping the canonical `cursor` parameter as the active page boundary.
  - Text edits and filter changes intentionally drop cursor state so refreshed searches start from the first page.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F115 — Loading and empty states.**
  - Added skeleton rows while the results-page input value differs from the URL-backed query and the 200 ms router update is pending.
  - Added an empty state for zero-result searches that echoes the query and suggests removing the type filter when one is active.
  - Pagination is hidden while loading or empty so stale cursor controls do not appear.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F116 — Native-anchor result rows.**
  - The shared `renderResultRow()` helper in `SearchPageClient` renders every row as `<a href={row.url}>` in both grouped and flat result modes.
  - This preserves browser-native new-tab and context-menu affordances on the full results page.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F117 — Relevance/recent sort toggle.**
  - Added `sort?: 'relevance' | 'recent'` to the search action input and passed it from `/msp/search`.
  - `runSearchQuery()` now switches its keyset predicate and `ORDER BY`: relevance uses score/recency/object_id, while recent uses `source_updated_at DESC, object_id ASC`.
  - Added a results-page segmented anchor toggle that preserves `q` and `type` while resetting cursor state on sort changes.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F118 — Search ARIA semantics.**
  - Added explicit combobox attributes to the sidebar search input: `role`, `aria-autocomplete`, `aria-expanded`, `aria-controls`, and `aria-activedescendant`.
  - Added stable list/option IDs for the typeahead popup and kept `/msp/search` exposed as an ARIA `region` in `SearchPageClient`.
  - Arrow-key state updates are handled in the next keyboard checkpoint (F119).
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F119 — Search keyboard navigation.**
  - Sidebar search now handles ArrowDown/ArrowUp with wrapping selection across suggestions plus the see-all row; `aria-activedescendant` tracks the selected option.
  - Enter opens the selected suggestion or submits to `/msp/search?q=...`; Escape dismisses the typeahead without trapping Tab behavior.
  - Results-page input handles Enter for immediate URL submission and Escape to restore the URL-backed query and blur.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F120 — Stable search DOM IDs.**
  - Added `toDomIdPart()` helpers in the search UI components so dynamic type and record IDs are normalized to lowercase kebab-case-safe fragments.
  - Sidebar options, full-page result rows, filter chips, sort controls, pagination links, and empty-state controls now have stable IDs with sanitized dynamic portions.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F121 — English search locale keys.**
  - Added the `search.*` namespace to `server/public/locales/en/msp/core.json`.
  - Covered placeholders, loading/help/error text, result summaries, empty states, filters/groups for all 27 object types, sort labels, pagination labels, and the typeahead see-all row.
  - Validation: `node -e "JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/core.json','utf8'))"`; `git diff --check`; `npm -w server run typecheck`.

- **F122 — Lang-pack propagation and validation.**
  - Ran `node scripts/generate-pseudo-locales.cjs`, which regenerated 86 pseudo-locale files from 43 English sources.
  - Ran `node scripts/validate-translations.cjs`; the first pass exposed missing real-locale `search.*` keys, so copied the English `search` namespace into `de/es/fr/it/nl/pl/pt` `msp/core.json` files and reran validation.
  - Final validation passed with 0 errors and 8 pre-existing Polish plural-form warnings unrelated to search.
  - Validation: `git diff --check`; `node scripts/validate-translations.cjs`; `npm -w server run typecheck`.

- **F123 — Search UI translation wiring.**
  - Removed English `defaultValue` fallbacks from `SearchPalette` and `SearchPageClient` now that `search.*` locale keys exist.
  - Visible search UI text is resolved through `useTranslation('msp/core')`; the only remaining hardcoded strings in these components are non-UI route/status identifiers and telemetry-style log keys.
  - Validation: `rg "defaultValue:" server/src/components/search/SearchPalette.tsx server/src/app/msp/search/SearchPageClient.tsx` returns no matches; `git diff --check`; `npm -w server run typecheck`.

- **F124 — SEARCH_INDEX_LIVE documentation/config.**
  - Added `SEARCH_INDEX_LIVE=false` to `.env.example` with rollout guidance: keep false through migration/backfill, then flip true for live incremental indexing.
  - Added `server.searchIndexLive` to `helm/values.yaml` and wired it into the main server deployment as the `SEARCH_INDEX_LIVE` environment variable.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F125 — Deploy runbook.**
  - Added `docs/deployment/app-wide-search-runbook.md`.
  - The runbook covers migrate, deploy with `SEARCH_INDEX_LIVE=false`, run `npm run search:backfill`, flip live indexing on, roll server/workers, sample index health, and confirm `search:reconcile`.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F126 — Search action telemetry.**
  - Added structured server logs for `search.query.count`, `search.query.empty`, and `search.query.latency_ms` in both `searchAppAction` and `searchAppTypeaheadAction`.
  - Each telemetry payload includes variant (`full` or `typeahead`), tenant, user ID, and latency value for the histogram-style metric.
  - `search.acl_drift` was already emitted by `verifyResultVisibility()` in F099 via server log plus optional Sentry capture.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F127 — Per-user search rate limiting.**
  - Added in-memory `rate-limiter-flexible` guards at the server-action boundary.
  - Full search is limited to 10 requests/sec per `(tenant, user)`; typeahead is limited to 30 requests/sec per `(tenant, user)`.
  - Limit failures throw `SearchRateLimitError` with `status=429`, `code='SEARCH_RATE_LIMITED'`, and `retryAfterMs`.
  - Validation: `git diff --check`; `npm -w server run typecheck`.

- **F128 — Ticket comment hash highlight.**
  - Main ticket comments now render with canonical `id="comment-{comment_id}"` DOM anchors to match search index URLs.
  - `CommentItem` detects a matching `#comment-{id}` hash on mount, scrolls the comment into view, and applies `.search-highlight` plus a short visual ring/background for about two seconds.
  - Validation: `git diff --check`; `npm -w @alga-psa/tickets run typecheck`; `npm -w server run typecheck`.

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

# 5. Reconciliation job (`search:reconcile`) runs daily at 6:00 AM per tenant
#    from launch; first run catches anything missed between (3) and (4).

# 6. Enable the sidebar UI by merging the feature branch to main.
```

---

## Implementation log

- **2026-05-13 — T061 asset CRUD event contract.** Extended `searchEventPublishing.contract.test.ts` to assert asset actions emit `ASSET_CREATED`, `ASSET_UPDATED`, and `ASSET_DELETED`, covering search index incremental refresh for asset rows. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed.
- **2026-05-13 — T062 invoice-family event contract.** Added a contract test for invoice header, item, and annotation create/update/delete event coverage. Filled the missing invoice item update publish in `packages/billing/src/models/invoice.ts` and added an annotation update helper that publishes `INVOICE_ANNOTATION_UPDATED`, matching the search indexer source events. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed; `npm -w @alga-psa/billing run typecheck` passed.
- **2026-05-13 — T063 contract-family event contract.** Extended the source-publishing contract test to cover `CONTRACT_*` and `CLIENT_CONTRACT_*` CRUD events. Added `CLIENT_CONTRACT_DELETED` publishes when deleting a contract removes its client assignments, so client-contract search rows can be removed incrementally. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed; `npm -w @alga-psa/billing run typecheck` passed.
- **2026-05-13 — T064 document update event contract.** Added source contract coverage for document content updates, association changes, and share-link create/revoke changes emitting `DOCUMENT_UPDATED`. Wired association and share-link changes to publish `DOCUMENT_UPDATED` so document search rows are reindexed when client scope or share state changes. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed; `npm -w @alga-psa/documents run typecheck` passed.
- **2026-05-13 — T065 service catalog event contract.** Extended the publishing contract test to assert both API and billing action service-catalog CRUD paths emit `SERVICE_CATALOG_CREATED`, `SERVICE_CATALOG_UPDATED`, and `SERVICE_CATALOG_DELETED`. Added publishes to `packages/billing/src/actions/serviceActions.ts` so MSP UI mutations refresh service catalog search rows. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed; `npm -w @alga-psa/billing run typecheck` passed.
- **2026-05-13 — T066 service-request event contract.** Added contract coverage for service-request definition/submission create, update, and delete search events. Existing create/update paths already published; added narrow delete helpers that emit `SERVICE_REQUEST_DEFINITION_DELETED` and `SERVICE_REQUEST_SUBMISSION_DELETED` so index rows can be removed when these records are physically deleted. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed; `npm -w server run typecheck` passed.
- **2026-05-13 — T067 workflow task event contract.** Added contract coverage for workflow task create/update/delete and assignment-change search events. The model already published create/update; added model helpers for assignment replacement and deletion that emit `WORKFLOW_TASK_ASSIGNMENT_CHANGED` and `WORKFLOW_TASK_DELETED`. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed; `npm -w server run typecheck` passed.
- **2026-05-13 — T068 remaining event-family contract.** Added aggregate contract coverage for interaction, schedule entry, time entry, board, category, and tag CRUD event publishes. Existing interaction/schedule/time/tag paths already published; added board/category publishes in ticket UI actions to match API/reference-data coverage. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed; `npm -w @alga-psa/tickets run typecheck` passed.

- **2026-05-13 — T069 subscriber event-union contract.** Added unit coverage that the search index subscriber event list equals the union of every registered indexer's `sourceEvents`, and that the event resolver maps each event to all declaring indexers. Exposed a small read-only helper for the computed subscription event types so registration can stay registry-driven. Validation: `npx vitest run src/test/unit/searchIndexSubscriber.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T070 subscriber create-upsert behavior.** Added a fast behavior test for `CLIENT_CREATED` with live indexing enabled: the subscriber extracts tenant/object id, calls the client indexer's `loadOne`, and forwards the resulting `SearchDoc` to `upsertSearchDoc`. Exposed a test-only handler wrapper so the event handling path can be exercised without Redis. Validation: `npx vitest run src/test/unit/searchIndexSubscriber.test.ts src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T071 subscriber delete behavior.** Extended the subscriber behavior suite so `CLIENT_DELETED` with live indexing enabled calls `deleteSearchDoc(knex, tenant, 'client', client_id)` and does not call `loadOne` or `upsertSearchDoc`. Validation: `npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T072 live-index disabled behavior.** Added coverage that with `SEARCH_INDEX_LIVE=false`, the subscriber resolves and acknowledges the event but does not create a tenant knex, load the source row, upsert, or delete index rows. Validation: `npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T073 live-index env flip behavior.** Confirmed the subscriber reads `SEARCH_INDEX_LIVE` per event rather than caching it at registration: a first `CLIENT_CREATED` while false performs no DB writes, then flipping the env var to true in the same process lets the next event upsert normally. Validation: `npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T074 missing-source cleanup.** Fixed the subscriber race branch so an update/create event whose `loadOne` returns null now deletes the existing search index row for that `(tenant, object_type, object_id)` instead of only logging and leaving stale data. Added behavior coverage with `CLIENT_UPDATED`. Validation: `npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T075 ticket-comment cascade.** Added subscriber behavior coverage for `TICKET_UPDATED`: after the ticket doc upsert, the subscriber queries the ticket's comment ids and re-loads/upserts each `ticket_comment` doc so parent-title denormalization stays fresh. Validation: `npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T076 invoice child cascade.** Added subscriber behavior coverage for `INVOICE_UPDATED`: after the invoice doc upsert, the subscriber queries invoice item ids and annotation ids, then re-loads/upserts both child entity types with inherited invoice ACL context. Validation: `npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T077 project child cascade.** Added subscriber behavior coverage for `PROJECT_UPDATED`: after the project doc upsert, the subscriber pages through phases, tasks, and task comments via their project-scoped queries and re-loads/upserts each child doc. Validation: `npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T078 document association re-index.** Added subscriber behavior coverage for `DOCUMENT_ASSOCIATED`: association changes resolve to `documentIndexer.loadOne`, and the freshly loaded document doc (including updated `acl.clientScopeId`) is upserted. Validation: `npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T079 user role visible-user reindex.** Added subscriber behavior coverage for `USER_ROLES_UPDATED`: after the user row is re-indexed, the subscriber enqueues `scheduleSearchVisibleUserReindexJob(tenant, userId)` so rows containing that user in `visible_to_user_ids` can refresh asynchronously. Validation: `npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T080 tenant/type backfill.** Added unit coverage for `runSearchBackfill({ tenant, type: 'client' }, knex)`: it resolves only the client indexer, skips tenant catalog discovery, calls `clientIndexer.loadBatch(knex, tenant, null, 500)`, and upserts every returned doc. Validation: `npx vitest run src/test/unit/searchBackfill.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T081 backfill batching guard.** Added a synthetic 10k-row backfill test that returns exactly 500 docs for 20 pages, verifies the cursor advances by last object id, and confirms 10,000 upserts without materializing the full source set in one call. Validation: `npx vitest run src/test/unit/searchBackfill.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T082 backfill idempotency.** Added an in-memory upsert simulation and ran the same backfill twice, confirming the final row map is identical after the second run even though upserts execute again. Validation: `npx vitest run src/test/unit/searchBackfill.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T083 tenant catalog discovery.** Added backfill coverage with no `tenant` option: the script queries `tenants`, orders by tenant id, and runs the selected client indexer once per discovered tenant. Validation: `npx vitest run src/test/unit/searchBackfill.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T084 backfill npm script.** Added a static package-script contract that verifies root `package.json` wires `search:backfill` to `tsx server/src/scripts/search-backfill.ts`. Validation: `npx vitest run src/test/unit/searchBackfill.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T085 reconciliation watermark re-index.** Added unit coverage for `reindexRowsAfterWatermark`: with an index watermark at noon, an older source doc is skipped while a newer source doc is upserted and counted as reindexed. Validation: `npx vitest run src/test/unit/searchReconcile.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T086 reconciliation stale delete.** Added unit coverage for `deleteRowsMissingFromSource`: indexed ids are checked with `indexer.loadOne`, present sources are kept, and a missing source row causes `deleteSearchDoc(knex, tenant, objectType, objectId)`. Validation: `npx vitest run src/test/unit/searchReconcile.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T087 reconciliation missing insert.** Added unit coverage for `insertRowsMissingFromIndex`: source docs are compared against existing `app_search_index.object_id` rows, and only source docs absent from the index are upserted. Validation: `npx vitest run src/test/unit/searchReconcile.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T088 reconciliation job registration/schedule.** Added a static contract that the search reconcile handler is registered in `registerAllHandlers`, `scheduleSearchReconcileJob` uses `scheduleRecurringJob<SearchReconcileJobData>`, and scheduled-job startup calls it daily at `0 6 * * *`. Validation: `npx vitest run src/test/unit/searchReconcile.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T089 query length cap.** Added unit coverage that `parseQuery` rejects 201-character input with the typed `SearchQueryError` code `query_too_long`. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T090 query normalization.** Added parser coverage for whitespace collapse/trimming on text queries and identifier-like query normalization (`TIC-1023` -> `tic-1023`) while preserving non-identifier casing. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T091 FTS branch SQL.** Added query-builder coverage that `runSearchQuery` emits `websearch_to_tsquery('english', ?)` and filters with `s.search_vector @@ q.tsq` in the match branch. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T092 FTS ranking order.** Added query-builder coverage that relevance scoring includes `ts_rank_cd(s.search_vector, q.tsq)` and the default relevance sort orders by `score DESC, source_updated_at DESC, object_id ASC`. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T093 pg_trgm fallback row mapping.** Added query coverage that the fuzzy branch includes `s.title % q.raw` and `coalesce(s.subtitle, '') % q.raw`, and that a simulated `exhcange` result row maps back as a client hit for "Exchange Systems." Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T094 trigram score contribution.** Added query-builder coverage that composite relevance includes `similarity(s.title, q.raw)`, subtitle similarity, and the v1 `* 0.4` trigram weight. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T095 ticket identifier pin.** Added query coverage for `TIC-1023`: parser binding lowercases the identifier to `tic-1023`, SQL checks `metadata->>'identifier'`, assigns exact matches score `1000`, and the mapped ticket hit remains first in the simulated result set. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T096 asset identifier pin.** Added asset-tag coverage for `LAP-0042`, verifying the same identifier exact-match SQL/binding path pins an asset result with score `1000`. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T097 time-decay ranking.** Added query-builder coverage that composite score multiplies relevance by `exp(-age/90d)` using `source_updated_at`, with default relevance ordering by score then recency so newer equivalent rows win. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T098 time-decay floor.** Added query-builder coverage that the time-decay multiplier is wrapped in `GREATEST(..., 0.05)` so very old rows retain the v1 minimum score multiplier. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T099 cursor round-trip.** Added unit coverage that `encodeSearchCursor` and `decodeSearchCursor` preserve score, ISO `updatedAt`, and object id for stable pagination boundaries. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T100 cursor pagination stability.** Added query coverage that a decoded cursor binds strict relevance/recency/object-id predicates and resets offset to zero, preventing page-one rows from reappearing on page two. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T101 snippet sentinel SQL.** Added query-builder coverage that snippet generation uses `ts_headline` with controlled `__SEARCH_MARK_START__` / `__SEARCH_MARK_STOP__` sentinels rather than raw HTML tags. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T102 snippet sanitizer.** Added direct sanitizer coverage showing arbitrary `<script>` / `<b>` source text is HTML-escaped while only sentinel-marked matches are rebuilt as `<mark>...</mark>`. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T103 malformed snippet sentinels.** Added fail-safe sanitizer coverage for unpaired/out-of-order sentinels, confirming the function escapes the full snippet instead of throwing or emitting unsafe HTML. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T104 typeahead skips headline SQL.** Fixed `runSearchQuery` so `includeSnippets=false` emits `NULL AS snippet` and does not include `ts_headline` in the SQL at all; updated cursor-binding assertions after removing the old boolean snippet binding. Validation: `npx vitest run src/test/unit/searchQuery.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T105 required-permission ACL predicate.** Added ACL SQL coverage that `required_permission` is checked against the single resolved permissions array binding via `ANY(?::text[])`, so permissions not in that set cannot pass the predicate. Validation: `npx vitest run src/test/unit/searchAcl.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T106 action ACL resolution once.** Added a mock-based `searchAppAction` test with `withAuth` as identity, confirming `resolveSearchAclPrincipal` runs exactly once per action call and its ACL object is reused for both `runSearchQuery` and `verifyResultVisibility`. Validation: `npx vitest run src/test/unit/searchActions.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T107 visible-user restriction predicate.** Added ACL SQL coverage that rows with non-empty `visible_to_user_ids` require overlap with the current user's UUID via `visible_to_user_ids && ARRAY[?]::uuid[]`; users not in the array cannot match that branch. Validation: `npx vitest run src/test/unit/searchAcl.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T108 visible-user unrestricted branch.** Added ACL SQL coverage that empty `visible_to_user_ids` rows pass through the `cardinality(visible_to_user_ids) = 0 OR ...` branch for users who have the required permission. Validation: `npx vitest run src/test/unit/searchAcl.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T109 internal-only ACL gate.** Added ACL SQL coverage that internal-only rows require `isInternal=true`; client-type/non-internal users bind `false` and therefore cannot pass `is_internal_only=true` rows. Validation: `npx vitest run src/test/unit/searchAcl.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T110 private-row ACL gate.** Added ACL SQL coverage that `is_private=true` rows require overlap with `visible_to_user_ids`, using the current user's UUID binding. Validation: `npx vitest run src/test/unit/searchAcl.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T111 client-scope ACL gate.** Added ACL SQL coverage that scoped rows require `client_scope_id = ANY(?::uuid[])`, binding only the user's accessible client ids. Validation: `npx vitest run src/test/unit/searchAcl.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T112 record-level visibility drop.** Added verifier coverage using a ticket search row whose authoritative ticket lookup returns no source row; `verifyResultVisibility` drops the row and emits the drift log. Validation: `npx vitest run src/test/unit/searchAcl.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T113 ACL drift telemetry.** Added verifier coverage that a record-level rejection calls the optional Sentry `captureMessage('search.acl_drift', ...)` hook with object/user metadata, in addition to the server warning log. Validation: `npx vitest run src/test/unit/searchAcl.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T114 zero-drift visibility path.** Added verifier coverage where the ticket source lookup succeeds; the row is preserved and no `search.acl_drift` Sentry capture is emitted. Validation: `npx vitest run src/test/unit/searchAcl.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T115 grouped action result.** Extended the search action unit suite with client + ticket hits and verified `searchAppAction` returns `totalCount` plus `groups` counts per object type (including zero for unrelated types). Validation: `npx vitest run src/test/unit/searchActions.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T116 withAuth wrapping contract.** Added a source-level action contract that `searchAppAction` is exported through `withAuth`; the auth package's wrapper owns the unauthenticated throw behavior. Validation: `npx vitest run src/test/unit/searchActions.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T117 action tenant isolation.** Added action coverage that the authenticated tenant context is passed through to `runSearchQuery`, and a different tenant is never supplied by the action path. The SQL-level tenant predicate is separately covered in query tests. Validation: `npx vitest run src/test/unit/searchActions.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T118 typeahead result shape.** Added typeahead action coverage that only the first five visible hits are returned, `totalCount` reflects the full visible set, and snippets are stripped from every row. Validation: `npx vitest run src/test/unit/searchActions.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T119 typeahead overhead budget.** Added a mocked action-path latency guard showing `searchAppTypeaheadAction` overhead stays below 100 ms when the query layer is fast. A real seeded-medium p50 check still belongs in integration/load infrastructure. Validation: `npx vitest run src/test/unit/searchActions.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T120 action input validation.** Added schema coverage that rejects empty queries, queries over 200 chars, unknown object types, and `limit > 100`. Validation: `npx vitest run src/test/unit/searchActions.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T121 result URL output schema.** Added output-schema coverage that result rows with an empty URL are rejected, enforcing non-empty canonical links at the action boundary. Validation: `npx vitest run src/test/unit/searchActions.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T122 sidebar search placement.** Added a static UI contract that `Sidebar.tsx` imports `SearchPalette` and renders it before the main `<nav>`, keeping search at the top of the MSP sidebar. Validation: `npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T123 search keyboard launcher.** Added UI contract coverage that `SearchPalette` listens for Cmd/Ctrl+K and focuses the search input, including the collapsed-sidebar expansion path. Validation: `npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T124 typeahead anchor rows.** Added UI contract coverage that typeahead limits visible results to five and renders each result via `Command.Item asChild` with a native `<a href={result.url}>`. Validation: `npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T060 project-family event contract.** Extended `searchEventPublishing.contract.test.ts` to assert project actions emit project create/update/delete and phase create/update/delete events, task actions emit task create/update/delete events, and task-comment actions emit task-comment create/update/delete events. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T059 user CRUD/role event contract.** Extended `searchEventPublishing.contract.test.ts` to assert `packages/users/src/actions/user-actions/userActions.ts` emits `USER_CREATED`, `USER_UPDATED`, `USER_DELETED`, and `USER_ROLES_UPDATED` with tenant context and stable idempotency keys, covering user role-change ACL reindex triggers. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T058 contact CRUD event contract.** Added a `ContactService.delete` override so API contact deletion now loads the contact, deletes it tenant-scoped, then publishes `CONTACT_DELETED` with contact id, optional client id, deleting user, tenant context, and an idempotency key. Extended `searchEventPublishing.contract.test.ts` to assert CONTACT_CREATED/UPDATED/DELETED publish contracts in `ContactService`. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed; `npm -w server run typecheck` passed.

- **2026-05-13 — T057 client delete event contract.** Extended `searchEventPublishing.contract.test.ts` to assert the client deletion path emits `CLIENT_DELETED` with `clientId`, deleting user, deletion timestamp, tenant context, and a stable delete idempotency key. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T056 client update event contract.** Extended `searchEventPublishing.contract.test.ts` to assert the client update action builds a `CLIENT_UPDATED` payload with `clientId`, publishes it with `tenantId: tenant` context, and uses a stable client-updated idempotency key. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T055 client create event contract.** Added `server/src/test/unit/searchEventPublishing.contract.test.ts` to assert the client creation action emits `CLIENT_CREATED` through `publishWorkflowEvent`, includes `createdClient.client_id` in the payload builder, carries `tenantId: tenant` in context, and uses a stable client-created idempotency key. Validation: `npx vitest run src/test/unit/searchEventPublishing.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T054 board/category/tag ACL.** Extended `searchIndexers.test.ts` to assert board, category, and tag indexers produce result rows with titles and `acl.requiredPermission='ticket:read'`, matching the PRD rule that structural ticket metadata is searchable as normal rows. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T053 time entry non-empty notes indexing.** Extended `searchIndexers.test.ts` to assert `timeEntryIndexer.loadOne` produces a `time_entry` SearchDoc for a one-character note, links to the parent ticket, and scopes visibility to the time-entry owner. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T052 time entry empty-notes skip.** Extended `searchIndexers.test.ts` to assert `timeEntryIndexer.loadOne` adds `whereNotNull('te.notes')` and `te.notes <> ''` filters and returns `null` when no row survives those filters, enforcing the PRD skip rule for empty notes. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T051 schedule entry assignee ACL.** Extended `searchIndexers.test.ts` to assert `scheduleEntryIndexer.loadOne` aggregates schedule assignees, maps them into `acl.visibleToUserIds`, and preserves `schedule:read`, body notes, and schedule URL. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T050 workflow task assignee ACL.** Extended `searchIndexers.test.ts` to assert `workflowTaskIndexer.loadOne` parses `assigned_users` JSONB entries (`user_id`, `userId`, and string forms), deduplicates them, and writes the resulting IDs into `acl.visibleToUserIds` with `workflow_task:read`. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T049 service request definition admin ACL.** Extended `searchIndexers.test.ts` to assert `serviceRequestDefinitionIndexer.loadOne` maps definition title/body/url and sets `acl.requiredPermission='admin'`, matching the PRD's admin-only visibility rule. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T048 service request submission payload filtering.** Extended `searchIndexers.test.ts` to assert `serviceRequestSubmissionIndexer.loadOne` flattens safe submitted payload strings into the body, excludes secret-like payload keys/values, and sets `service_request:read` plus optional client scope. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T047 service catalog attributes.** Extended `searchIndexers.test.ts` to assert `serviceCatalogIndexer.loadOne` includes both service description and flattened JSONB attribute string values in the indexed body with `service_catalog:read` ACL. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T046 KB article document join.** Extended `searchIndexers.test.ts` to assert `kbArticleIndexer.loadOne` joins `kb_articles` to `documents`, uses document name/content for title/body, sets document parent metadata, and requires `kb:read`. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T045 document ACL defaults.** Extended `searchIndexers.test.ts` to assert `documentIndexer.loadOne` sets `acl.clientScopeId` from `documents.client_id` and intentionally leaves v1-unused private/share-list hints (`isPrivate`, `visibleToUserIds`) unset. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T044 document body byte cap.** Extended `searchIndexers.test.ts` with a large BlockNote document fixture and asserted `documentIndexer.loadOne` truncates flattened body content to at most 65,536 UTF-8 bytes before indexing. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T043 active contract label.** Extended `searchIndexers.test.ts` to assert `contractIndexer.loadOne` maps an active contract to `subtitle='Contract'`, keeping quote labeling limited to draft contracts. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T042 draft contract quote label.** Extended `searchIndexers.test.ts` to assert `contractIndexer.loadOne` maps `status='draft'` to `subtitle='Quote'`, keeps contract body/identifier metadata, and requires `contract:read`. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T041 invoice child ACL inheritance.** Extended `searchIndexers.test.ts` to assert `invoiceItemIndexer` and `invoiceAnnotationIndexer` join their parent invoice, use invoice number as title, emit item/annotation hash URLs, and inherit `invoice:read` plus `clientScopeId` from the invoice. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T040 invoice client subtitle and identifier.** Extended `searchIndexers.test.ts` to assert `invoiceIndexer.loadOne` joins clients by tenant/client id, builds subtitle from client name/status/total, sets `metadata.identifier` to the invoice number, and scopes ACL by invoice client. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T039 asset identifier metadata.** Extended `searchIndexers.test.ts` to assert `assetIndexer.loadOne` copies `asset_tag` into `metadata.identifier`, enabling exact identifier ranking for asset-tag searches such as `LAP-0042`. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T038 asset JSONB attribute flattening.** Extended `searchIndexers.test.ts` to assert `assetIndexer.loadOne` includes location plus flattened JSONB attribute string values in the body while excluding secret-like keys/values such as `password`. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T037 project-task-comment BlockNote fallback.** Extended `searchIndexers.test.ts` to assert `projectTaskCommentIndexer.loadOne` flattens BlockNote JSON from `note` when `markdown_content` is null, preserving searchable visible comment text. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T036 project-task-comment markdown precedence.** Extended `searchIndexers.test.ts` to assert `projectTaskCommentIndexer.loadOne` uses `markdown_content` as the indexed body when both markdown and BlockNote `note` content are present, while still inheriting project ACL fields. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T035 project phase/task inherited ACL.** Extended `searchIndexers.test.ts` to exercise `projectPhaseIndexer.loadOne` and `projectTaskIndexer.loadOne` with parent project rows, asserting both emit `project:read`, inherit `clientScopeId` from the joined project, set project parent metadata, and use the project name as subtitle. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T034 project client-scope ACL.** Extended `searchIndexers.test.ts` to assert `projectIndexer.loadOne` maps project title/body/url and sets `acl.clientScopeId` from `projects.client_id` with `requiredPermission='project:read'`. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T033 ticket-comment anchor URL.** Extended `searchIndexers.test.ts` with a public ticket-comment fixture and asserted `ticketCommentIndexer.loadOne` emits `/msp/tickets/{ticket_id}#comment-{comment_id}`, preserving the hash anchor used by search results. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T032 ticket-comment internal ACL.** Extended `searchIndexers.test.ts` with a mocked comment/ticket join to assert `ticketCommentIndexer.loadOne` scopes by comment tenant/id, inherits ticket context, flattens markdown comment body, and maps `comments.is_internal=true` to `acl.isInternalOnly=true` with `ticket:read`. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T031 ticket indexer subtitle and identifier.** Extended `searchIndexers.test.ts` with a mocked ticket/client join to assert `ticketIndexer.loadOne` joins clients by tenant/client id, filters by tenant and ticket id, denormalizes `client_name` + `ticket_number` into the subtitle, and exposes `ticket_number` as `metadata.identifier`. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T030 user indexer internal-only filter.** Extended `searchIndexers.test.ts` to assert `userIndexer.loadOne` adds the `user_type = 'internal'` predicate alongside the user id filter and returns `null` when that filtered query finds no row, preventing client-portal users from being indexed as team members. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T029 contact subtitle composition.** Extended `searchIndexers.test.ts` to exercise `contactIndexer.loadOne` and assert it queries `contacts`, filters by `contact_name_id`, and builds the subtitle from email, phone number, and role while preserving the contact URL and `contact:read` ACL. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T028 client batch backfill mapping.** Extended `searchIndexers.test.ts` with a thenable mocked `clients` query to exercise `clientIndexer.loadBatch` as the backfill CLI uses it. The test asserts tenant scoping, stable `client_id` ordering, batch limit, and one returned `SearchDoc` per seeded client row with `client:read` ACL. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T027 client indexer loadOne mapping.** Added `server/src/test/unit/searchIndexers.test.ts` with a mocked `clients` query chain to assert `clientIndexer.loadOne` filters by tenant and client id, maps `client_name` to title, email/phone to subtitle, notes to body, canonical client URL, and `requiredPermission='client:read'`. Validation: `npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T026 concurrent upsert conflict contract.** Extended `searchUpsert.test.ts` with two concurrent `upsertSearchDoc` calls for the same `(tenant, object_type, object_id)` and an in-memory raw handler keyed by that conflict target. The test asserts both calls use `ON CONFLICT (tenant, object_type, object_id)`, only one logical row remains, and the later call's searchable fields win. Validation: `npx vitest run src/test/unit/searchUpsert.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T025 search index delete helper.** Extended `searchUpsert.test.ts` with a mocked Knex query-builder chain to assert `deleteSearchDoc` targets `app_search_index`, scopes the delete by tenant/object_type/object_id, and resolves cleanly when the underlying delete affects zero rows. Validation: `npx vitest run src/test/unit/searchUpsert.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T024 upsert conflict refresh.** Extended `searchUpsert.test.ts` to assert the `ON CONFLICT` branch refreshes title/body/source timestamp, assigns `search_vector = EXCLUDED.search_vector`, and sets `indexed_at = now()`. The test also checks updated title/body values flow into the SQL bindings. Validation: `npx vitest run src/test/unit/searchUpsert.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T023 upsert insert SQL path.** Added `server/src/test/unit/searchUpsert.test.ts` with a mocked Knex `raw` call to assert `upsertSearchDoc` emits a single `INSERT INTO app_search_index` statement, includes the primary-key conflict target, writes `search_vector`, and binds the expected tenant/type/id/title/body/url/metadata values for a new client search doc. Validation: `npx vitest run src/test/unit/searchUpsert.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T022 registry exposes CE indexers.** Added `server/src/test/unit/searchRegistry.test.ts` to import the real registry through the CE/EE alias path and assert `allIndexers()` / `registeredObjectTypes()` expose 27 unique CE search object types and that `getIndexer('client')` resolves the client indexer. Validation: `npx vitest run src/test/unit/searchRegistry.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T021 weighted tsvector SQL helper.** Added `server/src/test/unit/searchSql.test.ts` to assert `buildTsvectorSql` emits `public.process_large_lexemes(?)` for title/subtitle/body with weights A/B/C, composes the weighted vectors with `||`, and returns the expected bindings. Validation: `npx vitest run src/test/unit/searchSql.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T020 truncation no-op boundary.** Extended `searchNormalize.test.ts` to assert `truncateForIndex` returns the exact original string, including multibyte content, when the UTF-8 byte length is already under the configured limit. Validation: `npx vitest run src/test/unit/searchNormalize.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T019 UTF-8 truncation byte cap.** Extended `searchNormalize.test.ts` with a multibyte emoji string and a byte limit that would split the emoji if truncation were byte-slice based. The test asserts `truncateForIndex` stays within the byte cap, returns only complete code points, and emits no replacement character. Validation: `npx vitest run src/test/unit/searchNormalize.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T018 JSONB payload scalar boundary.** Extended `searchNormalize.test.ts` to assert `flattenJsonbPayload` returns an empty string for nullish and scalar values (`null`, `undefined`, string, number, boolean), preserving the contract that only object/array JSONB containers contribute text. Validation: `npx vitest run src/test/unit/searchNormalize.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T017 JSONB payload secret filtering.** Extended `searchNormalize.test.ts` with a nested JSONB fixture containing ordinary string leaves plus `password`, `api_key`, `authorization`, and `secret*` keys. The test asserts `flattenJsonbPayload` concatenates only safe string leaves in traversal order and excludes secret-like values. Validation: `npx vitest run src/test/unit/searchNormalize.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T016 Markdown flattening.** Extended `searchNormalize.test.ts` with markdown containing a heading, bullet list, bold/italic markers, link syntax, fenced code, and blockquote. The test asserts `flattenMarkdown` strips formatting syntax while preserving readable content. Validation: `npx vitest run src/test/unit/searchNormalize.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T015 nested BlockNote list flattening.** Extended `searchNormalize.test.ts` with a four-level nested BlockNote list fixture using inline mark styles. The test asserts `flattenBlockNote` does not throw and returns all nested visible text in order. Validation: `npx vitest run src/test/unit/searchNormalize.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T014 BlockNote image data stripping.** Extended `searchNormalize.test.ts` with a BlockNote text payload containing a `data:image/png;base64,...` string between visible text leaves. The test asserts the data URI and base64 fragment are absent from `flattenBlockNote` output while surrounding visible text remains. Validation: `npx vitest run src/test/unit/searchNormalize.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T013 BlockNote visible-text flattening.** Added `server/src/test/unit/searchNormalize.test.ts` with a realistic BlockNote fixture containing headings, nested bullet-list content, inline marks, and multiple text leaves. The test asserts `flattenBlockNote` emits the visible text in document order without JSON/formatting noise. Validation: `npx vitest run src/test/unit/searchNormalize.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T012 SearchDoc/AclMetadata compile-time ACL contract.** Extended `searchTypes.exhaustive.test.ts` to build a `SearchDoc` with every `AclMetadata` denormalized hint (`visibleToUserIds`, `visibleToRoles`, `isInternalOnly`, `isPrivate`, `clientScopeId`, `requiredPermission`) and to use `@ts-expect-error` for a `SearchDoc` missing `acl`, so `npm -w server run typecheck` fails if ACL metadata ever becomes optional. Validation: `npx vitest run src/test/unit/searchTypes.exhaustive.test.ts --coverage=false` from `server/` passed; `npm -w server run typecheck` passed.

- **2026-05-13 — T011 SearchObjectType exhaustive switch.** Added `server/src/test/unit/searchTypes.exhaustive.test.ts` with a `SearchObjectType` switch that covers all 27 current object types and assigns the default arm to `never`, so adding a new type forces the switch to be updated at compile time. Validation: `npx vitest run src/test/unit/searchTypes.exhaustive.test.ts --coverage=false` from `server/` passed; `npm -w server run typecheck` passed.

- **2026-05-13 — T010 migration down/up cycle.** Extended `searchMigration.contract.test.ts` to execute `down` against a mocked `knex.schema.dropTableIfExists` and then execute the mocked non-Citus `up` path again, asserting the table drop targets `app_search_index` and the create-table path still runs. Validation: `npx vitest run src/test/unit/searchMigration.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T009 search index btree indexes.** Extended `searchMigration.contract.test.ts` to assert the migration creates `app_search_index_recent ON app_search_index (tenant, source_updated_at DESC)` and `app_search_index_type ON app_search_index (tenant, object_type)`. Validation: `npx vitest run src/test/unit/searchMigration.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T008 subtitle trigram planner contract.** Extended `searchMigration.contract.test.ts` to assert the migration creates `app_search_index_subtitle_trgm ON app_search_index USING gin (subtitle gin_trgm_ops)` and that the query path uses both `coalesce(s.subtitle, '') % q.raw` and `similarity(coalesce(s.subtitle, ''), q.raw)`. Validation: `npx vitest run src/test/unit/searchMigration.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T007 title trigram planner contract.** Extended `searchMigration.contract.test.ts` to assert the migration creates `app_search_index_title_trgm ON app_search_index USING gin (title gin_trgm_ops)` and that the query path uses both `s.title % q.raw` and `similarity(s.title, q.raw)` for fuzzy matching/ranking. Validation: `npx vitest run src/test/unit/searchMigration.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T006 search_vector GIN planner contract.** Local Postgres/Citus is still unavailable, so the test uses a static planner contract rather than live `EXPLAIN`: `searchMigration.contract.test.ts` now asserts the migration creates `app_search_index_vector_gin ON app_search_index USING gin (search_vector)` and that `server/src/lib/search/query.ts` uses the indexed `s.search_vector @@ q.tsq` predicate. Validation: `npx vitest run src/test/unit/searchMigration.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T005 no-Citus migration path.** Extended `searchMigration.contract.test.ts` with a mocked migration `up` execution where `pg_extension` reports Citus is absent. The test asserts the migration never checks `pg_dist_partition`, never calls `create_distributed_table`, and emits the documented skip warning instead of failing. Validation: `npx vitest run src/test/unit/searchMigration.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T004 Citus distribution migration path.** Extended `searchMigration.contract.test.ts` with a mocked migration `up` execution where the `citus` extension is present. The test asserts the migration checks `pg_dist_partition` for `app_search_index` and calls `SELECT create_distributed_table('app_search_index', 'tenant')` only after confirming the table is not already distributed. Validation: `npx vitest run src/test/unit/searchMigration.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T003 pg_trgm idempotent extension contract.** Extended `searchMigration.contract.test.ts` to assert the migration contains `CREATE EXTENSION IF NOT EXISTS pg_trgm` and not the non-idempotent `CREATE EXTENSION pg_trgm` form. Validation: `npx vitest run src/test/unit/searchMigration.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T002 search index primary key contract.** Extended `searchMigration.contract.test.ts` to assert `tenant uuid NOT NULL` explicitly and the `PRIMARY KEY (tenant, object_type, object_id)` clause in the migration's `CREATE TABLE` body. Validation: `npx vitest run src/test/unit/searchMigration.contract.test.ts --coverage=false` from `server/` passed.

- **2026-05-13 — T001 migration table column contract.** Added `server/src/test/unit/searchMigration.contract.test.ts`, which parses `server/migrations/20260513120000_create_app_search_index.cjs` and asserts the exact `app_search_index` column names and SQL definitions from PRD §9.1. Validation: `npx vitest run src/test/unit/searchMigration.contract.test.ts --coverage=false` from `server/` passed. Note: an initial `npm -w server run test:unit -- searchMigration.contract.test.ts` invocation expanded to the whole unit suite because of the package script and was killed after unrelated existing failures; it was not used as the gate.

- **2026-05-13 — F134 reconciliation skips unregistered types.** Normal reconciliation already iterates `allIndexers()`, so orphaned rows with unregistered object types are never selected for source loading. Tightened the targeted `type` path as well: `resolveReconcileIndexers` now logs and returns an empty list when `getIndexer(type)` is missing instead of throwing. This lets synthetic/old EE object types remain untouched in CE builds. Validation: `git diff --check`; `npm -w server run typecheck`.

- **2026-05-13 — F133 registry-driven search filters/groups.** `/msp/search` now reads `registeredObjectTypes()` on the server page and passes the filtered registered CE/EE object types into `SearchPageClient`. The client renders exactly those registered types for filter chips and grouped result sections, while retaining i18n keys (`search.filters.*` / `search.groups.*`) and falling back to a humanized `object_type` when an EE type lacks CE locale entries. Invalid or unregistered `type=` params are ignored before calling `searchAppAction`. Validation: `git diff --check`; `npm -w server run typecheck`.

- **2026-05-13 — F132 registered-type orphan safety.** No code change was needed: `searchAppAction` and `searchAppTypeaheadAction` call `resolveAllowedTypes`, which intersects any requested types with `registeredObjectTypes()`, and `runSearchQuery` always applies `s.object_type = ANY(?::text[])` in SQL. That means CE builds cannot return stale EE-only rows such as `ee_chat_history` because there is no registered indexer for that type. Validation: inspected `server/src/lib/actions/searchActions.ts` and `server/src/lib/search/query.ts`; `npm -w server run typecheck` was already clean after F131.

- **2026-05-13 — F131 CE/EE search indexer stub.** The repo's CE-first alias convention maps `@ee/*` to `packages/ee/src/*` in `server/tsconfig.json`, with EE builds overriding the alias to `ee/server/src`. The search registry already imports `@ee/lib/search/indexers`, so no separate stub-generator registration was needed. Typed the CE stub at `packages/ee/src/lib/search/indexers/index.ts` as `EntityIndexer[] = []` and added the matching empty EE-side module at `ee/server/src/lib/search/indexers/index.ts` so both alias targets resolve until EE contributes real indexers. Validation: `git diff --check`; `npm -w server run typecheck`.

- **2026-05-13 — F130 project task comment hash highlights.** Search result URLs for project tasks/comments use `/msp/projects/{project_id}/tasks/{task_id}#comment-{task_comment_id}`, while the current project UI opens task editors from `/msp/projects/{project_id}?taskId={task_id}`. Added a lightweight `/msp/projects/[id]/tasks/[taskId]` client redirect that preserves the hash and forwards to the existing project page query shape. `ProjectPage` now preserves a `#comment-*` hash during the initial URL normalization for the same task, and `TaskComment` exposes `id="comment-{taskCommentId}"`, scrolls it into view, and applies a brief `.search-highlight` style. Validation: `git diff --check`; `npm -w @alga-psa/projects run typecheck`; `npm -w server run typecheck`.

- **2026-05-13 — F129 invoice item/annotation hash highlights.** Invoice search result URLs target `/msp/invoices/{invoice_id}#item-{item_id}` and `#annotation-{annotation_id}`, but the current MSP invoice view is hosted in the billing invoicing tab rather than a standalone invoice page. Added a lightweight `/msp/invoices/[id]` client redirect that preserves the hash and forwards to `/msp/billing?tab=invoicing&subtab=finalized&invoiceId={id}`. `InvoicePreviewPanel` now renders hidden item and annotation anchor targets, scrolls the current hash into view, and applies a brief `.search-highlight` treatment. Also made `getInvoiceAnnotations` tenant-scoped instead of a placeholder so annotation anchor content can be loaded. Validation: `git diff --check`; `npm -w @alga-psa/billing run typecheck`; `npm -w server run typecheck`.

- **2026-05-13 — F039 service catalog indexer.** Added `serviceCatalogIndexer` and registered it in the CE indexer array. It indexes `service_catalog.service_name` as title, combines `description` with flattened `attributes` JSONB for the body, links to `/msp/billing/services/{service_id}`, and sets `requiredPermission='service_catalog:read'`. `sourceEvents` stays empty until the service-catalog event family is added in F057. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/service_catalog.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F040 service request submission indexer.** Added `serviceRequestSubmissionIndexer` and registered it. It indexes `request_name`, flattens `submitted_payload` via the secret-skipping JSONB flattener, links to `/msp/service-requests/{submission_id}`, sets `requiredPermission='service_request:read'`, and carries `client_id` into `clientScopeId`. `sourceEvents` remains empty until F058 adds the service-request event family. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/service_request_submission.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F041 service request definition indexer.** Added `serviceRequestDefinitionIndexer` and registered it. It indexes `service_request_definitions.name` and `description`, links to `/msp/service-requests/definitions/{definition_id}`, and sets the admin-only ACL hint with `requiredPermission='admin'`. Event hooks remain empty until F058. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/service_request_definition.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F042 workflow task indexer.** Added `workflowTaskIndexer` with explicit `tenant` predicates on both `loadOne` and `loadBatch`, even though `workflow_tasks.task_id` is the only PK in the current schema. It indexes `title` and `description`, links to `/msp/workflow-tasks/{task_id}`, sets `requiredPermission='workflow_task:read'`, and parses `assigned_users` JSONB into de-duplicated `visibleToUserIds` from string arrays or object arrays (`user_id`, `userId`, `id`). Event hooks remain empty until F059. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/workflow_task.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F043 interaction indexer.** Added `interactionIndexer` and registered it. It flattens/truncates BlockNote `interactions.notes`, builds subtitles from `interaction_types.type_name` plus any available client/contact/ticket labels, links to `/msp/interactions/{interaction_id}`, and sets `requiredPermission='interaction:read'`. Current schema allows a nullable title because it was renamed from legacy `description`, so the indexer falls back to `Untitled interaction` only when the stored title is blank. Event hooks remain empty until F060. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/interaction.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F044 schedule entry indexer.** Added `scheduleEntryIndexer` and registered it. Current migrations removed `schedule_entries.user_id` and use `schedule_entry_assignees`, so the indexer aggregates assignee `user_id`s from that pivot table into `visibleToUserIds` instead of reading a non-existent owner column. It indexes `title`/`notes`, links to `/msp/schedule/{entry_id}`, and sets `requiredPermission='schedule:read'`. Event hooks remain empty until F061. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/schedule_entry.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F045 time entry indexer.** Added `timeEntryIndexer` and registered it. It enforces the PRD rule in SQL (`notes IS NOT NULL AND notes <> ''`), indexes note text only for rows with content, carries `time_entries.user_id` into `visibleToUserIds`, and sets `requiredPermission='time:read'`. URLs point at the parent ticket, project task, or interaction when enough work-item data exists, with `/msp/time-entries/{entry_id}` as a fallback. Event hooks remain empty until F061. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/time_entry.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F046 board indexer.** Added `boardIndexer` and registered it. Current migrations create `boards.board_id` / `boards.board_name` (the scratchpad's `channel_id` / `channel_name` note reflects an older rename state), so the indexer uses the current columns, links to `/msp/tickets?board={board_id}`, and sets `requiredPermission='ticket:read'`. Event hooks remain empty until F062. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/board.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F047 category indexer.** Added `categoryIndexer` and registered it. Ticket categories are still read from the `categories` table in app code, with `board_id` backfilled during the board migration, so the indexer uses `categories.category_id` / `category_name`, links to `/msp/tickets?category={category_id}`, includes `board_id` metadata when present, and sets `requiredPermission='ticket:read'`. Event hooks remain empty until F062. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/category.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F048 tag indexer.** Added `tagIndexer` and registered it. The current tag system normalizes unique tag labels into `tag_definitions`; `tags` / `tag_mappings` are assignment rows, so indexing definitions avoids duplicate result rows for the same tag. The indexer uses `tag_id` / `tag_text`, links to `/msp/tickets?tags={tag_text}`, carries `tagged_type` and `board_id` metadata when present, and sets `requiredPermission='ticket:read'`. Event hooks remain empty until F062. Validation: `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/tag.ts server/src/lib/search/indexers/index.ts`.

- **2026-05-13 — F049 client CRUD events.** `CLIENT_CREATED` and `CLIENT_UPDATED` already existed in `packages/event-schemas` and were already published from both the server `ClientService` and package client actions. Added missing `CLIENT_DELETED` event type + payload schema, published it after successful hard-delete in both delete paths, and added `CLIENT_DELETED` to `clientIndexer.sourceEvents` so the future search subscriber can remove the row. Validation: `npm -w @alga-psa/event-schemas run typecheck` and `npm -w @alga-psa/clients run typecheck` pass. `npm -w server run typecheck` is currently blocked before project files by generated `.next/dev/types/routes.d.ts` syntax errors (lines 755+); no search/client-service-specific errors were reachable from that run.

- **2026-05-13 — F050 contact CRUD events.** `CONTACT_CREATED`, `CONTACT_UPDATED`, and `CONTACT_ARCHIVED` already existed in `packages/event-schemas` and were already published from the server/package contact create-update paths. Added missing `CONTACT_DELETED` event type + payload schema, publish after successful hard-delete in the package `deleteContact` action, and added `CONTACT_DELETED` to `contactIndexer.sourceEvents`. Validation: `npm -w @alga-psa/event-schemas run typecheck`, `npm -w @alga-psa/clients run typecheck`, and `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/contact.ts`.

- **2026-05-13 — F051 user lifecycle events.** No app-wide `USER_*` CRUD events existed in `packages/event-schemas`. Added `USER_CREATED`, `USER_UPDATED`, `USER_DELETED`, and `USER_ROLES_UPDATED` with tenant-scoped payloads. Published them from `packages/users/src/actions/user-actions/userActions.ts` after successful add/update/delete/role-update flows, and registered those events on `userIndexer.sourceEvents` so internal team-member rows can refresh/delete when the search subscriber lands. Validation: `npm -w @alga-psa/event-schemas run typecheck`, `npm -w @alga-psa/users run typecheck`, and `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/user.ts`.

- **2026-05-13 — F052 project-family events.** Existing project/task workflow events covered create/status/assignment but not every indexed row lifecycle. Added `PROJECT_DELETED`, `PROJECT_PHASE_CREATED/UPDATED/DELETED`, `PROJECT_TASK_UPDATED/DELETED`, and `PROJECT_TASK_COMMENT_CREATED/UPDATED/DELETED` schemas. Published the missing events from project phase mutations, project hard-delete, task update/delete/move, and task-comment create/update/delete while preserving existing `PROJECT_*`, `PROJECT_TASK_*`, and legacy `TASK_COMMENT_*` events. Updated source events for the project, phase, task, and task-comment indexers. Validation: `npm -w @alga-psa/event-schemas run typecheck`, `npm -w @alga-psa/projects run typecheck`, and `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/project.ts server/src/lib/search/indexers/project_phase.ts server/src/lib/search/indexers/project_task.ts server/src/lib/search/indexers/project_task_comment.ts`.

- **2026-05-13 — F053 asset events.** `ASSET_CREATED`, `ASSET_UPDATED`, assignment, unassignment, and warranty events already existed and were published from the package action paths; the API service already attempted `ASSET_DELETED` but the schema did not define it. Added `ASSET_DELETED` to the event schema, published it from `packages/assets/src/actions/assetActions.ts` after successful hard-delete, and added it to `assetIndexer.sourceEvents` so deleted assets can be removed from the search index. Validation: `npm -w @alga-psa/event-schemas run typecheck`, `npm -w @alga-psa/assets run typecheck`, and `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/asset.ts`.

- **2026-05-13 — F054 invoice events.** Existing invoice workflow events covered generation/finalization/status/delivery, and `InvoiceService` already published an undeclared `INVOICE_DELETED`. Added generic `INVOICE_CREATED/UPDATED/DELETED`, `INVOICE_ITEM_CREATED/UPDATED/DELETED`, and `INVOICE_ANNOTATION_CREATED/UPDATED/DELETED` schemas. Published header/item events from `server/src/lib/api/services/InvoiceService.ts`, annotation create from the billing invoice model save point, and delete events from `hardDeleteInvoice`. Updated invoice, invoice-item, and invoice-annotation indexer source events. Validation: `npm -w @alga-psa/event-schemas run typecheck`, `npm -w @alga-psa/billing run typecheck`, and `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/invoice.ts server/src/lib/search/indexers/invoice_item.ts server/src/lib/search/indexers/invoice_annotation.ts`. A raw `npx tsc ... server/src/lib/api/services/InvoiceService.ts` remains blocked by existing repo-wide module-resolution/JSX settings and unrelated pre-existing server errors, so it was not used as the gate.

- **2026-05-13 — F055 contract/client-contract events.** Existing `CONTRACT_*` workflow events were mostly assignment-oriented and client-contract rows had no distinct source events. Added `CONTRACT_DELETED` plus `CLIENT_CONTRACT_CREATED/UPDATED/DELETED` schemas, widened contract event schemas with a generic search payload union, published contract CRUD events from `packages/billing/src/actions/contractActions.ts`, and published client-contract create/update/deactivate events from `packages/clients/src/actions/clientContractActions.ts`. Updated the contract and client-contract indexer source events. Validation: `npm -w @alga-psa/event-schemas run typecheck`, `npm -w @alga-psa/billing run typecheck`, `npm -w @alga-psa/clients run typecheck`, and `npx tsc --noEmit --pretty false --skipLibCheck server/src/lib/search/indexers/contract.ts server/src/lib/search/indexers/client_contract.ts`.

- **2026-05-13 — F056 document/KB events.** Added `DOCUMENT_UPDATED` plus `KB_ARTICLE_CREATED/UPDATED/DELETED` schemas. `documentIndexer.sourceEvents` now covers uploaded/updated/deleted/generated/associated/detached events, and `kbArticleIndexer.sourceEvents` covers the KB article CRUD family. Published `DOCUMENT_UPDATED` from document metadata, upload, and BlockNote content create/update/delete paths, and `DOCUMENT_DELETED` from hard-delete. Existing post-commit `DOCUMENT_ASSOCIATED` / `DOCUMENT_DETACHED` workflow publishes remain the association insert/delete signal for search re-indexing. Published KB article create/update/delete events from the KB actions. Validation: `npm -w @alga-psa/event-schemas run typecheck` and `npm -w @alga-psa/documents run typecheck`.

- **2026-05-13 — F057 service catalog events.** Added `SERVICE_CATALOG_CREATED/UPDATED/DELETED` schemas and registered them on `serviceCatalogIndexer.sourceEvents`. Published the events from both `ServiceCatalogService` and `ProductCatalogService`, because services and products share the same `service_catalog` table and the v1 indexer indexes every catalog row. Validation: `npm -w @alga-psa/event-schemas run typecheck` passes. A raw single-file `npx tsc` against the server service files is still blocked by existing workspace module-resolution/alias settings (`@/interfaces/*`, `@alga-psa/core/*`, `@alga-psa/event-bus/publishers`) rather than by the changed lines.

- **2026-05-13 — F058 service-request events.** Added `SERVICE_REQUEST_SUBMISSION_CREATED/UPDATED/DELETED` and `SERVICE_REQUEST_DEFINITION_CREATED/UPDATED/DELETED` schemas, registered them on the submission/definition indexers, and added `server/src/lib/service-requests/searchEvents.ts` as the shared publish helper. Submission create and execution-status transitions now publish events; definition creation, duplication/template creation, draft saves, publish, archive, and unarchive publish definition events. There is no current hard-delete path for service-request definitions/submissions, so the `*_DELETED` event types are reserved for the future subscriber delete branch. Validation: `npm -w @alga-psa/event-schemas run typecheck`; `git diff --check`.

- **2026-05-13 — F059 workflow-task events.** Added `WORKFLOW_TASK_CREATED/UPDATED/DELETED/ASSIGNMENT_CHANGED` schemas and registered them on `workflowTaskIndexer.sourceEvents`. The CE/shared write points are `shared/workflow/persistence/workflowTaskModel.ts` and `shared/task-inbox/taskInboxService.ts`, so task create, inline task create, status updates, response updates, and completion now publish workflow-task search events from there. The assignment-change event name is registered for assignment mutators; current CE shared code does not expose a dedicated assignment update method beyond create-time assignees. Validation: `npm -w @alga-psa/event-schemas run typecheck`, `npm -w @alga-psa/shared run typecheck`, and `git diff --check`.

- **2026-05-13 — F060 interaction events.** Added `INTERACTION_CREATED/UPDATED/DELETED` schemas, registered them on `interactionIndexer.sourceEvents`, and published them from `packages/clients/src/actions/interactionActions.ts`. The existing `INTERACTION_LOGGED` workflow event remains for workflow/domain consumers; the new CRUD-shaped events give search a simple upsert/delete contract. Validation: `npm -w @alga-psa/event-schemas run typecheck`, `npm -w @alga-psa/clients run typecheck`, and `git diff --check`.

---

## Implementation order suggestion (not prescriptive)

- **2026-05-13 — T125 typeahead native new-tab behavior.** Added UI contract coverage that result anchors do not install click handlers or call `preventDefault`, preserving Cmd/Ctrl-click and middle-click browser behavior. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T126 see-all typeahead row.** Added UI contract coverage that the final typeahead row uses the `search.seeAllResults` i18n key, passes `totalCount`, and links to `/msp/search?q=${encodeURIComponent(trimmedQuery)}` via a native anchor. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T127 quiet typeahead threshold.** Added UI contract coverage that `SearchPalette` only opens typeahead for `trimmedQuery.length >= 2` and clears result state below that threshold, matching the PRD empty-state behavior. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T128 server-rendered search results.** Added route contract coverage that `/msp/search` is dynamic, reads `q` from `searchParams`, awaits `searchAppAction` for non-empty queries, and passes the resolved `initialResult` into `SearchPageClient` for first render. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T129 debounced URL updates.** Added results-page UI contract coverage that input changes debounce for 200ms, write `q` into `URLSearchParams`, call `router.replace(nextUrl, { scroll: false })`, and clear timers on cleanup. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T130 deep-linked search state.** Added UI contract coverage that `/msp/search` reads `type`, `cursor`, and `sort` from `searchParams`, passes them as initial props, and `SearchPageClient` initializes local query/type state from those props for cold opens. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T131 filter count badges.** Added UI contract coverage that filter chips compute per-type badge counts from `initialResult.groups[type]`, use `initialResult.totalCount` for All, and expose stable chip IDs. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T132 grouped All results.** Added UI contract coverage that the All view builds grouped sections from `initialResult.results`, caps each group with `.slice(0, 10)`, and renders rows through the shared result-row renderer. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T133 single-type flat results.** Added UI contract coverage that the page passes `types: [activeType]` to `searchAppAction` for a selected type and that `SearchPageClient` renders `initialResult.results.map(renderResultRow)` as a flat list when `activeType !== 'all'`. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T134 cursor pagination links.** Added UI contract coverage that the results page derives previous and next cursor stacks separately, linking previous to the prior boundary and next to `initialResult.nextCursor` with the current boundary appended. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T135 empty search state.** Added UI contract coverage that the results page only shows empty state after a non-empty settled query with zero results, echoes `initialQuery` through `search.noResults`, and offers the clear-filter anchor for filtered empty results. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T136 loading skeleton.** Added UI contract coverage that results page detects `query.trim() !== initialQuery`, renders five `animate-pulse` skeleton rows with a translated loading label, and removes that branch once URL-backed results catch up. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T137 native result anchors.** Added UI contract coverage that `renderResultRow` returns an `<a href={row.url}>` with stable row IDs and no click handler or `preventDefault`, preserving browser Cmd/Ctrl-click behavior. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T138 recent sort SQL.** Added query-layer coverage that `sort: 'recent'` orders by `source_updated_at DESC, object_id ASC` and does not include `score DESC` in the `ORDER BY` clause. Validation: `cd server && npx vitest run src/test/unit/searchQuery.test.ts --coverage=false`.

- **2026-05-13 — T139 sidebar combobox ARIA.** Added UI contract coverage that the sidebar input declares combobox/list semantics, reflects `aria-expanded={isOpen}`, points to `app-search-typeahead-list`, and updates `aria-activedescendant` through component state. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T140 sidebar arrow navigation.** Adjusted `SearchPalette` arrow-key state so Down advances into options and wraps back to the input state, while Up from the first option returns to input (`activeIndex = -1`) instead of jumping to the last row. Added UI contract coverage for that behavior. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T141 sidebar Escape close.** Added UI contract coverage that Escape prevents default, clears typeahead state, marks the list dismissed, resets active option state, and does not blur the combobox input. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T142 sidebar Enter submits to results.** Added UI contract coverage that Enter prevents default, calls `navigateToActiveOption`, and the no-active-row path navigates to `seeAllUrl` (`/msp/search?q=...`). Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T143 sidebar Enter opens active row.** Added UI contract coverage that the active suggestion path in `navigateToActiveOption` calls `window.location.assign(visibleResults[activeIndex].url)` before falling back to the full-results URL. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T144 stable sidebar input id.** Added UI contract coverage that `SearchPalette` keeps the sidebar combobox input ID stable as `app-search-input` for UI reflection and accessibility tests. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T145 stable result row ids.** Added UI contract coverage that both sidebar suggestion metadata and results-page anchors use the shared kebab-case `toDomIdPart` helper and the `app-search-result-row-{type}-{id}` ID pattern. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T146 stable filter chip ids.** Added UI contract coverage that the All filter chip uses `app-search-filter-chip-all` and every registered type chip uses `app-search-filter-chip-{toDomIdPart(type)}` while iterating `typeEntries`. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T147 English search locale keys.** Added `searchI18n.contract.test.ts` coverage that `server/public/locales/en/msp/core.json` contains the required `search.*` leaves and every `SEARCH_OBJECT_TYPES` filter/group label. Validation: `cd server && npx vitest run src/test/unit/searchI18n.contract.test.ts --coverage=false`.

- **2026-05-13 — T148 search locale key completeness.** Ran the lang-pack pipeline (`node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`; zero errors, existing Polish extra-key warnings outside search) and added coverage that every locale's `search` namespace has the same leaf-key structure as English. Validation: `cd server && npx vitest run src/test/unit/searchI18n.contract.test.ts --coverage=false`.

- **2026-05-13 — T149 no hardcoded search UI copy.** Removed the literal `/msp/search` metadata title and added a grep-style i18n guard ensuring sidebar/results-page visible search phrases are absent from source while key UI paths use `t('search.*')`. Validation: `cd server && npx vitest run src/test/unit/searchI18n.contract.test.ts src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T150 pseudo-locale search strings.** Added coverage that every `xx` pseudo-locale search string differs from English and contains the repo's pseudo fill token (`11111`), which is the current pseudo-locale convention generated by `scripts/generate-pseudo-locales.cjs`; this guards against untranslated search UI leaks. Validation: `cd server && npx vitest run src/test/unit/searchI18n.contract.test.ts --coverage=false`.

- **2026-05-13 — T151 search live-index env docs.** Added deploy contract coverage that `.env.example` documents `SEARCH_INDEX_LIVE=false` and Helm exposes `server.searchIndexLive: false` wired into the `SEARCH_INDEX_LIVE` container env var. Validation: `cd server && npx vitest run src/test/unit/searchDeploy.contract.test.ts --coverage=false`.

- **2026-05-13 — T152 search deploy runbook sequence.** Added deploy contract coverage that `docs/deployment/app-wide-search-runbook.md` orders rollout as migrate → deploy with `SEARCH_INDEX_LIVE=false` → `npm run search:backfill` → flip `SEARCH_INDEX_LIVE=true`/roll server-workers → verify `search:reconcile`. Validation: `cd server && npx vitest run src/test/unit/searchDeploy.contract.test.ts --coverage=false`.

- **2026-05-13 — T153 search count/latency telemetry.** Mocked the logger in `searchActions.test.ts` and added coverage that a full search emits `search.query.count` and `search.query.latency_ms` with variant, tenant, user id, and numeric latency value. Validation: `cd server && npx vitest run src/test/unit/searchActions.test.ts --coverage=false`.

- **2026-05-13 — T154 empty search telemetry.** Added search-action coverage that a full search with zero visible results emits `search.query.empty` with full-search variant, tenant, and user id. Validation: `cd server && npx vitest run src/test/unit/searchActions.test.ts --coverage=false`.

- **2026-05-13 — T155 typeahead rate limit.** Added behavioral coverage using the real in-memory limiter: 30 typeahead calls for the same tenant/user resolve, and the 31st rejects with `SearchRateLimitError` (429-equivalent). Validation: `cd server && npx vitest run src/test/unit/searchActions.test.ts --coverage=false`.

- **2026-05-13 — T156 full-search rate limit.** Added behavioral coverage using the real in-memory limiter: 10 full-search calls for the same tenant/user resolve, and the 11th rejects with `SearchRateLimitError` (429-equivalent). Validation: `cd server && npx vitest run src/test/unit/searchActions.test.ts --coverage=false`.

- **2026-05-13 — T157 ticket comment hash anchors.** Added hash-anchor contract coverage that `CommentItem` detects `#comment-{comment_id}`, scrolls the corresponding DOM id into view, applies `.search-highlight`, and clears it after ~2s. Validation: `cd server && npx vitest run src/test/unit/searchHashAnchors.contract.test.ts --coverage=false`.

- **2026-05-13 — T158 invoice hash anchors.** Added line-item and annotation hash-anchor support: invoice redirect preserves hashes, `LineItem` handles `#item-{item_id}` with scroll/highlight, and `InvoiceAnnotations` handles loaded `#annotation-{annotation_id}` rows similarly. Validation: `cd server && npx vitest run src/test/unit/searchHashAnchors.contract.test.ts --coverage=false`.

- **2026-05-13 — T159 project task comment hash anchors.** Added contract coverage that `/msp/projects/{id}/tasks/{taskId}` redirects preserve the hash, `ProjectPage` keeps `#comment-*` while task selection is stable, and `TaskComment` scrolls/highlights the `comment-{taskCommentId}` target. Validation: `cd server && npx vitest run src/test/unit/searchHashAnchors.contract.test.ts --coverage=false`.

- **2026-05-13 — T160 ACME top result acceptance.** Added action-level acceptance coverage that a search returning ACME client and ACME ticket hits preserves the client as result #1 and reports grouped counts for both client and ticket. Validation: `cd server && npx vitest run src/test/unit/searchActions.test.ts --coverage=false`.

- **2026-05-13 — T161 sidebar Enter acceptance.** Added UI acceptance coverage that sidebar Enter uses `navigateToActiveOption()` and the no-active-row path navigates to `seeAllUrl`, built as `/msp/search?q=${encodeURIComponent(trimmedQuery)}`. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T162 result new-tab acceptance.** Added UI acceptance coverage that results-page rows are plain `<a href={row.url}>` anchors with no click interception, while page state remains URL-backed through initial cursor/sort/query props. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T163 ticket identifier acceptance.** Added a metadata identifier prefix branch (`LIKE q.identifier || '%'`) scored at 900 below exact matches (1000), so shortened IDs such as `tic-10` can find `TIC-1023`. Added query-layer coverage for the exact and prefix SQL branches. Validation: `cd server && npx vitest run src/test/unit/searchQuery.test.ts --coverage=false`.

- **2026-05-13 — T164 ticket-comment search-to-highlight acceptance.** Added contract coverage that `ticketCommentIndexer` emits `/msp/tickets/{ticket_id}#comment-{comment_id}` URLs with markdown-flattened body content and the ticket `CommentItem` honors the same hash by scrolling/highlighting. Validation: `cd server && npx vitest run src/test/unit/searchHashAnchors.contract.test.ts --coverage=false`.

- **2026-05-13 — T165 internal-comment positive visibility.** Added ACL verifier coverage that an internal user keeps an internal ticket-comment search row when the comment exists and its parent ticket is readable. Validation: `cd server && npx vitest run src/test/unit/searchAcl.test.ts --coverage=false`.

- **2026-05-13 — T166 internal-comment negative visibility.** Added ACL verifier coverage that a non-internal user loses an internal ticket-comment search row and the verifier short-circuits before loading the parent ticket. Validation: `cd server && npx vitest run src/test/unit/searchAcl.test.ts --coverage=false`.

- **2026-05-13 — T167 project client-scope denial.** Added ACL verifier coverage that a project whose `client_id` is outside `accessibleClientIds` is removed from visible search rows. Validation: `cd server && npx vitest run src/test/unit/searchAcl.test.ts --coverage=false`.

- **2026-05-13 — T168 document client-scope denial.** Added ACL verifier coverage that a document whose `client_id` is outside `accessibleClientIds` is removed from visible search rows; v1 leaves per-user document sharing out of scope. Validation: `cd server && npx vitest run src/test/unit/searchAcl.test.ts --coverage=false`.

- **2026-05-13 — T169 misspelled Exchange acceptance.** Added query-layer acceptance coverage that the pg_trgm fallback path returns `Exchange` as the first hit for misspelled `exhcange` and preserves the higher score over weaker fuzzy matches. Validation: `cd server && npx vitest run src/test/unit/searchQuery.test.ts --coverage=false`.

- **2026-05-13 — T170 live ticket-create indexing.** Added subscriber acceptance coverage that a `TICKET_CREATED` event resolves the ticket indexer, loads the ticket document, and calls `upsertSearchDoc` during the event handler path. Validation: `cd server && npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false`.

- **2026-05-13 — T171 live ticket-delete indexing.** Added subscriber acceptance coverage that a `TICKET_DELETED` event deletes the ticket index row immediately and does not call the ticket indexer's `loadOne`. Validation: `cd server && npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false`.

- **2026-05-13 — T172 all-entity backfill acceptance.** Added backfill coverage that `runSearchBackfill({ tenant })` iterates all 27 registered indexers and upserts one sampled searchable doc per object type. Validation: `cd server && npx vitest run src/test/unit/searchBackfill.test.ts --coverage=false`.

- **2026-05-13 — T173 reconciliation restores missing index row.** Added reconciliation coverage that a source doc absent from `app_search_index` is detected by the missing-row phase and upserted back into the index. Validation: `cd server && npx vitest run src/test/unit/searchReconcile.test.ts --coverage=false`.

- **2026-05-13 — T174 generated tenant-isolation load guard.** Added query-layer generated-load coverage across 50 tenants that asserts every SQL query includes `s.tenant = ?::uuid`, every call binds the requested tenant, and every returned synthetic row belongs to that tenant. Validation: `cd server && npx vitest run src/test/unit/searchQuery.test.ts --coverage=false`.

- **2026-05-13 — T175 pseudo-locale search coverage.** Added i18n contract coverage that the `xx` pseudo locale has every English `search.*` leaf key, includes pseudo fill for each rendered search string, and has no raw English literal text outside interpolation placeholders. Validation: `cd server && npx vitest run src/test/unit/searchI18n.contract.test.ts --coverage=false`.

- **2026-05-13 — T176 keyboard-only search flow.** Added UI contract coverage for the full keyboard path: shortcut focus, arrow navigation, Enter/Escape behavior, results-page input URL updates, filter chips, pagination links, and clear-filter control. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T177 cold deep-link restore.** Added UI contract coverage that `/msp/search` reads `q`, `type`, `cursor`, and `sort` from the URL, passes them to `searchAppAction`, and hydrates `SearchPageClient` with the same state. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T178 Citus/GIN search-plan contract.** Added migration/query contract coverage that `app_search_index` is distributed by tenant outside a transaction, has GIN indexes for FTS and trigram predicates, and the query path includes the tenant predicate plus indexable FTS/trigram branches. Validation: `cd server && npx vitest run src/test/unit/searchMigration.contract.test.ts --coverage=false`.

- **2026-05-13 — T179 Citus upsert locality.** Added upsert SQL coverage that tenant is the first UUID-bound insert value and part of the conflict target `(tenant, object_type, object_id)`, keeping single-doc writes shard-local under Citus. Validation: `cd server && npx vitest run src/test/unit/searchUpsert.test.ts --coverage=false`.

- **2026-05-13 — T180 mandatory tenant predicate.** Added query SQL capture coverage that every search emits `WHERE s.tenant = ?::uuid` and binds the authenticated tenant in the expected parameter slot. Validation: `cd server && npx vitest run src/test/unit/searchQuery.test.ts --coverage=false`.

- **2026-05-13 — T181 large document data-URI fixture.** Added document-indexer coverage for a 10MB BlockNote payload with embedded image data URI: visible text remains, `data:image` is stripped, and indexed body stays ≤64KB. Validation: `cd server && npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false`.

- **2026-05-13 — T182 service-request secret payload fixture.** Added service-request-submission indexer coverage that visible payload strings are indexed while `password`, `api_key`, and `authorization` values are excluded from the body. Validation: `cd server && npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false`.

- **2026-05-13 — T183 process_large_lexemes SQL path.** Added upsert SQL capture coverage that search-vector computation calls `public.process_large_lexemes(?)` for title, subtitle, and body weight tiers A/B/C. Validation: `cd server && npx vitest run src/test/unit/searchUpsert.test.ts --coverage=false`.

- **2026-05-13 — T184 backfill-to-live smoke.** Added subscriber/backfill smoke coverage that a seed tenant is backfilled first, then `SEARCH_INDEX_LIVE=true` allows a `TICKET_CREATED` event to land as an incremental search upsert. Validation: `cd server && npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false`.

- **2026-05-13 — T185 ticket-update subscriber stress.** Added bounded stress coverage that processes 100 `TICKET_UPDATED` events through the subscriber path, upserts each ticket, cascades the comment reindex lookup, and completes well under the 30s lag budget. Validation: `cd server && npx vitest run src/test/unit/searchIndexSubscriber.behavior.test.ts --coverage=false`.

- **2026-05-13 — T186 mixed identifier/free-text ranking.** Expanded query parsing to extract identifier-like tokens from mixed queries (e.g. `TIC-1023 vpn`) and added coverage that the exact identifier row is pinned above regular free-text matches. Validation: `cd server && npx vitest run src/test/unit/searchQuery.test.ts --coverage=false`.

- **2026-05-13 — T187 permission-prefiltered type union.** Added action-layer permission-to-object-type filtering before query execution, so a user with only `client:read` cannot query ticket/document types even when requested. Validation: `cd server && npx vitest run src/test/unit/searchActions.test.ts --coverage=false`.

- **2026-05-13 — T188 malformed cursor typed error.** Added action-layer coverage that a malformed cursor error from the query layer is propagated with `code='invalid_cursor'` rather than being wrapped as a generic failure. Validation: `cd server && npx vitest run src/test/unit/searchActions.test.ts --coverage=false`.

- **2026-05-13 — T189 ticket-comment renamed-parent subtitle.** Updated ticket-comment indexing to include the parent ticket title in the subtitle alongside the ticket number, and added coverage that a renamed parent title appears in both title and subtitle after reindex. Validation: `cd server && npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false`.

- **2026-05-13 — T190 visible-user document ACL refresh.** Added visible-user reindex job coverage for a document row currently containing a user in `visible_to_user_ids`: the job finds it via `?::uuid = ANY(visible_to_user_ids)`, reloads the document indexer, and upserts the refreshed ACL row. CE v1 still has no internal document share-list source table; this validates the async refresh path for future/private rows. Validation: `cd server && npx vitest run src/test/unit/searchVisibleUserReindex.test.ts --coverage=false`.

- **2026-05-13 — T191 SearchPalette accessibility contract.** No axe harness is installed, so added static accessibility coverage for the serious/critical surfaces: combobox ARIA state, listbox linkage, translated labels, decorative icon hiding, native anchors, and no forced focus removal. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T192 results-page accessibility contract.** Added static accessibility coverage for `/msp/search`: named region, labeled filter/sort/loading/pagination regions, hidden decorative icons, native anchors, and no fake button roles. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T193 full-search latency guard.** Added a mocked medium-tenant full-search benchmark over 20 unique users to avoid rate-limit interference and assert action p95 remains <500ms while telemetry still records latency. Validation: `cd server && npx vitest run src/test/unit/searchActions.test.ts --coverage=false`.

- **2026-05-13 — T194 zero ACL drift happy path.** Added broader verifier coverage that ticket and document rows whose SQL-level ACL agrees with record-level checks are returned without emitting `search.acl_drift` telemetry. Validation: `cd server && npx vitest run src/test/unit/searchAcl.test.ts --coverage=false`.

- **2026-05-13 — T195 reconciliation summary log.** Added reconciliation contract coverage that the handler logs per-tenant/per-object-type summary fields for reindexed, stale-deleted, and missing-inserted rows. Validation: `cd server && npx vitest run src/test/unit/searchReconcile.test.ts --coverage=false`.

- **2026-05-13 — T196 client-contract joined indexing.** Added client-contract indexer coverage for joins to `clients` and `contracts`, derived `{client_name} – {contract_name}` title, dates/status body, canonical client contract URL, and `clientScopeId = client_id`. Validation: `cd server && npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false`.

- **2026-05-13 — T197 interaction BlockNote notes flattening.** Added interaction indexer coverage for BlockNote JSON notes: text leaves such as `Added Sciton Tribrid Laser` are indexed, JSON syntax is absent, subtitle includes type/client/contact/ticket context, and `interaction:read` is required. Validation: `cd server && npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false`.

- **2026-05-13 — T198 workflow-task tenant filter with single-column PK.** Added workflow-task indexer coverage that `loadOne` queries `workflow_tasks` with `where('tenant', tenant)` plus `andWhere('task_id', id)`, despite `task_id` being the only PK column. Validation: `cd server && npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false`.

- **2026-05-13 — T199 workflow-task assigned_users JSONB parsing.** Added workflow-task indexer coverage that JSON-string `assigned_users` entries (`user_id` and `id`) are parsed into deduped `acl.visibleToUserIds`, which upsert writes into `visible_to_user_ids`. Validation: `cd server && npx vitest run src/test/unit/searchIndexers.test.ts --coverage=false`.

- **2026-05-13 — T200 CE eeIndexers stub.** Added registry coverage that `@ee/lib/search/indexers` resolves to the CE stub `[]`, and `allIndexers().length === ceIndexers.length === 27`. Validation: `cd server && npx vitest run src/test/unit/searchRegistry.test.ts --coverage=false`.

- **2026-05-13 — T201 dynamic registry extension.** Changed search registry accessors to rebuild from `ceIndexers + eeIndexers` on each call, then added coverage that a synthetic indexer pushed into `ceIndexers` appears in `allIndexers()`, `registeredObjectTypes()`, and `getIndexer('synthetic')`. Validation: `cd server && npx vitest run src/test/unit/searchRegistry.test.ts --coverage=false`.

- **2026-05-13 — T202 EE orphan query safety.** Added action coverage that CE query type lists are derived from registered object types and do not include an unregistered `ee_chat_history` orphan type. Validation: `cd server && npx vitest run src/test/unit/searchActions.test.ts --coverage=false`.

- **2026-05-13 — T203 registry-driven filter chips.** Added UI contract coverage that the search page receives `registeredObjectTypes()`, builds `typeEntries` from `registeredTypes`, renders the `All` chip separately, and maps one chip per registered type. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T204 missing-label fallback.** Added UI contract coverage that search filter and group labels pass `defaultValue: humanizeObjectType(type)` through i18n, with `service_request_submission` falling back to `Service request submission` when a locale key is absent. Validation: `cd server && npx vitest run src/test/unit/searchUi.contract.test.ts --coverage=false`.

- **2026-05-13 — T205 reconciliation orphan safety.** Added reconciliation coverage that a requested unregistered object type is resolved through `getIndexer(data.type)`, logs a skip, returns an empty indexer list, and therefore does not attempt source loading or mutation for orphan rows such as `ee_chat_history`. Validation: `cd server && npx vitest run src/test/unit/searchReconcile.test.ts --coverage=false`.

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
