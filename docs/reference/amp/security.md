# AMP security boundaries

An AMP is untrusted input even when Alga tooling produced it.

## Consumer obligations

- Verify the SQLite file header before opening; open read-only with
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
| Package file size | 250 MB |
| Rows per entity table | 500,000 |
| Rows per package (all entity tables) | 2,000,000 |
| Text value length | 64 KiB |
| `extension_json` / `value_json` size and depth | 16 KiB, depth 8 |
| Opaque identifier length | 256 bytes |
| Attachments | not supported in v1 |

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

## What safety does not mean

A committed multi-entity migration cannot be rolled back. The safety model is
preflight validation → dependency-ordered checkpoints → idempotent retry →
a truthful outcome ledger. Operators verify with a dry run before applying.
