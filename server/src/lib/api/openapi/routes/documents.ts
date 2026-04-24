import { ApiOpenApiRegistry, zOpenApi } from '../registry';

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
      'Downloads a stored document file, or exports the document as PDF or Markdown based on the optional format query parameter. The fileId path value may be either a documents.document_id or an external_files.file_id. The route requires an Auth.js session cookie and runs within the session tenant. The normal download path uses document read permission and document authorization rules; PDF and Markdown export paths perform tenant-scoped document lookup and generation.',
    tags: [tag],
    security: [{ SessionCookieAuth: [] }],
    request: {
      params: DocumentDownloadParams,
      query: DocumentDownloadQuery,
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
        description: 'No valid session is present.',
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
      'x-api-key-auth-skipped': true,
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

  void MarkdownFileResponse;
}
