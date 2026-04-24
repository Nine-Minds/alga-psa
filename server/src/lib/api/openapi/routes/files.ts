import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerFileRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Files';

  const FileDownloadParams = registry.registerSchema(
    'FileDownloadParams',
    zOpenApi.object({
      fileId: zOpenApi
        .string()
        .uuid()
        .describe('File UUID from external_files.file_id to download. The handler does not validate UUID syntax before querying storage metadata.'),
    }),
  );

  const FileBinaryDownloadResponse = registry.registerSchema(
    'FileBinaryDownloadResponse',
    zOpenApi.string().describe('Binary file bytes loaded from the configured storage provider.'),
  );

  const FileDownloadPlainTextError = registry.registerSchema(
    'FileDownloadPlainTextError',
    zOpenApi.string().describe('Plain text error response, such as Tenant not found or Download failed.'),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/files/{fileId}/download',
    summary: 'Download file by ID',
    description:
      'Downloads a stored external file as an attachment by external_files.file_id. The route is skipped by API-key middleware and relies on session/tenant resolution through createTenantKnex and StorageService. Storage lookup is tenant-scoped to external_files.tenant and is_deleted=false, but the handler performs no explicit per-document authorization; any user resolved into the tenant can download a file by fileId. The response body is binary and Content-Type is taken from stored file metadata.',
    tags: [tag],
    security: [{ SessionCookieAuth: [] }],
    request: {
      params: FileDownloadParams,
    },
    responses: {
      200: {
        description: 'Binary file download with attachment Content-Disposition. Content-Type varies by stored MIME type.',
        contentType: 'application/octet-stream',
        schema: FileBinaryDownloadResponse,
      },
      404: {
        description: 'Tenant could not be resolved by createTenantKnex.',
        contentType: 'text/plain',
        schema: FileDownloadPlainTextError,
      },
      500: {
        description: 'File metadata/storage lookup failed or another download error occurred.',
        contentType: 'text/plain',
        schema: FileDownloadPlainTextError,
      },
    },
    extensions: {
      'x-api-key-auth-skipped': true,
      'x-tenant-scoped-storage': true,
      'x-explicit-document-authorization': false,
    },
    edition: 'both',
  });
}
