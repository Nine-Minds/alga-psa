/**
 * API KB Article Controller
 * Handles knowledge base article API endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController, AuthenticatedApiRequest } from './ApiBaseController';
import { KbArticleService } from '../services/KbArticleService';
import {
  createKbArticleSchema,
  updateKbArticleSchema,
  updateKbArticleContentSchema,
  kbArticleListQuerySchema,
} from '../schemas/kbArticle';
import {
  createSuccessResponse,
  handleApiError,
  NotFoundError,
} from '../middleware/apiMiddleware';
import { runWithTenant } from '../../db';

export class ApiKbArticleController extends ApiBaseController {
  private kbService: KbArticleService;

  constructor() {
    const kbService = new KbArticleService();

    super(kbService, {
      resource: 'document',
      createSchema: createKbArticleSchema,
      updateSchema: updateKbArticleSchema,
      querySchema: kbArticleListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read',
      },
    });

    this.kbService = kbService;
  }

  /**
   * Override extractIdFromPath for kb-articles resource
   */
  protected async extractIdFromPath(req: AuthenticatedApiRequest): Promise<string> {
    if ('params' in req && req.params) {
      const params = await req.params;
      if (params && 'id' in params) {
        return params.id;
      }
      if (params && 'ticketId' in params) {
        return params.ticketId;
      }
    }

    // Fallback to URL parsing
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const kbIndex = pathParts.findIndex(part => part === 'kb-articles');
    return pathParts[kbIndex + 1] || '';
  }

  /**
   * Publish an article
   * POST /api/v1/kb-articles/:id/publish
   */
  publish() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const result = await this.kbService.publish(id, apiRequest.context);
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Archive an article
   * POST /api/v1/kb-articles/:id/archive
   */
  archive() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const result = await this.kbService.archive(id, apiRequest.context);
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get article content as readable text
   * GET /api/v1/kb-articles/:id/content
   */
  getContent() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          const id = await this.extractIdFromPath(apiRequest);
          const result = await this.kbService.getContent(id, apiRequest.context);

          if (!result) {
            throw new NotFoundError('Article not found');
          }

          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update article content
   * PUT /api/v1/kb-articles/:id/content
   */
  updateContent() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');
          const id = await this.extractIdFromPath(apiRequest);
          const data = await this.validateData(apiRequest, updateKbArticleContentSchema);
          const result = await this.kbService.updateContent(id, data, apiRequest.context);
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * List available categories
   * GET /api/v1/kb-articles/categories
   */
  getCategories() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          const result = await this.kbService.getCategories(apiRequest.context);
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * List article templates
   * GET /api/v1/kb-articles/templates
   */
  getTemplates() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(req.url);
          const articleType = url.searchParams.get('article_type') || undefined;

          const result = await this.kbService.getTemplates(apiRequest.context, articleType);
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create article from ticket
   * POST /api/v1/kb-articles/from-ticket/:ticketId
   */
  createFromTicket() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'create');
          const ticketId = await this.extractIdFromPath(apiRequest);
          const result = await this.kbService.createFromTicket(ticketId, apiRequest.context);
          return createSuccessResponse(result, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
