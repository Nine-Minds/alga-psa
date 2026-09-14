/**
 * API Email Template Controller
 * Reads and edits tenant email templates, so agents (MCP included) can change
 * notification copy without the settings UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController, AuthenticatedApiRequest } from './ApiBaseController';
import { EmailTemplateService } from '../services/EmailTemplateService';
import {
  emailTemplateDeleteQuerySchema,
  emailTemplateDetailQuerySchema,
  emailTemplateListQuerySchema,
  emailTemplateNameSchema,
  updateEmailTemplateSchema,
} from '../schemas/emailTemplateSchemas';
import {
  createPaginatedResponse,
  createSuccessResponse,
  handleApiError,
  ValidationError,
} from '../middleware/apiMiddleware';

export class ApiEmailTemplateController extends ApiBaseController {
  private emailTemplateService: EmailTemplateService;

  constructor() {
    const emailTemplateService = new EmailTemplateService();

    super(emailTemplateService, {
      resource: 'email_template',
      permissionResource: 'settings',
      querySchema: emailTemplateListQuerySchema,
      updateSchema: updateEmailTemplateSchema,
      permissions: {
        read: 'read',
        list: 'read',
        update: 'update',
        delete: 'update',
      },
    });

    this.emailTemplateService = emailTemplateService;
  }

  /** Templates are addressed by kebab-case name, not by UUID. */
  private extractName(req: AuthenticatedApiRequest): string {
    const segments = new URL(req.url).pathname.split('/').filter(Boolean);
    const index = segments.lastIndexOf('templates');
    const raw = index === -1 ? '' : decodeURIComponent(segments[index + 1] ?? '');
    const parsed = emailTemplateNameSchema.safeParse(raw);

    if (!parsed.success) {
      throw new ValidationError('Invalid email template name', parsed.error.errors);
    }

    return parsed.data;
  }

  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, 'read');
          const query = this.validateQuery(apiRequest, emailTemplateListQuerySchema);
          const result = await this.emailTemplateService.list(query, apiRequest.context);

          return createPaginatedResponse(
            result.data,
            result.total,
            result.page,
            result.limit,
            { filters: query },
            apiRequest,
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  getByName() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, 'read');
          const name = this.extractName(apiRequest);
          const { language } = this.validateQuery(apiRequest, emailTemplateDetailQuerySchema);
          const template = await this.emailTemplateService.getByName(name, language, apiRequest.context);

          return createSuccessResponse(template, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  updateByName() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, 'update');
          const name = this.extractName(apiRequest);
          const data = await this.validateData(apiRequest, updateEmailTemplateSchema);
          const template = await this.emailTemplateService.upsertOverride(name, data, apiRequest.context);

          return createSuccessResponse(template, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  deleteByName() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, 'update');
          const name = this.extractName(apiRequest);
          const { language } = this.validateQuery(apiRequest, emailTemplateDeleteQuerySchema);
          await this.emailTemplateService.deleteOverride(name, language, apiRequest.context);

          return createSuccessResponse(null, 204, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
