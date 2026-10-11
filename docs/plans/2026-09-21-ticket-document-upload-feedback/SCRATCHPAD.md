# Ticket document upload investigation

- Card: alga-2026-0002519.
- Inspected base: `2dc8454a4ccf4b701ba0b6c1e66c12a6f75f6b04`.
- Planning only. No application changes or runtime tests performed.
- Existing `package-lock.json` modification predates this assignment and is excluded from the plan commit.
- Plan lives in `docs/plans/` as requested for this assignment.

## Findings

`DocumentUpload.tsx` hides the whole queue behind `isUploading`; failure reasons appear only in the error icon's title. Returned errors and thrown exceptions update the queue but not the persistent top-level error. Permission errors already call `handleError`, so new toast behavior must avoid duplicate permission notifications.

Both `Documents.tsx` upload instances call `setShowUpload(false)` on each successful file. This unmounts the upload UI before the remaining batch finishes. Fixing queue visibility alone cannot solve mixed-result uploads.

The existing optional `onAllUploadsComplete` has no result argument. `TaskDocumentsSimple.tsx` uses it to close its uploader unconditionally. The cross-feature provider passes upload props through a generic record, so type checking alone may miss callback integration regressions.

`DocumentsTile.tsx` opens a manager Dialog; the upload zone appears after Upload file. `FolderSelectorModal` opens another Dialog when `folderPath` is undefined. Confirm invokes selection and then closes the folder modal synchronously; cancellation clears pending files. Preserve this flow unless browser evidence identifies a separate defect.

`uploadDocument` validates before storage, inserts the document and ticket association in a transaction, and uses best-effort folder initialization. Null folder input can still auto-file into ticket attachments; it does not force physical root storage. Expected action errors become returned messages; unexpected errors are rethrown and may be sanitized by Next.js in production.

Storage defaults permit all MIME types, with local/S3 environment overrides and a separate provider size ceiling. Next.js defaults to a 20 MB server-action request limit, overridable by `SERVER_ACTIONS_BODY_LIMIT`. Multipart overhead means this is not an exact per-file allowance.

## Evidence still needed

- Customer video was not present in the checkout search. Obtain through the internal card; record the actual drop target and source application without committing customer material.
- Hosted provider, MIME allowlist, provider size ceiling, and effective server-action request limit were not inspected. Check only those non-secret settings read-only during implementation validation. Do not dump environment variables or change policy to make a test pass.
- Determine whether the report used a saved EML file or an Outlook message drag that supplied no browser File objects.

## Test setup notes

Existing component examples: `packages/documents/src/components/Documents.drawer.test.tsx` and `packages/tickets/src/components/ticket/bento/DocumentsTile.test.tsx`.

`packages/documents/vitest.config.ts` now defines two Vitest projects so the
workspace command discovers the feedback suites: `documents-node`
(`tests/**/*.test.ts`) and `documents-upload-feedback` (`src/**/*.test.tsx`
under jsdom, with `vitest.setup.ts`, workspace source aliases and a load-only
storage stub). Broader `src/**` suites still run under the root/server config.

Supported commands:

- `npm -w @alga-psa/documents test` — node contract suites + the two upload
  feedback suites (26 files / 67 tests).
- `npm -w @alga-psa/documents test -- src/components/DocumentUpload.test.tsx`
  — single suite.
- `npm -w @alga-psa/projects test -- src/components/TaskDocumentsSimple.test.tsx`
  — project-task parent integration.
- Root/server cross-check: from `server/`,
  `npx vitest run ../packages/documents/src/components/DocumentUpload.test.tsx
  ../packages/documents/src/components/Documents.uploadBatch.test.tsx
  ../packages/projects/src/components/TaskDocumentsSimple.test.tsx`.

### Live evidence (port 3798, ticket 48a3d221, DocumentUpload manager)

- Drop and Browse Files both reach the folder selector; Confirm uploads and the
  all-success batch closes the uploader after refresh.
- `.eml` (message/rfc822), `.xls` (application/vnd.ms-excel) and `.xlsx`
  uploaded, refreshed, and remained in the ticket's Documents tile after reload;
  DB rows in `documents` + `document_associations` (entity_type `ticket`).
- Empty MIME metadata (`type: ""`) uploaded and stored as
  `application/octet-stream`.
- Mixed batch (good + 21 MB file): uploader stayed open with `1 of 2 files
  uploaded`, inline Failed row `Failed to upload file`, and the success refreshed.
- Folder dialog Cancel left prior documents intact and uploaded nothing;
  reselecting and Confirming uploaded. Focus stayed inside the nested dialog.
- Long filenames wrap and the failure reason is readable in light and dark
  themes (screenshots under `/tmp/ghostty-pane-ide/screenshots/`).
- Restricted MIME rejected at the isolated storage layer: with
  `STORAGE_LOCAL_ALLOWED_MIME_TYPES=application/pdf`, `application/pdf` is
  allowed and `message/rfc822` throws `File type not allowed`. A restricted
  server was not booted because its `initializeApp` would rotate the shared dev
  credential, which the review forbids.

Remaining external blockers: hosted MIME allowlist/limits remain unverified; the
Escape-to-cancel keyboard path did not close the Radix folder dialog under
automation (button Cancel verified); a long server-side error string could not
be induced locally, so long-text wrapping was checked with long filenames.
