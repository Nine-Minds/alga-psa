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
`packages/documents/vitest.config.ts` includes only `tests/**/*.test.ts` in a Node environment. New TSX component tests need an explicitly selected compatible jsdom configuration or a narrowly scoped config update; report actual discovery and execution counts.
