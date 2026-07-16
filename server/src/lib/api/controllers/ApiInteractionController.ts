import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { InteractionService } from '../services/InteractionService';
import {
  createInteractionApiSchema,
  interactionListQuerySchema,
} from '../schemas/interactionSchemas';
import { runWithTenant } from '../../db';
import {
  createPaginatedResponse,
  createSuccessResponse,
  handleApiError,
} from '../middleware/apiMiddleware';

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
