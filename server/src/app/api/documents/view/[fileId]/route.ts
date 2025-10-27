import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { getConnection } from '@/lib/db/db';
import { StorageProviderFactory } from 'server/src/lib/storage/StorageProviderFactory';
import { FileStoreModel } from 'server/src/models/storage';
import { getCurrentUser } from '@product/actions/user-actions/userActions';

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
          console.log(`Public access granted for tenant logo (file ${fileId}) from tenant ${fileTenant}`);
        }
      }
    }

    // Now handle authentication and permissions
    let user: any = null;
    let tenant = fileTenant; // Use the tenant from the file for public logos
    let knex = adminKnex;    // Use admin connection for public logos

    // If it's not a tenant logo, we need authentication
    if (!isTenantLogo) {
      user = await getCurrentUser();
      const tenantContext = await createTenantKnex();
      knex = tenantContext.knex;
      tenant = tenantContext.tenant;

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
    let associatedClientId: string | null = null;
    let userClientId: string | null = null;
    let associatedContactId: string | null = null;
    let associatedUserId: string | null = null;
    let associatedTenantId: string | null = null;

    // 0. If it's a tenant logo, grant public access
    if (isTenantLogo) {
        hasPermission = true;
    }
    // 1. Check if user is internal - they have full access
    else if (user && user.user_type === 'internal') {
        hasPermission = true;
        console.log(`Internal user ${user.user_id} granted access to file ${fileId}`);
    } else if (user) {
        // 2. Find the document record linked to this file_id
        const documentRecord = await knex('documents')
          .select('document_id')
          .where({ file_id: fileId, tenant })
          .first();

        if (documentRecord) {
          // Find all associations for this document
          const associations = await knex('document_associations')
            .select('entity_id', 'entity_type')
            .where({
              document_id: documentRecord.document_id,
              tenant: tenant
            });

          // Check each association
          for (const assoc of associations) {
            if (assoc.entity_type === 'client') {
              associatedClientId = assoc.entity_id;
            } else if (assoc.entity_type === 'contact') {
              associatedContactId = assoc.entity_id;
            } else if (assoc.entity_type === 'user') {
              associatedUserId = assoc.entity_id;
            } else if (assoc.entity_type === 'tenant') {
              associatedTenantId = assoc.entity_id;
            }
          }

          // Check if this is a tenant logo - all users in the tenant can view it
          if (associatedTenantId === user.tenant) {
            hasPermission = true;
            console.log(`User ${user.user_id} accessing tenant logo (file ${fileId})`);
          }
          // Check if this is the user's own avatar
          else if (associatedUserId === user.user_id) {
            hasPermission = true;
            console.log(`User ${user.user_id} accessing their own avatar (file ${fileId})`);
          }
          // Check if this is the user's own contact avatar
          else if (associatedContactId === user.contact_id) {
            hasPermission = true;
            console.log(`User ${user.user_id} accessing their linked contact avatar (file ${fileId})`);
          }
          // Check client association
          else if (associatedClientId && user.contact_id) {
            // Fetch the user's client_id via their contact record
            const contactRecord = await knex('contacts')
              .select('client_id')
              .where({ contact_name_id: user.contact_id, tenant })
              .first();

            userClientId = contactRecord?.client_id ?? null;

            // Allow access if the user's client matches the document's associated client
            if (userClientId === associatedClientId) {
              hasPermission = true;
              console.log(`User ${user.user_id} granted access to client ${associatedClientId} file ${fileId}`);
            }
          }

          // New permission check: Allow any user within the same tenant to view user avatars
          if (!hasPermission && associatedUserId) {
              const associatedUser = await knex('users')
                  .select('tenant')
                  .where({ user_id: associatedUserId })
                  .first();

              if (associatedUser && associatedUser.tenant === user.tenant) {
                  hasPermission = true;
                  console.log(`User ${user.user_id} granted access to user avatar ${fileId} within the same tenant`);
              }
          }
        }
    }

    if (!hasPermission) {
      if (user) {
        console.warn(`User ${user.user_id} (type: ${user.user_type}) does not have permission to view file ${fileId}.`);
        console.warn(`AssociatedClient: ${associatedClientId}, UserClient: ${userClientId}`);
        console.warn(`AssociatedContact: ${associatedContactId}, UserContact: ${user.contact_id}`);
        console.warn(`AssociatedUser: ${associatedUserId}, UserId: ${user.user_id}`);
      } else {
        console.warn(`Unauthenticated user does not have permission to view file ${fileId}.`);
      }
      return new NextResponse('Forbidden', { status: 403 });
    }

    // Check if it's a viewable file type (images, videos, PDFs)
    const isViewableType = fileRecord.mime_type?.startsWith('image/') || 
                          fileRecord.mime_type?.startsWith('video/') || 
                          fileRecord.mime_type === 'application/pdf' ||
                          fileRecord.mime_type === 'image/svg+xml';
    
    if (!isViewableType) {
        console.warn(`Attempted to view non-viewable file: ${fileId}, MIME: ${fileRecord.mime_type}`);
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
