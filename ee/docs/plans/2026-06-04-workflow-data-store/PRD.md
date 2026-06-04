# PRD — Workflow Data Store (KV + Entity Links)

- Slug: `workflow-data-store`
- Date: `2026-06-04`
- Status: Draft

## Summary

Add a tenant-scoped, cross-run **persistent data store** that workflows can read and write through registered actions. It ships two complementary primitives:

1. **Key/Value store** (`workflow_data_store`) — store any JSON value under a free-form `namespace` + `key`. For counters, cursors, dedup flags, accumulators, run-to-run handoff, and small config.
2. **Entity links** (`workflow_entity_links`) — a first-class, bidirectional, many-to-many mapping between two identifiers (`{type, id}` ↔ `{type, id}`) within a `namespace`. For mapping entities the system produces/consumes — e.g. mirroring a task in one project to a task (or tasks) in another.

The immediate driver is cross-project task mirroring ("update tasks in project B when tasks in project A change"), which requires durable state that survives a single run and is shared across runs. But the design is intentionally generic so it is reused across many automation scenarios.

This extends the existing V2 workflow action registry and persistence conventions; it introduces no new runtime framework.

## Problem

A V2 workflow run carries state only in its **Envelope** (`payload`, `vars`, `meta`). That state is per-run and is discarded when the run ends. Snapshots (`workflow_run_snapshots`) are internal recovery only. There is **no supported way for one run to leave a fact that a later, separate run can read.**

Cross-project task mirroring needs exactly that: one run records `task_A → task_B`, and a *different* run (triggered later by an update to `task_A`) must look that mapping up. More broadly, authors repeatedly need to remember things across runs (last-processed cursor, "already handled" markers, external-id ↔ internal-id maps) and today have no primitive for it.

The one adjacent table, `tenant_external_entity_mappings`, is integration-specific (QBO/Xero), uses a textual `tenant_id`, is not Citus-distributed, and carries `integration_type`/`external_realm_id` semantics. Repurposing it for internal workflow mapping would overload a table that accounting sync depends on. We reuse the *pattern*, not the table.

## Goals

- Provide a generic, tenant-scoped key/value store usable from any workflow via actions.
- Provide a generic, bidirectional, many-to-many entity-link/mapping store usable from any workflow via actions.
- Free-form namespaces (created on first write); no mandatory registration step.
- Support the cross-project task-mirroring scenario end-to-end with these primitives alone.
- Follow existing V2 conventions: `shared/workflow/persistence` models, `businessOperations` action modules, `withTenantTransaction` + `requirePermission` + `writeRunAudit` + idempotency.
- Land as a **single CE migration** that creates the tables with `tenant uuid` from the start and distributes them inline (Citus-guarded), colocated into the workflow colocation group (group 41, with `workflow_runs`).
- Expose the actions in the workflow designer under a "Data Store" palette group with expression/scope-picker support.
- All new designer UI uses AlgaPSA `@alga-psa/ui` design-system components (no native HTML controls) and is fully localized under the `msp/workflows` i18n namespace, passing `validate-translations.cjs` across all 9 locales.

## Non-goals

- No managed namespace registry, declared value schemas, or per-namespace governance UI in this plan (free-form only; a `list_namespaces` helper gives autocomplete without a registry).
- No per-action `persist`/auto-capture field and no automatic "store every step output." Writes are always explicit, dedicated Data Store nodes — the designer is already complex, and adding a persist affordance to every action would add confusing surface everywhere. Storing is a deliberate act with its own node.
- No strict 1:1 cardinality enforcement on links; cardinality is **N:M** by design (callers decide fan-out). Only duplicate identical edges are prevented.
- No N-ary links (only binary edges between two identifiers). Model richer relationships with `namespace` + edge `attributes`.
- No reuse or migration of `tenant_external_entity_mappings`.
- No changes to workflow runtime mapping semantics, Envelope shape, or persisted step shape.
- No general-purpose blob storage; values are bounded JSON (size-capped).
- No cross-tenant or global (tenantless) scope.

## Users and Primary Flows

### Users
- Workflow authors who need state that outlives a single run.
- MSP operators automating cross-project / cross-entity synchronization.
- Authors building dedup, rate-limit, counter, and "remember last seen" automations.

### Primary flow — cross-project task mirror
1. **Link-setup workflow.** Trigger `PROJECT_TASK_CREATED` in project A (gated to mirrored projects). Create the counterpart in B via `projects.create_task`, then `links.upsert` records the edge `{namespace:'project-task-mirror', left:{project_task, taskA}, right:{project_task, taskB}, attributes:{fieldMap}}`.
2. **Mirror workflow.** Trigger `PROJECT_TASK_UPDATED` for `taskA`. `links.lookup{from:{project_task, taskA}, direction:'forward'}` returns `matches[]`; a `control.forEach` over matches calls `projects.update_task(match.id, mappedFields)`. No matches → no-op. Reverse sync uses `direction:'reverse'`.

### Secondary flows
- **Dedup:** `store.set{namespace:'invoice-dunning-sent', key: invoiceId, value:true, if_revision:0}`; CONFLICT means already sent → branch to skip.
- **Counter:** `store.increment{namespace:'tenant-onboarding', key:'welcome-emails', by:1}`.
- **Cursor:** `store.get`/`store.set{namespace:'sync-cursor', key: sourceId, value: lastSeenIso}`.

## Design

### Namespaces

A **namespace** is the author-chosen logical bucket that groups related entries within a tenant. It is a plain `text` column — not a Postgres schema or Citus concept — and is the first part of every entry's identity: a KV row is `(tenant, namespace, key)` and a link edge is `(tenant, namespace, left, right, relation)`. Think of it as a collection / keyspace-prefix / bucket name.

Its job is to keep unrelated automations from colliding: without it, every key shares one flat per-tenant space and a `key` from one feature could clash with the same `key` from another. Namespaces also scope reads — `store.list`/`links.lookup`/`*.list_namespaces` operate within a single namespace. They are **free-form and created on first write** (no registration); the designer surfaces the field as a soft-enum combobox autocompleting from namespaces already in use.

Examples in one tenant: `project-task-mirror` (task↔task mappings), `invoice-dunning-sent` (dedup flags by invoice id), `sync-cursor` (last-seen timestamps by source id), `onboarding-counters` (counters). A single namespace can hold mappings for *all* project pairs at once, since each edge carries the actual entity ids; split into multiple namespaces only when you want separately listable/auditable buckets.

### Write model & referencing (vars vs. store)

Writes are **explicit, dedicated nodes** (`store.set`, `store.delete`, `store.increment`, `links.upsert`, `links.delete`). The author adds a Data Store node only where they want to persist something specific; no other action gains any new field. This keeps the designer uncluttered and every write visible in the pipeline and run inspector.

**What can be stored** is whatever the author maps into the node's `value` (KV) or `left`/`right`/`attributes` (links): a literal string, number, or boolean; a JSON object/array; a prior step's output via `{ $expr: "vars.x" }`; or an entire trigger/webhook payload via `{ $expr: "payload" }` (stored whole as jsonb, bounded by the size cap). Link identifiers are arbitrary strings, mapped explicitly.

**Referencing works the same in both scopes** — the store is just durable rows keyed by `(tenant, namespace, key)`:

- *Same run* — `store.get`/`links.lookup` with `saveAs` loads the value into this run's `vars`; reference it via `{ $expr: "vars.x" }`. A `store.set` earlier in the same run is readable by a later `store.get` (same row), and `store.set`'s own output also lands in `vars`. For pure same-run data passing, plain `vars` (no DB) is still the cheaper path; reach for the store when you want durability.
- *Later run* — a separate execution reads the same row with `store.get`/`links.lookup` (+ `saveAs`) and references it identically. This is the only way to share state across runs, since `vars` dies with the run.

So one mental model: `vars` = ephemeral fast path; store = durable shared path; both surfaced through the same `saveAs` → `{ $expr: "vars.x" }` mechanism. The store node is what rehydrates durable state into the current run's `vars`.

### Data model

Two tables, both: `tenant uuid NOT NULL` (distribution column) → FK to `tenants`, composite PK including `tenant`, all unique/index keys lead with `tenant` (Citus requirement), distributed `colocate_with => 'workflow_runs'` so they land in the workflow colocation group.

`created_by_run_id` is a **soft reference** (plain nullable uuid, no FK). Store/link data deliberately **outlives** runs — runs are pruned/retained on a different schedule, and we do not want store entries cascade-deleted when a run is cleaned up.

#### `workflow_data_store` (KV)

| column | type | notes |
|---|---|---|
| `tenant` | uuid NOT NULL | FK → `tenants.tenant`; distribution column |
| `store_id` | uuid NOT NULL | `gen_random_uuid()` |
| `namespace` | text NOT NULL | free-form collection |
| `key` | text NOT NULL | key within namespace |
| `value` | jsonb NOT NULL | arbitrary JSON; size-capped |
| `value_type` | text NOT NULL default `'json'` | designer hint: `string` / `number` / `boolean` / `json` |
| `revision` | bigint NOT NULL default 1 | optimistic concurrency (compare-and-set) |
| `expires_at` | timestamptz NULL | optional TTL |
| `created_by_run_id` | uuid NULL | soft ref |
| `created_at` / `updated_at` | timestamptz | set in model code |

- PK `(tenant, store_id)`
- UNIQUE `(tenant, namespace, key)` — logical identity
- INDEX `(tenant, namespace)`
- Partial INDEX `(tenant, expires_at)` WHERE `expires_at IS NOT NULL` — janitor sweep

#### `workflow_entity_links` (mapping)

| column | type | notes |
|---|---|---|
| `tenant` | uuid NOT NULL | FK → `tenants.tenant`; distribution column |
| `link_id` | uuid NOT NULL | `gen_random_uuid()` |
| `namespace` | text NOT NULL | e.g. `project-task-mirror` |
| `left_type` / `left_id` | text NOT NULL | e.g. `project_task` / `<taskA>` |
| `right_type` / `right_id` | text NOT NULL | e.g. `project_task` / `<taskB>` |
| `relation` | text NOT NULL default `'related'` | semantic label (`mirrors`, `maps_to`, …) |
| `attributes` | jsonb NOT NULL default `'{}'` | per-edge metadata (e.g. field map) |
| `created_by_run_id` | uuid NULL | soft ref |
| `created_at` / `updated_at` | timestamptz | set in model code |

- PK `(tenant, link_id)`
- UNIQUE `(tenant, namespace, left_type, left_id, right_type, right_id, relation)` — the **(left, right) pair is intentionally NOT unique**; uniqueness is on the *typed edge* (incl. `relation`). So the same pair can carry multiple connection types at once (e.g. two different workflows establishing `mirrors` and `blocks` between `taskA` and `taskB`), while re-running the same typed edge stays idempotent (clean `upsert`). Everything else is N:M.
- INDEX `(tenant, namespace, left_type, left_id)` — forward lookup
- INDEX `(tenant, namespace, right_type, right_id)` — reverse lookup

Identifiers are `text` (not uuid) so the store maps anything: uuids, external string ids, emails, composite keys.

### Migration (single CE file, no split)

`server/migrations/20260604120000_create_workflow_data_store_tables.cjs`, modeled exactly on `20260429133000_create_asset_facts_table.cjs`:

- `exports.config = { transaction: false }` (required for `create_distributed_table`).
- `createTable` for both tables with `tenant uuid` first, composite PK/unique/index as above.
- Detect Citus via `pg_extension`; if enabled and not already distributed, `SELECT create_distributed_table('workflow_data_store', 'tenant', colocate_with => 'workflow_runs')` and the same for `workflow_entity_links`. Else `console.warn` and skip (plain Postgres for CE/dev).
- `down` drops both tables.

No `ee/server/migrations` file. No expand/contract dance — the tables are born distributed-ready (`tenant uuid` from row zero), avoiding the retrofit pain the existing V2 tables went through.

### Persistence models

`shared/workflow/persistence/workflowDataStoreModel.ts` and `workflowEntityLinkModel.ts`, mirroring the `*V2` model style (tenant-scoped, explicit `tenant` param, Knex):

- KV: `get`, `set` (insert-or-update on `(tenant,namespace,key)`; bumps `revision`; optional `if_revision` compare-and-set returning a conflict signal), `delete`, `increment` (atomic numeric update under the row), `list` (namespace + optional prefix, cursor pagination), `listNamespaces`, `deleteExpired` (janitor).
- Links: `upsert` (onConflict on the unique edge → update `attributes`/`relation`), `lookup` (forward/reverse/either; optional `relation`/`right_type` filter), `delete` (by partial criteria; requires at least one of left/right), `list`, `listNamespaces`.

### Actions (registry)

New module(s) under `shared/workflow/runtime/actions/businessOperations/` (`dataStore.ts` for KV, `entityLinks.ts` for links), registered from `runtime/init.ts`. All writes are `sideEffectful` with idempotency via `actionProvidedKey`, wrapped in `withTenantTransaction`, gated by `requirePermission`, and audited via `writeRunAudit`. Reads are non-side-effectful but tenant-scoped. Zod in/out schemas with `withWorkflowJsonSchemaMetadata` for the designer.

KV (palette group `store`):
- `store.get` → `{found, value, value_type, revision, expires_at}`
- `store.set` `{namespace, key, value, value_type?, ttl_seconds?, if_revision?}` → `{revision, created}` (CAS mismatch → `ActionError CONFLICT`)
- `store.delete` `{namespace, key}` → `{deleted}`
- `store.increment` `{namespace, key, by?=1, initial?=0}` → `{value, revision}`
- `store.list` `{namespace, prefix?, limit?<=200, cursor?}` → `{items[], next_cursor}`
- `store.list_namespaces` → `{namespaces:[{namespace, key_count}]}`

Links (palette group `links`):
- `links.upsert` `{namespace, left:{type,id}, right:{type,id}, relation?, attributes?}` → `{link_id, created}`
- `links.lookup` `{namespace, from:{type,id}, direction?='forward'|'reverse'|'either', relation?, right_type?, limit?<=200}` → `{matches:[{link_id, type, id, relation, attributes}]}`
- `links.delete` `{namespace, left?, right?, relation?}` → `{deleted_count}` (≥1 of left/right required)
- `links.list` `{namespace, left_type?, right_type?, relation?, limit?, cursor?}` → `{items[], next_cursor}`
- `links.list_namespaces` → `{namespaces:[{namespace, link_count}]}`

### Designer integration

Add a "Data Store" catalog group in `runtime/designer/actionCatalog.ts` exposing `store.*` and `links.*`. `namespace` is free-text with autocomplete sourced from `*.list_namespaces`. `left/right` ids are populated from upstream action outputs via expressions (`{ $expr: "vars.created.task_id" }`). Three "label" fields — **namespace**, entity **`type`**, and link **`relation`** — share one UX: a **soft-enum combobox** that suggests (a) a curated constant list and (b) values already used in the chosen namespace (a lightweight `SELECT DISTINCT` helper, same idea as `list_namespaces`), while still accepting a custom free-text value. None are enforced enums at the DB/schema level (all stay free-form `text`). Curated defaults: types = `project_task`, `ticket`, `contact`, `client`, `project`, `appointment`, `quote`, …; relations = `related` (default), `mirrors`, `maps_to`, `blocks`, `duplicate_of`, `synced_with`.

On `links.upsert` the author sets `relation` via that combobox (default `related`); on `links.lookup` an optional `relation` filter uses the same combobox (empty = match any relation). `left/right` ids are expression inputs sourced from upstream outputs (`{ $expr: "vars.created.task_id" }`). `direction` (forward/reverse/either) is a small segmented control.

**Components (design-system only; no native HTML controls).** All fields use AlgaPSA `@alga-psa/ui` components — never native `<select>`/`<input>`/`<textarea>`:
- soft-enum comboboxes (namespace, entity `type`, `relation`) reuse the existing creatable-combobox pattern (`TagInput` / `ComboBoxFieldSelector` precedent): filtered suggestions + "add new" free text;
- fixed choices (`direction`, `value_type`) use `CustomSelect`;
- id/value fields reuse the designer's existing expression input (`ExpressionAutocomplete`) and `@alga-psa/ui` `Input`;
- the `value` (JSON/payload) editor reuses the designer's existing fixed-value/JSON editor components, not a raw textarea.

### TTL / janitor

Lazy expiry on read (`store.get` treats `expires_at < now()` as not-found and opportunistically deletes), plus a periodic sweep bolted onto the existing `WorkflowRuntimeV2Worker` poll loop calling `deleteExpired(tenant)` in batches.

### Limits / abuse guards

- `value` capped at `WORKFLOW_STORE_MAX_VALUE_BYTES` (default 256 KB, matching snapshot caps); oversize → `ValidationError`.
- `namespace`/`key`/`*_id` length caps (e.g. 256 chars).
- No per-tenant row quota (out of scope; revisit only if abuse is observed in practice).

## Localization (i18n)

All new designer UI must be fully localized — the workflow surface was migrated in the `2026-04-18-msp-i18n-workflows` effort and must not regress.

- **Strings via `t()`** under the existing `msp/workflows` namespace (`useTranslation('msp/workflows')` from `@alga-psa/ui/lib/i18n/client`). Add keys for the "Data Store" palette group, node labels/descriptions, every field label/placeholder, empty states, and validation messages.
- **No hardcoded option arrays** — the curated entity-`type` and `relation` suggestion lists follow the `enum-labels-pattern.md` option-hook pattern: `VALUES` + `LABEL_DEFAULTS` constants plus `useEntityTypeOptions()` / `useRelationOptions()` hooks (colocated in `ee/packages/workflows/src/hooks/`). The stored value stays the canonical token (`project_task`, `mirrors`); only the display label is translated.
- **Action palette metadata** — the `ui.label`/`ui.description` for `store.*` / `links.*` actions must resolve through i18n keys (consistent with how existing action palette entries are localized), not hardcoded English in the action registry.
- **Locale files** — add the new keys to all nine `server/public/locales/*/msp/workflows.json` plus pseudo-locales `xx`/`yy`.
- **Validation/QA** — `node scripts/validate-translations.cjs` passes with zero missing/extra keys across 9 locales; `xx` pseudo-locale QA shows no English bleed-through on the Data Store nodes.

## Security / RBAC

Reuse the existing `workflow` permission resource (actions: `read`, `view`, `manage`, `publish`, `admin`) — no new resource. Read actions (`store.get`, `store.list`, `*.list_namespaces`, `links.lookup`, `links.list`) require **`workflow:read`**; write actions (`store.set`, `store.delete`, `store.increment`, `links.upsert`, `links.delete`) require **`workflow:manage`**. No seed/permission migration needed since the rows already exist. The permission is checked against the workflow's actor (publisher/creator, resolved by `resolveRunActorUserId`), consistent with other business-operation actions. Tenant isolation is enforced by the `tenant` distribution column and `set_config('app.current_tenant', …)` inside `withTenantTransaction`.

## Observability

- Writes recorded in `audit_logs` via `writeRunAudit` (operation `store.set`/`links.upsert`/etc., with namespace/key/edge in details).
- Action invocations already logged in `workflow_action_invocations` (input/output/idempotency), giving per-run traceability for store operations.

## Test plan (high level)

- **Models:** CRUD; revision bump; `if_revision` compare-and-set (success + conflict); `increment` atomicity under concurrency; TTL lazy expiry + `deleteExpired`; link `upsert` idempotency; N:M `lookup` forward/reverse/either; duplicate-edge unique conflict; `delete` by partial criteria; tenant isolation (no cross-tenant reads).
- **Actions:** Zod schema validation; RBAC denial without permission; idempotent replay (same idempotency key → same result, no double write); value-size cap rejection.
- **Citus:** both tables distributed and colocated with `workflow_runs` (same colocation group); inserts route correctly; CE/dev (no Citus) path works.
- **Integration:** the two reference workflows (link-setup + mirror) run end-to-end against a seeded tenant, including `forEach` over multiple matches for a 1:N mirror.
- **Designer / i18n:** Data Store nodes render with `@alga-psa/ui` components only (no native `<select>`/`<input>`); soft-enum comboboxes show suggestions + accept custom values; `validate-translations.cjs` passes across 9 locales with the new keys; `xx` pseudo-locale shows no English bleed-through on the Data Store nodes.

## Rollout

Purely additive — new tables, models, actions, and a designer group. No data backfill, no changes to existing workflows. The designer "Data Store" group may sit behind a feature flag during rollout if desired. Backward compatible.

## Open questions

_All initial open questions are resolved and reflected in the design above (both primitives · free-form namespaces · N:M with `relation` in the typed-edge unique key · single CE migration colocated with `workflow_runs` · explicit-node writes · any string/JSON/payload values · `workflow:read`/`workflow:manage` RBAC · no per-tenant quota · soft-enum comboboxes for namespace/type/relation)._

## Appendix — reference workflow sketches

**Mirror workflow (PROJECT_TASK_UPDATED → update linked tasks):**
```
trigger: { type: event, eventName: PROJECT_TASK_UPDATED }
steps:
  - id: lookup
    type: action.call
    config: { actionId: links.lookup }
    input: { namespace: "project-task-mirror",
             from: { type: "project_task", id: { $expr: "payload.task_id" } },
             direction: "forward" }
  - id: fan-out
    type: control.forEach
    items: { $expr: "vars.lookup.matches" }
    itemVar: m
    body:
      - id: update
        type: action.call
        config: { actionId: projects.update_task }
        input: { task_id: { $expr: "m.id" },
                 name:    { $expr: "payload.changes.name" },
                 description: { $expr: "payload.changes.description" } }
```
