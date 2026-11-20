# MCP: ticket attachments as native content (image, PDF, text)

Card: 063388b6-bcc1-44f5-9436-af4b94a75e61 · PSA ticket alga-2026-0002814 (Joymode Business Solutions)
Branch: `feature/mcp-return-ticket-attachment-content-natively-im`. Line numbers are from `origin/main` at `3e5fadef35`.
Builds on the attach_file design (`ee/docs/plans/2026-10-20-mcp-doc-attachments.md`, PR #3978, merged). It reuses that design's entity adapters, its `/api/v1/documents` controller, and its rule that hardened work runs once, on the server.

## Problem

Joymode uses the hosted Alga MCP server from ChatGPT Business. They ask the assistant to "review the PDF attached to SR000674" and "review the installation photographs attached to SR000671" (22 JPEGs). Neither works.

- **Binary bodies become garbled text.** Every upstream body is read with `res.text()`:
  - hosted server: `selfFetch`, `ee/server/src/lib/mcp/jsonRpcServer.ts:97`;
  - stdio connector: `InstanceClient.send`, `packages/alga-mcp-connector/src/instanceClient.ts:128`.

  A `call_api_endpoint` on `GET /api/v1/tickets/{id}/documents/{documentId}` decodes JPEG or PDF bytes as UTF-8 and returns them inside a JSON string.
- **The only result shape is JSON text.** The hosted server's `ToolOutcome.content` is typed `Array<{ type: 'text' }>` (`jsonRpcServer.ts:58`), and `textContent()` (`:68`) wraps everything in `JSON.stringify`. The connector returns a single JSON text block (`packages/alga-mcp-connector/src/server.ts:67`). Neither can emit MCP image or resource content.
- **The Markdown export answers 401 to API keys.** Joymode's ticket comment confirms they hit "the Markdown document export endpoint" and got 401. That route is `GET /api/documents/download/{fileId}?format=markdown`:
  - It authenticates with `getSession()` only (`server/src/app/api/documents/download/[fileId]/route.ts:27`).
  - Its OpenAPI entry declares `security: [{ SessionCookieAuth: [] }]` (`server/src/lib/api/openapi/routes/documents.ts:104`).
  - It is still in the MCP registry, so models find it and then fail on it.

  Two sibling routes already accept API keys through an identical, copy-pasted session-then-`x-api-key` block: `/api/documents/{documentId}/content` (`content/route.ts:47-75`) and `/api/documents/{documentId}/download` (`download/route.ts:34-61`). Only the export route is missing it.

## Scope decision (captain, 2026-11-18)

Alga does no AI processing. It delivers each attachment's source content in the richest MCP content form, and the client model does the reading, the vision and the analysis.

## Decisions

### 1. Two layers, each placed once

A model reading an attachment needs two separate things, so there are two layers:

- **(a) Transport.** Decode an upstream HTTP response and turn a tool result into MCP content blocks. This is protocol code with no dependencies. It must run in both MCP servers, so it lives in `@alga-psa/agent-tooling`. That package is already shared by both servers and bundled into the connector by tsup.
- **(b) The attachment content engine.** Turn a stored attachment into content blocks, dispatched on content type. This needs `sharp`, Ghostscript (through `pdf2pic`), `unpdf`, `mammoth` and the storage layer. It must also run behind authorization. It runs **on the server only**, behind one REST endpoint. Both MCP servers reach it through that endpoint, using the same `read_attachment` tool and the same transport mapper.

**Why the engine is not in agent-tooling:**

- The stdio connector is an MIT package published to npm and runs on the user's machine. Bundling `sharp`'s native binaries, Ghostscript and a PDF engine into it would be fragile on every platform.
- It would also mean shipping original bytes to the client so they could be extracted there.
- Authorization has to run on the server either way.

This follows decision 3 of the attach_file design: the hardened work (there, the URL fetch) runs once, on one host, and the connector forwards.

#### 1a. Transport layer (`packages/agent-tooling/src/content/`)

New files:

```ts
// content/blocks.ts — the MCP content union we emit (MCP 2025-06-18).
export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }                     // base64
  | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } }
  | { type: 'resource_link'; uri: string; name: string; mimeType?: string; size?: number; description?: string };
export function isMcpContentBlock(value: unknown): value is McpContentBlock;   // strict guard, rejects anything else

export interface ToolResult {
  content: McpContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
  statusCode?: number;
}
export function jsonToolResult(data: unknown, isError: boolean, statusCode?: number): ToolResult; // today's textContent()

// content/readResponseBody.ts — replaces both res.text() sites.
export type UpstreamBody =
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; value: string }
  | { kind: 'binary'; contentType: string; byteLength: number | null; fileName: string | null };
export async function readResponseBody(res: Response): Promise<UpstreamBody>;
```

`readResponseBody` dispatches on the response `Content-Type`:

- `application/json` or `+json` → parsed. Malformed JSON falls back to text.
- `text/*`, `application/xml`, `+xml`, `text/markdown` → text.
- Anything else → `binary`. The body is cancelled, never decoded. The JSON the model sees is:

  ```json
  { "binary": true, "content_type": "...", "byte_length": n, "file_name": "...",
    "hint": "Binary content is not returned by call_api_endpoint. Use read_attachment to read ticket attachments." }
  ```

This applies the rule "never raw bytes as text" to every endpoint, not only the new tool.

```ts
// content/attachmentRead.ts — the read_attachment wire contract and its mapper.
export interface AttachmentReadHeader { /* see section 5 */ }
export interface AttachmentReadPayload { header: AttachmentReadHeader; blocks: McpContentBlock[] }
export function attachmentReadToToolResult(payload: unknown, status: number): ToolResult;
```

`attachmentReadToToolResult` validates every block with `isMcpContentBlock`. It drops and reports any block it does not recognise, so an unknown shape can never reach a client. It returns:

```ts
content: [{ type: 'text', text: JSON.stringify(header) }, ...blocks]
structuredContent: header
```

The header is **always** `content[0]`. The audit summary depends on that (Risks, R1).

#### 1b. Shared meta-tool dispatch (`packages/agent-tooling/src/dispatch/dispatchMetaTool.ts`)

Both servers carry the same `if (name === …)` chain today. It is already marked `// LEVERAGE: pattern mcp-tool-dispatch` at `jsonRpcServer.ts:173` and `packages/alga-mcp-connector/src/tools.ts:65`. A fifth tool would be the third copy of that pattern, so it becomes one table:

```ts
export interface MetaToolTransport {
  /** Send a built request to the instance; the caller owns auth, base URL, act-as and timeouts. */
  send(req: BuiltRequest, opts?: { actAsUserId?: string | null }): Promise<{ status: number; ok: boolean; body: UpstreamBody }>;
}
export interface MetaToolContext {
  registry: ChatApiRegistryEntry[];
  transport: MetaToolTransport;
  actAsUserId?: string | null;   // hosted agent sessions only; the connector never sets it
}
export async function dispatchMetaTool(name: string, args: Record<string, unknown>, ctx: MetaToolContext): Promise<ToolResult>;
```

Inside is a `Record<toolName, handler>`. Each handler builds a `BuiltRequest` with the existing pure builders (`buildRequest`, `buildAttachFileRequest`, the new `buildReadAttachmentRequest`, and a search builder moved from the two copies), sends it, and maps the result:

- `read_attachment` maps through `attachmentReadToToolResult`;
- every other tool maps through `jsonToolResult`.

**Contract:** for the four existing tools the output stays byte-identical to today, as long as the upstream body is JSON. Snapshot tests pin this (Implementation, stage 1).

**Call sites after the change:**

`ee/server/src/lib/mcp/jsonRpcServer.ts`:

- Delete `textContent`/`toolOk`/`toolErr`, the body of `dispatchTool`, and the `res.text()` in `selfFetch`.
- `selfFetch` becomes the transport:

  ```ts
  const transport: MetaToolTransport = {
    send: (req, opts) => selfSend(ctx.baseUrl, req, ctx.apiKey, opts?.actAsUserId), // uses readResponseBody
  };
  out = await dispatchMetaTool(name, args, { registry: ctx.registry, transport, actAsUserId: actAsFromArgs(args, ctx) });
  ```

- `ToolOutcome` is replaced by `ToolResult`.
- `handleOne` keeps its try/catch, the act-as argument decoration (`withActAsArgument`) and the agent audit.
- `resultSummary` stays `out.content[0].text`. Because the header comes first, that is the header and never base64.

`packages/alga-mcp-connector/src/instanceClient.ts`:

- `send()` uses `readResponseBody`.
- A new public `transport(): MetaToolTransport` wraps `sendBuilt`.

`packages/alga-mcp-connector/src/server.ts`:

- The `CallToolRequestSchema` handler becomes:

  ```ts
  const r = await dispatchMetaTool(name, args, { registry: opts.registry, transport: opts.client.transport() });
  return { content: r.content, structuredContent: r.structuredContent, isError: r.isError };
  ```

- The catch block keeps returning a JSON error result.

`packages/alga-mcp-connector/src/tools.ts` is deleted. Its `resolveEntry` copy goes too, resolving `// LEVERAGE: pattern registry-resolve-entry` for the connector.

#### 1c. Attachment content engine (`packages/documents/src/lib/attachmentContent/`)

```ts
// index.ts
export interface AttachmentSource {
  document: { document_id: string; document_name: string; mime_type: string | null; file_id: string | null;
              file_size: number | null; updated_at: string };
  /** Lazy: called at most once per request, only by producers that need bytes. */
  loadBytes(): Promise<Buffer>;
  /** In-app (BlockNote / text) body for documents without a file. */
  loadInAppMarkdown(): Promise<string | null>;
}
export interface ContentBudget { maxImages: number; maxEncodedBytes: number; maxTextChars: number; deadlineMs: number }
export interface ReadPosition { docIndex: number; unitIndex: number }

export async function readAttachmentContent(
  sources: AttachmentSource[],          // already authorized, in stable order
  start: ReadPosition,
  budget: ContentBudget,
): Promise<{ blocks: McpContentBlock[]; served: ServedRange[]; omitted: Omission[]; next: ReadPosition | null; limitsApplied: LimitName[] }>;
```

The engine has three parts:

- **Producers.** One module per type under `producers/`. Each implements:

  ```ts
  interface AttachmentProducer {
    name: string;
    /** Exact MIME types and `type/*` wildcards this producer owns. */
    accepts: readonly string[];
    /** Enumerate the attachment's units lazily; a unit is the smallest piece ever split across calls. */
    units(source: AttachmentSource, ctx: ProducerCtx): AsyncIterable<ContentUnit>;
  }
  interface ContentUnit { label: string; materialize(): Promise<McpContentBlock[]>; cost(): UnitCost }
  ```

- **Dispatch.** `producers/registry.ts` holds one ordered table. The lookup order is:
  1. exact MIME type;
  2. `type/*` wildcard;
  3. the fallback producer.

  The effective MIME type comes from `resolveEffectiveMime(document, firstBytes)`. It uses the stored `mime_type`, corrected by a `file-type` sniff of the first 4 KiB when the stored type is missing, `application/octet-stream`, or contradicts the bytes. `file-type` is already a dependency of `packages/storage`. Documents with no `file_id` always go to the in-app producer.

  No caller checks a type. Adding XLSX later means adding one producer and one table entry.
- **Packer.** `packer.ts` walks the units from `start` and materializes each one, stopping before a unit that would exceed the remaining budget. Before each unit's blocks it emits a one-line text label:

  ```
  [3/22] IMG_0412.jpg (image/jpeg, scaled from 4032×3024 to 1568×1176)
  ```

  The first unit of a call is always admitted. Producers guarantee that a single unit fits an empty budget: images are bounded by downscaling, text by chunk size. So every call makes progress.

### 2. Type mapping

| Effective type | Producer | Units | Blocks per unit |
|---|---|---|---|
| `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/tiff`, `image/bmp`, `image/heic`/`heif` (when the sharp build decodes it) | `image` | 1 per file | `image` |
| `application/pdf` | `pdf` | `original` (when eligible), then 1 per page | `original`: `resource` blob `application/pdf`. Page: `text` (text layer), or `image` (rendered) when the page has no usable text layer |
| `text/plain`, `text/markdown`, `text/csv`, `application/json`, `application/xml`, `text/xml` | `text` | chunks of ≤ 60,000 chars split at line boundaries | `text` |
| `text/html` | `html` | as `text`, after HTML → Markdown | `text` |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `docx` | as `text`, after DOCX → HTML → Markdown | `text` |
| no `file_id` (BlockNote / in-app text documents) | `inApp` | as `text` | `text` |
| anything else, unreadable images, files over the size cap | `fallback` | 1 | `resource_link` plus a metadata `text` line |

**Images**

- Decoded with `sharp` (`limitInputPixels: 100_000_000`), auto-rotated from EXIF, and EXIF metadata stripped from the output.
- **Downscale rule:** if the long edge is over **1568 px** or the file is over **1 MiB**, resize to fit 1568 px on the long edge (never upscale). Re-encode as JPEG quality 80, or PNG when the source has alpha.
- An image already ≤ 1568 px and ≤ 1 MiB in a client-native format (JPEG, PNG, WebP, GIF) is passed through unchanged. TIFF, BMP and HEIC are always converted to JPEG.
- **Why 1568 px:** it is Claude's documented maximum useful edge before server-side resizing, and above OpenAI's high-detail tile working size (768 px short side). Larger images spend bytes on detail no client keeps.
- A typical 4032×3024 phone JPEG comes out at about 250–450 KiB, roughly 330–600 KiB as base64.
- When sharp cannot decode the file (for example HEIC on a prebuilt sharp without HEVC), the image goes to `fallback`, and the label line says why.

**PDF**

- **Library: `unpdf`** (new dependency of `packages/documents`), for both the text layer and the page count. `unpdf` is pdf.js packaged for server runtimes: no worker setup, no canvas, and ESM that works in the Next `nodejs` runtime. Using `pdfjs-dist` directly in Next.js needs the legacy build plus worker-path configuration. That is a known source of build breakage, and it would give us the same pdf.js extraction with more wiring.
- Text is read per page from `getTextContent()`, with **`isEvalSupported: false`** (pdf.js font-eval CVE-2024-4367). Each page becomes:

  ```
  --- Page 4 of 12 (text layer) ---
  …
  ```

- **Scanned pages:** a page whose text layer has fewer than **16 non-whitespace characters** counts as having no text layer. It is rendered to an image: 150 DPI, fit to 1568 px long edge, JPEG quality 80. Its label is `--- Page 4 of 12 (no text layer; page image) ---`.
- **Rendering reuses the Ghostscript path** (`pdf2pic`) that preview generation already uses. Ghostscript is installed in every server image (`Dockerfile:19`, `ee/server/Dockerfile:19`, and both `Dockerfile.dev`). That avoids adding `@napi-rs/canvas` as a second native renderer.
  - The single-page render in `packages/documents/src/lib/documentPreviewGenerator.ts:441-490` moves into `packages/documents/src/lib/pdfPageRender.ts` as `renderPdfPages(pdfPath, pages, { dpi, maxEdgePx, timeoutMs })`.
  - Both preview generation and the engine call it.
  - Per-page timeout here is **10 s**; preview keeps `PDF_RENDER_TIMEOUT_MS`.
- **The original PDF** is emitted as a `resource` block when all of these hold:
  - its size is ≤ **1.5 MiB** (about 2 MiB as base64);
  - the call starts at page 1 of that document;
  - it fits the remaining byte budget.

  The URI is the document's in-app download URL (section 3). Larger originals get no blob; the header says `original_omitted: "size"`, and a `resource_link` is emitted instead.

  The blob is the full-fidelity path: figures, tables and layout reach any client that passes PDFs to its model. Text and page images are the path that works on every client. The verification plan (section 6) decides whether the blob stays.
- PDFs over **50 MiB** (checked from `file_size` before download) go to `fallback`.
- Encrypted PDFs that pdf.js cannot open go to `fallback` with reason `encrypted`.

**DOCX / HTML / text**

- **DOCX:** `mammoth.convertToHtml` (new dependency), then `turndown` (already in the root `package.json`; add it to `packages/documents`). Images embedded in the DOCX are dropped and counted in the label, e.g. `(3 embedded images not included)`.
- **HTML:** `turndown` with `script`/`style` removed.
- **Text:** decoded as UTF-8; a BOM selects UTF-16.
- **In-app documents:** `buildDocumentMarkdown(blockData, textContent)` (`packages/documents/src/lib/documentMarkdownExport.ts:3`). This is the conversion the Markdown export and the API-key download route already use, so it is reused as-is.

**Unknown types**

- Output is a `resource_link` (`uri` = in-app download URL, `name`, `mimeType`, `size`) plus a text line:

  ```
  [5/9] site-survey.xlsx (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, 84 KiB): content type not readable through read_attachment; the user can open it in Alga.
  ```

- Bytes are never emitted as text or as a blob for these types.

### 3. Authorization, the tool, and the 401

**Tool: `read_attachment`** (agent-tooling `definitions.ts`, added to `buildMetaToolDefinitions`). The input schema mirrors attach_file's entity addressing:

| Param | Type | Required | Meaning |
|---|---|---|---|
| `entity_type` | enum, generated from the adapters that implement reading; today `["ticket"]` | yes | owner of the attachments |
| `entity_id` | string | yes | ticket UUID, or a ticket number such as `SR000674` (the ticket adapter resolves numbers) |
| `document_id` | string | no | read one attachment; omit to read all of the entity's attachments in order |
| `cursor` | string | no | the `next_cursor` from a previous result; continue where it stopped |

Draft description:

> Read the content of files attached to a ticket so you can analyse them yourself. Images come back as images. PDFs come back as the original file plus per-page text, with scanned pages as page images. Documents and notes come back as text. Omit document_id to read every attachment on the ticket. Results arrive in parts: if the result header has next_cursor, call again with the same entity and that cursor.

`redactToolArguments` needs no entry: no argument is secret.

**REST endpoint: `GET /api/v1/documents/content`**

- Query: `entity_type`, `entity_id`, `document_id?`, `cursor?`.
- Served by a new `ApiDocumentController.readContent()` in `server/src/lib/api/controllers/ApiDocumentController.ts`, next to `attach()`. Route file: `server/src/app/api/v1/documents/content/route.ts`.
- Authentication is the standard v1 `authenticate(req)`: `x-api-key`, which carries the hosted server's minted user and agent session keys, or a session. No new auth code.

**Authorization:**

1. `assertEntityAvailableForProduct(adapter, tenant)`, unchanged from attach_file.
2. `adapter.listReadableDocuments(apiRequest, entityId, knex)`. This is a new optional member of `EntityAdapter` in `server/src/lib/api/services/documents/entityAdapters.ts`, and only adapters that implement it appear in the tool's enum. For `ticket` it calls a new shared function, `authorizeTicketDocuments(apiRequest, ticketId, knex)`, extracted from `ApiTicketController.getDocuments()`:
   - `checkPermission(ticket:read)`;
   - `assertTicketReadAllowed` (the ticket read kernel; `ApiTicketController.ts:181`);
   - `TicketService.getTicketDocuments`, which applies client-portal `is_client_visible` and the comment-attachment audience filter `filterReadableCommentAttachments` (`TicketService.ts:1056`);
   - `reprojectUnderDecision(ticketGate, documents, TICKET_DOCUMENT_SOURCE)`.

   `ApiTicketController.getDocuments()` and `assertTicketDocumentReadAllowed` (`:208`) are refactored to call the same function, so one gate serves REST listing, REST download and the MCP read.
3. For each document that survives step 2: `canReadDocument(user, documentId)` and `getAuthorizedDocumentById(trx, tenant, user, documentId)`. This is the gate pair the API-key download route uses (`server/src/app/api/documents/[documentId]/download/route.ts:70-85`).
   - A document is served only when both gates admit it.
   - Content is served only when the kernel's projection kept the `content` field, as the content route does (`content/route.ts:117`).
   - A document that fails either gate is **silently left out** of a whole-ticket read. With an explicit `document_id`, it returns 404. Either way, existence is not confirmed.
4. `document_id` must be among the authorized documents. A cursor is re-validated against the authorized list on every call; authorization is never cached in the cursor.

Bytes come from `StorageService.downloadFile(file_id)` inside `AttachmentSource.loadBytes`. The engine never sees an unauthorized document.

**OpenAPI and registry**

- The endpoint is registered in `server/src/lib/api/openapi/routes/documents.ts` (`x-rbac-resource: ticket`, `x-rbac-action: read`) with **`x-chat-exclude: true`**.
- `ee/scripts/generate-chat-registry.mjs` gains a check that skips operations carrying that flag. Reason: through `call_api_endpoint` this response would reach the model as base64 inside JSON text, which is the bug being fixed. Only `read_attachment` calls it.
- Registry overrides in `ee/docs/api-registry/tickets.json` for `GET /api/v1/tickets/{id}/documents/{documentId}`, and in `documents.json` for both download routes, say: "to read an attachment's content, use read_attachment".

**The 401: API-key auth on the Markdown/export route**

- New `server/src/lib/api/documentRoutePrincipal.ts`:

  ```ts
  export async function resolveDocumentRoutePrincipal(request: NextRequest):
    Promise<{ ok: true; tenant: string; user: IUser } | { ok: false; response: NextResponse }>;
  ```

  This is the block duplicated at `content/route.ts:47-75` and `[documentId]/download/route.ts:34-61`, moved unchanged:
  1. **session first**, through `getCurrentUser()`;
  2. otherwise `x-api-key` → `validateApiKeyAnyTenant` → `findUserByIdForApi` → `assertApiPrincipal` (internal users only);
  3. otherwise 401.

  Session callers take exactly the branch they take today, so nothing changes for them. The API-key branch applies the same principal rule as the routes that already accept keys.
- All three routes call it:
  - `content/route.ts`;
  - `[documentId]/download/route.ts`;
  - `download/[fileId]/route.ts`. Here it replaces `getSession()` at `:27`, and the PDF branch's `userId: session.user.id` (`:168`) becomes `principal.user.user_id`.
- The original-file branch of `download/[fileId]` currently calls the `downloadDocument` server action. That action is `withAuth`, so it is session-bound and would still 401 for keys. The branch instead calls a `serveDocumentFile(document)` helper extracted from `[documentId]/download/route.ts:117-141`. This resolves `// LEVERAGE: pattern document-byte-serving` at both sites.
- `coManagedWorkspaceDenial` stays in each route, after principal resolution.
- OpenAPI: `download/{fileId}` security becomes `[{ SessionCookieAuth: [] }, { ApiKeyAuth: [] }]`, with `x-auth-modes: ['session-cookie', 'api-key']`. Then regenerate the spec and registry.
- Middleware already exempts these paths from the global key check (`server/src/middleware.ts:153`, `:305-307`), because each route authenticates itself. No middleware change.

### 4. Non-persistence and caching

- **No copies.** Original bytes are read from storage into process memory for one request and dropped when it ends.
- **One unavoidable exception:** Ghostscript needs a file path. When a call renders scanned pages, the PDF is written to a `mkdtemp` directory and removed in `finally`, the same lifecycle as preview generation. Nothing is written to storage, the database or any shared cache.
- **No extraction cache in this version.**
  - Text extraction (pdf.js) and image downscaling cost tens to low hundreds of milliseconds.
  - Scanned-page rendering costs about 0.5–2 s per page. It is bounded per call by the image cap (8) and the deadline (section 5), so a call with no cache still fits the client timeouts.
  - Requests are spread across pods with no stickiness, so an in-process cache would rarely hit.
  - A shared cache would be a second store of customer content. It would need authorization-aware keys and its own retention policy, and the current read volume does not justify that.
  - "Cache miss for a scan" therefore means simply that the scan renders on the call that reaches it.
  - If production timings later show renders dominating, the cache to add is a Redis entry keyed `attcontent:v1:{tenant}:{file_id}:{updated_at}:{page}:{dpi}`. It would hold the rendered page only, with a TTL of 10 minutes, so that one pagination session hits. Invalidation comes from the key itself: a replaced file changes `file_id`/`updated_at`. That is recorded here as the shape to use, not built now.
- **Cursor staleness.** The cursor carries `(document_id, file_id, updated_at)` for every document it covers. If any of those has changed by the next call, the call fails with `409 CURSOR_STALE`: "The attachments changed since this read started; call read_attachment again without a cursor." It does not silently serve a mix of old and new.

### 5. Large and many-attachment reads

The budget is per call. All numbers are constants in `attachmentContent/limits.ts`, where the verification step can tune them:

| Limit | Value | Why |
|---|---|---|
| image blocks per call (photos + rendered pages) | **8** | Keeps one result within what vision models accept per turn, and bounds render time |
| encoded payload per call (base64 of images + blobs) | **4 MiB** | Conservative until client limits are measured (section 6) |
| text per call | **60,000 chars** (about 15k tokens) | Fits the smallest common client tool-output limit (Claude Code's default MCP output cap is 25k tokens) with room for the header |
| deadline per call | **20 s** of packing time | The connector's request timeout is 30 s (`packages/alga-mcp-connector/src/config.ts:40`), and `selfFetch` has no timeout of its own |
| PDF original blob | ≤ **1.5 MiB** raw, first call for that document only | Stays inside the payload budget alongside page content |
| PDF processed at all | ≤ **50 MiB** | `unpdf` needs the whole buffer in memory |

**Pagination.**

- Everything is one ordered stream of units. A whole-ticket read follows the ticket's attachments in a **stable order**, `(association_created_at, document_id)`, not `getTicketDocuments`' `updated_at desc`, which can reorder between calls. Within each attachment, units go in natural order.
- The cursor is an opaque base64url JSON string: `{ v: 1, entity, document_id|null, docIndex, unitIndex, fingerprints }`. It is not signed, because authorization re-runs on every call. Tampering can only point at units of documents the caller may already read.
- The same mechanism covers a 22-photo ticket and a 300-page PDF.

**Expected shapes:**

- **SR000671 (22 JPEGs):** about 7–8 photos per call (byte budget first), so 3–4 calls.
- **SR000674 (PDF):**
  - first call: the original blob (if ≤ 1.5 MiB), then text pages until 60k chars;
  - a scanned PDF: 8 page images per call.

**Result header.** It is always `content[0]` and is also sent as `structuredContent`:

```json
{
  "entity": { "type": "ticket", "id": "…", "label": "SR000671" },
  "served": [
    { "document_id": "…", "name": "IMG_0410.jpg", "mime_type": "image/jpeg", "part": "image", "rendering": "image" },
    { "document_id": "…", "name": "Install Guide.pdf", "mime_type": "application/pdf",
      "part": "pages 1-6 of 14", "rendering": "original+text", "scanned_pages": [5] }
  ],
  "omitted": [{ "document_id": "…", "name": "site.heic", "reason": "unreadable_image" }],
  "limits_applied": ["max_encoded_bytes"],
  "remaining": "pages 7-14 of Install Guide.pdf, then 15 more attachments",
  "next_cursor": "eyJ2IjoxLC4uLn0",
  "instructions": "More content remains. Call read_attachment with the same entity_type and entity_id and cursor set to next_cursor to continue."
}
```

When nothing remains, `next_cursor` is `null`, and `instructions` says the read is complete. A truncated result is never an error: `isError` is `false`, and the header states exactly what was served and what remains. `omitted` lists attachments that cannot be read in this format, with the reason, so the model can tell the user.

### 6. Verification plan for what reading the code cannot settle

The implementation step runs this plan. Its results are recorded on the card before any limit or default is changed.

**V1. Does the client pass MCP image content to the model?** (This decides the core value for SR000671.)

- **Clients:** ChatGPT Business (custom connector, developer mode) against the hosted server; Claude Desktop with the stdio connector; MCP Inspector as ground truth for what was sent.
- **Steps:** on a dev ticket, attach a photo containing an unambiguous visual fact that appears in no text anywhere, such as a hand-written serial number. Ask "what serial number is written on the device in the attached photo?"
- **Falsified if** the model cannot answer while Inspector shows the `image` block was sent. Then that client drops image content.
- **Fallback:** none is possible inside the scope decision; alternatives would be OCR or captioning, which are AI processing. Report to the captain with evidence. A client that does not show tool-result images to its model cannot be fixed on our side.

**V2. Does the client pass embedded PDF resource blobs to the model?**

- **Steps:** use a fixture PDF where one page has a normal text layer **and** an embedded image containing a word (e.g. `CANARY-7Q`) that is absent from every text layer. The page has text, so the engine sends it as text only; the word can reach the model only through the blob. Ask "is the word CANARY anywhere in the attached PDF? quote it".
- **Falsified if** the model cannot find it. That client drops or ignores `resource` blobs.
- Then repeat with Joymode's **SR000674**, through Joymode (the captain or support arranges a session; we do not copy customer files into dev). Ask the question from their ticket: "summarize the Citrix migration instructions and compare them against the checklist". Record whether the answer cites content that only exists in figures.
- **Fallback if any primary client drops blobs:**
  - set `PDF_EMBED_ORIGINAL = false` globally. The hosted server is stateless per request (there is no MCP session to key per-client shaping on), so it cannot shape per client.
  - Also render to images the pages that carry raster figures, in addition to their text. Detection uses pdf.js's operator list (`paintImageXObject` ops covering > 15% of the page area).
  - This keeps figures readable through image content, which V1 has proven, and spends no payload on blobs that get dropped.

**V3. Per-client result size limits.**

- **Steps:** a debug override (dev only, env `ATTACHMENT_CONTENT_BUDGET_OVERRIDE`) to send results of 1, 2, 4, 8 and 12 MiB encoded. For each client, record the size at which the call errors, the result is truncated, or images stop being seen.
- **Decision rule:** set `maxEncodedBytes` to 75% of the smallest failing size among ChatGPT Business, Claude (claude.ai and Desktop) and Cursor, and never above 8 MiB.
- Repeat with 8 vs 12 vs 20 images per call for the image cap.

**V4. Timeouts.** Time a 40-page fully scanned PDF in the dev stack. The first call must return within 20 s with 8 rendered pages and a cursor. If Ghostscript is slower than 2.5 s per page at 150 DPI, lower the DPI to 120 before lowering the image cap.

**V5. The 401 regression.** Over `call_api_endpoint`, call `GET /api/documents/download/{fileId}?format=markdown` with an API key for an in-app document. Expect 200 text/markdown, where today it is 401. The same call from the web UI (session) still returns 200.

### 7. Not doing

- No summarisation, captioning, classification or translation of attachments.
- No model-based OCR. Scanned pages are delivered as images; the client's model reads them.
- No AI processing of any kind inside Alga.
- No new storage. No copy of the original, no stored extraction, no shared cache. The Redis page cache in section 4 is documented, not built.
- No per-type special cases outside the content engine. Callers never branch on MIME type.
- No changes to the attach_file upload path (`POST /api/v1/documents`, `buildAttachFileRequest`, `safeFetch`, allowed hosts). Moving its dispatch into `dispatchMetaTool` must leave its behaviour byte-identical.
- No MCP `resources/read` / `resources` capability. `resource_link` URIs point at the in-app download URL, which a human can open in Alga. Making links model-readable is a separate card if V2 shows clients would use it.
- No entities other than tickets in this card. The adapter member is in place; enabling project tasks, clients, contacts or assets is one adapter method each.
- No XLSX, PPTX, email (`message/rfc822`) or archive extraction. Each is one future producer.

## Implementation sequence

Each stage ends green before the next starts. Stage 1 must merge with byte-identical outputs for the existing tools.

1. **agent-tooling transport and dispatch.** Add `content/blocks.ts`, `content/readResponseBody.ts`, `content/attachmentRead.ts`, `dispatch/dispatchMetaTool.ts`, the `read_attachment` definition, and `invoke/buildReadAttachmentRequest.ts`.
   - *Proof:* unit tests for `readResponseBody` (json/text/binary/malformed), the block guard, the header-first mapper, and the request builder.
   - *Proof:* snapshot tests showing the four existing tools give identical results through `dispatchMetaTool` against a fake transport.
2. **Rewire both MCP servers onto `dispatchMetaTool`.** Change `jsonRpcServer.ts` (selfFetch as transport, `ToolResult`) and `instanceClient.ts`/`server.ts`; delete `tools.ts`.
   - *Proof:* the existing hosted MCP tests and connector tests pass.
   - *Proof:* a new test where `call_api_endpoint` on a binary response returns the `binary: true` JSON, not garbled text.
3. **Document route principal (the 401 fix).** Add `documentRoutePrincipal.ts` and `serveDocumentFile`, and apply them to the three routes. Update the OpenAPI security entry and regenerate the spec and registry.
   - *Proof:* integration tests for markdown, pdf and original export on `download/{fileId}`: API key → 200, no credentials → 401, client-portal-user key → 401, session → unchanged.
   - *Proof:* the content and download routes' existing tests still pass.
4. **Content engine.** Add the `attachmentContent/` producers, registry, packer, cursor and limits, plus `pdfPageRender.ts` extracted from the preview generator. Add the `unpdf`, `mammoth` and `turndown` dependencies to `packages/documents` (do not commit `package-lock.json` churn outside these).
   - *Proof:* unit tests over fixtures in `packages/documents/src/lib/attachmentContent/__fixtures__/`:
     - small PNG passthrough; 4032×3024 JPEG downscaled to 1568 with EXIF stripped; PNG with alpha;
     - undecodable HEIC → fallback;
     - born-digital 3-page PDF → blob + 3 text pages; scanned 2-page PDF → 2 images; mixed PDF; encrypted PDF → fallback; oversize PDF → fallback;
     - DOCX → Markdown; HTML → Markdown; 150k-char text → 3 chunks;
     - in-app BlockNote → Markdown; ZIP → resource_link;
     - packer budgets (each limit triggers and names itself in `limits_applied`), the always-progress rule, and cursor round-trip and staleness.
   - *Proof:* existing preview generator tests still pass.
5. **Ticket read gate.** Extract `authorizeTicketDocuments` and point `ApiTicketController.getDocuments`/`assertTicketDocumentReadAllowed` at it. Add `listReadableDocuments` to the ticket adapter, and add the ticket-number resolution.
   - *Proof:* the existing ticket document API tests pass unchanged.
6. **REST endpoint.** Add `ApiDocumentController.readContent()`, the route, the zod schema, OpenAPI with `x-chat-exclude`, the generator skip, the registry overrides, and the regeneration.
   - *Proof:* integration tests:
     - another tenant's ticket → 404;
     - no `ticket:read` → 403;
     - ticket kernel denial → 404;
     - document kernel denial: omitted from the whole-ticket read, 404 when explicit;
     - client-portal visibility and comment-attachment audience respected;
     - stale cursor → 409;
     - the endpoint is absent from the generated registry.
7. **Live check on the dev server** (`http://feature-mcp-return-ticket-attachment-content-natively-im.localhost:3238`). Use MCP Inspector against `/api/mcp` and Claude Desktop with the locally built connector. Read a ticket with 22 photos, then a scanned PDF and a born-digital PDF, following cursors to the end. Confirm every attachment is served exactly once.
8. **Verification plan V1–V5** (section 6). Record the results on the card and apply the limit and default changes they call for.

## Risks

- **R1. Audit summary.** `jsonRpcServer.ts:242` stores `out.content[0].text` as the audit `resultSummary`. If any result began with an image block, the summary would be `undefined`; a blob-first result could put base64 in the audit table. Mitigation: the mapper guarantees the header-first contract, and a unit test pins it. Add `read_attachment` to `redactToolResult` so the summary keeps only `served`/`omitted`/`next_cursor` names and counts.
- **R2. Whole-file reads.** `StorageService.downloadFile` buffers the whole file. Mitigation: the 50 MiB PDF cap and an image cap at the provider's `maxFileSize`, both checked against `documents.file_size` before download. One `loadBytes()` per document per call.
- **R3. Untrusted parsers in the web process.**
  - pdf.js on hostile PDFs: `isEvalSupported: false`.
  - sharp decompression bombs: `limitInputPixels`.
  - Ghostscript on hostile PDFs: `-dSAFER` is pdf2pic's default; confirm it is set.
  - Each render has its own timeout. Rendering runs only for pages with no text layer, and at most 8 per call.
- **R4. Unstable list order.** `getTicketDocuments` orders by `updated_at desc` (`TicketService.ts:1056`). Mitigation: the engine re-sorts to the stable key, and staleness detection covers edits.
- **R5. `downloadTicketDocument` cannot serve in-app documents.** It 404s when `file_id` is null (`TicketService.ts:1594`). The engine must not go through it: `AttachmentSource` uses `StorageService` directly for files and `buildDocumentMarkdown` for in-app docs, after the gates in section 3.
- **R6. Stored MIME types are wrong.** Phone uploads arrive as `application/octet-stream`, and HEIC is labelled as JPEG. Mitigation: the `file-type` sniff in `resolveEffectiveMime`; a sniff/declared mismatch is noted in the label line.
- **R7. HEIC decoding** depends on the sharp build. Prebuilt sharp has no HEVC decoder. SR000671's files are JPEGs, but other customers' iPhone photos may not be. They fall back with a clear reason; a libheif-enabled build is a separate infrastructure decision.
- **R8. Moving the dispatch** (`dispatchMetaTool`) touches attach_file's live path. Mitigation: the stage 1 snapshot tests, and the act-as and audit wrapping stays in `handleOne`, unchanged.
- **R9. Client limits are unknown until V3.** The starting numbers are conservative, so the cost of being wrong is extra calls, not failed calls.
- **R10. Shared rendering code.** `documentPreviewGenerator.ts:441-490` and the engine will share `renderPdfPages`. A regression there breaks previews too, so stage 4 runs the preview tests.
