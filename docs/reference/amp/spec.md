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

The package contains `amp_manifest`, the core entities `organizations`, `locations`,
`contacts`, `tickets`, `ticket_comments`, `assets`, `products`, `vendor_products`, and the
workspace entities enumerated in the [data dictionary](data-dictionary.md#workspace-entities-amp-2).
Workspace entities cover people and authorization assignments, work catalogs, projects/tasks,
conversations, operational time, calendars/business hours, meetings and appointment requests,
documents/KB and authored workflow configuration/history. Auxiliary tables are
`external_identifiers`, `custom_field_values`, `package_diagnostics`, `attachments`, and `exclusions`.
Exact columns and row schemas are published by `@alga-psa/migration-spec`. Any other table,
trigger, view, or unexpected column is invalid. A producer does not select native columns implicitly.

## Manifest

`amp_manifest` has exactly one row. Required values include format version
`2.0.0`, package id, UTC creation time, producer name/version, source system,
`content_sha256`, and `attachments_sha256`. Content hashes entity rows, identifiers, custom fields, attachment ownership metadata and exclusions using
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
`msp_private`, `commercial`, `secret`, `deferred`, or `attachment_unreadable`, with a
non-empty explanation and optional owner reference. Producers exclude the
credential vault with reason `secret`. Plaintext credentials and connection
secrets are never serialized. `package_diagnostics` remains producer warning
or informational output and is not a declared exclusion.

## Canonical content hash

`content_sha256` is SHA-256 over entity tables, `external_identifiers`, `custom_field_values`, `attachments` and `exclusions`
(the manifest and producer diagnostics are excluded): sort table names, sort rows by `package_record_id`,
serialize each row as JSON with sorted keys and nulls omitted, prefix with
`<table>:`, join rows with LF, then hash the UTF-8 bytes.

## Compatibility and validation

This implementation accepts AMP `2.0.x`. AMP 1 SQLite-only files are not AMP
2 ZIP packages and are rejected; there is no compatibility conversion path.
Validation errors use stable codes from `AMP_ERROR_CODES`, including
`AMP_UNSUPPORTED_VERSION`, `AMP_INVALID_PACKAGE_STRUCTURE`, `AMP_LIMIT_EXCEEDED`, `AMP_INVALID_VALUE`,
`AMP_INVALID_REFERENCE`, and `AMP_HASH_MISMATCH`.

## Graph and import semantics

References are create-only identities. Self-referencing folders and message replies must be acyclic;
consumers order them before applying children. A package may not use native IDs to bypass these edges.
The semantic field catalog and fixture in the conformance suite include every workspace entity.

A co-managed producer reads records and file metadata in one repeatable-read database transaction.
Native storage keys are immutable object identities: a replacement upload allocates a new key.
The producer captures each file before releasing that snapshot, verifies size and hashes the captured
bytes, then seals the package. A missing, changed or unreadable object is an `attachment_unreadable`
exclusion; dependent file references become null or their dependent records receive an exclusion.
MSP-owned stores, commercial records, credential vaults and provider secrets remain excluded with reasons.
The manifest's export interval brackets the database snapshot and file capture.

Fresh Alga workspace imports use the normal AMP stager, identity ledger and domain appliers with
`createTargetTenant`, `deactivateImportedUsers`, `requireReauthForConnections` and `pauseDispatch`.
Users stay inactive; credentials, sessions, provider bindings and source relationships are not recreated.
Workflows stay paused. Calendar entries and appointment requests are cancelled, with original state
retained in staging for review. Workflow task history becomes inert audit evidence. Nothing automatically
activates the restored tenant. Installation operators review the import report and configure new connections.

### Content references and cyclic conversations

Semantic links in Markdown/HTML, Tiptap and BlockNote content use
`amp://<entity>/<percent-encoded-package-record-id>/<representation>#fragment`.
The supported entities are `files`, `documents`, `attachments` and `exclusions`;
representations are `view`, `download`, `thumbnail`, `preview` and `content`.
Consumers resolve these identities through the package, never as filesystem paths or network
requests. Unknown identities, query strings, credentials and malformed AMP URIs are invalid.
An exclusion link communicates an unavailable target; consumers display an unavailable-content
placeholder. Literal prose, code blocks and external URLs are unchanged. Producers discard
source request queries (which may carry temporary authorization) when canonicalizing local links.

Conversation threads refer to their root message, and messages refer to their thread. The two
root-message edges are deferred references: validate both ends before application, allocate the
thread identity before its messages, and bind the root after identity creation. All other required
references follow dependency order; self-referential hierarchies must be acyclic. A thread has
exactly one ticket or work-item parent and a root message of the corresponding kind.
