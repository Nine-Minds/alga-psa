# AMP format v2.0.0

## Container

An AMP package is a ZIP archive with `data.sqlite` and zero or more binary
entries at `attachments/<first-two-lowercase-hex>/<lowercase-sha256>`. Entry
paths are derived only from validated digests. ZIP names are unique, UTF-8,
case-sensitive and use `/`. Directories, links, encryption, traversal,
duplicate names and unlisted entries are invalid. Consumers open `data.sqlite`
read-only with SQLite extensions disabled and use parameterized SELECTs over
the tables below.

Limits count expanded bytes, not compression savings: 100 MiB per attachment,
1 GiB for all expanded entries, and 50,000 ZIP entries including
`data.sqlite`. The compressed archive is also limited to 1 GiB. Consumers
check declared sizes, enforce a running expanded-byte total, and verify actual
sizes and digests before writing content to disk.

## Tables

Only `amp_manifest`, the entity tables `organizations`, `locations`,
`contacts`, `tickets`, `ticket_comments`, `assets`, `products`,
`vendor_products`, and auxiliary tables `external_identifiers`,
`custom_field_values`, `package_diagnostics`, `attachments`, and `exclusions`
are allowed. Exact columns are defined by `@alga-psa/migration-spec` and the
[data dictionary](data-dictionary.md). Any other table, trigger, view, or
unexpected column is invalid.

## Manifest

`amp_manifest` has exactly one row. Required values include format version
`2.0.0`, package id, UTC creation time, producer name/version, source system,
`content_sha256`, and `attachments_sha256`. Content hashes entity rows using
the canonical ordering rules below. The attachment hash is SHA-256 of UTF-8
lines for unique content digests sorted by byte order, each line exactly
`<lowercase-sha256>\t<expanded-size>\n`.

## Values and relationships

Identifiers are opaque strings up to 256 UTF-8 bytes and are never Alga
database ids. Timestamps are RFC 3339 UTC with trailing `Z`; dates are
`YYYY-MM-DD`; money uses integer minor units and ISO 4217 currency codes;
text is UTF-8 and at most 64 KiB; `extension_json` is at most 16 KiB and depth
8. Boolean values are SQLite integers `0` or `1`.

References use `package_record_id` and are validated by consumers. Required
v1 core edges remain required: locations to organizations and comments to
tickets. Optional references may be null where the schema allows it.

## Attachments and exclusions

Each `attachments` row associates one entity with a digest, byte size, media
type, and optional source filename. Repeated ownership references may share a
digest, but the ZIP contains one entry per unique digest. The entry content
must match both the declared size and SHA-256.

`exclusions` is independent of `package_diagnostics`. Its reason is one of
`msp_private`, `commercial`, `secret`, `deferred`, or `unreadable`, with a
non-empty explanation and optional owner reference. Producers exclude the
credential vault with reason `secret`. Plaintext credentials and connection
secrets are never serialized. `package_diagnostics` remains producer warning
or informational output and is not a declared exclusion.

## Canonical content hash

`content_sha256` is SHA-256 over entity tables only (manifest and auxiliary
tables are excluded): sort table names, sort rows by `package_record_id`,
serialize each row as JSON with sorted keys and nulls omitted, prefix with
`<table>:`, join rows with LF, then hash the UTF-8 bytes.

## Compatibility and validation

This implementation accepts AMP `2.0.x`. AMP 1 SQLite-only files are not AMP
2 ZIP packages and are rejected; there is no compatibility conversion path.
Validation errors use stable codes from `AMP_ERROR_CODES`, including
`AMP_UNSUPPORTED_VERSION`, `AMP_INVALID_PACKAGE_STRUCTURE`, `AMP_LIMIT_EXCEEDED`, `AMP_INVALID_VALUE`,
`AMP_INVALID_REFERENCE`, and `AMP_HASH_MISMATCH`.
