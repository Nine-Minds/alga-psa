# Alga Migration Package decisions

## Package reader

AMP v1 reads SQLite with Node's built-in `node:sqlite` `DatabaseSync` API. The reader opens the uploaded file from a sandboxed temporary location with `readOnly: true` and `allowExtension: false`. It uses parameterized `SELECT` queries against an allowlisted table and column set after checking the exact schema and supported format version. The file is never attached to Postgres, executed, or modified.

This keeps untrusted package content inside a narrow reader boundary. Uploaded SQL, triggers, views, indexes, functions, and `PRAGMA`s are not executed. `sqlite_master` is read only to verify the schema. The reader also enforces the plan's package limits: 250 MB, 500,000 rows per entity, 2,000,000 rows total, 64 KiB text values, and bounded extension JSON.

`better-sqlite3` was rejected because it adds a native module build to every container without adding a needed AMP capability. `sql.js` and other JavaScript/WASM readers were rejected because Node already provides the required local, read-only SQLite interface. `node:sqlite` still produces an experimental warning, so AMP keeps it behind an `AmpSqliteReader` seam. The test image uses Node 22, and the root runtime range is `>=22 <27`.

## v1 contract and access

AMP v1 accepts these canonical entities, in apply order: organizations, locations, contacts, tickets, ticket comments, and assets. An organization is the neutral package name for an Alga client.

Application is create-only. Before a record is applied, AMP checks `migration_identity_mappings` for the same `(tenant, namespace, entity_type, source_record_id)`. A match is skipped as already applied. AMP never fuzzy matches names or email addresses, and it does not update a target by source key in v1.

AMP extends the existing `import_export` permission resource. `read` lists jobs and reads sanitized reports. `manage` uploads packages, configures and preflights jobs, executes or cancels jobs, and downloads source or result artifacts.

## Migration ledger boundary

The future `migration_*` tables are a separate staging and ledger model. They are not an extension of `import_job_items` or `external_entity_mappings`. Those legacy tables both have asset foreign keys, so their row model cannot represent AMP's six entity types or their relationships.

The legacy asset-import implementation remains in place through the transition. AMP retains its useful patterns: tenant-aware StorageService persistence, pg-boss job wiring, import/export permissions, preview and reporting concepts. It does not reuse its asset-bound storage model or jobs as AMP storage.

## Entity application map

An applier runs as a worker with an explicit tenant, transaction, and migration actor. Server actions wrapped with `withAuth` assume an interactive session and must not be called from that worker. When a suitable model API is available, the applier calls it. Otherwise it must re-express the listed model-layer invariants in a transaction-scoped Phase 3 API.

| AMP entity | Existing creation path | Worker assessment and Phase 3 boundary |
| --- | --- | --- |
| Organizations | `packages/clients/src/actions/clientActions.ts` → `createClient` | Session-bound: `withAuth`, MSP permission checks, tenant knex creation, tax/default billing-profile provisioning, and workflow publication use the request user. There is no equivalent transaction-scoped client model create API. The organization applier must introduce or use a model-layer operation that preserves structural validation, default billing profile/contract provisioning, and post-commit events with an explicit migration actor. |
| Locations | `packages/clients/src/models/clientLocation.ts` → `createLocation(trx, tenant, clientId, data)`; interactive wrapper: `packages/clients/src/actions/clientLocationActions.ts` → `createClientLocation` | Usable non-interactively. `createLocation` takes an explicit transaction and tenant, locks the client, requires an active default location, and preserves the one-default-location invariant. Do not call the `withAuth` action. |
| Contacts | `shared/models/contactModel.ts` → `ContactModel.createContact(input, tenant, trx)`; interactive wrapper: `packages/clients/src/actions/contact-actions/contactActions.tsx` → `addContact` | Usable non-interactively at the model layer. The action is session-bound for permission checks and workflow publication; the applier must authorize before dispatch and preserve required post-commit event behavior with its migration actor. |
| Tickets | `shared/models/ticketModel.ts` → `TicketModel.createTicket` or `createTicketWithRetry`; existing import caller: `packages/tickets/src/actions/ticketImportActions.ts` | Usable non-interactively at the model layer. The action-level paths in `ticketActions.ts` and `ticketImportActions.ts` are `withAuth` and use a request user. AMP passes its preflight-resolved board, status, priority, requester/client, location, and optional assignee explicitly, and retains the model's board/status, reference, billing-profile, numbering, and business-rule validation. |
| Ticket comments | `shared/models/ticketModel.ts` → `TicketModel.createComment`; existing sessionless-style caller: `packages/tickets/src/actions/inboundActions.ts` | Usable non-interactively at the model layer. `packages/tickets/src/actions/comment-actions/commentActions.ts` is session-bound and derives author type and client-portal authorization from the request user. AMP must pass an explicit migration/system author policy and preserve ticket/contact ownership, thread, visibility, validation, and post-commit event invariants. |
| Assets | `packages/assets/src/actions/assetActions.ts` → `createAssetRecord(knex, tenant, actorUserId, data)`; interactive wrapper: `createAsset` | The `createAsset` action is session-bound. `createAssetRecord` is intentionally sessionless and accepts an actor, but it opens and commits its own transaction. It validates asset type/custom attributes, resolves the client location, writes asset history, and publishes workflow events. Phase 3 needs a transaction-scoped variant or a model-layer extraction so the asset mutation, AMP outcome, and identity mapping commit atomically. |

## Future Citus schema design

Every future `migration_*` table is tenant-scoped and distributed by `tenant`, colocated with `tenants`. This matches `server/migrations/utils/citusDistribution.cjs` and the existing composite-key/RLS pattern. Each table starts with `tenant` and uses `(tenant, <table-id>)` as its primary key. All internal references use composite `(tenant, foreign-id)` foreign keys. RLS uses the standard tenant policy. A future migration will use `ensureTenantDistribution(knex, table)` and set `exports.config = { transaction: false }`; no migration is part of this decision record.

The initial index set is:

| Table | Primary/unique constraint | Supporting indexes |
| --- | --- | --- |
| `migration_jobs` | `(tenant, migration_job_id)` | `(tenant, state, created_at DESC)`, `(tenant, owner_user_id, created_at DESC)`, `(tenant, package_sha256)`, `(tenant, source_file_id)` |
| `migration_job_entities` | `(tenant, migration_job_entity_id)`; unique `(tenant, migration_job_id, entity_type)` | `(tenant, migration_job_id, phase)` |
| `migration_staged_records` | `(tenant, migration_staged_record_id)`; unique `(tenant, migration_job_id, entity_type, package_record_id)` | `(tenant, migration_job_id, entity_type, validation_state, package_record_id)`, `(tenant, migration_job_id, source_record_id)` |
| `migration_record_outcomes` | `(tenant, migration_record_outcome_id)`; unique `(tenant, migration_staged_record_id, attempt)` | `(tenant, migration_staged_record_id, created_at)`, `(tenant, migration_job_id, action, created_at)` if `migration_job_id` is denormalized for reporting |
| `migration_identity_mappings` | `(tenant, migration_identity_mapping_id)`; unique `(tenant, namespace, entity_type, source_record_id)` | `(tenant, target_entity_type, target_entity_id)` |
| `migration_mapping_profiles` | `(tenant, migration_mapping_profile_id)`; unique `(tenant, entity_type, source_signature, name)` | `(tenant, entity_type, source_signature, updated_at DESC)` |
| `migration_reports` | `(tenant, migration_report_id)`; unique `(tenant, migration_job_id, report_type)` | `(tenant, migration_job_id, created_at DESC)` |

These keys keep tenant equality in every join, allowing Citus to route job, staging, ledger, and identity work to one colocated shard. The final migration must verify actual column names against Phase 1/2 types before creating the indexes; this record intentionally specifies no DDL.
