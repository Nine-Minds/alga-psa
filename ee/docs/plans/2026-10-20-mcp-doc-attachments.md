# MCP document attachments without multipart — design of record

Card: 090e258b-ce4e-4fab-a728-69a7e3f63bcd · PSA ticket alga-2026-0002707 (Joymode Business Solutions)
Branch: `feature/mcp-attach-files-to-ticket-documents-without-mul`, stacked on the watcher card (521200a0). Line numbers below are from this branch, not origin/main. Both cards regenerate the OpenAPI specs and `registry.generated.ts`, so rebase onto the watcher card before regenerating.

## Problem

ChatGPT created the Joymode ticket, its contacts and its checklist over MCP, but it could not attach the two source files: a five-page PDF install guide and an annotated photo. Nothing on the MCP path can carry file bytes:

- `POST /api/v1/tickets/{id}/documents` accepts only multipart. The route is `server/src/app/api/v1/tickets/[id]/documents/route.ts`, then `ApiTicketController.uploadDocument()` (`ApiTicketController.ts:1396`, `req.formData()`, field `file`), then `TicketService.uploadTicketDocument(ticketId, file: File, …)` (`TicketService.ts:1320`).
- `call_api_endpoint` always JSON-serializes `body` (`packages/agent-tooling/src/invoke/buildRequest.ts`, end of `buildRequest`), so a multipart request cannot be expressed. The registry still lists the multipart entry (`post-_api_v1_tickets_id_documents`), so the model finds it and then has no way to call it.
- `/api/v1/documents` exists only as a GET stub that returns 404 (`server/src/app/api/v1/documents/route.ts`).

## How files reach an MCP server (verified 2026-10-23)

- **ChatGPT** (Apps SDK / connectors, https://developers.openai.com/plugins/reference): a tool lists its file inputs in `_meta["openai/fileParams"]`. These must be **top-level** input fields. Each field receives `{ download_url, file_id, mime_type?, file_name? }`. The schema has to declare all four properties, with `download_url` and `file_id` required and the other two optional, or the Scan Tools / submission step rejects the tool. Array fields are allowed. The `download_url` is described only as "temporary". Field reports show `https://files.oaiusercontent.com/…` signed per call, so it has to be downloaded during the call and never stored. Reported failure modes (unofficial, openai-apps-sdk-examples #185 and #237):
  - About 10% of calls arrive with the file param missing or as a bare string.
  - Mobile uploads arrive as `chat_upload://…` with no `download_url`.
- **MCP spec** (2025-11-25 and 2026-07-28): `tools/call` arguments are plain JSON. There is no client-to-server file mechanism. The file-upload SEPs (2356, 2631) were closed and moved into `experimental-ext-file-uploads`, which no client has adopted.
- **Claude** (claude.ai / Desktop custom connectors): there is no documented way to pass a file handle to a tool. The model sees the attachment's content, and the only way to send bytes is base64 the model writes itself.
- **Base64 from the model:** a 2–5 MB PDF is roughly 2.7–6.7 MB of base64, which is millions of output tokens. That is not workable for the customer's PDF. It works only for small payloads the model actually holds byte-for-byte, such as text it wrote itself.

Two consequences shape the design. First, ChatGPT's file handoff only works on a top-level tool parameter, so it **cannot** go through `call_api_endpoint`, where everything is nested under `body`. Second, the bytes have to be fetched from a URL by our side, because that URL is all ChatGPT gives us.

## Decisions

1. **Add a dedicated MCP tool, `attach_file`, next to the three meta-tools.** It is the only way to receive ChatGPT file objects. Its definition in `packages/agent-tooling/src/tools/definitions.ts` is the documentation. It declares `_meta: { "openai/fileParams": ["file"] }`.
2. **Add one generic REST endpoint, `POST /api/v1/documents` (JSON).** It creates a document from a URL or from base64 and associates it with one entity. Every path uses it: the MCP tool, `call_api_endpoint`, the stdio connector, the in-app chat, and plain API clients. The MCP tool only maps arguments onto it. The multipart ticket route stays as it is for the web UI and existing API users.
3. **The server fetches the URL.** The fetch happens inside the REST service, not in the MCP layer, so there is one hardened fetcher on one host with one set of limits. The stdio connector runs on the user's machine and does no fetching; it forwards the URL. An SSRF guard on a public API endpoint is required anyway, because any API-key holder can call it.
4. **Sources are `url` and `base64` only.** `url` is the primary path, and ChatGPT's `download_url` arrives through it. `base64` is for API callers and small model-held payloads, and the tool description says so. Multipart through `call_api_endpoint` is not offered.
5. **Supported entities: `ticket`, `project_task`, `client`, `contact`, `asset`.** These have REST v1 controllers today and match the web UI upload targets. They are a subset of `DocumentAssociationEntityType`. Each entity is one adapter entry, so `contract` and `opportunity` can be added later without touching the endpoint or the tool.
6. **One upload core.** Validation, storage, the document row, the association, previews and events run in a single core that takes `{ fileName, mimeType, bytes }`. `TicketService.uploadTicketDocument` (multipart) becomes a caller of the core, so `StorageService.validateFileUpload` runs in exactly one place for every REST/MCP upload.
7. **Every upload through the core publishes `DOCUMENT_ASSOCIATED` and the document search event**, the same as the web UI server action (`packages/documents/src/actions/documentActions.ts`, `uploadDocument`). The REST ticket path publishes neither today. This change is intended.
8. **Add MCP `initialize.instructions`** to the hosted server and to the stdio connector. The text is one shared constant exported from agent-tooling. It says: use `attach_file` for any file the user provides; never base64 a file you didn't author; `call_api_endpoint` cannot send multipart; attach one file per call.
9. **The existing multipart registry entry is redirected, not removed.** Its override description tells MCP callers to use `attach_file` or `POST /api/v1/documents`.
10. **Host policy is https only plus a check of the resolved IP. There is no host allowlist.** OpenAI documents no host for `download_url`. Legitimate sources (ChatGPT's file CDN, presigned S3/Azure/GCS URLs) are open-ended. An allowlist built on an undocumented host would break silently. Section 4 lists what the guard blocks.
11. **One file per call.** The tool's `file` field is a single object, not an array. Two files mean two calls, and each call returns its own document or its own error. Batch partial-failure semantics are not worth adding here.

## What changes

### 1. Upload core and entity adapters (server)

New module `server/src/lib/api/services/documents/`:

- **`attachDocument.ts`: `attachDocumentFromBytes({ knex, tenant, actorUserId, target, file: { fileName, mimeType, bytes }, source })`**
  - Runs `StorageService.validateFileUpload(tenant, mimeType, bytes.length)` first and maps its errors to `ValidationError` on path `file` (as `ticketUploadValidationMessage` does now, `TicketService.ts:237`).
  - Calls `StorageService.uploadFile`.
  - Resolves the document type: move `TicketService.getDocumentTypeIdForMime` (`TicketService.ts:1737`) here.
  - Resolves the folder via the adapter.
  - In one transaction: inserts `documents` and `document_associations`, then runs the adapter's in-transaction hook.
  - On rollback, deletes the stored file (same pattern as the draft cleanup in `uploadTicketDocument`).
  - After commit: generates previews (`generateDocumentPreviews`, the logic of today's `persistDocumentPreviews`), then publishes `DOCUMENT_ASSOCIATED` and the search event.
  - Returns the created `IDocument`.
- **`entityAdapters.ts`**: a typed table keyed by entity type. Each entry has:
  - `rbacResource` (`ticket`, `project`, `client`, `contact`, `asset`)
  - `assertCanAttach(apiRequest, entityId, knex)`: existence (404), RBAC `<resource>:update`, plus the kernel read check where that entity already has one. Ticket uses the current `assertTicketReadAllowed` record context (`ApiTicketController.ts:154`). Project task uses the parent project's record context (`ApiProjectController.ts:75`).
  - `resolveFolder`: ticket uses `/Tickets/Attachments` when present. Other entities use the first entity-scoped folder, as `uploadDocument` does.
  - `inTransaction`: ticket writes the `DOCUMENT_ATTACHED` ticket activity with source `API`, the existing behaviour at `TicketService.ts:1406`.
  - The ticket and project record-context builders are currently private and duplicated (Ticket and Project controllers). Move them into a shared module the adapters import, and mark the old sites `// LEVERAGE: pattern ticket-record-context`.
  - The endpoint also requires `document:create`, which matches the server action.
- **`resolveSource.ts`**: turns `source` into `{ bytes, fileName, mimeType }`.
  - **`base64`**: strict decode. Reject invalid characters and padding errors; do not silently drop bytes. Before decoding, reject when `ceil(len*3/4)` exceeds the provider's max file size. `file_name` is required.
  - **`url`**: the safe fetcher (section 4).
    - File name, first match wins: explicit `file_name`, then `Content-Disposition` filename, then the last segment of the URL path. If none yields a name, fail with 400 and tell the caller to pass `file_name`.
    - MIME type, first match wins: explicit `mime_type`, then the type `file-type` sniffs from the bytes (already a dependency of `packages/storage`), then the response `Content-Type` with parameters stripped and only if it isn't `application/octet-stream`, then `application/octet-stream`. `validateFileUpload` then checks the resolved type against the allowlist.
  - File names are sanitized: strip path separators and control characters, cap at 255 bytes.
- **`TicketService.uploadTicketDocument`** keeps its signature. It reads the `File` into bytes and calls the core. The comment-attachment-draft branch stays ticket-only and multipart-only, and moves into the ticket adapter as an option of the in-transaction hook.

### 2. REST endpoint

- **`server/src/app/api/v1/documents/route.ts`**: keep the GET stub and add `POST`, served by a new `ApiDocumentController.attach()` in `server/src/lib/api/controllers/`. The controller uses the same authenticate → `runWithTenant` → adapter `assertCanAttach` sequence as the ticket controller.
- **Request (zod schema in `server/src/lib/api/schemas/`):**
  ```json
  {
    "entity_type": "ticket | project_task | client | contact | asset",
    "entity_id": "uuid",
    "source": { "type": "url", "url": "https://…" } | { "type": "base64", "content": "…" },
    "file_name": "optional for url, required for base64",
    "mime_type": "optional"
  }
  ```
- **Response:** 201 with the created document (same shape as the ticket upload).
- **Errors:**
  - 400 for validation failures: source, size, type not allowed, unsafe URL, fetch failure. The message names the cause, e.g. "URL resolved to a private address", "download exceeded 25 MB", "remote returned 403".
  - 404 when the entity is missing or not readable.
  - 403 for RBAC.
  - A remote error status is reported as 400 with its upstream status. It is never passed through as our own status.
- **OpenAPI:** register the route in `server/src/lib/api/openapi/routes/documents.ts` (`edition: 'both'`, `x-rbac-resource: document`, `x-rbac-action: create`) with full request and response schemas. Update the multipart ticket route's description in `workManagementV1.ts:1073` to point at the new endpoint.
- **Regenerate:** `npm run openapi:generate` (sdk), then `node ee/scripts/generate-chat-registry.mjs`. This rewrites the CE `server/src/lib/mcp/registry.generated.ts` and the EE `ee/server/src/chat/registry/apiRegistry.generated.ts`.
- **Overrides:** add a new `ee/docs/api-registry/documents.json` entry for `post /api/v1/documents`. It carries a model-facing description (URL first, base64 only for small self-authored content, one file per call) and examples for a ticket attach by URL and a contact attach by base64. Add an entry in `tickets.json` for `post /api/v1/tickets/{id}/documents` stating that it is multipart only, not callable through `call_api_endpoint`, and that callers should use `attach_file` or `POST /api/v1/documents`.

### 3. MCP tool and server wiring

- **`definitions.ts`:** add `ATTACH_FILE_TOOL = 'attach_file'` to `buildMetaToolDefinitions`, and add an optional `_meta` to `MetaToolDefinition` so the hosted and stdio servers emit it in `tools/list`.
  - Input schema: `entity_type` (enum of the adapter keys), `entity_id`, then exactly one of `file` | `url` | `content_base64`, plus optional `file_name` and `mime_type`.
  - `file` is an `OpenAIFile` `$defs` object exactly as OpenAI specifies: four properties, `download_url` and `file_id` required, `additionalProperties: false`.
  - `_meta: { "openai/fileParams": ["file"] }`.
  - `file` is **not** listed in `required`, so URL and base64 callers stay valid.
  - The description says when to use each input and that ChatGPT attachments arrive as `file`.
  - Update the file-header comment, which currently says "Three tools".
- **New pure mapper `packages/agent-tooling/src/invoke/buildAttachFileRequest.ts`:** turns tool args into a `BuiltRequest` for `POST /api/v1/documents`. `file.download_url` becomes `source.url`; `file.file_name` and `file.mime_type` fill gaps. It fails fast with messages the model can act on:
  - none or several sources given;
  - `file` is a string, or has no `download_url`;
  - `download_url` is not https, which covers the mobile `chat_upload://` case. That message tells the model to ask the user to re-attach the file from ChatGPT web or desktop.
  - The result never echoes the download URL back, because it is a signed credential.
- **Hosted server `ee/server/src/lib/mcp/jsonRpcServer.ts`:**
  - Dispatch `attach_file` through `buildAttachFileRequest` and the existing `selfFetch` under the caller's key. Agent sessions get the same audit path, with `download_url` and `content_base64` redacted from the audited `arguments`.
  - `initialize` (`jsonRpcServer.ts:142`) returns `instructions`.
- **Stdio connector `packages/alga-mcp-connector/src/server.ts` and `tools.ts`:**
  - Same dispatch through `InstanceClient`. Add a method that sends a `BuiltRequest` directly.
  - Pass `instructions` to `new Server(…, { capabilities, instructions })`.
  - The connector's default request timeout (`ALGA_REQUEST_TIMEOUT_MS`, 30 s) stays above the server fetch budget (below).
  - Mark the duplicated dispatch as `// LEVERAGE: pattern mcp-tool-dispatch`. `resolveEntry` is already marked `registry-resolve-entry`.

### 4. Safe URL fetch

New module `server/src/lib/net/safeFetch.ts`, written against injected `lookup` and `fetch` so tests run with no network.

- **Scheme:** `https:` only. No userinfo in the URL. Default port or 443 only.
- **Address check:** resolve with `dns.lookup({ all: true })`. Reject if **any** resolved address is non-public:
  - IPv4 `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16` (includes cloud metadata), `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`, `255.255.255.255`;
  - IPv6 `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, `64:ff9b::/96`, `2001:db8::/32`;
  - IPv4-mapped / compatible IPv6, which is unwrapped and checked as IPv4;
  - `localhost` and `*.localhost` by name.
- **DNS pinning:** connect to the vetted address through an undici `Agent` whose `connect.lookup` returns that address, so a DNS-rebinding switch between check and connect cannot happen. TLS SNI and certificate checks still use the hostname.
- **Redirects:** `redirect: 'manual'`, at most 3 hops, each hop re-validated (scheme, resolution, pinning). Reject a downgrade to http.
- **Limits:**
  - 15 s connect plus headers, 20 s total, which stays inside the 30 s connector timeout and the MCP client budgets.
  - Size cap = provider `maxFileSize`. Pre-check `Content-Length`, and also count bytes while streaming and abort past the cap, so a missing or lying header doesn't bypass it.
  - GET only. No cookies, no `Authorization`, no forwarded caller headers.
  - Response status must be 2xx.
- **Errors:** a typed `UnsafeUrlError` / `UrlFetchError` maps to the 400s above.
- **No private-range override env.** Unlike `WEBHOOK_SSRF_ALLOW_PRIVATE`, this fails closed. Local and dev tests inject the resolver.
- **Webhooks:** `server/src/lib/webhooks/ssrf.ts` has a narrower blocklist, checks then refetches (rebinding window) and follows redirects. Moving webhooks onto `safeFetch` is a follow-up. Mark it `// LEVERAGE: pattern ssrf-guard` at both sites; webhook delivery is not changed here.

## Order of work

1. Rebase onto the watcher card's branch tip so the spec and registry regeneration starts from its output.
2. Build `safeFetch` and its unit tests.
3. Build the upload core and entity adapters, and move the record-context builders into a shared module. Move `uploadTicketDocument` onto the core and confirm the existing ticket upload and attachment-draft tests (`algadeskTicketAttachmentDrafts.integration.test.ts`) still pass unchanged.
4. Build `resolveSource` (base64 and url) and `POST /api/v1/documents` with its controller and schema.
5. Add the OpenAPI route and description edits, run `openapi:generate`, add the registry overrides, run `generate-chat-registry.mjs`.
6. Add the agent-tooling `attach_file` definition, `buildAttachFileRequest`, and the instructions constant, with unit tests.
7. Wire the hosted MCP server and the stdio connector (dispatch, `_meta` in `tools/list`, `instructions`, audit redaction).
8. Run the tests below, then a live check on the dev server: attach a real multi-page PDF and a PNG to a ticket over `/api/mcp` with `attach_file` using a public https URL; confirm they appear in the ticket Documents panel with previews and that the ticket activity entry exists.

## Tests

- **Round-trip (integration, `server/src/test/integration/`):** `POST /api/v1/documents` with base64 for a ticket and with url (stubbed fetch) for a contact. Assert:
  - the document row, the association and the stored bytes;
  - the ticket activity row;
  - a disallowed MIME type and an oversize payload are rejected with 400 by `validateFileUpload`;
  - a missing or unreadable entity returns 404;
  - an RBAC deny returns 403.
- **Multipart regression:** the existing ticket upload integration coverage passes unchanged, and the core is exercised through it.
- **SSRF (unit, `safeFetch`):**
  - http scheme; `localhost`; `127.0.0.1`; `169.254.169.254`; `10.x`; `[::1]`; `::ffff:127.0.0.1`; `fc00::1`;
  - a hostname resolving to public and private addresses at once;
  - a redirect to a private host; more than 3 redirects; an https→http redirect;
  - an oversize body with and without `Content-Length`; a timeout;
  - a pinned connect address that is used even when a second lookup would return a different IP.
- **Tool mapping (unit, agent-tooling):**
  - an OpenAI file object maps to `source.url` with name and MIME filled;
  - a string-valued `file`, a missing `download_url`, `chat_upload://`, and several sources each give the expected error;
  - `tools/list` includes `_meta["openai/fileParams"]` and the exact four-property `file` schema;
  - `initialize` returns `instructions` (hosted contract test alongside `server/src/test/unit/mcp/mcpSearchApiRegistry.contract.test.ts`, plus the connector's `__tests__`).
- **Registry search (contract):** `search_api_registry` with "attach a file to a ticket" ranks `post /api/v1/documents` above the multipart entry, and the multipart entry's description points at `attach_file`.

## Non-goals

- Changing the web UI upload server action (`packages/documents` `uploadDocument`). It keeps its own pipeline; mark it `// LEVERAGE: pattern document-upload-core` for later migration onto the core.
- Multipart support in `call_api_endpoint` / `buildRequest`.
- Entities beyond the five above (contract, opportunity, quote, invoice, user, tenant, document-parent links).
- Comment-attachment drafts through the JSON endpoint.
- The experimental MCP file-upload extension, `window.openai.uploadFile` widgets, or any UI resource.
- Reading local file paths in the stdio connector.
- A host allowlist or a private-network override for URL fetch.
- Moving webhook delivery onto `safeFetch`.
- Adding `attach_file` to the EE in-app chat tool loop. That loop can already reach `POST /api/v1/documents` through its registry.
- Customer-facing replies on alga-2026-0002707. These go through the founder's Biz Buddy draft, and this card posts internal notes only.

## Risks

- **ChatGPT file param reliability.** The missing or string `file` case (~10% reported) and mobile `chat_upload://` are outside our control. The tool fails fast with a message the model can relay, and the URL and base64 paths remain.
- **`download_url` expiry.** It is fetched once, synchronously, within the call. There is no retry with a stale URL and no queueing.
- **The ChatGPT scan rejects the schema.** The `file` schema follows OpenAI's published shape exactly, and a unit test pins it.
- **Public SSRF surface.** Every API-key holder can make the server fetch public URLs. This is bounded by https only, the public-IP check, pinning, the redirect cap, the size cap and timeouts. The endpoint still requires `document:create` plus `<entity>:update`.
- **On-prem / appliance egress.** Instances without outbound internet cannot fetch ChatGPT URLs. Failures return a clear `UrlFetchError`; base64 still works.
- **Behaviour change on the REST ticket upload.** It now publishes `DOCUMENT_ASSOCIATED` and search events (decision 7). Workflows listening for that event will start firing for API uploads.
- **Spec and registry conflicts with the watcher card.** Rebase before regenerating. Generated files are never hand-merged; always regenerate them.
- **MIME sniffing.** For URL and base64 sources only, the sniffed type overrides a declared or `Content-Type` value. A mislabelled file can therefore be classified differently from what the caller said, which is the intent: the allowlist judges what the bytes actually are.

## Decisions later steps must honour

- The ChatGPT path is `attach_file` with a top-level `file` param plus `_meta["openai/fileParams"]`. Do not route ChatGPT file objects through `call_api_endpoint`.
- The REST surface is the single JSON endpoint `POST /api/v1/documents`. Do not add JSON variants to per-entity routes.
- All REST and MCP uploads go through the shared core. `validateFileUpload` is never bypassed and never duplicated.
- URL fetch goes only through `safeFetch`: https only, public IPs only with pinning, at most 3 re-validated redirects, size cap = provider max, 20 s budget, no override env.
- One file per call, and the signed URL is never echoed or logged.
- The multipart ticket endpoint stays, with its registry description redirected.
- Both MCP servers send the shared `instructions`.
