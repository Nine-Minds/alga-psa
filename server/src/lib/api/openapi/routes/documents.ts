import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import { ATTACHABLE_ENTITY_TYPES } from '../../schemas/documentAttach';
import { READABLE_ENTITY_TYPES } from '../../schemas/documentContentRead';

export function registerDocumentRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Documents';

  const DocumentDownloadParams = registry.registerSchema(
    'DocumentDownloadParams',
    zOpenApi.object({
      fileId: zOpenApi
        .string()
        .uuid()
        .describe('Document UUID or file UUID. The download handler resolves document_id first, then file_id.'),
    }),
  );

  const DocumentFileIdParams = registry.registerSchema(
    'DocumentFileIdParams',
    zOpenApi.object({
      fileId: zOpenApi
        .string()
        .uuid()
        .describe('File UUID from external_files.file_id identifying the stored file to serve.'),
    }),
  );

  const DocumentIdDownloadParams = registry.registerSchema(
    'DocumentIdDownloadParams',
    zOpenApi.object({
      documentId: zOpenApi
        .string()
        .uuid()
        .describe('Document UUID from documents.document_id, or file UUID from documents.file_id. The handler resolves document_id first and falls back to file_id.'),
    }),
  );

  const DocumentIdDownloadHeaders = registry.registerSchema(
    'DocumentIdDownloadHeaders',
    zOpenApi.object({
      'x-api-key': zOpenApi
        .string()
        .optional()
        .describe('Optional API key for machine-to-machine download requests. Used only when no valid Auth.js session cookie is present.'),
    }),
  );

  const DocumentDownloadQuery = registry.registerSchema(
    'DocumentDownloadQuery',
    zOpenApi.object({
      format: zOpenApi
        .enum(['pdf', 'markdown', 'md'])
        .optional()
        .describe('Optional export format. pdf generates a PDF; markdown or md exports markdown; omitted downloads the original stored file.'),
    }),
  );

  const DocumentViewHeaders = registry.registerSchema(
    'DocumentViewHeaders',
    zOpenApi.object({
      range: zOpenApi
        .string()
        .optional()
        .describe('HTTP Range header for partial video responses, for example bytes=0-1048575. Only honored for video/* files.'),
      'x-api-key': zOpenApi
        .string()
        .optional()
        .describe('Optional API key fallback for non-browser clients. Used only when no valid session cookie is present.'),
    }),
  );

  const BinaryFileResponse = registry.registerSchema(
    'BinaryFileResponse',
    zOpenApi.string().describe('Binary file bytes streamed from the storage provider.'),
  );

  const MarkdownFileResponse = registry.registerSchema(
    'MarkdownFileResponse',
    zOpenApi.string().describe('Markdown export text generated from document content.'),
  );

  const DocumentDownloadError = registry.registerSchema(
    'DocumentDownloadError',
    zOpenApi.object({
      error: zOpenApi.string().optional().describe('Human-readable error message.'),
      permissionError: zOpenApi
        .string()
        .optional()
        .describe('Permission-denied message returned by the underlying document action in some RBAC failures.'),
    }),
  );

  const DocumentPlainTextError = registry.registerSchema(
    'DocumentPlainTextError',
    zOpenApi.string().describe('Plain text error response.'),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/documents/download/{fileId}',
    summary: 'Download or export document file',
    description:
      'Downloads a stored document file, or exports the document as PDF or Markdown based on the optional format query parameter. The fileId path value may be either a documents.document_id or an external_files.file_id. The route supports Auth.js session-cookie authentication and x-api-key fallback for machine clients (internal users only; client-portal keys are refused), and runs within the authenticated principal\'s tenant. Every format uses document read permission and document authorization rules.',
    tags: [tag],
    security: [{ SessionCookieAuth: [] }, { ApiKeyAuth: [] }],
    request: {
      params: DocumentDownloadParams,
      query: DocumentDownloadQuery,
      headers: DocumentIdDownloadHeaders,
    },
    responses: {
      200: {
        description:
          'File bytes for the original stored file, generated PDF, or Markdown text. Content-Type varies by requested format and stored MIME type.',
        contentType: 'application/octet-stream',
        schema: BinaryFileResponse,
      },
      400: {
        description: 'Invalid or missing fileId.',
        schema: DocumentDownloadError,
      },
      401: {
        description: 'No valid session or API key was supplied, or the API key belongs to a client-portal user.',
        schema: DocumentDownloadError,
      },
      404: {
        description: 'Document or file was not found, has no associated file, or has no exportable content.',
        schema: DocumentDownloadError,
      },
      500: {
        description: 'Export, generated-PDF download, storage, or unexpected internal failure.',
        schema: DocumentDownloadError,
      },
    },
    extensions: {
      'x-download-formats': ['original', 'pdf', 'markdown'],
      'x-auth-modes': ['session-cookie', 'api-key'],
      'x-api-key-auth-skipped': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/documents/{documentId}/download',
    summary: 'Download document attachment',
    description:
      'Downloads the original stored file for a document as an attachment. The documentId path value is resolved against documents.document_id first, then documents.file_id. The route supports Auth.js session-cookie authentication and x-api-key fallback for machine clients, derives the tenant from the authenticated principal, requires document:read permission, and runs document authorization rules before reading the file from storage.',
    tags: [tag],
    security: [{ SessionCookieAuth: [] }, { ApiKeyAuth: [] }],
    request: {
      params: DocumentIdDownloadParams,
      headers: DocumentIdDownloadHeaders,
    },
    responses: {
      200: {
        description: 'Binary file stream with attachment Content-Disposition headers. Content-Type varies by stored MIME type.',
        contentType: 'application/octet-stream',
        schema: BinaryFileResponse,
      },
      400: {
        description: 'Missing documentId path parameter.',
        schema: DocumentDownloadError,
      },
      401: {
        description: 'No valid session or API key was supplied.',
        schema: DocumentDownloadError,
      },
      403: {
        description: 'Authenticated user lacks document:read permission.',
        schema: DocumentDownloadError,
      },
      404: {
        description: 'Document not found, document has no file_id, or file metadata/storage record was not found.',
        schema: DocumentDownloadError,
      },
      500: {
        description: 'Unexpected internal failure while downloading the document.',
        schema: DocumentDownloadError,
      },
    },
    extensions: {
      'x-auth-modes': ['session-cookie', 'api-key'],
      'x-id-resolution': 'document_id_then_file_id',
      'x-rbac-required': 'document:read',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/documents/view/{fileId}',
    summary: 'View document file inline',
    description:
      'Streams a stored file for inline browser viewing, such as images, videos, PDFs, and SVGs. Tenant logo files are public. Other files require either a valid Auth.js session cookie or an x-api-key header, then document-level authorization is checked using RBAC, relationship rules, bundle narrowing, and client visibility rules. Video files support HTTP Range requests and may return 206 Partial Content.',
    tags: [tag],
    security: [{ SessionCookieAuth: [] }, { ApiKeyAuth: [] }, {}],
    request: {
      params: DocumentFileIdParams,
      headers: DocumentViewHeaders,
    },
    responses: {
      200: {
        description: 'Full file stream for inline viewing.',
        contentType: 'application/octet-stream',
        schema: BinaryFileResponse,
      },
      206: {
        description: 'Partial file stream for a valid video Range request.',
        contentType: 'application/octet-stream',
        schema: BinaryFileResponse,
      },
      400: {
        description: 'Missing fileId or unsupported file type for inline viewing.',
        contentType: 'text/plain',
        schema: DocumentPlainTextError,
      },
      401: {
        description: 'No valid session or API key was supplied.',
        contentType: 'text/plain',
        schema: DocumentPlainTextError,
      },
      403: {
        description: 'Authenticated user is not authorized to view the file.',
        contentType: 'text/plain',
        schema: DocumentPlainTextError,
      },
      404: {
        description: 'File was not found in metadata or storage.',
        contentType: 'text/plain',
        schema: DocumentPlainTextError,
      },
      416: {
        description: 'Range header is invalid or outside the file size.',
        contentType: 'text/plain',
        schema: DocumentPlainTextError,
      },
      500: {
        description: 'Unexpected internal error while authorizing or streaming the file.',
        contentType: 'text/plain',
        schema: DocumentPlainTextError,
      },
    },
    extensions: {
      'x-supports-range-requests': true,
      'x-public-when-tenant-logo': true,
      'x-api-key-auth-skipped': true,
    },
    edition: 'both',
  });

  const AttachDocumentBody = registry.registerSchema(
    'AttachDocumentBody',
    zOpenApi.object({
      entity_type: zOpenApi
        .enum(ATTACHABLE_ENTITY_TYPES)
        .describe('Kind of record the file is attached to.'),
      entity_id: zOpenApi.string().uuid().describe('UUID of the ticket, project task, client, contact or asset.'),
      source: zOpenApi
        .discriminatedUnion('type', [
          zOpenApi.object({
            type: zOpenApi.literal('url'),
            url: zOpenApi
              .string()
              .describe(
                'https URL the server downloads the file from. The host must be on the workspace\'s allowed download hosts (managed by tenant admins under Settings > MCP Server; the ChatGPT file host is built in), otherwise the call fails with 400 FETCH_HOST_NOT_ALLOWED. Port 443 only, public addresses only, at most 3 redirects (each re-checked against the allowlist), size capped at the storage limit. Signed URLs are used once and never logged.',
              ),
          }),
          zOpenApi.object({
            type: zOpenApi.literal('base64'),
            content: zOpenApi
              .string()
              .describe('Standard base64 of the file bytes. Only for small content the caller wrote itself; requires file_name.'),
          }),
        ])
        .describe('Where the file bytes come from: an https URL (preferred) or base64.'),
      file_name: zOpenApi
        .string()
        .optional()
        .describe('File name including extension. Required for base64. For url, defaults to the Content-Disposition name, then the last URL path segment.'),
      mime_type: zOpenApi
        .string()
        .optional()
        .describe('Declared MIME type. The server sniffs the bytes and a recognised type overrides this; the storage allowlist is applied to the resolved type.'),
    }),
  );

  const AttachedDocument = registry.registerSchema(
    'AttachedDocument',
    zOpenApi.object({
      data: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).describe('The created document row (document_id, document_name, mime_type, file_size, folder_path, ...).'),
    }),
  );

  const AttachDocumentError = registry.registerSchema(
    'AttachDocumentError',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/documents',
    summary: 'Attach a file to a ticket, project task, client, contact or asset',
    description:
      'Creates a document from an https URL or from base64 and associates it with one entity. One file per call. ' +
      'The server downloads URL sources itself, only from hosts on the workspace\'s allowed download hosts list (and only public addresses); the list applies to every caller of this endpoint, not only MCP. Validation (size, MIME type allowlist), storage, the document row, the association, previews and DOCUMENT_ASSOCIATED events run in one shared upload core; ' +
      'ticket attachments also write a ticket activity entry. Requires document:create and <entity>:update. ' +
      'Errors: 400 invalid source, host not allowed (code FETCH_HOST_NOT_ALLOWED; nothing is fetched and no document is created), unsafe or unreachable URL (a remote error status is reported in the message, never as our status), oversize, or disallowed type; 403 permission denied; 404 entity not found.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: AttachDocumentBody } },
    responses: {
      201: { description: 'Document created and attached.', schema: AttachedDocument },
      400: { description: 'Validation failure: bad source, URL host not on the workspace allowlist (code FETCH_HOST_NOT_ALLOWED), unsafe URL, fetch failure, size or type not allowed.', schema: AttachDocumentError },
      401: { description: 'API key missing/invalid.', schema: AttachDocumentError },
      403: { description: 'Permission denied (document:create or the entity update permission).', schema: AttachDocumentError },
      404: { description: 'Entity not found.', schema: AttachDocumentError },
      500: { description: 'Unexpected failure.', schema: AttachDocumentError },
    },
    extensions: { 'x-tenant-scoped': true, 'x-rbac-resource': 'document', 'x-rbac-action': 'create' },
    edition: 'both',
  });

  const ReadContentQuery = registry.registerSchema(
    'ReadDocumentContentQuery',
    zOpenApi.object({
      entity_type: zOpenApi.enum(READABLE_ENTITY_TYPES).describe('Kind of record that owns the attachments.'),
      entity_id: zOpenApi.string().describe('UUID, or a human number such as a ticket number (SR000674).'),
      document_id: zOpenApi.string().uuid().optional().describe('Read only this attachment. Omit to read every readable attachment in a stable order.'),
      cursor: zOpenApi.string().optional().describe('The next_cursor of the previous response; continues where it stopped.'),
    }),
  );

  const ReadContentResponse = registry.registerSchema(
    'ReadDocumentContentResponse',
    zOpenApi.object({
      data: zOpenApi.object({
        header: zOpenApi
          .record(zOpenApi.string(), zOpenApi.unknown())
          .describe('entity, served, omitted, limits_applied, remaining, next_cursor, instructions.'),
        blocks: zOpenApi
          .array(zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()))
          .describe('MCP content blocks (text, image, resource, resource_link) in reading order.'),
      }),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/documents/content',
    summary: 'Read an entity\'s attachments as native MCP content blocks',
    description:
      'Returns the attachments of one entity (today: a ticket, by UUID or ticket number) in the richest form a model can read: ' +
      'images as image blocks (downscaled to 1568 px), PDFs as the original file plus per-page text with scanned pages rendered to images, ' +
      'documents, notes and text files as Markdown, anything else as metadata plus a resource_link. No AI processing happens here. ' +
      'Each call is bounded by a byte budget and image/page caps and returns header.next_cursor when more remains; a cursor goes stale (409 CURSOR_STALE) if any attachment changed. ' +
      'Authorization: the ticket read gate (ticket:read, the ticket kernel, client-portal visibility, comment-attachment audience) and, per document, document:read plus the document kernel. A document either gate refuses is left out of a whole-ticket read and answers 404 when requested by document_id. ' +
      'Used by the read_attachment MCP tool; not exposed through call_api_endpoint because the response carries base64.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: ReadContentQuery },
    responses: {
      200: { description: 'Header plus content blocks.', schema: ReadContentResponse },
      400: { description: 'Invalid query or cursor, or an entity type that cannot be read.', schema: AttachDocumentError },
      401: { description: 'API key missing/invalid.', schema: AttachDocumentError },
      403: { description: 'Permission denied (ticket:read).', schema: AttachDocumentError },
      404: { description: 'Entity or document not found, or not readable by the caller.', schema: AttachDocumentError },
      409: { description: 'CURSOR_STALE: the attachments changed since the cursor was issued.', schema: AttachDocumentError },
      500: { description: 'Unexpected failure.', schema: AttachDocumentError },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'ticket',
      'x-rbac-action': 'read',
      // Through call_api_endpoint this response would reach the model as base64 inside JSON text. Only read_attachment calls it.
      'x-chat-exclude': true,
    },
    edition: 'both',
  });

  void MarkdownFileResponse;
}
