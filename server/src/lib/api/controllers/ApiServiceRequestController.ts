/**
 * API Service Request Controller
 * MSP "on behalf of a client contact" surface:
 *   GET  /api/v1/service-requests/catalog?clientId=&contactId=
 *   POST /api/v1/service-requests/{definitionId}/submissions
 *
 * Thin over lib/service-requests/mspSubmissions.ts, the same functions the MSP UI calls.
 * RBAC: the existing `service` resource - read for the catalog, create for a submission.
 * No client-scoped rule; the tenant is the boundary.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodError, type ZodSchema } from 'zod';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { ApiBaseController } from './ApiBaseController';
import {
  AuthenticatedApiRequest,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  handleApiError,
} from '../middleware/apiMiddleware';
import {
  serviceRequestCatalogQuerySchema,
  serviceRequestSubmissionBodySchema,
  serviceRequestSubmissionParamsSchema,
} from '../schemas/serviceRequestSubmission';
import { requireContactInReadScope } from '../../service-requests/servicePermission';
import {
  listDefinitionsForRequester,
  MspSubmissionError,
  resolveRequesterForMspSubmission,
  submitOnBehalfOfMsp,
} from '../../service-requests/mspSubmissions';

export class ApiServiceRequestController extends ApiBaseController {
  constructor() {
    super({} as any, { resource: 'service_request', permissionResource: 'service' });
  }

  private async parseBody<T>(req: AuthenticatedApiRequest, schema: ZodSchema<T>): Promise<T> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON');
    }
    try {
      return schema.parse(body);
    } catch (error) {
      if (error instanceof ZodError) throw new ValidationError('Validation failed', error.issues);
      throw error;
    }
  }

  private run(
    action: 'read' | 'create',
    handler: (apiRequest: AuthenticatedApiRequest) => Promise<NextResponse>,
  ) {
    return async (req: NextRequest, _routeContext?: unknown): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, action);
          return handler(apiRequest);
        });
      } catch (error) {
        return handleApiError(mapMspSubmissionError(error));
      }
    };
  }

  /** GET /api/v1/service-requests/catalog - what the contact would see in the portal. */
  catalog() {
    return this.run('read', async (apiRequest) => {
      const { clientId, contactId } = this.validateQuery(apiRequest, serviceRequestCatalogQuerySchema) as {
        clientId: string;
        contactId: string;
      };
      const { tenant, userId } = apiRequest.context;
      const { knex } = await createTenantKnex();
      await requireContactInReadScope(knex, tenant, apiRequest.context.user as unknown as IUserWithRoles, contactId);
      const requester = await resolveRequesterForMspSubmission(knex, tenant, clientId, contactId, userId);
      const items = await listDefinitionsForRequester(knex, tenant, requester);
      return createSuccessResponse(items, 200, undefined, apiRequest);
    });
  }

  /** POST /api/v1/service-requests/{definitionId}/submissions */
  submit() {
    return this.run('create', async (apiRequest) => {
      const parts = new URL(apiRequest.url).pathname.split('/').filter(Boolean);
      const definitionId = serviceRequestSubmissionParamsSchema.safeParse({
        definitionId: parts[parts.lastIndexOf('service-requests') + 1],
      });
      if (!definitionId.success) throw new ValidationError('Invalid service request definition ID format');
      const body = await this.parseBody(apiRequest, serviceRequestSubmissionBodySchema);
      const { tenant, userId } = apiRequest.context;

      const { knex } = await createTenantKnex();
      try {
        const result = await withTransaction(knex, async (trx) => {
          await requireContactInReadScope(trx, tenant, apiRequest.context.user as unknown as IUserWithRoles, body.contactId);
          const requester = await resolveRequesterForMspSubmission(trx, tenant, body.clientId, body.contactId, userId);
          return submitOnBehalfOfMsp({
            knex: trx,
            tenant,
            definitionId: definitionId.data.definitionId,
            requester,
            payload: body.payload,
            clientSubmissionKey: body.clientSubmissionKey ?? null,
          });
        });
        return createSuccessResponse(
          {
            submissionId: result.submissionId,
            executionStatus: result.executionStatus,
            ticketId: result.createdTicketId ?? null,
          },
          result.replayed ? 200 : 201,
          undefined,
          apiRequest,
        );
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Submission validation failed:')) {
          throw new ValidationError(error.message);
        }
        throw error;
      }
    });
  }
}

/** A contact outside the client, or a definition the contact cannot see, is a 404 - never a hint about why. */
function mapMspSubmissionError(error: unknown): unknown {
  return error instanceof MspSubmissionError ? new NotFoundError(error.message) : error;
}
