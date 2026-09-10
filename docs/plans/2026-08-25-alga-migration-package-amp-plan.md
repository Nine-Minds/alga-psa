# Alga Migration Package (AMP) — implementation plan

**Date:** 2026-08-25
**Branch:** `feature/alga-migration-package-amp`
**Status:** proposed
**Edition:** Community Edition. Spec, SDK, CLI, importer, connectors, and UI all ship in the open-source repo.

## Problem

AlgaPSA has no repeatable, inspectable way to bring an MSP's existing book of
business into a tenant. What exists today is an *asset* importer wearing generic
clothes:

- `import_sources`, `import_jobs`, `import_job_items`, `external_entity_mappings`
  (`server/migrations/20251102090000_create_import_framework_tables.cjs`) look
  domain-neutral, but `import_job_items.asset_id` and
  `external_entity_mappings.asset_id` are both foreign keys into `assets`. The
  row model cannot express a second entity type, let alone relationships
  between entity types.
- Preview is built from `assetFieldDefinitions.ts` and asset duplicate rules;
  `assetImportHandler` creates assets and nothing else.
- The three vendor importers that exist — `ConnectWiseRmmExportImporter`,
  `DattoRmmExportImporter`, `NableExportImporter` — are RMM *asset* exports, not
  PSA migrations.
- Every other import path in the product (tickets, accounting CSV, reference
  data, settings) reinvents its own parse/preview/duplicate/error/retry
  behaviour.

A migration is not a file upload. It is a multi-entity, dependency-ordered,
partially-failing, resumable operation over untrusted data that must never
duplicate records on a second run and must never cross a tenant boundary.

## Solution shape

Define a versioned interchange artifact — the **Alga Migration Package (AMP)**,
a single SQLite file — and one staged import engine in AlgaPSA that consumes it.

```text
CSV / XLSX ─────────────┐
Competitor export / API ├─> connector or converter ─> AMP package ─┐
AlgaPSA export ─────────┘                                          │
                                                                   v
                                                     validate → stage → dry run
                                                                   │
                                                                   v
                                                  tenant-safe domain appliers
                                                                   │
                                                                   v
                                              outcome ledger, reports, audit
```

The product is the *contract*, not the container. SQLite is a portable
relational file we read; it is never attached to Postgres, never executed, and
never trusted. Every source path — CSV, vendor connector, future Alga export —
becomes an AMP producer, so preflight, idempotency, retry, permissions, and
reporting are written once.

### What this deliberately is not

- Not a visual ETL builder or transformation language.
- Not SQL execution over an uploaded database, and no use of uploaded triggers,
  views, indexes, or `PRAGMA`s.
- Not a claim that a committed multi-entity migration can be rolled back. The
  safety model is preflight → dependency-ordered checkpoints → idempotent retry
  → outcome ledger.
- Not source-system-to-Alga-table direct connectors.
- Not a CE/EE split. Connector gating would defeat the point.

## Verified codebase facts

Checked against this worktree on 2026-08-25 — these drive plan decisions:

| Claim | Status |
| --- | --- |
| Import framework tables are asset-bound | **Confirmed.** `import_job_items.asset_id` → `assets`; `external_entity_mappings.asset_id` → `assets`, plus `uq_external_entity_unique_source` on `(tenant, import_source_id, external_id)`. |
| Tables are tenant-scoped with composite FKs and RLS | **Confirmed.** Composite `(tenant, id)` primary keys, composite foreign keys, RLS enabled per table. This is the pattern new tables must follow. |
| Permission resource `import_export` exists with `read`/`manage` | **Confirmed.** `server/migrations/20251102090500_add_import_permissions.cjs`; enforced in `server/src/lib/imports/importActions.ts:48`. |
| Source-file persistence already exists | **Confirmed.** `StorageService.validateFileUpload` / `uploadFile` / `createDocumentSystemEntry` / `downloadFile`, with `import_jobs.source_file_id` and `source_document_id`. |
| Background execution exists | **Confirmed.** `JobService` + pg-boss; handlers registered in `server/src/lib/jobs/index.ts`. |
| `packages/*` is a workspace root | **Confirmed.** ~60 packages already; new spec/SDK/CLI packages need no build-system work. |
| Domain tables for v1 | **Confirmed.** `clients`, `client_locations`, `contacts`, `tickets`, `comments`, `assets`, plus reference tables `boards`, `statuses`, `priorities`. Domain logic lives in `packages/clients` and `packages/tickets` (`actions/`, `models/`, `services/`). |
| Existing upload cap | `MAX_IMPORT_FILE_SIZE_BYTES = 100 MB` in `importActions.ts:28` — an asset-CSV number, not a migration number. |
| A SQLite reader is available | **Confirmed, no native dependency needed.** See below. |

### SQLite runtime — decided, no spike required

The brief listed "choose a SQLite runtime" as a Phase 0 feasibility spike. It is
already answered. Node's built-in `node:sqlite` is present and sufficient:

```
node v22.18.0 →  require('node:sqlite') OK  (DatabaseSync, StatementSync, backup)
new DatabaseSync(path, { readOnly: true, allowExtension: false })  →  opens
  writes rejected with ERR_SQLITE_ERROR
  parameterized SELECT over known tables works
```

No `better-sqlite3`, `sql.js`, or any other SQLite dependency exists in the repo
today, and none is needed — which removes a native-module build from every
container. Runtime coverage:

| Image | Base | `node:sqlite` |
| --- | --- | --- |
| `Dockerfile` (production) | `node:26.1.0-alpine` | yes |
| `Dockerfile.build` | `node:24-alpine` | yes |
| `Dockerfile.dev` | `node:alpine` | yes |
| `Dockerfile.test` | `node:20` | **no** — must move to `node:22`+ |

Two consequences, both in Phase 0:

1. `Dockerfile.test` moves to a Node 22+ base.
2. Root `package.json` `engines.node` tightens from `">=20 <25"` to `">=22 <27"`.

`node:sqlite` still emits an `ExperimentalWarning`. That is acceptable — it is a
warning, not a flag — but all package reading goes behind one narrow interface
(`AmpSqliteReader`) so the implementation can be swapped without touching the
validator, stager, or planner.

## Decisions

The brief's §13 questions, answered. These are the plan's premises.

**1. v1 entity scope.** Organizations, locations, contacts, tickets, ticket
comments, assets. No contracts, invoices, time entries, projects, or binary
attachments. This is the smallest dependency-complete slice that proves the
engine, and it is the slice every competitor export has.

**2. Write semantics.** Strictly create-only, except that a record with an
existing `migration_identity_mappings` row for the same
`(tenant, namespace, entity_type, source_record_id)` is skipped as
already-applied. No fuzzy matching on name or email, ever. Update-by-source-key
is a v2 feature with a per-entity merge policy.

**3. Limits and retention.** Enforced by the validator and configurable per
deployment, with these defaults:

| Limit | Default |
| --- | --- |
| Package file size | 250 MB |
| Rows per entity table | 500,000 |
| Rows per package (all entity tables) | 2,000,000 |
| Text field length | 64 KiB |
| `extension_json` size / nesting depth | 16 KiB / depth 8 |
| Attachments | not supported in v1 |
| Source package retention | 30 days after terminal state |
| Report retention | 90 days |

Package upload does **not** inherit the 100 MB asset cap; it gets its own
constant and its own streamed write to storage.

**4. Tenant reference data at preflight.** Required, operator-supplied, never
guessed:

- tickets → target board, status mapping (source status name → `statuses` row),
  priority mapping (→ `priorities` row), default requester client for tickets
  whose organization cannot be resolved, and an optional default assignee
  (absent means unassigned).
- assets → asset type mapping.
- all entities → default client for orphaned children.

Safe to auto-create on apply: locations under a resolved organization, contacts
under a resolved organization, and tags. Never auto-created: boards, statuses,
priorities, asset types, users, or anything that changes tenant-wide taxonomy.

**5. SQLite reader.** Built-in `node:sqlite`, read-only, extensions disabled, as
decided above.

**6. Export.** Compatibility is defined now — the spec is written so an Alga
export is a conforming producer — but export ships in Phase 5, after the import
engine has proven itself. Building both ends at once would let the format be
quietly shaped by our own schema instead of by the interchange contract.

**7. Vocabulary.** The package says `organizations`; Alga maps them to `clients`.
"Client" in Alga also names the client-portal audience, and every source system
calls these accounts/companies/organizations. Keeping the neutral term in the
interchange format and doing the rename in one documented mapping step is
clearer than propagating Alga's internal noun into a third-party contract.

## Architecture

### Package layout

```text
packages/
  migration-spec/        AMP types, canonical schema SQL, JSON Schema, compat rules
  migration-sdk/         builder/reader, validator, conformance helpers
  migration-cli/         alga-migrate executable
  migration-connectors/  shared helpers + built-in connectors (csv/, ...)
server/src/
  lib/migrations/        reader, validator, stager, planner, appliers, ledger, reports
  app/api/migrations/    authenticated UI/CLI endpoints
  components/settings/migrations/   Imports & Exports workspace
```

Stays in the monorepo until the interfaces stabilise. Connector authors depend
on `migration-spec` / `migration-sdk` only — never on `server/src/lib/imports`,
Knex schemas, or server actions.

### Server modules

```text
MigrationPackageReader     open + structurally validate an uploaded AMP
MigrationPackageValidator  spec/version/value/relationship validation
MigrationStager            copy allowlisted package rows into Postgres staging
MigrationPlanner           resolve target mappings, produce the dry-run plan
MigrationDomainApplier     per-entity application in dependency order
MigrationLedger            idempotency, per-record outcome, retry ownership
MigrationReportService     UI/API reports and downloadable outcome files
MigrationJobHandler        async orchestration and cancellation checkpoints
```

Appliers (`OrganizationMigrationApplier`, `LocationMigrationApplier`,
`ContactMigrationApplier`, `TicketMigrationApplier`,
`TicketCommentMigrationApplier`, `AssetMigrationApplier`) call the existing
domain services in `packages/clients` and `packages/tickets` wherever those
services can be driven without an interactive session, so business invariants
are not re-implemented in migration code. Where a domain service is
irreducibly request-scoped, the plan records that and the applier writes through
the model layer with the same validation.

### Database model

New `migration_*` tables. The asset framework's tables stay exactly as they are
and keep serving legacy asset imports through the transition; overloading
`import_job_items` to carry six entity types would produce a nullable-FK-per-
entity table that expresses nothing.

| Table | Responsibility |
| --- | --- |
| `migration_jobs` | tenant, owner, source file/document IDs, package id + sha256 + format version, producer, state, run options, timestamps, planned/applied metrics |
| `migration_job_entities` | per job × entity type: phase, planned/applied/skipped/failed counters — the source of truthful progress |
| `migration_staged_records` | normalized allowlisted rows: entity type, package record id, source keys, payload JSONB, source timestamps, validation state |
| `migration_record_outcomes` | append-only ledger: staged record, attempt, action, target entity type + id, errors/warnings, timestamp |
| `migration_identity_mappings` | `(tenant, namespace, entity_type, source_record_id) → alga entity id` — the idempotency anchor, uniquely indexed |
| `migration_mapping_profiles` | saved CSV/source→canonical mappings, scoped to entity type and source signature |
| `migration_reports` | generated report metadata and storage reference |

Every table follows the verified house pattern: `tenant` first, composite
`(tenant, <id>)` primary key, composite tenant-aware foreign keys, RLS enabled,
Citus-compatible (`tenant` as the distribution column, no cross-tenant joins).

The uploaded package is immutable. Staging records which package hash and
importer version produced it, so a retry reads Postgres staging — not the file —
and is deterministic even if object storage is briefly unavailable.

### Lifecycle

```text
uploaded → inspecting → needs_configuration | rejected
                     → preflighting → ready | blocked
                     → queued → applying
                     → completed | completed_with_errors | failed | cancelled
```

`rejected` = unsafe/corrupt/unsupported; nothing staged, nothing applied.
`blocked` = valid package, unresolved mapping or data errors; the operator
amends configuration and preflights again. `ready` = an immutable plan saved
with its mapping/configuration version. `completed_with_errors` is reachable
only for records the operator marked non-blocking, and the final report makes
every omission visible.

Preflight re-runs immediately before apply if the plan has aged past a threshold
or if relevant tenant reference data changed, so a stale plan never gets applied
against a moved target.

### Apply order and atomicity

Bounded transactions per entity batch, in dependency order:

1. reference resolution + organizations
2. locations
3. contacts
4. tickets
5. ticket comments
6. assets

Each batch writes the target mutation, its `migration_record_outcomes` rows, and
its `migration_identity_mappings` rows **in the same transaction**. That single
invariant is the retry contract. No transaction is ever held across the package.

## Security posture

An AMP is untrusted input even when Alga tooling produced it.

- Verify extension and SQLite file header, then open read-only in a sandboxed
  temp location with `allowExtension: false`. The uploaded file is never
  modified.
- Only parameterized `SELECT`s over an allowlisted table set with an allowlisted
  column set, after an exact schema and format-version check. Never execute
  package-supplied SQL, views, triggers, functions, or `PRAGMA`s. `sqlite_master`
  is read for schema *verification* only, never executed.
- Enforce the size, row-count, string-length, and JSON-depth limits above, plus
  a bounded extraction time/row budget.
- Stream and batch. A migration package is never buffered whole in a Next.js
  request; upload streams to storage and extraction reads in cursored batches.
- Store the package only through the existing tenant-aware
  StorageService/document path; authorize every download by tenant **and**
  `import_export:manage`.
- Treat manifest fields, source names, and error text as untrusted display data:
  escape in the UI, redact secrets from reports and logs.
- Record package hash, producer + version, source system, actor, configuration,
  and the full outcome ledger for audit.

Permissions extend the existing resource rather than inventing one:
`import_export:read` lists jobs and reads sanitized reports;
`import_export:manage` uploads, configures, preflights, executes, cancels, and
downloads source/result artifacts. Being able to read clients does not entitle
someone to download a package — a package routinely contains more than its
uploader can otherwise see.

## AMP format v1.0.0

Allowlisted tables: `amp_manifest`, `organizations`, `locations`, `contacts`,
`tickets`, `ticket_comments`, `assets`, `external_identifiers`,
`custom_field_values`, `package_diagnostics`.

`amp_manifest` holds exactly one row: `format_version`, `package_id`,
`created_at`, `producer_name`, `producer_version`, `source_system`,
`source_instance_id`, `export_started_at`, `export_completed_at`,
`content_sha256`, `capabilities_json`.

`content_sha256` is defined over a canonical serialization of every allowlisted
entity table — ordered by table name then `package_record_id`, values normalized
— explicitly excluding the manifest row itself, so the hash is never
self-referential.

Every entity table carries `package_record_id` (PK within the package),
`source_record_id` (opaque source key), `external_identifier_namespace`
(source system + instance), source `created_at`/`updated_at`, and a bounded
`extension_json` for preserved non-canonical source data that Alga never
interprets automatically.

Value rules: IDs are UUIDs or bounded opaque strings and are never Alga database
IDs. Timestamps are RFC 3339 UTC; dates are `YYYY-MM-DD`; money is integer minor
units plus an ISO 4217 code. No locale-dependent numbers or dates anywhere.

Tickets carry portable business facts — title, description, source dates, status
*name* and category, priority *name*, requester/organization/location references
— and never Alga board IDs, user IDs, or workflow IDs. Those are resolved from
operator-supplied preflight configuration.

Relationships use `package_record_id` references. The spec permits SQLite
foreign keys, but Alga re-validates every relationship itself and never relies
on producer-side constraints. `package_diagnostics` carries producer warnings
and is displayed but never treated as validation.

Compatibility: additive changes (optional columns/tables) are minor; any
breaking semantic change is a major version. The server accepts a documented
range of format versions and says exactly why when it does not.

## Phased delivery

Each phase is independently reviewable and leaves the product working.

### Phase 0 — foundations and decision record

- Write `docs/architecture/amp-decision-record.md` capturing the decisions above:
  SQLite runtime, limits, v1 entities, source-key/idempotency rule, vocabulary
  mapping.
- Move `Dockerfile.test` to a Node 22+ base; tighten root `engines.node` to
  `">=22 <27"`; confirm CI runners.
- Map the six v1 canonical entities to concrete call sites in `packages/clients`
  and `packages/tickets`, and record which domain services are usable
  non-interactively and which invariants must be re-expressed in an applier.
- Decide and document the Citus distribution column and index set for the
  `migration_*` tables before any migration file is written.

*Exit:* decision record committed; test image on Node 22+; an entity→service map
exists with named functions.

### Phase 1 — public contract and package tooling

- `packages/migration-spec`: canonical schema SQL, TypeScript types, JSON Schema
  for value/semantic validation, compatibility matrix, error codes.
- `packages/migration-sdk`: package builder/writer, typed reader, structural +
  semantic validator, conformance helpers, diagnostics types.
- `packages/migration-cli`: `alga-migrate validate | inspect | csv | package check`.
  No database access, no ability to mutate a tenant.
- One sample package per entity group, plus conformance fixtures.
- `docs/reference/amp/` — spec, data dictionary, mapping guidance, source-key
  rules, security boundaries, exit codes.

*Exit:* a package generated independently of server code validates with the CLI
and is readable by a server-side reader test.

### Phase 2 — staging, planning, and the workspace shell

- `migration_*` tables with composite tenant keys, RLS, Citus-ready indexes.
- Upload API with streamed storage write, package-specific size cap, permission
  checks, hash + manifest capture.
- `MigrationPackageReader` / `Validator` / `Stager` with the full allowlist and
  limit enforcement; `MigrationPlanner` producing a dry-run plan for all six
  entities.
- Rename the settings route from **Asset Import/Export** to **Imports &
  Exports** at the existing `/msp/settings/import-export` path; add imports
  home, source selection, package inspection, configuration, and preflight
  report screens. Downloadable CSV/JSON preflight report. No **Run** while
  blocking errors remain.

*Exit:* a valid package uploads and dry-runs; invalid relationships and values
are reported per entity and field; **zero** Alga entities are created by any
path in this phase.

### Phase 3 — the reliable application path

- `MigrationJobHandler` registered with `JobService`/pg-boss; dependency-ordered
  phases; per-batch transactions binding mutation + outcome + identity mapping.
- `MigrationLedger` idempotency; cancellation checkpoints; resume-from-checkpoint;
  retry that re-applies only unapplied work from staging under the same import
  key.
- The six appliers, create-only.
- Preflight staleness re-check before apply; target-side conflict detection.
- Execution and results UI: per-phase per-entity progress (never a single
  fictional percentage), final counters, drill-down to created records,
  downloadable outcome report.

*Exit:* re-running the same package creates no duplicates; a worker killed
mid-apply resumes without double-writing; a cross-tenant package reference is
rejected; cancellation stops at a checkpoint with a truthful ledger.

### Phase 4 — CSV/XLSX as an AMP producer

- CSV/XLSX → AMP converter (`producer_name = alga-csv-adapter`) using the
  `papaparse` / `exceljs` dependencies already present, preserving source row
  numbers and headers in bounded diagnostics.
- Mapping profiles persisted per entity type and source signature — not global
  header guesses.
- Move the existing asset CSV/XLSX flow behind the AMP pipeline while preserving
  its user-facing behaviour; keep the legacy asset tables intact for history.
- Migrate other domain import dialogs only after each one's domain mapping is
  specified. Nothing is deleted before equivalent behaviour exists in the
  workspace.

*Exit:* the same logical CSV that worked before now travels the AMP path and
produces a standard preflight and outcome report.

### Phase 5 — connectors, export, attachments

- First community connectors under `packages/migration-connectors`, each
  declaring name, version, supported AMP version, source-system versions, entity
  coverage, known omissions, and licensing/API prerequisites; each passing the
  shared conformance suite with anonymized fixtures.
- Alga → AMP export for the v1 entities.
- Attachment archive form (AMP ZIP: `data.sqlite` + `attachments/`) only after
  lifecycle, retention, and security requirements are agreed.

## Testing

Behavioural tests throughout; no source-text assertions.

- **SDK/CLI:** valid and invalid fixtures; version compatibility; rejection of
  unknown tables, oversized packages, bad values; diagnostic accuracy.
- **Server integration:** tenant isolation; staging fidelity; preflight error
  surfacing; dependency-ordered apply; idempotent re-run; partial failure and
  retry; permission enforcement; source-file download authorization; report
  contents.
- **Worker integration:** cancellation at checkpoints; injected mid-phase
  failure and recovery.
- **Security:** a package containing triggers, views, an attached-extension
  attempt, a giant string, a deeply nested `extension_json`, and a cross-tenant
  ID must each be rejected with the documented error code — one test per attack.
- **UI:** upload → blocking preflight → configure → ready → progress →
  completed report.
- **Connector conformance:** each connector fixture produces a package that
  passes the shared validator with the expected canonical records and
  relationships.

## Risks

- **`node:sqlite` is experimental.** Mitigated by the `AmpSqliteReader` seam and
  by using only `DatabaseSync` + `StatementSync` with parameterized selects.
- **Domain services may not be callable outside a request context.** Phase 0
  surfaces this before appliers are written, not during Phase 3.
- **Scope creep into ETL.** The mapping UI exists only for the CSV adapter.
  Canonical packages get no mapping UI, by design.
- **Two import systems coexisting.** Accepted and time-boxed: legacy asset
  import stays until Phase 4 moves it, then its tables persist read-only for
  history.

## Explicitly out of scope for this branch

Contracts, invoices, time entries, projects, binary attachments, update-by-
source-key merges, Alga export, and any vendor connector beyond the CSV adapter.
Phase 5 is scoped here so the contract accommodates it; it is not built here.

## First step

Phase 0. Do not start with a connector — the public contract, the staging and
ledger model, and the preflight path are the reusable foundation that makes
every later connector cheap and trustworthy.
