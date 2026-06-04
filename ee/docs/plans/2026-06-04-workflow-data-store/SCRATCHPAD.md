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
