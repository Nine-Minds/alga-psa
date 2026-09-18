# PRD — Spreadsheet import through the migration workspace

- Slug: `2026-09-11-amp-spreadsheet-import-storage-gate`
- Date: `2026-09-11`
- Status: Draft

## Summary

Importing a contacts spreadsheet through Settings → Imports & Exports fails on any
deployment that restricts the attachment MIME allowlist. The upload is converted to an
AMP package server-side and stored through the same validation gate that guards
user-chosen attachments, so a generated internal artifact is rejected by a policy written
for untrusted uploads. The raw storage error string reaches the browser unchanged.

Three fixes: teach the storage layer to distinguish system-generated artifacts from
user-supplied uploads, map migration upload failures to actionable messages instead of
echoing internal strings, and make contact spreadsheet headers actually map so the import
produces applicable records rather than an empty shell.

## Problem

A spreadsheet uploaded at Settings → Imports & Exports fails with the bare text
`File type not allowed`, for `.csv` and `.xlsx` alike, at any row count.

The chain:

1. `server/src/app/api/migrations/spreadsheet/route.ts:50` converts the sheet to an AMP
   package and stores it with `mime_type: 'application/vnd.sqlite3'`.
2. `packages/storage/src/StorageService.ts:96` runs the attachment allowlist check on that
   MIME type.
3. `packages/storage/src/config/storage.ts:90` throws the bare string
   `File type not allowed` when the type is absent from
   `STORAGE_{LOCAL,S3}_ALLOWED_MIME_TYPES`.
4. The route returns `error.message` verbatim; `MigrationJobsHome` renders it verbatim.

The chart default is `*/*` (`helm/values.yaml:224`, `:241`), so local development never
sees this. Deployments that narrow the list do, and `application/vnd.sqlite3` is on no
one's attachment allowlist — every AMP and spreadsheet import fails there, permanently.
Re-saving the file cannot help: `.csv` and `.xlsx` converge on the same AMP package with
the same MIME type.

The defect class is wider than imports. Every artifact the product generates and stores
is gated on a list describing what a *user* may attach: invoice ZIP bundles
(`application/zip`, `server/src/lib/jobs/handlers/invoiceZipHandler.ts:257`), document
preview and thumbnail renditions, call-recording and meeting artifacts. An operator
tightening attachment policy silently breaks unrelated features with no signal linking
cause to effect.

Behind the storage gate sits a second defect. `inferSpreadsheetMapping`
(`packages/migration-connectors/src/csv/mapping.ts`) carries one global alias table with
asset-only entries. For `contacts`, a header maps only when it is already the canonical
column name. A sheet of `Name, Email, Client` maps `Email` alone; `Name` and `Client` fall
into `extension_json` and are lost. Contacts have an empty required-column set, so every
row survives conversion and the job reaches `needs_configuration` looking successful. The
failure surfaces much later at apply time —
`server/src/lib/migrations/appliers/entityAppliers.ts:151` throws
`Contact has no first or last name`. Fixing only the storage gate would convert a clear
early failure into a confusing late one.

## Goals

- A contacts spreadsheet uploaded through the migration workspace stages successfully on a
  deployment carrying a restrictive attachment allowlist.
- Generated artifacts are never subject to the user-attachment MIME policy, by
  construction rather than by widening a list.
- A genuinely rejected upload produces a mapped, actionable message; internal error
  strings never reach the browser.
- Common contact spreadsheet headers map to contact fields, and columns that do not map
  are reported to the user rather than silently discarded.

## Non-goals

- Consolidating the two contact-import paths. Contacts → Import CSV
  (`packages/clients/src/components/contacts/ContactsImportDialog.tsx:137`) parses in the
  browser, uploads nothing, and is unaffected. The duplication is real and worth a
  `LEVERAGE:` marker, not a scope item here.
- Reworking the AMP package format, the staging pipeline, or the configure/apply UI beyond
  surfacing diagnostics that already exist.
- Broad alias coverage for every entity type. Contacts is the reported and verified path;
  organizations and locations get the aliases needed to keep contact-to-client resolution
  coherent.
- Changing deployment values files. The hosted allowlist is reviewed and reported here;
  any change to `nm-kube-config` is a separate pull request and is explicitly not the fix.

## Users and Primary Flows

An MSP administrator migrating from another system opens Settings → Imports & Exports,
chooses a `.csv` or `.xlsx` export from the previous tool, selects what the rows represent
(Contacts), and uploads. The expected outcome is a staged migration job in
`needs_configuration` whose row counts match the sheet, followed by configure and apply.

Secondary flow: the same administrator uploads a prepared `.amp` package. Same route
family, same storage gate, same current failure.

## UX / UI Notes

- The upload dialog (`MigrationJobsHome.tsx:200`) currently special-cases exactly one
  error code and passes everything else through as raw text. Replace with a closed
  code-to-copy mapping covering every code the routes emit, with a generic fallback for
  anything unrecognized.
- The spreadsheet route already returns `conversionDiagnostics`; the dialog discards it.
  Surface unrecognized columns after a successful stage — a sheet whose `Client` column
  was ignored should say so before the user reaches apply.
- No new screens. No change to the accepted file extensions.

## Requirements

### Functional Requirements

**Storage provenance**

- The storage layer distinguishes a user-supplied upload from a system-generated artifact.
  User uploads keep the existing allowlist check unchanged. System artifacts are validated
  for size and provider limits only.
- The discriminator is an explicit named value, not a boolean flag, and defaults to the
  user-upload behavior so an un-migrated call site fails closed.
- Both migration routes store their AMP package as a system artifact.
- `/api/migrations/upload` stops deriving the stored MIME type from the request's
  `content-type` header. The route already validates the extension; the artifact type is
  ours to state.
- The other generators of stored artifacts — invoice ZIP bundles, document preview and
  thumbnail renditions, telephony call artifacts, online meeting artifacts — move to the
  system-artifact path. User-supplied paths (documents, ticket attachments, avatars and
  logos, client portal uploads) stay on the user-upload path.

**Error surfacing**

- Both migration upload routes return a code from a closed set. An unrecognized throw maps
  to a generic failure code and is logged server-side with tenant and route context.
- A storage-layer rejection maps to a distinct code, so a genuinely misconfigured
  deployment is diagnosable without reading pod logs.
- The dialog translates every code to user-facing copy through `i18n` with a default
  value, following the mapping precedent in
  `packages/documents/src/actions/documentActionErrors.ts:49`.

**Contact header mapping**

- Alias tables become entity-scoped rather than one shared asset-only map.
- Contacts recognize the common spellings for email, first name, last name, phone, and
  title, case- and separator-insensitive.
- A single full-name column maps to first and last name. Mapping today is header → column
  and cannot express one-to-many, so the conversion engine gains a derived-column
  transform. Handle both `First Last` and `Last, First`.
- A contact row that cannot be applied — no name, or no email — is skipped at conversion
  with a diagnostic, rather than converted and thrown at apply. Contacts gain a real
  required-column set.
- A client or company column on a contacts sheet resolves to an existing tenant client by
  name. Unmatched rows fall back to the configured default client and report the mismatch
  rather than failing. See open questions — this is the largest decision in the plan.

### Non-functional Requirements

- Streaming behavior is preserved; neither route may materialize an upload in memory.
- The tenant context wrapper around the ingest stays intact.
- No new configuration keys are required for a correct deployment.

## Data / API / Integrations

- No schema change. `migration_jobs` and `external_files` are unchanged.
- `POST /api/migrations/spreadsheet` and `POST /api/migrations/upload` change their error
  payload from arbitrary text to codes from a closed set. Both are internal, called only
  by the migration workspace.
- `packages/storage` gains the provenance parameter on its two upload entry points.
  Existing call sites compile unchanged and keep current behavior.
- `packages/migration-connectors` gains entity-scoped aliases and one engine transform.

## Security / Permissions

- Both routes keep their `import_export: manage` permission check.
- The bypass applies only where the MIME type is chosen by product code, never where it
  is derived from a request header or a user-selected file. Removing the header-derived
  MIME in `/api/migrations/upload` is part of the same reasoning.
- Size limits and the AMP package ceiling continue to apply to system artifacts.

## Observability

Unknown throws in the upload routes are logged with tenant and route context before the
generic code is returned, so replacing raw error pass-through does not cost
diagnosability.

## Rollout / Migration

- No data migration. The fix is effective on deploy for new uploads; previously failed
  uploads were never stored and simply need retrying.
- The deployment allowlist review is tracked here but lands separately in
  `nm-kube-config`. The source fix must stand on its own against the current hosted
  values.

## Open Questions

1. **Client-by-name resolution.** Contacts reference organizations through
   `organization_package_record_id`, resolvable only within the same package, and an
   unresolved reference rejects the whole job at staging. A single-sheet contact import has
   no organizations table. Two shapes: resolve the name against existing tenant clients at
   apply time, falling back to the configured default client; or synthesize organization
   rows during conversion. The second makes an import of contacts silently create clients,
   which is probably not what an administrator expects. Recommendation is apply-time
   resolution. This may warrant its own card — it is the one item here that is a feature
   rather than a defect fix.
2. **Scope of the internal-artifact migration.** Moving the migration routes is required.
   Moving invoice ZIP, previews, and call artifacts is a one-line change per site and
   leaves the product without a second instance of this bug. Confirm they belong in this
   card.
3. **Hosted allowlist disposition.** Evidence points to drift rather than policy: the
   chart default is `*/*`, the hosted list repeats the same six entries for local and s3
   and matches the chart's example `locations.documents` block, and no commit isolates it
   as a deliberate decision. Confirm with the operator before changing it.
4. **Unused configuration.** `config.storage.locations.*.allowed_mime_types` appears in
   every values file but no chart template reads it. Confirm it is dead before treating any
   of it as policy.

## Acceptance Criteria (Definition of Done)

- A contacts `.csv` and a contacts `.xlsx` upload through Settings → Imports & Exports
  reach `needs_configuration` on a deployment configured with the current hosted allowlist,
  with no `File type not allowed`.
- A sheet headed `Name, Email, Client` produces contact records carrying first name, last
  name, and email, and reports what happened to the client column.
- An upload rejected for a real reason shows mapped copy. No storage-layer or engine string
  reaches the browser.
- A regression test pins the restrictive-allowlist case, so narrowing the allowlist can
  never again break imports.
- Smoke evidence covers the contacts entity type end to end through the UI, through apply.
