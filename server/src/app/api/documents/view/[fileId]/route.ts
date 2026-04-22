import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@alga-psa/db';
import { getConnection } from '@/lib/db/db';
import { StorageProviderFactory } from '@alga-psa/storage';
import { FileStoreModel } from 'server/src/models/storage';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { ApiKeyServiceForApi } from 'server/src/lib/services/apiKeyServiceForApi';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { runWithTenant } from 'server/src/lib/db';
import { getAuthorizedDocumentByFileId } from '@alga-psa/documents/actions/documentActions';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const resolvedParams = await params;
  const fileId = resolvedParams.fileId;

  if (!fileId) {
    return new NextResponse('File ID is required', { status: 400 });
  }

  try {
    // First, check if this is a public tenant logo using admin connection
    let isTenantLogo = false;
    let fileRecord: any = null;
    let fileTenant: string | null = null;

    // Use admin connection to check if this is a tenant logo (no auth required)
    const adminKnex = await getConnection();

    // Get file record to determine tenant
    const fileRecordAdmin = await adminKnex('external_files')
      .where({ file_id: fileId, is_deleted: false })
      .first();

    if (fileRecordAdmin) {
      fileTenant = fileRecordAdmin.tenant;
      fileRecord = fileRecordAdmin;

      // Check if this is a tenant logo
      const documentRecord = await adminKnex('documents')
        .select('document_id')
        .where({ file_id: fileId, tenant: fileTenant })
        .first();

      if (documentRecord) {
        const tenantLogoAssoc = await adminKnex('document_associations')
          .where({
            document_id: documentRecord.document_id,
            entity_type: 'tenant',
            is_entity_logo: true,
            tenant: fileTenant
          })
          .first();

        if (tenantLogoAssoc) {
          isTenantLogo = true;
          // Public access granted for tenant logo
        }
      }
    }

    // Now handle authentication and permissions
    let user: any = null;
    let tenant = fileTenant; // Use the tenant from the file for public logos
    let knex = adminKnex;    // Use admin connection for public logos

    // If it's not a tenant logo, we need authentication
    if (!isTenantLogo) {
      // Try session-based auth first, then fall back to API key auth (mobile app)
      try {
        user = await getCurrentUser();
      } catch {
        // No session context (e.g. mobile API request) — fall through to API key auth
      }
      if (user) {
        const tenantContext = await createTenantKnex();
        knex = tenantContext.knex;
        tenant = tenantContext.tenant;
      } else {
        const apiKey = request.headers.get('x-api-key');
        if (apiKey) {
          const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenant = keyRecord.tenant;
            const resolved = await runWithTenant(tenant!, async () => {
              const u = await findUserByIdForApi(keyRecord.user_id, tenant!);
              const ctx = await createTenantKnex();
              return { user: u, knex: ctx.knex };
            });
            user = resolved.user;
            knex = resolved.knex;
          }
        }
      }

      if (!tenant || !user) {
        return new NextResponse('Unauthorized', { status: 401 });
      }

      // Re-fetch file record with tenant context if needed
      if (!fileRecord || fileRecord.tenant !== tenant) {
        fileRecord = await FileStoreModel.findById(knex, fileId);
      }
    }

    if (!fileRecord) {
      return new NextResponse('File not found', { status: 404 });
    }

    // --- Permission Check ---
    let hasPermission = false;

    if (isTenantLogo) {
      hasPermission = true;
    } else if (user?.user_type === 'internal') {
      hasPermission = true;
    } else if (user && tenant) {
      const authorizedDocument = await withTransaction(knex, async (trx) =>
        getAuthorizedDocumentByFileId(trx, tenant, user, fileId)
      );
      hasPermission = Boolean(authorizedDocument);
    }

    if (!hasPermission) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    // Check if it's a viewable file type (images, videos, PDFs)
    const isViewableType = fileRecord.mime_type?.startsWith('image/') || 
                          fileRecord.mime_type?.startsWith('video/') || 
                          fileRecord.mime_type === 'application/pdf' ||
                          fileRecord.mime_type === 'image/svg+xml';
    
    if (!isViewableType) {
        return new NextResponse('File type not supported for viewing', { status: 400 });
    }

    // Get the storage provider instance
    const provider = await StorageProviderFactory.createProvider();

    // Handle HTTP Range requests for video files (needed for video seeking and previews)
    const range = request.headers.get('range');
    const isVideoFile = fileRecord.mime_type?.startsWith('video/');

    if (range && isVideoFile) {
      // Parse range header (e.g., "bytes=0-1023" or "bytes=1024-")
      const rangeMatch = range.match(/bytes=(\d+)-(\d*)/);
      if (!rangeMatch) {
        return new NextResponse('Invalid Range', { status: 416 });
      }

      const start = parseInt(rangeMatch[1], 10);
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileRecord.file_size - 1;
      const fileSize = fileRecord.file_size;

      // Validate range
      if (start >= fileSize || end >= fileSize || start > end) {
        const headers = new Headers();
        headers.set('Content-Range', `bytes */${fileSize}`);
        return new NextResponse('Range Not Satisfiable', { status: 416, headers });
      }

      const contentLength = end - start + 1;

      // Get the readable stream for the file range
      const stream = await provider.getReadStream(fileRecord.storage_path, { start, end });

      // Set headers for partial content
      const headers = new Headers();
      headers.set('Content-Type', fileRecord.mime_type);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      headers.set('Content-Length', contentLength.toString());
      headers.set('Cache-Control', 'public, max-age=3600');

      // Return partial content (206)
      return new NextResponse(stream as any, {
        status: 206, // Partial Content
        headers,
      });
    } else {
      // Get the full readable stream for the file
      const stream = await provider.getReadStream(fileRecord.storage_path);

      // Set headers for full content
      const headers = new Headers();
      headers.set('Content-Type', fileRecord.mime_type);
      headers.set('Content-Length', fileRecord.file_size.toString());
      
      // Add Accept-Ranges header for video files to indicate range support
      if (isVideoFile) {
        headers.set('Accept-Ranges', 'bytes');
      }
      
      // Cache for 1 hour (adjust as needed)
      headers.set('Cache-Control', 'public, max-age=3600');

      // Return the full stream response
      return new NextResponse(stream as any, {
        status: 200,
        headers,
      });
    }

  } catch (error) {
    console.error(`Error serving file ${fileId}:`, error);
    if (error instanceof Error && error.message.includes('File not found')) {
        return new NextResponse('File not found in storage', { status: 404 });
    }
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
