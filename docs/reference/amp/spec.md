# AMP format v1.0.0

## Container

An AMP is one SQLite database file. Consumers open it read-only with
extensions disabled and read it with parameterized SELECTs over the
allowlisted tables below. Anything else in the file — other tables, triggers,
views, indexes beyond primary keys — makes the package invalid. SQLite-internal
`sqlite_*` tables are ignored.

## Tables

Allowlisted tables, and only these:

- `amp_manifest` — exactly one row of package metadata
- Entity tables: `organizations`, `locations`, `contacts`, `tickets`,
  `ticket_comments`, `assets`
- Auxiliary tables: `external_identifiers`, `custom_field_values`,
  `package_diagnostics`

Each table's exact column set is normative and defined in
`@alga-psa/migration-spec` (`AMP_TABLE_COLUMNS`) and listed in the
[data dictionary](data-dictionary.md). A present table with a missing or extra
column is a schema mismatch.

## Manifest

`amp_manifest` holds exactly one row:

| Field | Required | Meaning |
| --- | --- | --- |
| `format_version` | yes | Semantic version of the AMP format, e.g. `1.0.0` |
| `package_id` | yes | Producer-chosen opaque identifier for this package |
| `created_at` | yes | RFC 3339 UTC creation time |
| `producer_name` / `producer_version` | yes | Tool that produced the package |
| `source_system` | yes | Human-readable source system name |
| `source_instance_id` | no | Distinguishes multiple instances of the same source |
| `export_started_at` / `export_completed_at` | no | Export window in RFC 3339 UTC |
| `content_sha256` | yes | Canonical content hash (below) |
| `capabilities_json` | no | Bounded JSON describing producer capabilities |

## Value rules

- **Identifiers** (`package_record_id`, `source_record_id`,
  `external_identifier_namespace`, `package_id`) are UUIDs or opaque strings of
  at most 256 bytes. They are never Alga database IDs.
- **Timestamps** are RFC 3339 UTC with a trailing `Z`
  (`2026-01-31T12:00:00Z`). **Dates** are `YYYY-MM-DD`. No locale-dependent
  formats anywhere.
- **Money**, when a future version introduces it, is integer minor units plus
  an ISO 4217 currency code. v1 has no money fields.
- **Text** values are UTF-8 and at most 64 KiB.
- **`extension_json`** is a JSON string of at most 16 KiB and nesting depth at
  most 8. It preserves non-canonical source data; Alga stores it but never
  interprets it automatically.
- Booleans are SQLite integers `0`/`1` (`ticket_comments.is_internal`).

Tickets carry portable business facts: title, description, source dates,
status *name*, priority *name*, category *name*, and references to requester,
organization, and location. They never carry Alga board IDs, user IDs, or
workflow IDs — those are resolved from operator-supplied configuration at
preflight.

## Relationships

References between records use `package_record_id` values and are typed by
column (for example `ticket_comments.ticket_package_record_id` must resolve in
`tickets`). Producers may declare SQLite foreign keys, but consumers
re-validate every relationship and never rely on producer-side constraints.
`package_record_id` must be unique within its table.

Required relationships in v1: `locations.organization_package_record_id` and
`ticket_comments.ticket_package_record_id`. All other reference columns are
optional and may be null; consumers decide at preflight how to place orphaned
records (see [mapping.md](mapping.md)).

## Canonical content hash

`content_sha256` is the SHA-256 hex digest of a canonical serialization of the
six entity tables — the manifest and auxiliary tables are excluded so the hash
is never self-referential:

1. Process entity tables in ascending table-name order.
2. Within a table, process rows in ascending `package_record_id` order
   (code-point comparison).
3. Serialize each row as JSON with keys sorted ascending and null values
   omitted.
4. Prefix each serialized row with `<table>:` and join all rows with `\n`.
5. Hash the UTF-8 bytes of the joined string.

## Diagnostics

`package_diagnostics` carries producer warnings (severity `info` or
`warning`) — for example rows the producer skipped or fields it truncated.
Consumers display diagnostics but never treat them as validation.

## Compatibility

Additive changes — new optional columns or tables — increment the minor
version. Any breaking semantic change increments the major version. A consumer
accepts packages whose major version it implements and whose minor version is
not newer than it understands, and reports the precise reason when it refuses
a version. This implementation accepts `1.0.x`.

## Validation errors

Every rejection carries a stable code from `AMP_ERROR_CODES`
(`@alga-psa/migration-spec`): `AMP_FILE_NOT_FOUND`, `AMP_NOT_SQLITE`,
`AMP_UNKNOWN_TABLE`, `AMP_SCHEMA_MISMATCH`, `AMP_FORBIDDEN_SQLITE_OBJECT`,
`AMP_EXTENSION_FORBIDDEN`, `AMP_INVALID_MANIFEST`, `AMP_UNSUPPORTED_VERSION`,
`AMP_LIMIT_EXCEEDED`, `AMP_INVALID_VALUE`, `AMP_DUPLICATE_RECORD_ID`,
`AMP_INVALID_REFERENCE`, `AMP_HASH_MISMATCH`, `AMP_CROSS_TENANT_REFERENCE`.
