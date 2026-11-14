/**
 * API Ticket Template Controller
 *
 * REST surface for ticket templates (/api/v1/tickets/templates), the same feature the Settings UI
 * drives. Every handler authenticates the API key, establishes the API-key identity and tenant, and
 * then calls the existing server actions in packages/tickets — no SQL is duplicated here, so the
 * template rules (permissions, reference validation, duplicate names, the "in use by schedules"
 * delete refusal, the client scope) hold identically for REST, MCP and the UI.
 *
 * Permissions: list/get need `ticket_template:read`, create `create`, update/activate `update`,
 * delete `delete`; instantiate needs `ticket:create` as well as `ticket_template:read` (the same
 * double check the Quick Add picker makes). `requireInternal` inside the actions keeps the whole
 * surface out of the client portal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ApiBaseController } from './ApiBaseController';
import { BaseService } from './types';
import { uuidSchema } from '../schemas/common';
import {
  createTicketTemplateSchema,
  instantiateTicketTemplateSchema,
  ticketTemplateListQuerySchema,
  updateTicketTemplateSchema,
} from '../schemas/ticketTemplate';
import {
  createTicketTemplate,
  deleteTicketTemplate,
  getTicketTemplate,
  listTicketTemplates,
  setTicketTemplateActive,
  updateTicketTemplate,
} from '@alga-psa/tickets/actions/ticketTemplateActions';
import { instantiateTicketTemplate } from '@alga-psa/tickets/lib/instantiateTicketTemplate';
import { TICKET_ORIGINS } from '@alga-psa/types';
import { getTenantDefaultLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getConnection } from '../../db/db';
import { hasPermission } from '../../auth/rbac';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createPaginatedResponse,
  createServerActionErrorResponse,
  createSuccessResponse,
  handleApiError,
  isServerActionErrorResult,
} from '../middleware/apiMiddleware';

/** Message key of the delete refusal, which is a conflict rather than a bad request. */
const IN_USE_BY_SCHEDULES_KEY = 'features/tickets:templates.errors.inUseBySchedules';

/**
 * The generic CRUD flow of ApiBaseController is never used here: every handler is explicit and
 * calls a server action, so there is no service to delegate to.
 */
const NO_SERVICE: BaseService = {
  list: () => { throw new Error('ticket templates are served by ticketTemplateActions'); },
  getById: () => { throw new Error('ticket templates are served by ticketTemplateActions'); },
  create: () => { throw new Error('ticket templates are served by ticketTemplateActions'); },
  update: () => { throw new Error('ticket templates are served by ticketTemplateActions'); },
  delete: () => { throw new Error('ticket templates are served by ticketTemplateActions'); },
};

export class ApiTicketTemplateController extends ApiBaseController {
  constructor() {
    super(NO_SERVICE, {
      resource: 'ticket_template',
      permissions: { create: 'create', read: 'read', update: 'update', delete: 'delete', list: 'read' },
    });
  }

  /** `/api/v1/tickets/templates/{templateId}[/instantiate]` */
  private extractTemplateId(req: NextRequest): string {
    const segments = new URL(req.url).pathname.split('/');
    const templatesIndex = segments.indexOf('templates');
    const templateId = templatesIndex >= 0 ? segments[templatesIndex + 1] : undefined;
    if (!templateId || !uuidSchema.safeParse(templateId).success) {
      throw new ValidationError('Validation failed', [
        { path: ['templateId'], message: 'A valid ticket template ID is required' },
      ]);
    }
    return templateId;
  }

  /**
   * A template refused because recurring schedules still use it is a 409, not a 400; everything else
   * keeps the shared mapping (permission -> 403, "not found" -> 404, "already exists" -> 409).
   */
  private actionErrorResponse(result: { actionError?: string; messageKey?: string; permissionError?: string }): NextResponse {
    if (result.messageKey === IN_USE_BY_SCHEDULES_KEY && result.actionError) {
      return NextResponse.json({ error: { code: 'CONFLICT', message: result.actionError } }, { status: 409 });
    }
    return createServerActionErrorResponse(result as Parameters<typeof createServerActionErrorResponse>[0]);
  }

  /** Reads one template through the canonical projection, so every write answers with the same shape. */
  private async readTemplate(templateId: string): Promise<NextResponse | Record<string, unknown>> {
    const template = await getTicketTemplate(templateId);
    if (isServerActionErrorResult(template)) return this.actionErrorResponse(template);
    return template as unknown as Record<string, unknown>;
  }

  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.list || 'read');
          const query = this.validateQuery(apiRequest, ticketTemplateListQuerySchema);

          // `is_active` omitted or true: active templates only. false: the inactive ones.
          const inactiveOnly = query.is_active === false;
          const templates = await listTicketTemplates({
            includeInactive: inactiveOnly,
            clientId: query.client_id ?? null,
            search: query.search,
          });
          if (isServerActionErrorResult(templates)) return this.actionErrorResponse(templates);

          const rows = (inactiveOnly ? templates.filter((template) => !template.is_active) : templates);
          const page = query.page as number;
          const limit = query.limit as number;
          const start = (page - 1) * limit;
          return createPaginatedResponse(
            rows.slice(start, start + limit),
            rows.length,
            page,
            limit,
            { filters: { client_id: query.client_id ?? null, is_active: query.is_active ?? true, search: query.search ?? null } },
            apiRequest,
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  getById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');
          const templateId = this.extractTemplateId(apiRequest);
          const template = await this.readTemplate(templateId);
          if (template instanceof NextResponse) return template;
          return createSuccessResponse(template, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  create() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.create || 'create');
          const data = await this.validateData(apiRequest, createTicketTemplateSchema);

          const created = await createTicketTemplate(data);
          if (isServerActionErrorResult(created)) return this.actionErrorResponse(created);

          const template = await this.readTemplate(created.template_id);
          if (template instanceof NextResponse) return template;
          return createSuccessResponse(template, 201, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /** Replaces the template wholesale (including its checklist); `is_active` activates/deactivates it. */
  update() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');
          const templateId = this.extractTemplateId(apiRequest);
          const { is_active: isActive, ...fields } = await this.validateData(apiRequest, updateTicketTemplateSchema);

          const updated = await updateTicketTemplate(templateId, fields);
          if (isServerActionErrorResult(updated)) return this.actionErrorResponse(updated);

          if (isActive !== undefined) {
            const activated = await setTicketTemplateActive(templateId, isActive);
            if (isServerActionErrorResult(activated)) return this.actionErrorResponse(activated);
          }

          const template = await this.readTemplate(templateId);
          if (template instanceof NextResponse) return template;
          return createSuccessResponse(template, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  delete() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.delete || 'delete');
          const templateId = this.extractTemplateId(apiRequest);

          const result = await deleteTicketTemplate(templateId);
          if (isServerActionErrorResult(result)) return this.actionErrorResponse(result);
          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Creates one ticket from the template: its fields, description, tags, custom fields, ITIL values
   * and checklist items in one request, with `created_from_template_id` recorded. The same code path
   * recurring schedules use, so a template behaves identically however it is applied.
   */
  instantiate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await this.runWithApiKeyContext(apiRequest, async () => {
          const { tenant, user, userId } = apiRequest.context;
          const knex = await getConnection(tenant);
          // Creating a ticket from a template needs both grants, like the in-app picker.
          if (!await hasPermission(user, 'ticket', 'create', knex)) {
            throw new ForbiddenError('Permission denied: Cannot create ticket');
          }
          if (!await hasPermission(user, 'ticket_template', 'read', knex)) {
            throw new ForbiddenError('Permission denied: Cannot read ticket_template');
          }

          const templateId = this.extractTemplateId(apiRequest);
          const data = await this.validateData(apiRequest, instantiateTicketTemplateSchema);
          const dueDate = data.due_date ? new Date(data.due_date) : null;
          const locale = await getTenantDefaultLocale(tenant, 'internal');

          const ticket = await withTransaction(knex, async (trx) => {
            const scoped = tenantDb(trx, tenant);
            const client = await scoped.table('clients').where({ client_id: data.client_id }).first('client_name');
            if (!client) throw new NotFoundError('client not found');
            const contact = data.contact_name_id
              ? await scoped.table('contacts').where({ contact_name_id: data.contact_name_id }).first('full_name')
              : null;

            const { ticketId } = await instantiateTicketTemplate(trx, tenant, {
              templateId,
              client: {
                client_id: data.client_id,
                contact_id: data.contact_name_id ?? null,
                location_id: data.location_id ?? null,
                asset_ids: data.asset_ids ?? [],
              },
              overrides: [],
              dispatch: {
                status_id: data.status_id ?? null,
                assigned_to: data.assigned_to ?? null,
                assigned_team_id: null,
                additional_agent_ids: [],
              },
              actor: { type: 'user', userId },
              suppression: {
                suppressContactNotifications: data.suppressContactNotifications,
                suppressInternalNotifications: data.suppressInternalNotifications,
              },
              titleContext: {
                clientName: client.client_name as string,
                contactName: (contact?.full_name as string | undefined) ?? null,
                dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : null,
                locale,
              },
              origin: { ticket_origin: TICKET_ORIGINS.API, source: 'api' },
              dueDate,
            });

            return scoped.table('tickets').where({ ticket_id: ticketId }).first();
          });

          return createSuccessResponse(ticket, 201, undefined, apiRequest);
        });
      } catch (error) {
        // Per-request template problems (a missing template, a dangling reference, a status that is
        // not on the effective board, a client-bound template used for another client) are the
        // caller's input, not a server fault.
        if (error instanceof Error && error.name === 'TicketTemplateInstantiationError') {
          const code = (error as { code?: string }).code;
          return NextResponse.json({
            error: {
              code: code === 'TEMPLATE_NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST',
              message: error.message,
            },
          }, { status: code === 'TEMPLATE_NOT_FOUND' ? 404 : 400 });
        }
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.issues));
        }
        return handleApiError(error);
      }
    };
  }
}
