# SCRATCHPAD — Workflow Data Store

Working notes, locked decisions, and implementation sequence. See `PRD.md` for the authoritative spec.

## Locked decisions (with rationale)

1. **Two primitives, built together** — `workflow_data_store` (KV) + `workflow_entity_links` (mapping). The cross-run gap (V2 runs have only per-run `vars`) needs durable storage; KV covers "remember a value", links cover "map A↔B with reverse lookup". KV-only would force two hand-synced keys for reverse lookups.
2. **Free-form namespaces** — created on first write, no registry. A `*.list_namespaces` helper gives designer autocomplete without governance overhead.
3. **N:M links; uniqueness on the typed edge** — `UNIQUE (tenant, namespace, left_type, left_id, right_type, right_id, relation)`. The (left,right) pair is deliberately NOT unique, so two workflows can establish two connection types (e.g. `mirrors` + `blocks`) between the same entities; re-running a typed edge stays idempotent. Starting permissive here is safe; tightening later would be the risky direction, so this is the right default.
4. **Single CE migration, distribute inline** — workflow V2 tables already live in CE (`20251221090000`). For a *new* table the house pattern is one CE migration that creates with `tenant uuid` and distributes behind an `isCitusEnabled` guard (`transaction:false`), template `server/migrations/20260429133000_create_asset_facts_table.cjs`. No CE/EE split — that split on the existing V2 tables was a retrofit (expand/contract `tenant_id text`→`tenant uuid`), not the greenfield pattern. Colocate with `workflow_runs` → group 41.
5. **`created_by_run_id` is a soft reference (no FK)** — store/link data outlives runs (different retention); we don't want it cascade-deleted when a run is pruned.
6. **Explicit-node writes only** — dedicated `store.set`/`links.upsert` nodes the author drops in deliberately. No per-action `persist` field / auto-capture: the designer is already complex and a persist affordance on every action would add confusing surface everywhere.
7. **Values are any string/number/boolean/JSON, incl. whole webhook/trigger payloads** (`{ $expr: "payload" }`), bounded by a 256 KB cap. Link ids are arbitrary `text`.
8. **RBAC reuses the existing `workflow` resource** — reads → `workflow:read`, writes → `workflow:manage`. No new resource, no permission-seed migration (rows already exist). Checked against the workflow actor.
9. **No per-tenant row quota** in v1 (revisit only if abuse appears).
10. **Designer UI = `@alga-psa/ui` components only** — creatable-combobox (TagInput/ComboBoxFieldSelector precedent) for namespace/type/relation, `CustomSelect` for direction/value_type, `ExpressionAutocomplete` for ids, existing fixed-value/JSON editor for `value`. No native HTML controls.
11. **Fully localized** — strings via `t()` under `msp/workflows`; type/relation suggestion lists via the `enum-labels-pattern.md` option-hook (`VALUES` + `LABEL_DEFAULTS` + `useXOptions()`), storing the canonical token and translating the label; keys in all 9 locales + `xx`/`yy`; `validate-translations.cjs` must pass.

## Referencing model (same mechanism, two scopes)

- Same run: plain `vars` (no DB) for pure data passing; the store is for durability. `store.get`/`links.lookup` with `saveAs` load into `vars`, referenced via `{ $expr: "vars.x" }`.
- Cross run: a separate execution reads the same `(tenant, namespace, key)` row identically. This is the only way to share state across runs.

## Implementation sequence (suggested slices)

1. **Migration** (`server/migrations/2026XXXX_create_workflow_data_store_tables.cjs`) — both tables + inline distribution, mirroring `asset_facts`. → F001
2. **Models** — `shared/workflow/persistence/workflowDataStoreModel.ts`, `workflowEntityLinkModel.ts`. → F002, F003
3. **Actions** — `runtime/actions/businessOperations/dataStore.ts`, `entityLinks.ts`; register from `runtime/init.ts`. → F004–F012, F015
4. **Limits + TTL** — value/size caps; lazy expiry + janitor sweep on `WorkflowRuntimeV2Worker`. → F013, F014
5. **Designer** — catalog group + node config UI (design-system components). → F016, F017
6. **i18n** — keys + option hooks across locales. → F018, F019
7. **Reference workflows + tests** — fixtures + model/action/Citus/integration/i18n suites. → F020, F021, F022

## Open items / to confirm during build

- Exact home for `value` JSON/payload editor component reuse (confirm the designer's existing fixed-value/JSON editor handles arbitrary objects, not just scalars).
- Confirm how existing action `ui.label`/`description` are localized in the palette so `store.*`/`links.*` follow the same wiring.
- Decide the curated default lists (entity types, relations) — seed values in the option-hook constants.
- Migration timestamp to be assigned at implementation time (must sort after latest existing migration).

## Notes

- Knowledge from analysis: V1 (event-sourced) runtime was removed (`20260308173000`); everything here targets V2 (Temporal interpreter + DB-poll fallback + Redis event stream). The store is read/written purely through actions, so it is engine-agnostic.

## 2026-06-04 implementation log

### F001 — CE migration

- Added `server/migrations/20260604120000_create_workflow_data_store_tables.cjs`.
- Migration creates both `workflow_data_store` and `workflow_entity_links` with `tenant uuid` as the first column and FK to `tenants.tenant`, composite PKs including `tenant`, and all unique/index keys tenant-leading.
- KV table includes unique logical identity `(tenant, namespace, key)`, namespace index, partial TTL sweep index `(tenant, expires_at) WHERE expires_at IS NOT NULL`, `revision`, optional `expires_at`, soft `created_by_run_id`, and timestamps.
- Link table includes N:M typed-edge uniqueness `(tenant, namespace, left_type, left_id, right_type, right_id, relation)`, forward/reverse lookup indexes, JSONB `attributes`, soft `created_by_run_id`, and timestamps.
- Distribution follows the asset facts pattern: `exports.config = { transaction: false }`, Citus extension guard, already-distributed guard via `pg_dist_partition`, and `create_distributed_table(..., 'tenant', colocate_with => 'workflow_runs')`. Non-Citus CE/dev path logs a warning and leaves plain Postgres tables.
- Down migration drops links before KV. No FK to workflow runs was added by design, because persisted store/link data must outlive run retention.

### F002 — KV persistence model

- Added `shared/workflow/persistence/workflowDataStoreModel.ts` and exported it from the persistence index.
- Implemented tenant-explicit `get`, `set`, `delete`, `increment`, `list`, `listNamespaces`, and `deleteExpired`.
- `set` uses insert-ignore then update, returning `{record, created, conflict}` so callers can translate CAS mismatch into the action-layer `CONFLICT`. `if_revision: 0` is create-only; other `if_revision` values update only matching revisions.
- `increment` is a single Postgres upsert and updates only existing numeric JSONB values, so concurrent increments are atomic and non-numeric values fail instead of being silently coerced.
- `get` already performs lazy TTL behavior: expired rows are deleted opportunistically and returned as not-found. The worker sweep remains open under F014.
- `list` uses offset cursors to match existing workflow list patterns and filters expired rows; namespace counts also ignore expired rows.

### F003 — entity-link persistence model

- Added `shared/workflow/persistence/workflowEntityLinkModel.ts` and exported it from the persistence index.
- Implemented tenant-explicit `upsert`, `lookup`, `delete`, `list`, and `listNamespaces`.
- `upsert` de-duplicates only the full typed edge `(tenant, namespace, left_type, left_id, right_type, right_id, relation)` and updates `attributes` on replay, preserving the PRD's N:M behavior and allowing the same pair under different relations.
- `lookup` supports `forward`, `reverse`, and `either`, returning target-side `{link_id,type,id,relation,attributes}` matches and applying `relation` plus target-type filtering.
- `delete` enforces the safety rule that at least one side (`left` or `right`) must be provided; namespace and optional relation always scope the deletion.

### F004 — store.get action

- Added `store.get` in `shared/workflow/runtime/actions/businessOperations/dataStore.ts`.
- Read action is non-side-effectful, tenant-scoped through `withTenantTransaction`, checks `workflow:read`, and returns `{found,value,value_type,revision,expires_at}`. The model handles lazy TTL deletion, so expired rows return `found:false`.

### F005 — store.set action

- Added `store.set` with `value_type`, `ttl_seconds`, `if_revision`, optional `idempotency_key`, action-provided idempotency, `workflow:manage`, and audit operation `store.set`.
- CAS conflicts from the model are translated to `ActionError` code `CONFLICT`.

### F006 — store.delete action

- Added `store.delete` with action-provided idempotency, `workflow:manage`, audit operation `store.delete`, and `{deleted}` output.

### F007 — store.increment action

- Added `store.increment` with atomic model increment, `by`/`initial`, action-provided idempotency, `workflow:manage`, audit operation `store.increment`, and `{value,revision}` output.
- Existing non-numeric values are rejected as validation errors instead of coerced.

### F008 — store list actions

- Added `store.list` with namespace/prefix/limit/cursor pagination and `store.list_namespaces` with key counts.
- Both are non-side-effectful reads and require `workflow:read`.

### F009 — links.upsert action

- Added `links.upsert` in `shared/workflow/runtime/actions/businessOperations/entityLinks.ts`.
- Write action is idempotent on the typed edge through the model, uses action-provided idempotency, requires `workflow:manage`, audits `links.upsert`, and returns `{link_id,created}`.

### F010 — links.lookup action

- Added `links.lookup` with `direction`, optional `relation`/target-type filtering, `limit`, `workflow:read`, and `{matches:[{link_id,type,id,relation,attributes}]}` output.

### F011 — links delete/list actions

- Added `links.delete` with left/right criteria validation, optional relation, `workflow:manage`, audit operation `links.delete`, and `{deleted_count}`.
- Added `links.list` and `links.list_namespaces` as non-side-effectful reads requiring `workflow:read`.

### F012 — shared action conventions

- All write actions use `withTenantTransaction`, `requirePermission(... workflow:manage)`, `writeRunAudit`, `sideEffectful:true`, and `actionProvidedKey`.
- Read actions are `sideEffectful:false`, use `withTenantTransaction`, require `workflow:read`, and do not write audit rows.

### F013 — action limits

- Added Zod length caps of 256 chars for namespace/key/entity ids/type/relation/idempotency inputs.
- Added `WORKFLOW_STORE_MAX_VALUE_BYTES` (default 256 KiB) enforcement for `store.set` before persistence, returning `ValidationError` when exceeded.

### F015 — runtime registration

- Registered `registerDataStoreActions()` and `registerEntityLinkActions()` from `shared/workflow/runtime/actions/registerBusinessOperationsActions.ts`, so `initializeWorkflowRuntimeV2()` loads them with the rest of business operations.

### F014 — TTL worker sweep

- Added a throttled expired-row sweep to `shared/workflow/workers/WorkflowRuntimeV2Worker.ts`.
- Each tick calls `sweepExpiredWorkflowDataStore()` only after `WORKFLOW_STORE_EXPIRY_SWEEP_INTERVAL_MS` (default 60s). It selects tenants with expired `workflow_data_store` rows and calls `WorkflowDataStoreModel.deleteExpired(knex, tenant, batchSize)` per tenant.
- Sweep bounds are configurable with `WORKFLOW_STORE_EXPIRY_SWEEP_TENANT_LIMIT` (default 50 tenants per sweep) and `WORKFLOW_STORE_EXPIRY_SWEEP_BATCH_SIZE` (default 1000 rows per tenant). Errors are logged as warnings and do not fail workflow polling.
- This completes TTL behavior together with the previously implemented lazy read expiry in `WorkflowDataStoreModel.get`/`store.get`.

### F016 — designer catalog and schema metadata

- Added a built-in `data-store` designer catalog group in `shared/workflow/runtime/designer/actionCatalog.ts` with modules `store` and `links`, default action `store.get`, and a `data-store` icon token.
- Added a Data Store palette icon mapping in `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx` using the existing lucide `Database` icon.
- Extended workflow JSON-schema editor metadata with a typed `softEnum` block for creatable combobox fields. The metadata supports namespace suggestions via `store.list_namespaces`/`links.list_namespaces`, curated entity type/relation token suggestions, custom free-text values, and namespace-scoped suggestion hints.
- Updated `store.*` and `links.*` schemas so namespace/type/relation/id/value fields expose designer editor hints: soft-enum custom inputs for labels, expression-capable text inputs for ids/keys, JSON editor hint for `store.set.value`, and enum-backed fields (`direction`, `value_type`) remain fixed-select compatible through existing enum handling.

### F017 — designer soft-enum UI

- Updated `ee/server/src/components/workflow-designer/mapping/InputMappingEditor.tsx` so string fields with `x-workflow-editor.softEnum.component === 'soft-enum-combobox'` render the design-system `SearchableSelect` with `allowCustomValue`.
- Curated token suggestions from metadata are shown for entity `type` and link `relation`; the current custom value is preserved as an option. Namespace fields accept free text and are ready for dynamic namespace suggestions once an autocomplete data source is wired.
- Fixed choices (`direction`, `value_type`) continue through the existing enum path, which renders `CustomSelect`; ids/keys use the existing source-mode/expression editor plus `@alga-psa/ui` `Input` in fixed mode; JSON values use the existing JSON editor path.
- No native HTML controls were added in the workflow designer code for Data Store fields.

### F018 — Data Store designer localization

- Added Data Store palette group keys, all `store.*`/`links.*` action label/description keys, soft-enum combobox placeholder/empty/custom-value keys, and entity type/relation enum label keys to every `server/public/locales/*/msp/workflows.json` file.
- Pseudo-locales `xx` and `yy` use marker text for the new Data Store keys instead of English fallback text, so the designer surface exposes missing i18n wiring during pseudo-locale QA.
- `node scripts/validate-translations.cjs` passed with zero errors; it still reports eight pre-existing extra-key warnings in Polish `msp/admin.json` and `msp/settings.json`, unrelated to workflow Data Store keys.

### F019 — localized entity type/relation options

- Added `WORKFLOW_ENTITY_TYPE_VALUES`/`WORKFLOW_ENTITY_TYPE_LABEL_DEFAULTS` and `WORKFLOW_LINK_RELATION_VALUES`/`WORKFLOW_LINK_RELATION_LABEL_DEFAULTS` in `ee/packages/workflows/src/constants/workflowEnums.ts`.
- Added `useWorkflowEntityTypeOptions()` and `useWorkflowLinkRelationOptions()` in `ee/packages/workflows/src/hooks/useWorkflowEnumOptions.ts`, following the existing enum-label hook pattern. The stored values remain canonical tokens (for example `project_task`, `mirrors`) while labels come from `msp/workflows`.
- Updated the Data Store soft-enum renderer to use those localized hooks for `workflow-entity-type` and `workflow-link-relation` metadata, preserving custom values as literal labels.
- Removed the duplicated curated type/relation arrays from `shared/workflow/runtime/actions/businessOperations/entityLinks.ts`; shared schema metadata now identifies the suggestion kind and the client owns localized display labels.

### F020 — project-task mirror reference workflows

- Added `ee/test-data/workflow-bundles/workflow-data-store-task-mirror.v1.json` with two workflow-bundle entries:
  - `reference.project-task-mirror-link-setup`: `PROJECT_TASK_CREATED` -> `projects.create_task` -> `links.upsert`, saving the created mirror task as `vars.createdMirrorTask` and using that same-run output to persist the source/target edge.
  - `reference.project-task-mirror-sync`: `PROJECT_TASK_UPDATED` -> `links.lookup` -> `control.forEach` over `vars.linkedTasks.matches` -> `projects.update_task`.
- Added `payload.ProjectTaskUpdated.v1` to the workflow payload schema registry via `projectTaskUpdatedEventPayloadSchema`; `PROJECT_TASK_UPDATED` already exists as a project task domain/webhook event, but workflow schemas previously exposed only created/status/assignment/completion task variants.
- Verification: JSON fixture parses; focused ESLint and `tsc --noEmit` checks passed for `shared/workflow/runtime/schemas/projectEventSchemas.ts` and `workflowEventPayloadSchemas.ts`.

### F021/F022 — model/action/designer/i18n test coverage

- Added DB-backed persistence model tests in `shared/workflow/runtime/actions/__tests__/workflowDataStoreModels.db.test.ts` covering KV CRUD/revision/CAS, atomic increment, TTL lazy expiry + `deleteExpired`, link idempotent upsert/N:M lookup/delete, and tenant isolation.
- Added DB-backed business-operation action tests in `shared/workflow/runtime/actions/__tests__/businessOperations.workflowDataStore.db.test.ts` covering `store.*` and `links.*` handlers, audit writes, oversize value rejection, permission denial, and action-provided idempotency key behavior.
- Added action registration/schema metadata tests in `shared/workflow/runtime/actions/__tests__/registerDataStoreActionsMetadata.test.ts`, designer catalog coverage in `shared/workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts`, and migration contract coverage in `shared/workflow/runtime/__tests__/workflowDataStoreMigration.test.ts`.
- Added runnable designer/i18n/reference workflow contracts:
  - `workflowDataStoreDesignerComponents.test.ts` asserts the soft-enum branch uses design-system `SearchableSelect` with custom values and no native `<select>`.
  - `workflowDataStoreEnumLocalization.test.ts` checks all workflow locales/pseudo-locales contain Data Store action/group/enum keys and that pseudo-locales do not fall back to English labels.
  - `workflowDataStoreReferenceWorkflows.test.ts` validates the link-setup and mirror workflow bundle plus payload schema refs.
- Test-discovered implementation fix: `WorkflowDataStoreModel.set` now JSON-encodes values before writing `jsonb`, so string values persist as valid JSON strings; `increment` now casts bound `initial`/`by` parameters before addition to avoid Postgres ambiguous-operator errors.
- Commands run:
  - `npx vitest run --config shared/vitest.config.ts workflow/runtime/actions/__tests__/registerDataStoreActionsMetadata.test.ts workflow/runtime/__tests__/workflowDataStoreMigration.test.ts workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts --reporter=dot`
  - `DB_PASSWORD_ADMIN=devpassword123 DB_PASSWORD_SERVER=devpassword123 npx vitest run --config shared/vitest.config.ts workflow/runtime/actions/__tests__/workflowDataStoreModels.db.test.ts workflow/runtime/actions/__tests__/businessOperations.workflowDataStore.db.test.ts --reporter=dot`
  - `npx vitest run --config shared/vitest.config.ts workflow/runtime/__tests__/workflowDataStoreEnumLocalization.test.ts workflow/runtime/__tests__/workflowDataStoreReferenceWorkflows.test.ts --reporter=dot`
  - `npx vitest run --config shared/vitest.config.ts workflow/runtime/__tests__/workflowDataStoreDesignerComponents.test.ts --reporter=dot`
  - `npx vitest run --config shared/vitest.config.ts workflow/runtime/actions/__tests__/registerDataStoreActionsMetadata.test.ts workflow/runtime/__tests__/workflowDataStoreMigration.test.ts workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts workflow/runtime/__tests__/workflowDataStoreEnumLocalization.test.ts workflow/runtime/__tests__/workflowDataStoreReferenceWorkflows.test.ts workflow/runtime/__tests__/workflowDataStoreDesignerComponents.test.ts --reporter=dot`
  - `node scripts/validate-translations.cjs` (passed; eight pre-existing Polish extra-key warnings remain outside workflow Data Store keys).
  - Focused ESLint on touched model/test files passed with warnings only (`no-explicit-any`/non-null assertions in test files).
- Gotcha: the EE server jsdom harness currently resolves `next-auth` -> `next/server` before a focused `InputMappingEditorStructuredLiterals.test.tsx` invocation can run, so the Data Store designer guard lives in the shared source-level component contract instead of adding a non-running render test to that EE file.

## 2026-06-05 audit remediation log

A full branch audit found three "finishing layer" gaps (core migration/models/actions verified correct). All three are now closed:

1. **i18n — real translations (was F018 PARTIAL).** The new Data Store keys had been inserted as English placeholders in the 7 shipping locales. Translated all keys (11 action label+desc pairs, palette group, 4 soft-enum strings, 7 entity types, 6 relations) in `fr/de/es/it/nl/pl/pt`, matching each file's existing conventions (keep "workflow" in fr/de/it/nl/pt, translate in es/pl; tenant → locataire/Mandant/inquilino/dzierżawca, kept in it/nl/pt). `xx/yy` pseudo-markers and `en` untouched. `validate-translations.cjs` still passes; `workflowDataStoreEnumLocalization.test.ts` green.

2. **Dynamic namespace suggestions (was a half-built designer feature).** The soft-enum metadata declared `suggestionActionIds`/`namespaceField` but nothing consumed them. Added server action `listWorkflowDataStoreNamespacesAction` (`ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`) — `withAuth` + `requireWorkflowPermission(read)`, returns the deduped sorted union of `WorkflowDataStoreModel.listNamespaces` + `WorkflowEntityLinkModel.listNamespaces` for the session tenant. Wired into `InputMappingEditor.tsx`: a module-level promise cache + a `useEffect` (fires only for the `workflow-data-store-namespace` soft-enum) loads the namespaces and merges them into the combobox options. Free-text + curated suggestions still work; the namespace combobox now also autocompletes from namespaces already used by the tenant.

3. **End-to-end engine integration test (was F022/T015 PARTIAL).** Added `shared/workflow/runtime/actions/__tests__/workflowEngineReferenceWorkflows.db.test.ts`: boots the real `WorkflowRuntimeV2` engine (NOT mocked `shared`), seeds tenant + actor + real `workflow:read`/`workflow:manage` RBAC, registers two definitions, runs link-setup (forEach upserts N links) then a SEPARATE mirror run (`links.lookup` → `control.forEach` over matches → `store.set`). Asserts N links, cross-run handoff producing one store row per matched target, the lookup envelope match count, and real audit rows. Plus a no-match no-op case. Uses store/link primitives in place of the heavyweight `projects.*` actions so the test stays hermetic while exercising identical engine mechanics (namespace/relation/entity-type identical to production). 2/2 pass against local Postgres in ~18s.

- Type-fix found during typecheck: the F017 soft-enum `<SearchableSelect options={options}>` typed `options` as `CustomSelect`'s `SelectOption` (label `string | JSX.Element`) which is not assignable to `SearchableSelect`'s `SelectOption` (label `string`). Re-typed the local array with `SearchableSelect`'s option type. `tsc -p ee/server` and `tsc -p ee/packages/workflows` now both report 0 errors.
- Updated `workflowDataStoreDesignerComponents.test.ts` import assertion from an exact-string match to a regex (the SearchableSelect import line gained a `type SelectOption` import).
- Verification: `tsc` clean (ee/server 0, ee/packages/workflows 0); `validate-translations.cjs` PASSED; full Data Store suite green (9 files / 42 tests incl. 3 DB suites) via `DB_PASSWORD_ADMIN=devpassword123 DB_PASSWORD_SERVER=devpassword123 npx vitest run --config shared/vitest.config.ts ...`.

## 2026-06-05 designer bug fix + normie UX pass

Surfaced while manually testing in the designer (screenshot showed `links.upsert`'s `right` field as a bare "string").

1. **`$ref` rendering bug (real, not stale code).** `left` and `right` shared one `entityRefSchema` instance, so `zodToJsonSchema` collapsed the second into `{$ref: …/left}`. The designer's field editor does not resolve `$ref`, so `right` rendered as an untyped "string". Fixed at the converter: `zodToWorkflowJsonSchema` (`shared/workflow/runtime/jsonSchemaMetadata.ts`) now passes `$refStrategy: 'none'` so every designer field schema is inlined — fixes any action with a reused field type, not just links. Regression test added in `registerDataStoreActionsMetadata.test.ts` (serialized `links.upsert` has no `$ref`; `from`/`to` are objects with `id`/`type`).

2. **Normie-friendly field names + help text (scope: labels + help only).** Renamed the author-facing link fields `left`→`from`, `right`→`to` (and lookup's `right_type`→`to_type`); the output `linkItemOutputSchema` now also uses `from`/`to`. The DB columns and the `WorkflowEntityLinkModel` API stay `left_*`/`right_*` — the handlers map `input.from`→model `left`, `input.to`→model `right`. Rewrote all `store.*`/`links.*` field descriptions in plain language (Collection / Record type / Record id / Relationship / etc.) and described `idempotency_key`, `if_revision`, `ttl_seconds`, `by`, `initial` as advanced/optional with guidance. No new "advanced" input-bucketing mechanism was added (none exists; that "Advanced Options" in the UI is step-level retry settings) — `idempotency_key` is flagged via its description instead.
   - Did NOT add a generic friendly-label (title) layer (the user declined that scope), so field labels show the schema key (`from`, `to`, `collection`-via-namespace, `relation`) — clear, just lowercase. Field *descriptions* remain English-only, consistent with every other action in the designer (per-field descriptions are not i18n'd anywhere yet); a separate effort if we want them localized.
   - Updated the reference bundle (`workflow-data-store-task-mirror.v1.json`), the e2e engine test, the bundle-shape test, the businessOps DB test, and the metadata tests to `from`/`to`.

- Verification: `tsc -p ee/packages/workflows` 0 errors; full Data Store suite green again (9 files / 43 tests). All changes are in `shared`/`ee/packages`/`ee/server` + locales, so the running dev server must be restarted to pick them up.
