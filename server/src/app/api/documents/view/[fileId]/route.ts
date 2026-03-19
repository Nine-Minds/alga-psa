import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { getConnection } from '@/lib/db/db';
import { StorageProviderFactory } from '@alga-psa/storage';
import { FileStoreModel } from 'server/src/models/storage';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { ApiKeyServiceForApi } from 'server/src/lib/services/apiKeyServiceForApi';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { runWithTenant } from 'server/src/lib/db';

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
    let associatedClientId: string | null = null;
    let userClientId: string | null = null;
    let associatedContactId: string | null = null;
    let associatedUserId: string | null = null;
    let associatedTenantId: string | null = null;
    let associatedProjectTaskId: string | null = null;
    let associatedContractId: string | null = null;
    const associatedTicketIds = new Set<string>();

    // 0. If it's a tenant logo, grant public access
    if (isTenantLogo) {
        hasPermission = true;
    }
    // 1. Check if user is internal - they have full access
    else if (user && user.user_type === 'internal') {
        hasPermission = true;
        // Internal user has full access
    } else if (user) {
        // 2. Find the document record linked to this file_id
        const documentRecord = await knex('documents')
          .select('document_id', 'is_client_visible')
          .where({ file_id: fileId, tenant })
          .first();

        if (documentRecord) {
          // For client users accessing via Documents Hub (not inline ticket display),
          // require is_client_visible = true
          const isClientUser = user.user_type === 'client';

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
            } else if (assoc.entity_type === 'project_task') {
              associatedProjectTaskId = assoc.entity_id;
            } else if (assoc.entity_type === 'contract') {
              associatedContractId = assoc.entity_id;
            } else if (assoc.entity_type === 'ticket' && assoc.entity_id) {
              associatedTicketIds.add(assoc.entity_id);
            }
          }

          // Check if this is a tenant logo - all users in the tenant can view it
          if (associatedTenantId === user.tenant) {
            hasPermission = true;
            // User accessing tenant logo
          }
          // Check if this is the user's own avatar
          else if (associatedUserId === user.user_id) {
            hasPermission = true;
            // User accessing their own avatar
          }
          // Check if this is the user's own contact avatar
          else if (associatedContactId === user.contact_id) {
            hasPermission = true;
            // User accessing their linked contact avatar
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
            // For client users, also require is_client_visible = true
            if (userClientId === associatedClientId) {
              if (!isClientUser || documentRecord.is_client_visible) {
                hasPermission = true;
                // Access granted via client association
              }
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
                  // Access granted for user avatar within same tenant
              }
          }

          // Allow any user within the same tenant to view team avatars
          if (!hasPermission) {
              const teamAssoc = associations.find((a: { entity_type: string }) => a.entity_type === 'team');
              if (teamAssoc) {
                  const associatedTeam = await knex('teams')
                      .select('tenant')
                      .where({ team_id: teamAssoc.entity_id })
                      .first();

                  if (associatedTeam && associatedTeam.tenant === user.tenant) {
                      hasPermission = true;
                      console.log(`User ${user.user_id} granted access to team avatar ${fileId} within the same tenant`);
                  }
              }
          }

          // Check project_task association - verify client owns the project
          if (!hasPermission && associatedProjectTaskId && user.contact_id) {
              // Get user's client_id if not already fetched
              if (!userClientId) {
                  const contactRecord = await knex('contacts')
                      .select('client_id')
                      .where({ contact_name_id: user.contact_id, tenant })
                      .first();
                  userClientId = contactRecord?.client_id ?? null;
              }

              if (userClientId) {
                  // Check if this task belongs to a project owned by the user's client
                  const projectCheck = await knex('project_tasks as pt')
                      .join('project_phases as pp', function() {
                          this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
                      })
                      .join('projects as p', function() {
                          this.on('pp.project_id', 'p.project_id').andOn('pp.tenant', 'p.tenant');
                      })
                      .where({
                          'pt.task_id': associatedProjectTaskId,
                          'pt.tenant': tenant,
                          'p.client_id': userClientId
                      })
                      .first();

                  if (projectCheck) {
                      // For client users, also require is_client_visible = true
                      if (!isClientUser || documentRecord.is_client_visible) {
                          hasPermission = true;
                          // Access granted via project task association
                      }
                  }
              }
          }

          // Check contract association - verify client owns the contract (billing_plan)
          if (!hasPermission && associatedContractId && user.contact_id) {
              // Get user's client_id if not already fetched
              if (!userClientId) {
                  const contactRecord = await knex('contacts')
                      .select('client_id')
                      .where({ contact_name_id: user.contact_id, tenant })
                      .first();
                  userClientId = contactRecord?.client_id ?? null;
              }

              if (userClientId) {
                  // Check if this contract (billing_plan) belongs to the user's client
                  const contractCheck = await knex('billing_plans')
                      .where({
                          plan_id: associatedContractId,
                          tenant: tenant,
                          company_id: userClientId
                      })
                      .first();

                  if (contractCheck) {
                      // For client users, also require is_client_visible = true
                      if (!isClientUser || documentRecord.is_client_visible) {
                          hasPermission = true;
                          // Access granted via contract association
                      }
                  }
              }
          }

          // Check ticket association - allow contact/client users when ticket belongs to them
          // For client users, require is_client_visible = true
          if (!hasPermission && associatedTicketIds.size > 0 && user.contact_id) {
              // Get user's client_id if not already fetched
              if (!userClientId) {
                  const contactRecord = await knex('contacts')
                      .select('client_id')
                      .where({ contact_name_id: user.contact_id, tenant })
                      .first();
                  userClientId = contactRecord?.client_id ?? null;
              }

              const ticketAccessQuery = knex('tickets')
                .where({ tenant })
                .whereIn('ticket_id', Array.from(associatedTicketIds))
                .andWhere(function ticketPermissionScope() {
                  this.where('contact_name_id', user.contact_id);
                  if (userClientId) {
                    this.orWhere('client_id', userClientId);
                  }
                })
                .first('ticket_id');

              const ticketAccess = await ticketAccessQuery;
              if (ticketAccess?.ticket_id) {
                  if (!isClientUser || documentRecord.is_client_visible) {
                      hasPermission = true;
                  }
              }
          }
        }
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
