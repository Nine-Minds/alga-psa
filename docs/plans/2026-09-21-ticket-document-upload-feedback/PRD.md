# Ticket document upload feedback

## Problem and goals

Ticket users can drop saved EML or Excel files into the document uploader and receive no lasting indication that an upload failed. The interface hides error rows when processing ends and closes after the first success in a batch. A drop with no browser File objects is silently ignored.

Give MSP technicians a visible outcome for every attempted file and a recovery instruction when a drag cannot supply files. Keep successful uploads associated with the ticket and visible after refresh. This is a feedback and upload lifecycle fix; the customer-specific failure cause still requires runtime evidence.

## Verified code paths

Paths below are relative to the repository root at `2dc8454a4c`.

| Path | Current behavior | Planned change |
| --- | --- | --- |
| `packages/documents/src/components/DocumentUpload.tsx` | Empty drop ignored; queue hidden when idle; per-file callback on success; completion callback has no summary | Persistent outcome list, empty-drop guidance, failure toast, batch summary and guarded selection |
| `packages/documents/src/components/Documents.tsx` | Folder and entity upload instances unmount on first success | Refresh and decide closure at batch completion |
| `packages/projects/src/components/TaskDocumentsSimple.tsx` | Cross-feature caller closes on every completed batch | Consume summary and retain uploader when failures remain |
| `packages/tickets/src/components/ticket/bento/DocumentsTile.tsx` | Manager Dialog contains ticket document section | Browser regression coverage; no planned layout change |
| `packages/documents/src/components/FolderSelectorModal.tsx` | Destination selection precedes uploads when folder path omitted | Preserve confirmation/cancellation behavior; verify nested dialog |
| `packages/documents/src/actions/documentActions.ts` | Validates, stores, creates document and ticket association | No planned server or database changes |
| `packages/storage/src/config/storage.ts` | Provider MIME policy defaults to `*/*`, supports overrides | Read-only hosted policy verification |
| `helm/templates/deployment.yaml` | Injects provider MIME/size settings | No planned chart change |
| `server/next.config.mjs` | Request body default `20mb`, environment override | No planned request limit change |
| `server/public/locales/en/common.json` and supported locale equivalents | Upload strings use common documents namespace | Add feedback strings following existing translation conventions |

## User flow and feedback

1. Open a ticket's document manager, choose Upload file, then drop saved files or use Browse Files. Preserve destination folder selection.
2. During processing, show progress and filename/status rows. Prevent another selection or drop from replacing an active batch; use a synchronous guard as well as disabled controls. A drop during processing may announce that an upload is already running.
3. Keep the outcome list mounted after processing if any file failed. Show the filename, textual Failed status, and readable reason directly in the row, not only a tooltip or color. Keep successful rows so partial success is clear. Wrap error text and constrain long lists using existing layout conventions.
4. Show one failure-summary toast per batch, for example “1 of 3 files could not be uploaded. Review the errors below.” Coordinate the existing permission-error toast path so a failure is not announced twice. The inline list remains the durable source of detail while the uploader is open.
5. An empty drop displays an inline alert and toast: “No files were received. Save the attachment or email to your computer, then drag the saved file here or use Browse Files.” Do not guess that every empty drop came from Outlook. Do not call the upload action or open the folder selector.
6. After all files succeed, refresh the documents and close the uploader. After partial success, refresh successful documents but keep the uploader open. After total failure, keep errors visible and allow another selection. Users may dismiss the uploader or select files again; a newly started batch replaces previous outcomes. Canceling folder selection must not erase previous outcomes.
7. Reset the hidden input after processing so selecting the same file again triggers a new attempt. Do not automatically retry successful or failed files. A transport error does not prove that a server write failed; avoid automatic retry that could create duplicates.

Use existing toast/error utilities, theme tokens, translated strings, unique component IDs for new controls, and accessible alert/status announcements. Persistent means until dismissal or a new batch in this open uploader, not stored across navigation or page reloads.

## Implementation sequence

1. Obtain video evidence and inspect the hosted provider's non-secret MIME and size settings read-only. Record whether the drop reached the uploader, supplied File objects, and opened the folder selector. If it reveals a separate layout defect, update scope with XO before expanding the change.
2. Make each file attempt return a terminal outcome. Accumulate outcomes locally during the sequential loop so the final summary does not depend on React state timing. Extend `onAllUploadsComplete` with an additive summary containing total, succeeded, and failed counts. Continue calling the existing per-file success callback for compatibility. Clear uploading state reliably in finalization.
3. Separate upload-action failures from consumer callback/refresh failures. A file already stored successfully must not be relabeled as an upload failure because refresh failed. Report a refresh problem separately with a reload instruction and ensure no rejected callback promise goes unhandled.
4. Implement the list, empty-drop guidance, batch toast, input reset, and selection guard in `DocumentUpload.tsx`. Preserve returned actionable reasons and use a safe localized fallback for exceptions; do not expose stack traces or promise a known MIME/size cause for an opaque transport error.
5. Update both `Documents.tsx` instances to refresh once after a batch with successes and close only when failed is zero. Keep existing folder-tree refresh behavior. Update `TaskDocumentsSimple.tsx` closure logic to honor the summary while preserving its per-file additions. Audit typed and cross-feature callers for early unmounts.
6. Add focused behavioral tests and execute browser validation against the ticket manager and folder selector. Capture the test command and actual results in the scratchpad during implementation.

## Acceptance criteria

- Returned rejection, permission rejection, and thrown action error each leave the affected filename and readable reason visible after processing ends.
- A mixed batch completes every attempt and retains failures regardless of success/failure ordering. Successful files remain visible after refresh.
- An empty drop produces actionable guidance without invoking upload or folder selection.
- Fully successful batches close only after the final file; failures leave the uploader available for correction and reselection.
- Saved `.eml`, `.xls`, and `.xlsx` files upload and remain associated when server policy permits them. Restricted MIME/size or transport failures remain visible; no new client allowlist bypasses policy.
- Folder confirmation/cancellation, nested-dialog focus, same-file reselection, and shared uploader callers continue working.

## Deliberately out of scope

Native Outlook message extraction, EML parsing or previews, Excel parsing, drag-and-drop anywhere on the ticket, a new tile drop zone, folder-default changes, storage MIME policy changes, larger upload/request limits, direct-to-storage transport, automatic retries, schema/association changes, and broad dialog redesign. No production mutation, deployment, or board action is part of this plan.

## Risks and open questions

The customer video and live configuration are unverified. An upload-feedback fix may expose an existing deployment policy restriction without allowing that file to upload. Files may carry empty or browser-dependent MIME types; test these without inventing extension-based permission overrides. Provider limits differ from the server-action request limit. Production exception sanitization can prevent a precise reason from reaching the client.

The shared uploader affects project and folder views as well as tickets. Generic cross-feature props weaken compile-time callback validation. Parent refreshes or remounts can still erase outcomes unless tested through the actual Documents component. Nested-dialog focus and stacking require browser checks; code inspection cannot establish whether they caused the report.

## Validation and rollout

Use the compact behavioral matrix in `tests.json`, then smoke-test saved EML and Excel files in a real ticket and reload it. Include a restricted-policy failure in an isolated environment and a request rejected before the server action. Inspect light/dark theme readability and keyboard navigation in the nested folder dialog. Never use customer attachments as committed fixtures.

No database/API persistence changes or migration are planned. Existing upload association tests remain regression coverage; if implementation expands into database behavior, add real migrated-schema happy-path and guard integration cases before completion. Ship through the normal application release; rollback is a code revert. Hosted configuration changes require a separately justified change after evidence review.
