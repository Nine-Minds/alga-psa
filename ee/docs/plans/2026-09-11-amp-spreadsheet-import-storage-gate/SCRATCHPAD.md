# Scratchpad — Spreadsheet import through the migration workspace

Working memory for `2026-09-11-amp-spreadsheet-import-storage-gate`. Diagnosis was done
against `main @ 032d1f637c`; this worktree branched from `284f8b0f80`.

## The two import paths

Only one of them can produce this error, which is why reports conflict.

| | Contacts → Import CSV | Settings → Imports & Exports |
| --- | --- | --- |
| Entry | `packages/clients/src/components/contacts/ContactsImportDialog.tsx:137` | `server/src/components/settings/migrations/MigrationJobsHome.tsx:200` |
| Accepts | `.csv` | `.amp`, `.csv`, `.xlsx` |
| Parsing | browser, `uploadedFile.text()` then `parseCSV` | server round-trip, converted to AMP |
| Storage at upload | none | yes — this is the gate that fails |

The browser path uploads nothing and cannot emit `File type not allowed`. Reports that
the import "works" are almost certainly that path. The failing path is the only UI that
accepts `.xlsx`.

## Failure chain, with line numbers

- `server/src/app/api/migrations/spreadsheet/route.ts:50` — stores the converted package
  with `mime_type: 'application/vnd.sqlite3'`.
- `packages/storage/src/StorageService.ts:96` — `uploadStream` calls `validateFileConfig`.
- `packages/storage/src/config/storage.ts:90` — throws the bare string.
- `route.ts:56` — `catch` returns `error.message` verbatim in `{ error }`.
- `MigrationJobsHome.tsx:252` — `migrationErrorMessage` (`migrationUi.ts:134`) returns
  `error.message` unchanged; only `AMP_PACKAGE_NO_IMPORTABLE_RECORDS` gets mapped copy.

`.csv` and `.xlsx` both become the same `.amp` with the same MIME type, which is why
re-saving the file never helped anyone.

## Allowlist configuration

Chart default is permissive:

- `helm/values.yaml:224` (local) and `:241` (s3) — `'*/*'  # Allow all file types`
- rendered at `helm/templates/deployment.yaml:426` and `:460` into
  `STORAGE_LOCAL_ALLOWED_MIME_TYPES` / `STORAGE_S3_ALLOWED_MIME_TYPES`

Deployment values narrow it to the same six entries, repeated per provider:

| File | local | s3 |
| --- | --- | --- |
| `nm-kube-config/alga-psa/hosted.values.yaml` | 216 | 237 |
| `nm-kube-config/alga-psa/sebastian.values.yaml` | 188 | 209 |
| `nm-kube-config/hosted-env-sebastian/values-hosted-env.yaml` | 236 | 255 |
| `nm-kube-config/hosted-env-dev/values-hosted-env.yaml` | 247 | — |

The six: `image/*`, `application/pdf`, `text/plain`, `application/msword`, the `.docx`
type, `video/*`.

Absent and therefore rejected on those deployments today: `application/vnd.sqlite3` (AMP
packages, both routes), `application/zip` (invoice bundle export), `text/csv`,
`application/vnd.ms-excel`, the `.xlsx` type.

Drift, not policy — the evidence:

- The chart ships `*/*`; nothing in the app assumes a narrow list.
- The same six entries appear in the chart's example `locations.documents` block
  (`helm/values.yaml:250`), which reads like the source they were copied from.
- No commit in `nm-kube-config` isolates the list as a decision. It predates the
  "Organize alga-psa project structure" reorg; `git log -S` on the `.docx` type finds
  nothing explanatory.

Still: confirm with the operator before touching it. And note
`config.storage.locations.*.allowed_mime_types` appears in every values file but **no
chart template reads it** — grep found only the two provider-level env vars. Probably dead
config; do not treat it as policy.

## Why the fix is provenance, not a wider list

`validateFileUpload` answers "may a user attach this?". Every generated artifact the
product stores is being asked that question about a MIME type our own code chose:

- `server/src/app/api/migrations/spreadsheet/route.ts:50`, `upload/route.ts:56` — AMP
- `server/src/lib/jobs/handlers/invoiceZipHandler.ts:257` — `application/zip`
- `server/src/lib/utils/documentPreviewGenerator.ts` ×6 and the
  `packages/documents/src/lib/` copy ×6 — renditions
- `packages/jobs/src/lib/handlers/telephonyCallArtifactHandler.ts:102` — call recordings
- `packages/scheduling/src/actions/onlineMeetingArtifactActions.ts:112` — meeting artifacts

Widening the list leaves the coupling: an operator tightening attachment policy keeps
breaking unrelated features, with no signal connecting the two. The missing concept is who
chose the MIME type. Prefer a named union value over a boolean — `{ origin:
'system-artifact' }` reads at the call site; `{ internal: true }` does not.

One subtlety worth keeping: `/api/migrations/upload` currently takes the stored MIME from
the request's `content-type` header (`upload/route.ts:57`). Under a bypass that becomes a
user-controlled value on an unvalidated path. The route already checks the extension, so
state the type in code.

## The second defect, behind the gate

`packages/migration-connectors/src/csv/mapping.ts` is 23 lines with one global alias
table, and every entry in it is asset-specific. For contacts, a header maps only if it is
already the canonical column.

Contacts columns (`packages/migration-spec/src/tables.ts:77-86`, identity at `:35-43`):
`first_name`, `last_name`, `email`, `phone`, `title`, `source_record_id`,
`organization_package_record_id`, `location_package_record_id`, plus derived columns that
throw if mapped (`engine.ts:265`).

A `Name, Email, Client` sheet therefore yields `{ "Email": "email" }`. And it does not
fail — contacts have an **empty** required set (`engine.ts:61`, both entity references are
`required: false` at `tables.ts:155`), so every row survives, `hasImportableRecords`
returns true (`MigrationStager.ts:38`), and the job reaches `needs_configuration` looking
healthy. `Name` and `Client` are gone into `extension_json`.

The bill arrives at apply: `server/src/lib/migrations/appliers/entityAppliers.ts:151`
throws `Contact has no first or last name`, `:152` requires an email.

Two consequences for sequencing:

- Shipping only the storage fix turns a clear early failure into a confusing late one.
  The header work is not optional polish.
- Had the reported sheet been `Name, Client` with no `Email`, mapping would be empty and
  the route would have thrown `AMP_SPREADSHEET_NO_RECOGNIZED_HEADERS` (`route.ts:42`) —
  the next failure waiting behind this one, exactly as the card predicted.

## Client-by-name is the hard part

Contacts link to organizations by `organization_package_record_id`, which must resolve
**within the same package** (`engine.ts:284` rewrites, `validator.ts:277` emits
`AMP_INVALID_REFERENCE`, and `MigrationStager.ts:57` then rejects the whole job). A
single-sheet contacts import has no organizations table, so there is nothing to resolve
against. No name-to-id resolution exists anywhere in the pipeline.

Apply time already has a fallback: an absent organization reference uses
`context.configuration.defaultClientId` and errors if that is unset
(`entityAppliers.ts:144`).

So the two shapes are: carry the client name through and resolve it at apply against
existing tenant clients with the default as fallback; or synthesize organization rows
during conversion. The second means importing contacts silently creates clients. Leaning
strongly to the first. Flagged as open question 1 — it is the one item in this plan that
is a feature rather than a defect fix, and it may deserve its own card.

## Diagnostics are already there and thrown away

`route.ts:54` returns `conversionDiagnostics`; `MigrationJobsHome.tsx:244` reads
`result.diagnostics` only on rejection and drops the rest. Unmapped headers currently
vanish without a word. Surfacing them is close to free and is what would have made this
bug self-diagnosing.

## LEVERAGE observations

Not scope, recorded so they are not lost:

- Two contact-import paths with different parsers, different accepted types, and different
  failure modes. `LEVERAGE: pattern contact-import` at both entry points.
- `documentPreviewGenerator` exists in two copies, `server/src/lib/utils/` and
  `packages/documents/src/lib/`, both carrying the same six upload sites.
- `documentActionErrors.ts:49` already maps `File type not allowed` for documents. The
  migration routes re-derive nothing and map nothing. The error-mapping shape wants to live
  below both.

## Commands

```bash
# stack for this card
# worktree: /home/robert/alga-copies/feature-amp-spreadsheet-import-fails-file-type-not-allow
# compose project: alga-psa-local-test, dev server on :3768

# reproduce the gate locally — mirror the hosted list into the dev env, restart, upload
STORAGE_LOCAL_ALLOWED_MIME_TYPES='image/*,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,video/*'

# note: packages/storage/src/config/storage.ts caches config in module scope;
# clearCachedStorageConfig() exists for tests, but a running server needs a restart.

# every place the allowlist is set
grep -rn "allowed_mime_types" ~/nm-kube-config --include=*.yaml
grep -rn "ALLOWED_MIME_TYPES" helm/templates/
```

## F031 — hosted attachment allowlist review (2026-09-11)

Re-verified after implementation. The hosted values files each replace the
chart's `*/*` default under `config.storage.providers` with the same six-entry
list, repeated for `local` and `s3`:

| File | local `allowed_mime_types` | s3 `allowed_mime_types` |
| --- | --- | --- |
| `nm-kube-config/alga-psa/hosted.values.yaml` | 216 | 237 |
| `nm-kube-config/alga-psa/sebastian.values.yaml` | 188 | 209 |
| `nm-kube-config/hosted-env-sebastian/values-hosted-env.yaml` | 236 | 255 |
| `nm-kube-config/hosted-env-dev/values-hosted-env.yaml` | — (no local block) | 247 |

The six: `image/*`, `application/pdf`, `text/plain`, `application/msword`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
`video/*`. Absent and therefore rejected: `application/vnd.sqlite3` (AMP
packages), `application/zip` (invoice bundle export), `text/csv`,
`application/vnd.ms-excel`, the `.xlsx` type.

Read: **drift, not policy.** The chart default is `*/*`
(`helm/values.yaml:223`, `:240`); the same six entries are copied from the
chart's example `locations.documents` block (`helm/values.yaml:250`); no commit
in `nm-kube-config` isolates the list as a decision. The source fix (storage
provenance) makes these files correct as-is for generated artifacts, so changing
them is now optional hygiene, not a fix. Recommendation for the operator:
either leave the six-entry list (correct for user attachments after F001–F010)
or restore `*/*` to match the chart default; do not add `application/vnd.sqlite3`
to it — that entry belongs to product artifacts, not user uploads. Out of this
worktree; no change made here.

## F031 / Q4 — `config.storage.locations.*.allowed_mime_types` is dead

Confirmed by grep: chart templates read
`.Values.config.storage.providers.{local,s3}.allowed_mime_types`
(`helm/templates/deployment.yaml:427`, `:461`; plus `deployment-dev.yaml`,
`storage-secret.yaml`, and the two code-server deployments). No template reads
`config.storage.locations.*.allowed_mime_types`, which still appears at
`helm/values.yaml:250` (`locations.documents`) and `:257`
(`locations.avatars`). Dead config; taking no action per the work order.

## Gotchas

- `getStorageConfig` memoizes in module scope (`config/storage.ts:7`). Changing the env
  var mid-process does nothing; tests must call `clearCachedStorageConfig()`.
- Both routes stream deliberately (`route.ts:19` comment) — do not introduce
  `arrayBuffer()` or a Buffer while editing them.
- Both run inside `runWithTenant`; storage and file-store resolve tenant from
  AsyncLocalStorage. Keep edits inside the wrapper.
- `external_files` has no metadata column, hence the deliberate absence of a `metadata`
  option on these two upload calls (`route.ts:48`). Do not add one.
- `'asset tag': 'asset_tag'` in the alias table is dead — assets have no `asset_tag`
  column, so `allowed.has(target)` drops it. Harmless, but do not copy the pattern when
  writing the entity-scoped tables.
- The reported sheet's headers are described generically throughout this plan on purpose;
  the specifics live on the Alga ticket.
