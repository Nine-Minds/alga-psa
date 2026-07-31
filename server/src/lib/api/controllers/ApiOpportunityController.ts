import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiBaseController } from './ApiBaseController';
import { OpportunityService } from '../services/OpportunityService';
import {
  completeOpportunityActionApiSchema,
  correctOpportunityEvidenceApiSchema,
  createOpportunityApiSchema,
  declaredOpportunityEvidenceApiSchema,
  loseOpportunityApiSchema,
  opportunityListQuerySchema,
  updateOpportunityApiSchema,
  acceptOpportunitySuggestionApiSchema,
  opportunitySuggestionListQuerySchema,
  snoozeOpportunitySuggestionApiSchema,
  winOpportunityApiSchema,
} from '../schemas/opportunitySchemas';
import { runWithTenant } from '../../db';
import {
  ValidationError,
  createPaginatedResponse,
  createSuccessResponse,
  handleApiError,
} from '../middleware/apiMiddleware';

const uuidSchema = z.string().uuid();

export class ApiOpportunityController extends ApiBaseController {
  private opportunityService: OpportunityService;

  constructor() {
    const opportunityService = new OpportunityService();
    super(opportunityService, {
      resource: 'opportunities',
      createSchema: createOpportunityApiSchema,
      updateSchema: updateOpportunityApiSchema,
      querySchema: opportunityListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read',
      },
    });
    this.opportunityService = opportunityService;
  }

  private async extractNestedUuid(req: NextRequest, key: string): Promise<string> {
    const params = await (req as any).params;
    const parsed = uuidSchema.safeParse(params?.[key]);
    if (!parsed.success) throw new ValidationError(`Invalid ${key} format`);
    return parsed.data;
  }

  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          const query = this.validateQuery(apiRequest, opportunityListQuerySchema);
          const result = await this.opportunityService.list(query, apiRequest.context);

          const { page, page_size, sort_by, sort_direction, ...filters } = query;
          return createPaginatedResponse(
            result.data,
            result.total,
            page,
            page_size,
            { sort: sort_by, order: sort_direction, filters },
            apiRequest,
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  workQueue() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          const queue = await this.opportunityService.getWorkQueue(apiRequest.context);
          return createSuccessResponse(queue);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  timeline() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          const id = await this.extractIdFromPath(apiRequest);
          const timeline = await this.opportunityService.listTimeline(id, apiRequest.context);
          return createSuccessResponse(timeline);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  listSuggestions() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          const query = this.validateQuery(apiRequest, opportunitySuggestionListQuerySchema);
          const suggestions = await this.opportunityService.listSuggestions(
            query.status,
            apiRequest.context,
          );
          return createSuccessResponse(suggestions);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  acceptSuggestion() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const data = await this.validateData(apiRequest, acceptOpportunitySuggestionApiSchema);
          const opportunity = await this.opportunityService.acceptSuggestion(id, data, apiRequest.context);
          return createSuccessResponse(opportunity, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  dismissSuggestion() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const suggestion = await this.opportunityService.dismissSuggestion(id, apiRequest.context);
          return createSuccessResponse(suggestion);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  snoozeSuggestion() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const data = await this.validateData(apiRequest, snoozeOpportunitySuggestionApiSchema);
          const suggestion = await this.opportunityService.snoozeSuggestion(
            id,
            data.snoozed_until,
            apiRequest.context,
          );
          return createSuccessResponse(suggestion);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  win() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const data = await this.validateData(apiRequest, winOpportunityApiSchema);
          const opportunity = await this.opportunityService.win(id, data, apiRequest.context);
          return createSuccessResponse(opportunity);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  lose() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const data = await this.validateData(apiRequest, loseOpportunityApiSchema);
          const opportunity = await this.opportunityService.lose(id, data, apiRequest.context);
          return createSuccessResponse(opportunity);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  completeAction() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const data = await this.validateData(apiRequest, completeOpportunityActionApiSchema);
          const opportunity = await this.opportunityService.completeAction(id, data, apiRequest.context);
          return createSuccessResponse(opportunity);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  recordEvidence() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const data = await this.validateData(apiRequest, declaredOpportunityEvidenceApiSchema);
          const evidence = await this.opportunityService.recordDeclaredEvidence(id, data, apiRequest.context);
          return createSuccessResponse(evidence, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  listEvidence() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          const id = await this.extractIdFromPath(apiRequest);
          const evidence = await this.opportunityService.listEvidence(id, apiRequest.context);
          return createSuccessResponse(evidence);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  correctEvidence() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const evidenceId = await this.extractNestedUuid(apiRequest, 'evidenceId');
          const data = await this.validateData(apiRequest, correctOpportunityEvidenceApiSchema);
          const evidence = await this.opportunityService.correctEvidence(id, evidenceId, data, apiRequest.context);
          return createSuccessResponse(evidence);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  linkQuote() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const quoteId = await this.extractNestedUuid(apiRequest, 'quoteId');
          const quote = await this.opportunityService.linkQuote(id, quoteId, apiRequest.context);
          return createSuccessResponse(quote);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  unlinkQuote() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const quoteId = await this.extractNestedUuid(apiRequest, 'quoteId');
          await this.opportunityService.unlinkQuote(id, quoteId, apiRequest.context);
          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
