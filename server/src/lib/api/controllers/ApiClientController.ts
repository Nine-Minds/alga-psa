/**
 * API Client Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { ClientService } from '../services/ClientService';
import { ContactService } from '../services/ContactService';
import {
  createClientSchema,
  updateClientSchema,
  clientListQuerySchema,
  createClientLocationSchema,
  clientMergePreviewRequestSchema,
  clientMergeRequestSchema,
  setBillingProfileContactsSchema
} from '../schemas/client';
import { 
  runWithTenant 
} from '../../db';
import {
  AuthenticatedApiRequest,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '../middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiClientController extends ApiBaseController {
  private clientService: ClientService;
  private contactService: ContactService;

  constructor() {
    const clientService = new ClientService();
    const contactService = new ContactService();
    
    super(clientService, {
      resource: 'client',
      createSchema: createClientSchema,
      updateSchema: updateClientSchema,
      querySchema: clientListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.clientService = clientService;
    this.contactService = contactService;
  }

  /**
   * Get client statistics
   */
  stats() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;

        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');
          const stats = await this.clientService.getClientStats(apiRequest.context!);
          return createSuccessResponse(stats);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get client contacts
   */
  getContacts() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;

        // Extract client/client ID from path (support both old and new paths)
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const clientsIndex = pathParts.findIndex(part => part === 'clients' || part === 'clients');
        const clientId = pathParts[clientsIndex + 1];

        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');

          // Verify client exists
          const client = await this.clientService.getById(clientId, apiRequest.context!);
          if (!client) {
            throw new NotFoundError('Client not found');
          }

          // Get pagination params
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          // Use ContactService to get contacts for this client
          const contacts = await this.contactService.list(
            { 
              page, 
              limit,
              filters: { client_id: clientId } 
            },
            apiRequest.context!
          );
          
          return createPaginatedResponse(
            contacts.data,
            contacts.total,
            page,
            limit
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create client location
   */
  createLocation() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;

        // Extract client/client ID from path (support both old and new paths)
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const clientsIndex = pathParts.findIndex(part => part === 'clients' || part === 'clients');
        const clientId = pathParts[clientsIndex + 1];

        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');

          // Verify client exists
          const client = await this.clientService.getById(clientId, apiRequest.context!);
          if (!client) {
            throw new NotFoundError('Client not found');
          }

          // Validate data
          let data;
          try {
            const body = await req.json();
            data = createClientLocationSchema.parse(body);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Validation failed', error.errors);
            }
            throw error;
          }

          const location = await this.clientService.createLocation(
            clientId,
            data,
            apiRequest.context!
          );
          
          return createSuccessResponse(location, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get client locations
   */
  getLocations() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;

        // Extract client/client ID from path (support both old and new paths)
        const url = new URL(req.url);
        const pathParts = url.pathname.split('/');
        const clientsIndex = pathParts.findIndex(part => part === 'clients' || part === 'clients');
        const clientId = pathParts[clientsIndex + 1];

        // Run within tenant context
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');

          // Verify client exists
          const client = await this.clientService.getById(clientId, apiRequest.context!);
          if (!client) {
            throw new NotFoundError('Client not found');
          }

          const locations = await this.clientService.getClientLocations(
            clientId,
            apiRequest.context!
          );
          
          return createSuccessResponse(locations);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Path ids for the merge and billing-profile routes.
   *
   * The existing helpers in this controller re-derive the client id from the
   * URL on every call; these routes nest one level deeper, so the segment
   * lookup is done once and by name rather than by offset.
   */
  private pathSegmentAfter(req: NextRequest, segment: string): string | undefined {
    const parts = new URL(req.url).pathname.split('/');
    const index = parts.findIndex((part) => part === segment);
    return index === -1 ? undefined : parts[index + 1];
  }

  private async parseBody<T>(req: NextRequest, schema: { parse: (value: unknown) => T }): Promise<T> {
    try {
      return schema.parse(await req.json());
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }
  }

  /**
   * Dry run of a merge. Read-only, but a POST because the source client is a
   * body parameter rather than a filter — and because a preview is a request
   * to compute something, not a resource to fetch.
   */
  mergePreview() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;
        const clientId = this.pathSegmentAfter(req, 'clients');

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');

          const client = clientId ? await this.clientService.getById(clientId, apiRequest.context!) : null;
          if (!client || !clientId) {
            throw new NotFoundError('Client not found');
          }

          const body = await this.parseBody(req, clientMergePreviewRequestSchema);
          const preview = await this.clientService.previewMerge(
            clientId,
            body.source_client_id,
            apiRequest.context!
          );
          return createSuccessResponse(preview);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Absorbs another client into this one as a billing profile.
   *
   * Requires delete as well as update: it retires the source client, and an
   * API key that may only edit clients must not be able to retire one.
   */
  merge() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;
        const clientId = this.pathSegmentAfter(req, 'clients');

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');
          await this.checkPermission(apiRequest, this.options.permissions?.delete || 'delete');

          const client = clientId ? await this.clientService.getById(clientId, apiRequest.context!) : null;
          if (!client || !clientId) {
            throw new NotFoundError('Client not found');
          }

          const body = await this.parseBody(req, clientMergeRequestSchema);
          const result = await this.clientService.mergeClient(
            clientId,
            {
              sourceClientId: body.source_client_id,
              contactAssignments: body.contact_assignments?.map((entry) => ({
                contactNameId: entry.contact_name_id,
                billingProfileId: entry.billing_profile_id,
                isManager: entry.is_manager,
                canViewProfileTickets: entry.can_view_profile_tickets,
              })),
              contractDecisions: body.contract_decisions?.map((entry) => ({
                clientContractId: entry.client_contract_id,
                choice: entry.choice,
                cutoverDate: entry.cutover_date ?? null,
              })),
              pinPortalGrants: body.pin_portal_grants,
              externalRemapChoices: body.external_remap_choices?.map((entry) => ({
                mappingId: entry.mapping_id,
                apply: entry.apply,
              })),
            },
            apiRequest.context!
          );

          return createSuccessResponse({
            merge_id: result.mergeId,
            source_client_id: result.sourceClientId,
            target_client_id: result.targetClientId,
            moved_profile_ids: result.movedProfileIds,
            moved_default_profile_id: result.movedDefaultProfileId,
            counts: result.counts,
            remapped_external_mapping_ids: result.remappedExternalMappingIds,
            skipped_external_mapping_ids: result.skippedExternalMappingIds,
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  getBillingProfileContacts() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;
        const clientId = this.pathSegmentAfter(req, 'clients');
        const profileId = this.pathSegmentAfter(req, 'billing-profiles');

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');
          if (!clientId || !profileId) {
            throw new NotFoundError('Billing profile not found for this client');
          }
          const contacts = await this.clientService.getBillingProfileContacts(
            clientId,
            profileId,
            apiRequest.context!
          );
          return createSuccessResponse(contacts);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  setBillingProfileContacts() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req) as AuthenticatedApiRequest;
        const clientId = this.pathSegmentAfter(req, 'clients');
        const profileId = this.pathSegmentAfter(req, 'billing-profiles');

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');
          if (!clientId || !profileId) {
            throw new NotFoundError('Billing profile not found for this client');
          }

          const body = await this.parseBody(req, setBillingProfileContactsSchema);
          await this.clientService.setBillingProfileContacts(
            clientId,
            profileId,
            body.contacts,
            apiRequest.context!
          );

          const contacts = await this.clientService.getBillingProfileContacts(
            clientId,
            profileId,
            apiRequest.context!
          );
          return createSuccessResponse(contacts);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
