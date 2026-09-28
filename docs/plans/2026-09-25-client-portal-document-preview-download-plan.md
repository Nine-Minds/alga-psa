# Client portal document preview and download: implementation plan

- Ticket: alga-2026-0002585 (card 79c84e0a)
- Branch: `feature/alga-2026-0002585-fix-client-portal-document-pre`
- Status: plan only. Implementation has not started.

## Problem

In Client Portal > Documents, client-visible documents are listed but cannot be viewed inline. **Download** saves a `.json` file instead of a usable document.

## What the code does today

Line numbers refer to `main` at `bc6b21745f`.

1. `packages/client-portal/src/components/documents/ClientDocumentsPage.tsx`
   - `DocumentCard` (127–163) renders only a Download icon button. There is no preview and no way to open a document.
   - `handleDownload` (242–258) calls `downloadClientDocument(documentId)` to check access. Then it calls the cross-feature `downloadDocument(getDocumentDownloadUrl(id), document_name)`.
   - Failures are only logged with `console.error` (253–254), so the user sees nothing. The `useCallback` has an empty dependency list (258).
2. `server/src/app/client-portal/ClientPortalDocumentsProvider.tsx:63-65` wires `downloadDocument` to `packages/documents/src/lib/documentUtils.ts:26-81`. That function takes an **anchor path**: it creates `<a href=url download=name>` and clicks it, without checking the HTTP status. Whatever the URL returns is saved to disk, including error bodies.
3. The URL is `/api/documents/download/{documentId}` (`documentUtils.ts:15-18`). The route handler is `server/src/app/api/documents/download/[fileId]/route.ts`. With no `format`, it takes the "standard file download" branch (208–254):
   - For a document with no `file_id`, such as an in-app block document or a `document_content` text document, it returns `404 application/json {"error":"Document has no associated file."}` (228–231).
   - If authorization is denied, it returns `403 application/json {"error":"Forbidden"}` (241–246). Other failures return `500 application/json`.
4. `document_name` usually has no extension for in-app documents. Given an `application/json` body and an extension-less `download` attribute, Chrome saves the file as `<name>.json`.

**Working hypothesis:** the `.json` file is the route's JSON error body saved by the anchor download. It is not a stored JSON file. For in-app documents this is certain by construction. Uploaded files would produce the same symptom only if the route rejects them, for example through the authorization divergence described next. Phase 0 confirms this with evidence before any code changes.

### Authorization divergence (a second, latent cause)

The portal **list** and the portal **download** use two different authorization predicates:

- **List and access check:** `client-documents.ts` `applyClientDocumentVisibilityFilter` (137–159). It requires `is_client_visible`, then matches any of these associations: direct `client`, `ticket` → `tickets.client_id`, `project_task` → project `client_id`, or `contract` → `contracts.owner_client_id` for non-templates. It also applies `applyPublicCommentAttachmentFilter`.
- **Byte serving:** `/api/documents/download` → `downloadDocument` action (`packages/documents/src/actions/documentActions.ts:1495-1560`) → `shared/lib/documentAuthorization.ts` `authorizeAndRedactDocuments` (339–433). This is the authorization kernel's `same_client` rule. It resolves contract clients through `client_contracts`, not `contracts.owner_client_id` (lines 185–190 and 240–247). It also depends on `user.clientId` being present on the resolved user.

So a document can appear in the portal list, pass `downloadClientDocument`, and still get a 403 JSON response from the byte route. That also becomes a `.json` download. The fix removes this class of bug by serving portal bytes through the **same predicate the list uses**.

## Design

**Guiding decision:** give the portal one authorization seam, "can this client user see document X", and have the list, preview, download and export all go through it. A document that appears in the list can then always be opened, by construction. Tenant isolation comes from `tenantDb` scoping, and client isolation comes from the existing visibility filter.

### Phase 0: Confirm the cause (evidence, no code changes)

On the card's stack (`alga-psa-local-test`, dev port 3284), use the `alga-client-portal-testing` skill to seed one client-visible document of each kind for a client contact:

- (a) an uploaded PDF
- (b) an uploaded PNG
- (c) an in-app (block) document
- (d) a contract-linked uploaded PDF whose contract is linked by `owner_client_id` only

As the client user, record the status, `Content-Type` and body of `GET /api/documents/download/{id}` for each document. Also record `documents.mime_type` and `file_id` from the database, to rule out a genuinely stored `application/json` file.

Attach the results to the card as a fact. If an uploaded file really is stored as JSON, stop and report back, because that changes the scope.

### Phase 1: Server-side portal document access layer

1. **Extract the predicate.** Move the visibility builders (`client-documents.ts:28-159`) and the single-document lookup (399–418) into a non-`'use server'` module: `packages/client-portal/src/lib/clientDocumentAccess.ts`. Export:
   - `applyClientDocumentVisibilityFilter(...)`, unchanged.
   - `resolveClientPortalDocument(trx, tenant, user, documentId): Promise<IDocument | null>`. It enforces `user_type === 'client'`, the `document:read` permission, `getAuthenticatedClientId`, `is_client_visible`, the visibility filter and the public comment-attachment filter.

   `getClientDocuments`, `getClientDocumentFolders` and `downloadClientDocument` then call into this module. Their behaviour does not change, and the existing integration tests (T015–T019, T045, T046) must still pass unmodified.
2. **New server action** `getClientDocumentContent(documentId)` in `client-documents.ts`. It authorizes through `resolveClientPortalDocument` and returns a discriminated union:
   - `{ kind: 'file', mimeType, fileName, previewable }`, where `previewable` uses `isPreviewableDocumentMimeType` restricted to `image/*` and `application/pdf`
   - `{ kind: 'block', blockData }` from `document_block_content`
   - `{ kind: 'text', content, mimeType }` from `document_content`
   - `{ kind: 'empty' }`
   - or a `ClientPortalActionError`

   The preview dialog uses the result to decide how to render the document.
3. **New route** `server/src/app/api/client-portal/documents/[documentId]/file/route.ts` (`GET`). It authenticates the session user, requires a `client` user, and authorizes with `resolveClientPortalDocument`. It then streams the file bytes via `StorageService`:
   - `?disposition=inline` is allowed only for `image/*` (excluding `image/svg+xml`) and `application/pdf`. Other types get 415.
   - `?disposition=attachment` is the default and works for any file-backed document.
   - Response headers:
     - the stored `mime_type`
     - `Content-Disposition` with a sanitized ASCII `filename` plus `filename*=UTF-8''…`. If the document name has no extension, append one derived from the MIME type.
     - `Content-Length`
     - `Cache-Control: private, no-store`
     - `X-Content-Type-Options: nosniff`
     - for inline responses, `Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox`
   - Error responses: `401` (no session), `403` (not a client user), `404` (not found or not visible), and `404` with a `no_file` error code for documents without a `file_id`. All errors are JSON `{ error, code }`, which the client now reads rather than saves (Phase 2).
4. **New route** `server/src/app/api/client-portal/documents/[documentId]/export/route.ts` (`GET ?format=md|pdf`) for in-app documents. It uses the same authorization.
   - `md` reuses the Markdown conversion already in `download/[fileId]/route.ts:94-137`: block content via `convertBlockContentToMarkdown`, otherwise `document_content`, with whitespace normalization. Lift that into a shared helper (below) rather than copying it.
   - `pdf` uses `createPDFGenerationService(tenant).generatePDF({ documentId, userId })`. This returns a Buffer. **Do not use `generateAndStore`**: it persists files and can insert or update `documents` rows (`pdfGenerationService.ts:213-310, 487-544`). A client export must not mutate tenant data.
   - Returns `404 no_content` when there is nothing to export.
5. **Shared helper** for Markdown export: add `packages/documents/src/lib/documentMarkdownExport.ts`, or the nearest existing formatting lib, as `buildDocumentMarkdown(blockData, textContent)`. Point `download/[fileId]/route.ts:94-137` at it too. Right now the same logic also exists in `[documentId]/download/route.ts:89-107`. Mark the three byte-serving document routes with `// LEVERAGE: pattern document-byte-serving`; do not merge them here.

### Phase 2: Client-side fetch download (no more saved error bodies)

1. Add `fetchAndSaveFile(url, fallbackName): Promise<void>` to `packages/client-portal/src/lib/` (portal-local).
   - It uses `fetch` with `credentials: 'include'` and, on a non-OK response, parses `{error, code}` and throws a typed `DocumentRequestError`.
   - On success it takes the filename from `Content-Disposition` (falling back to `fallbackName`), creates an object URL from the blob, clicks a hidden anchor, and revokes the URL.
2. Rewrite `handleDownload` (`ClientDocumentsPage.tsx:242-258`) as follows:
   - Choose the URL by document kind:
     - file-backed documents use `/file?disposition=attachment`
     - in-app documents offer PDF export (primary) and Markdown export (secondary)
   - Call `fetchAndSaveFile`.
   - Show failures to the user with `toast.error` from `react-hot-toast`, the same pattern as `ClientKBArticleView`. Use translated messages that map `404/no_file/no_content/403/5xx` to specific copy. The load-error banner stays reserved for list failures.
   - Fix the `useCallback` dependencies.
3. The separate `downloadClientDocument` pre-check call is no longer needed, because the route performs the same check. Keep the action exported, since integration tests and possibly other callers use it.

### Phase 3: Preview UI

1. **`DocumentCard`**:
   - Add a **View** button (`id={\`client-docs-view-document-${document_id}\`}`) next to Download. Clicking the card title also opens the preview.
   - Give the Download button a unique id per document: `client-docs-download-document-${document_id}`. The current id is repeated for every card, which violates the unique-id rule in `docs/AI_coding_standards.md:22`.
   - In-app documents get a Download menu with "PDF" and "Markdown" items. Use existing `@alga-psa/ui` dropdown primitives.
2. **New `packages/client-portal/src/components/documents/ClientDocumentPreviewDialog.tsx`**, built on the `@alga-psa/ui` `Dialog` with actions in the `footer` prop per the coding standards. It calls `getClientDocumentContent` and renders the result:
   - Images and PDFs are fetched as a blob from `/file?disposition=inline` and shown through an object URL, as an `<img>` or as an `<iframe>`/`<object>` for PDF. Fetching as a blob allows real error detection on a non-OK status and avoids `X-Frame-Options` and frame-ancestor issues. Revoke the URL on close.
   - Block documents render read-only through the existing `DocumentViewer` (`packages/documents/src/components/DocumentViewer.tsx`). `client-portal` does not depend on `@alga-psa/documents`, so expose it through the cross-feature context: add `renderDocumentViewer` to `DocumentsCrossFeatureCallbacks` (`packages/core/src/context/DocumentsCrossFeatureContext.ts`) and to `ClientPortalDocumentsProvider.tsx`, and to the MSP provider too if the interface requires it.
   - Text documents render in a `<pre>`, or through the Markdown renderer when `mime_type === 'text/markdown'`.
   - Other types show a "Preview isn't available for this file type" empty state with a Download button.
   - Loading, not-found and generic-failure states are all shown inside the dialog. Nothing fails silently.
3. **i18n:** add `portal.view`, `portal.download`, `portal.downloadPdf`, `portal.downloadMarkdown`, `portal.previewUnavailable`, `portal.previewError`, `portal.downloadError`, `portal.notFound` and `portal.noContent` to `server/public/locales/en/features/documents.json:216` and the other locales (`de es fr it nl pl pt`, plus the `xx`/`yy` pseudo-locales through the repo's generation script). Follow the `alga-tech-doc-writing` conventions for UI copy.

### Phase 4: Tests and evidence

- **Integration**, extending `server/src/test/integration/clientPortalDocuments.integration.test.ts`:
  - `/file` inline PDF and PNG: 200 with the correct `Content-Type`, `inline` disposition, `nosniff` and CSP headers.
  - `/file` attachment: `Content-Disposition` filename has an extension, and the bytes equal the upload.
  - `/file` for an in-app document: `404 no_file`.
  - `/export?format=md` for a block document: Markdown body with an `.md` filename.
  - `/export?format=pdf`: `%PDF` magic bytes, and **no new rows** in `documents` or `external_files`. Mock or stub the renderer only if Puppeteer is unavailable in CI, and record that choice.
  - Denials:
    - another client's document → 404
    - non-visible document → 404
    - document from another tenant → 404
    - MSP (internal) user on the portal routes → 403
    - unauthenticated → 401
    - private comment attachment → 404
    - SVG inline → 415
  - A contract document linked only via `owner_client_id` can be listed **and** downloaded. This is the regression test for the divergence.
- **Unit tests:**
  - `ClientDocumentsPage.test.tsx`: View opens the dialog; a failed download shows a toast and saves no file; in-app documents offer PDF and Markdown and no raw download; IDs are unique.
  - A new `ClientDocumentPreviewDialog.test.tsx` covering each render branch plus the error states.
  - `fetchAndSaveFile`: a non-OK response throws with the server code; the filename comes from `Content-Disposition`.
- **Portal smoke evidence**, using the `alga-client-portal-testing` skill on port 3284, with screenshots and downloaded-file `file(1)` output attached to the card:
  - As the client contact, preview the PDF, the PNG and the in-app document.
  - Download each one, and export the in-app document as PDF and as Markdown.
  - Force a failure (delete the storage object for one document) and confirm the visible error.

## Order of work

Phase 0 → Phase 1 (1 → 2 → 3/4/5) with integration tests alongside → Phase 2 → Phase 3 → i18n → unit tests → smoke. Each phase gets its own commits.

## Out of scope

- The MSP-side anchor download in `documentUtils.ts:26-81`, which is also used by `DocumentStorageCard` and `TaskDocumentUpload`. It has the same "save the error body" flaw for internal users and the portal Projects tab. Mark it with `// LEVERAGE: friction anchor-download-saves-errors` and raise it as a follow-up. Changing it here widens the blast radius beyond this ticket.
- Reconciling the authorization kernel's contract→client resolution (`client_contracts`) with the portal's (`contracts.owner_client_id`). The portal stops depending on the kernel for byte serving. Aligning the kernel is a separate authorization change and should be raised as a follow-up.
- Inline video preview. It needs HTTP Range support, which exists in `/api/documents/view` but not here. Videos stay download-only in the portal.
- Office documents (docx/xlsx/pptx) inline preview: download only.
- Thumbnails in the portal document grid.
- Consolidating the three existing document byte routes (`/download/[fileId]`, `/[documentId]/download`, `/view/[fileId]`). These are only marked with the LEVERAGE pattern.

## Risks

1. **Phase 0 may disprove the hypothesis.** If a stored file really is `application/json`, the fix still stands (usable downloads, visible errors), but the reporter's specific document needs a data-level look.
2. **PDF export for block content.** `generatePDF` needs the rendering backend (Puppeteer or Chromium) to be available in the portal request context and in CE. `getDocumentHtml` (`pdfGenerationService.ts:1082`) reads `documents` without portal authorization, so the route must authorize **before** calling it. If the renderer is unavailable, the UI must show a clear error and still offer the Markdown export.
3. **SVG and HTML inline content** could be an XSS vector on the app origin. This is mitigated by refusing inline for SVG and non-previewable types, and by adding `nosniff` and sandbox CSP headers.
4. **Blob preview memory:** very large PDFs are fully buffered in the browser. This is acceptable for portal documents; if it becomes a problem, the dialog should fall back to Download above a size threshold (for example 50 MB, using `file_size`).
5. **Cross-feature context change:** adding `renderDocumentViewer` touches the shared interface. Every provider must implement it, or the property must be optional.
6. **Behaviour-preserving extraction:** moving the visibility builders must not change their SQL. The existing T015–T019, T045 and T046 tests serve as the guard.
