import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { InteractionService } from '../services/InteractionService';
import {
  createInteractionApiSchema,
  interactionListQuerySchema,
  updateInteractionApiSchema,
} from '../schemas/interactionSchemas';
import { runWithTenant } from '../../db';
import {
  createPaginatedResponse,
  createSuccessResponse,
  handleApiError,
  ValidationError,
} from '../middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiInteractionController extends ApiBaseController {
  private interactionService: InteractionService;

  constructor() {
    const interactionService = new InteractionService();
    super(interactionService, {
      resource: 'interaction',
      createSchema: createInteractionApiSchema,
      querySchema: interactionListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        list: 'read',
        update: 'update',
      },
    });
    this.interactionService = interactionService;
  }

  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          const query = this.validateQuery(apiRequest, interactionListQuerySchema);
          const result = await this.interactionService.list(query, apiRequest.context);
          const { page, page_size, ...filters } = query;

          return createPaginatedResponse(
            result.data,
            result.total,
            page,
            page_size,
            { filters },
            apiRequest,
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  listStatuses() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          const statuses = await this.interactionService.listStatuses(apiRequest.context);
          return createSuccessResponse(statuses, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /** PUT /api/v1/interactions/{id}: status and notes only (see updateInteractionApiSchema). */
  updateStatusOrNotes() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          let data;
          try {
            data = updateInteractionApiSchema.parse(await req.json());
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Validation failed', error.errors);
            }
            throw error;
          }
          const updated = await this.interactionService.updateStatusOrNotes(id, data, apiRequest.context);
          return createSuccessResponse(updated, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  listTypes() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          const types = await this.interactionService.listTypes(apiRequest.context);
          return createSuccessResponse(types, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
