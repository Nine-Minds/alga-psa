# Client visibility for MCP `attach_file` and REST document attach — design of record

PSA ticket alga-2026-0002823 (Joymode Business Solutions) · Branch `feature/mcp-attach-file-choose-internal-only-or-client-v`, based on `origin/main` at `8d93a231e6`. Design Session run 4ccc84f5. No separate plan existed for this card; this document and the card description are the spec.

Extends [2026-10-20-mcp-doc-attachments.md](./2026-10-20-mcp-doc-attachments.md). Everything there still holds; this adds one option to the same upload core.

## Problem

Documents attached through `attach_file`, `POST /api/v1/documents` and the multipart `POST /api/v1/tickets/{id}/documents` are always internal-only. The caller cannot make a file visible to the client in the portal, and the response gives no sign of the choice. Staff who attach a file through MCP have to open the web UI and toggle visibility by hand.

## Decisions

1. **Contract.** One optional boolean, `is_client_visible`, default `false` (internal), in three places:
   - the JSON body of `POST /api/v1/documents`;
   - a form field on the multipart `POST /api/v1/tickets/{id}/documents` route;
   - the `attach_file` tool arguments.

   It is supported for `ticket`, `project_task` and `client`. `true` for `contact` or `asset` is refused with 400, because no client-portal surface reads those documents. An explicit `false` is accepted for every entity type. A value that is not a boolean is a 400 in REST (for the form field, anything other than `true` or `false`) and an `AttachFileInputError` in MCP.
2. **Mechanism.** All in `server/src/lib/api/services/documents/`:
   - `EntityAdapter` gets a `portalVisible` flag, `true` on the ticket, project_task and client adapters only.
   - `AttachHookOptions` gets `isClientVisible`, next to `commentAttachmentDraft`.
   - `documentOverrides` returns `{ is_client_visible: true }` when `isClientVisible` is set. `commentAttachmentDraft` still forces `true`: a draft always wins, and an explicit `false` does not undo it.
   - The core refuses the unsupported-entity case and the permission case **before** `StorageService.uploadFile`, so a refused request leaves no orphan object in storage. (The core is `attachDocument` in `attachDocument.ts`; the design session called it `attachDocumentFromBytes`, its name in the 2026-10-20 design.)
3. **Permission.** Making a document client-visible requires `document:update` in addition to `document:create`. This matches the web UI's `toggleDocumentVisibility` (`packages/documents/src/actions/documentActions.ts`, "Cannot update document visibility"). The target record is already authorized by `adapter.assertCanAttach`. The MCP connector inherits the caller's permissions: there is no new grant and no bypass. The check sits on the shared path, so the JSON endpoint and the ticket multipart route both get it. The core takes the caller as `permissionContext` and fails closed when it is missing. When the request is made through a principal, both the effective user and the principal must hold the permission (`hasApiContextPermission`).
4. **Wire-through.**
   - `ApiDocumentController.attach` validates the field with the zod schema and passes it on.
   - `ApiTicketController.uploadDocument` reads the `is_client_visible` form field (`parseClientVisibleFormField`).
   - `TicketService.uploadTicketDocument` replaces the positional `commentAttachmentDraft = false` with an options object `{ commentAttachmentDraft?, isClientVisible? }`.
   - `attach_file` gains `is_client_visible` in its input schema, and `buildAttachFileRequest` passes it through. `OPENAI_FILE_SCHEMA` is untouched. The tool description and the shared server instructions mention the option.
   - The OpenAPI route descriptions, the registry override `ee/docs/api-registry/documents.json` and the generated specs and registries document the field.
5. **Confirmation.** The response is the `IDocument` / `getDocumentById` shape, which carries `is_client_visible`, so the caller sees the resulting visibility. The real proof of client visibility is the portal predicate `resolveClientPortalDocument` (`packages/client-portal/src/lib/clientDocumentAccess.ts`, filter `d.is_client_visible = true`); the column alone is not enough. That check needs a running server and is done as a smoke test, not in unit tests.
6. **Out of scope.** Client-portal changes; consolidating the `packages/documents` web upload (the `document-upload-core` LEVERAGE note stays); a visibility-edit endpoint; a contract attach type; publish notifications; drive-by refactors.

## Tests

- Default stays internal; an explicit `false` is internal.
- `true` on ticket gives `is_client_visible: true`; `true` on project_task and client is accepted.
- `true` on contact or asset gives 400, with no `uploadFile` call.
- `true` without `document:update` is refused (403), with no `uploadFile` call; a missing permission context also refuses.
- An explicit `false` does not undo a comment-attachment draft.
- A non-boolean value is a 400 in REST (JSON schema and form field) and throws `AttachFileInputError` in `buildAttachFileRequest`.
- The pinned `uploadTicketDocument(...)` call shape in `ticketDocumentsUpload.contract.test.ts` follows the options object.

## Risks

- **Exposure by mistake.** A model could set `true` on its own. The tool and registry text say to set it only when the user asks, and the call needs `document:update`. The default stays internal.
- **Portal check not run here.** Unit tests prove the `documents` row; they do not prove the client portal shows the file. Run the live portal check before relying on it.
