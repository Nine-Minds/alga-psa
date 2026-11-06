# AMP security boundaries

An AMP is untrusted input even when Alga tooling produced it.

## Consumer obligations

- Verify ZIP paths, entry counts, declared and expanded sizes, and digests before
  extracting only to a private temporary directory. Verify the SQLite file
  header in `data.sqlite`; open it read-only with
  extensions disabled (`node:sqlite` `readOnly: true, allowExtension: false`),
  from a sandboxed temporary location. Never modify the uploaded file.
- Execute only parameterized SELECTs over the allowlisted tables and columns,
  after an exact schema and format-version check. Never execute
  package-supplied SQL, views, triggers, functions, or `PRAGMA`s.
  `sqlite_master` is read for schema verification only.
- Reject any trigger or view outright (`AMP_FORBIDDEN_SQLITE_OBJECT`); reject
  unknown tables (`AMP_UNKNOWN_TABLE`) and deviant column sets
  (`AMP_SCHEMA_MISMATCH`).
- Stream and batch: never buffer a whole package in a request; read rows in
  cursored batches.
- Treat manifest fields, source names, and error text as untrusted display
  data — escape in UIs, redact secrets from reports and logs.

## Limits

Enforced by the validator with these defaults (`AMP_LIMITS`); deployments may
configure them:

| Limit | Default |
| --- | --- |
| Compressed package size | 1 GiB |
| Expanded package size | 1 GiB |
| Attachment size | 100 MiB |
| ZIP entry count | 50,000 |
| Rows per entity table | 500,000 |
| Rows per package (all entity tables) | 2,000,000 |
| Text value length | 64 KiB |
| `extension_json` / `value_json` size and depth | 16 KiB, depth 8 |
| Opaque identifier length | 256 bytes |
| Attachments | SHA-256 validated and associated through the `attachments` table |

## Server-side posture (AlgaPSA)

- Packages upload through the tenant-aware storage path with a streamed
  write and a package-specific size cap — not the legacy asset-CSV cap.
- Downloads are authorized by tenant **and** `import_export:manage`; a package
  routinely contains more than its uploader can otherwise see, so read access
  to clients does not entitle anyone to the file.
- Every job records package hash, producer and version, source system, actor,
  configuration, and a full outcome ledger for audit.
- Records referencing another tenant's data are rejected with
  `AMP_CROSS_TENANT_REFERENCE`; staging, planning, and application are
  tenant-scoped end to end.
- Source packages are retained 30 days after a terminal job state; reports 90
  days.
- Customer workspace exports are authorized against the active session tenant,
  co-managed capability, relationship and customer-admin permission before
  records are read. The exporter creates its package in private OS temporary
  storage and removes it on success or failure. Abandoned SDK staging folders
  are removed after 24 hours by an hourly sweep.
- The customer export response is not persisted in object storage: it is
  generated for that download, then its temporary package is deleted before
  response streaming begins. An interrupted download leaves no server-side
  package to resume; the customer starts a new export. Response buffers are
  released when the request is disposed.

## What safety does not mean

A committed multi-entity migration cannot be rolled back. The safety model is
preflight validation → dependency-ordered checkpoints → idempotent retry →
a truthful outcome ledger. Operators verify with a dry run before applying.

## Workspace lifecycle

AMP packages contain sensitive workspace data and file contents. Serve exports only over the authenticated
customer-admin route, with `no-store, private` and `nosniff`. The package itself has no passphrase wrapper;
use encrypted storage and encrypted transport when moving it between operators or consumers.
The credential vault is excluded, not serialized in cleartext or as a legacy vault envelope.

The exporter stages bytes in process-owned mode-0700 directories and mode-0600 files. It deletes its
package and captured files after the response buffer is prepared, including on failure; an interrupted
download leaves no reusable server-side package. An hourly sweep removes abandoned directories older
than 24 hours (at most one sweep interval after expiration). Filesystem cleanup failures are contained;
subsequent sweeps retry. The caller must close SDK readers to release their temporary files promptly.

Import verifies every attachment's size, digest and ownership before staging any records. Verified bytes
are staged transactionally in `migration_staged_attachments`, under the migration job and target tenant.
Native file writes use the shared storage upload-session journal: a failed write/transaction is recovered
without deleting another import's bytes. File metadata and the identity mapping commit together.
Successful imports delete their staged bytes immediately. Failed imports retain verified bytes for
30 days; the existing file-upload recovery maintenance job prunes expired AMP staging per tenant.
Deleting the migration job also cascades to its staging. Retry after expiry restages the original AMP
package. Native files and identity mappings survive staging cleanup. Reports follow migration-job retention.

Full workspace admission requires database-owner authority, a fresh UUID distinct from the source,
and all four safety policies. An existing tenant is accepted only to resume the exact package hash
already admitted by this service. The kill switch rejects installation imports before reading packages
or creating tenants. Browser exports retain the same capability and tenant-local admin checks.

Fresh import targets use the native tenant dispatch suspension (`suspended_at`, reason
`amp_workspace_review`) from creation onward. Job dispatch and tenant maintenance exclude them;
storage recovery/retention remains enabled as housekeeping. Completion does not release this gate.
After reviewing records, users, workflows and new connections, an installation operator can release
this specific suspension through the existing `resumeTenant` mechanism. No import command activates
users or clears another suspension reason.
