/**
 * API Recurring Ticket Controller
 *
 * REST surface for recurring ticket definitions (/api/v1/tickets/recurring), the same feature the
 * Recurring Tickets UI drives. Every handler authenticates the API key, establishes the API-key
 * identity and tenant, and then calls the existing server actions in packages/tickets — no SQL is
 * duplicated here, so the rules (reference validation, archived read-only, the no-backfill watermark
 * on resume/add-client, history surviving client removal) hold identically for REST, MCP and the UI.
 *
 * The controller adds only HTTP: path parsing, the `client_id` -> `definition_client_id` lookup,
 * in-memory list paging, and the status mapping by action `messageKey`.
 *
 * Permissions: `recurring_ticket` read / create / update / delete is checked up front so a caller
 * without the grant fails fast with 403; the action checks again and is the authoritative check
 * (including `ticket_template:read` on create and on a template change).
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { BaseService } from './types';
import {
  recurringDefinitionClientParamsSchema,
  recurringDefinitionParamsSchema,
  recurringTicketAddClientsSchema,
  recurringTicketListQuerySchema,
  recurringTicketOccurrencesQuerySchema,
} from '../schemas/recurringTicket';
import {
  recurringSchedulePreviewInputSchema,
  recurringTicketClientUpdateSchema,
  recurringTicketDefinitionInputSchema,
} from '@alga-psa/tickets/lib/recurring/definitionInput';
import {
  addClientsToRecurringTicketDefinition,
  archiveRecurringTicketDefinition,
  createRecurringTicketDefinition,
  getRecurringTicketDefinition,
  listRecurringTicketDefinitions,
  listRecurringTicketOccurrences,
  previewRecurringTicketOccurrences,
  removeClientFromRecurringTicketDefinition,
  setRecurringTicketClientActive,
  setRecurringTicketDefinitionActive,
  updateRecurringTicketClient,
  updateRecurringTicketDefinition,
} from '@alga-psa/tickets/actions/recurringTicketActions';
import type {
  RecurringDefinitionClientRecord,
  RecurringDefinitionDetail,
  RecurringDefinitionStatus,
} from '@alga-psa/tickets/lib/recurring/types';
import {
  NotFoundError,
  ValidationError,
  createPaginatedResponse,
  createServerActionErrorResponse,
  createSuccessResponse,
  handleApiError,
  isServerActionErrorResult,
  type ServerActionErrorResult,
} from '../middleware/apiMiddleware';
import type { AuthenticatedApiRequest } from '../middleware/apiMiddleware';

const ERROR_KEY_PREFIX = 'features/tickets:recurring.errors.';
const KEY_DEFINITION_NOT_FOUND = `${ERROR_KEY_PREFIX}definitionNotFound`;
const KEY_DEFINITION_ARCHIVED = `${ERROR_KEY_PREFIX}definitionArchived`;
const KEY_CLIENT_NOT_FOUND = `${ERROR_KEY_PREFIX}clientNotFound`;
const KEY_INVALID_REFERENCES = `${ERROR_KEY_PREFIX}invalidReferences`;

type ActionErrorLike = ServerActionErrorResult & { messageKey?: string };

/** Where a `clientNotFound` came from: it is a 404 for a path client, a 400 for a client named in a body. */
type ClientNotFoundScope = 'path' | 'body';

const NO_SERVICE: BaseService = {
  list: () => { throw new Error('recurring tickets are served by recurringTicketActions'); },
  getById: () => { throw new Error('recurring tickets are served by recurringTicketActions'); },
  create: () => { throw new Error('recurring tickets are served by recurringTicketActions'); },
  update: () => { throw new Error('recurring tickets are served by recurringTicketActions'); },
  delete: () => { throw new Error('recurring tickets are served by recurringTicketActions'); },
};

type PermissionAction = 'read' | 'create' | 'update' | 'delete';

function statusOf(definition: RecurringDefinitionDetail['definition']): RecurringDefinitionStatus {
  if (definition.archived_at) return 'archived';
  return definition.is_active ? 'active' : 'paused';
}

export class ApiRecurringTicketController extends ApiBaseController {
  constructor() {
    super(NO_SERVICE, {
      resource: 'recurring_ticket',
      permissions: { create: 'create', read: 'read', update: 'update', delete: 'delete', list: 'read' },
    });
  }

  // -------------------------------------------------------------------------------------------
  // plumbing
  // -------------------------------------------------------------------------------------------

  /** Authenticate, run in the API-key context, fail fast on the RBAC grant, and map thrown errors. */
  private handler(
    permission: PermissionAction,
    fn: (apiRequest: AuthenticatedApiRequest) => Promise<NextResponse>,
  ) {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await this.runWithApiKeyContext(apiRequest, async () => {
          await this.checkPermission(apiRequest, permission);
          return fn(apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /** Path segments after `/recurring`: `[definitionId, 'clients', clientId, action]`. */
  private pathAfterRecurring(req: NextRequest): string[] {
    const segments = new URL(req.url).pathname.split('/').filter(Boolean);
    const index = segments.indexOf('recurring');
    return index >= 0 ? segments.slice(index + 1) : [];
  }

  private parsePath<T extends { parse: (value: unknown) => any }>(schema: T, value: unknown, message: string): ReturnType<T['parse']> {
    const parsed = (schema as any).safeParse(value);
    if (!parsed.success) {
      throw new ValidationError(message, parsed.error.issues);
    }
    return parsed.data;
  }

  private extractDefinitionId(req: NextRequest): string {
    const [definitionId] = this.pathAfterRecurring(req);
    return this.parsePath(recurringDefinitionParamsSchema, { definitionId }, 'A valid recurring ticket ID is required').definitionId;
  }

  private extractDefinitionAndClientId(req: NextRequest): { definitionId: string; clientId: string } {
    const [definitionId, , clientId] = this.pathAfterRecurring(req);
    return this.parsePath(recurringDefinitionClientParamsSchema, { definitionId, clientId }, 'Valid recurring ticket and client IDs are required');
  }

  /**
   * Maps an action's error result by `messageKey`. Permission -> 403; unknown definition or client -> 404;
   * an archived definition -> 409 (the shared message mapping would say 400); bad references -> 400.
   * A `clientNotFound` is a 404 when the client is in the path and a 400 when the body named it.
   */
  private actionErrorResponse(result: ActionErrorLike, clientNotFound: ClientNotFoundScope = 'path'): NextResponse {
    if ('actionError' in result) {
      switch (result.messageKey) {
        case KEY_DEFINITION_NOT_FOUND:
          return NextResponse.json({ error: { code: 'NOT_FOUND', message: result.actionError } }, { status: 404 });
        case KEY_CLIENT_NOT_FOUND:
          return clientNotFound === 'path'
            ? NextResponse.json({ error: { code: 'NOT_FOUND', message: result.actionError } }, { status: 404 })
            : NextResponse.json({ error: { code: 'BAD_REQUEST', message: result.actionError } }, { status: 400 });
        case KEY_DEFINITION_ARCHIVED:
          return NextResponse.json({ error: { code: 'CONFLICT', message: result.actionError } }, { status: 409 });
        case KEY_INVALID_REFERENCES:
          return NextResponse.json({ error: { code: 'BAD_REQUEST', message: result.actionError } }, { status: 400 });
        default:
          break;
      }
    }
    return createServerActionErrorResponse(result);
  }

  /** Reads one definition through the canonical projection, so every write answers with the same shape. */
  private async readDefinition(definitionId: string): Promise<NextResponse | RecurringDefinitionDetail> {
    const detail = await getRecurringTicketDefinition(definitionId);
    if (isServerActionErrorResult(detail)) return this.actionErrorResponse(detail as ActionErrorLike);
    return detail as RecurringDefinitionDetail;
  }

  /**
   * Resolves `{definitionId}` + `{clientId}` (the client's `client_id`) to the definition's client row.
   * The pair must exist on this definition, which the per-client actions do not check themselves: a
   * client that belongs to a different definition is a 404 here.
   */
  private async resolveDefinitionClient(
    definitionId: string,
    clientId: string,
  ): Promise<NextResponse | RecurringDefinitionClientRecord> {
    const detail = await this.readDefinition(definitionId);
    if (detail instanceof NextResponse) return detail;
    const row = detail.clients.find((candidate) => candidate.client_id === clientId);
    if (!row) throw new NotFoundError('Client is not on this recurring ticket');
    return row;
  }

  private async detailResponse(
    apiRequest: AuthenticatedApiRequest,
    definitionId: string,
    status = 200,
    extra: Record<string, unknown> = {},
  ): Promise<NextResponse> {
    const detail = await this.readDefinition(definitionId);
    if (detail instanceof NextResponse) return detail;
    return createSuccessResponse({ ...extra, ...detail }, status, undefined, apiRequest);
  }

  // -------------------------------------------------------------------------------------------
  // definitions
  // -------------------------------------------------------------------------------------------

  list() {
    return this.handler('read', async (apiRequest) => {
      const query = this.validateQuery(apiRequest, recurringTicketListQuerySchema);
      const items = await listRecurringTicketDefinitions(query.status);
      if (isServerActionErrorResult(items)) return this.actionErrorResponse(items as ActionErrorLike);

      // The action neither pages nor searches; do both here (fine at realistic definition counts).
      const needle = (query.search as string | undefined)?.toLowerCase();
      const rows = needle
        ? (items as Array<{ name: string }>).filter((item) => item.name.toLowerCase().includes(needle))
        : (items as unknown[]);
      const page = query.page as number;
      const limit = query.limit as number;
      const start = (page - 1) * limit;
      return createPaginatedResponse(
        rows.slice(start, start + limit),
        rows.length,
        page,
        limit,
        { filters: { status: query.status, search: query.search ?? null } },
        apiRequest,
      );
    });
  }

  create() {
    return this.handler('create', async (apiRequest) => {
      const data = await this.validateData(apiRequest, recurringTicketDefinitionInputSchema);
      const created = await createRecurringTicketDefinition(data);
      if (isServerActionErrorResult(created)) return this.actionErrorResponse(created as ActionErrorLike);
      return this.detailResponse(apiRequest, (created as { definition_id: string }).definition_id, 201);
    });
  }

  preview() {
    return this.handler('read', async (apiRequest) => {
      const draft = await this.validateData(apiRequest, recurringSchedulePreviewInputSchema);
      const preview = await previewRecurringTicketOccurrences(draft);
      if (isServerActionErrorResult(preview)) return this.actionErrorResponse(preview as ActionErrorLike);
      return createSuccessResponse(preview, 200, undefined, apiRequest);
    });
  }

  getById() {
    return this.handler('read', async (apiRequest) => {
      return this.detailResponse(apiRequest, this.extractDefinitionId(apiRequest));
    });
  }

  /** PUT replaces the whole definition: omitted fields return to their defaults. */
  update() {
    return this.handler('update', async (apiRequest) => {
      const definitionId = this.extractDefinitionId(apiRequest);
      const data = await this.validateData(apiRequest, recurringTicketDefinitionInputSchema);
      const updated = await updateRecurringTicketDefinition(definitionId, data);
      if (isServerActionErrorResult(updated)) return this.actionErrorResponse(updated as ActionErrorLike);
      return this.detailResponse(apiRequest, definitionId);
    });
  }

  /** DELETE archives; there is no unarchive. */
  delete() {
    return this.handler('delete', async (apiRequest) => {
      const definitionId = this.extractDefinitionId(apiRequest);
      const result = await archiveRecurringTicketDefinition(definitionId);
      if (isServerActionErrorResult(result)) return this.actionErrorResponse(result as ActionErrorLike);
      return new NextResponse(null, { status: 204 });
    });
  }

  pause() {
    return this.setActive(false);
  }

  resume() {
    return this.setActive(true);
  }

  private setActive(active: boolean) {
    return this.handler('update', async (apiRequest) => {
      const definitionId = this.extractDefinitionId(apiRequest);
      const result = await setRecurringTicketDefinitionActive(definitionId, active);
      if (isServerActionErrorResult(result)) return this.actionErrorResponse(result as ActionErrorLike);
      return this.detailResponse(apiRequest, definitionId);
    });
  }

  /**
   * The next 5 due dates of a saved definition. No action returns these, so the draft is built from
   * the stored definition and handed to the preview action. The preview ignores pause state and the
   * occurrences already generated, so `definition_status` is returned alongside the dates.
   */
  upcoming() {
    return this.handler('read', async (apiRequest) => {
      const detail = await this.readDefinition(this.extractDefinitionId(apiRequest));
      if (detail instanceof NextResponse) return detail;
      const { definition } = detail;
      // Render `{{client}}` in sample_title with a real client of this definition, not an empty string.
      const sampleClient = detail.clients.find((client) => client.is_active) ?? detail.clients[0];

      const preview = await previewRecurringTicketOccurrences({
        ticket_template_id: definition.ticket_template_id,
        sample_client_name: sampleClient?.client_name ?? null,
        recurrence: definition.recurrence,
        start_date: definition.start_date,
        create_time: definition.create_time,
        due_time: definition.due_time,
        lead_days: definition.lead_days,
        non_business_day_policy: definition.non_business_day_policy,
      });
      if (isServerActionErrorResult(preview)) return this.actionErrorResponse(preview as ActionErrorLike);
      return createSuccessResponse(
        { ...(preview as object), definition_status: statusOf(definition) },
        200,
        undefined,
        apiRequest,
      );
    });
  }

  occurrences() {
    return this.handler('read', async (apiRequest) => {
      const definitionId = this.extractDefinitionId(apiRequest);
      const query = this.validateQuery(apiRequest, recurringTicketOccurrencesQuerySchema);

      // The occurrences action does not check the definition exists; an unknown id would be an empty page.
      const detail = await this.readDefinition(definitionId);
      if (detail instanceof NextResponse) return detail;

      const result = await listRecurringTicketOccurrences(definitionId, {
        status: query.status,
        clientId: query.client_id,
        page: query.page,
        pageSize: query.limit,
      });
      if (isServerActionErrorResult(result)) return this.actionErrorResponse(result as ActionErrorLike);
      const { items, total } = result as { items: unknown[]; total: number };
      return createPaginatedResponse(
        items,
        total,
        query.page as number,
        query.limit as number,
        { filters: { status: query.status ?? null, client_id: query.client_id ?? null } },
        apiRequest,
      );
    });
  }

  // -------------------------------------------------------------------------------------------
  // clients
  // -------------------------------------------------------------------------------------------

  addClients() {
    return this.handler('update', async (apiRequest) => {
      const definitionId = this.extractDefinitionId(apiRequest);
      const { client_ids: clientIds } = await this.validateData(apiRequest, recurringTicketAddClientsSchema);
      const result = await addClientsToRecurringTicketDefinition(definitionId, clientIds);
      // A client that no longer exists is the request's fault (400), not a missing path resource.
      if (isServerActionErrorResult(result)) return this.actionErrorResponse(result as ActionErrorLike, 'body');
      return this.detailResponse(apiRequest, definitionId, 200, { added: (result as { added: number }).added });
    });
  }

  updateClient() {
    return this.handler('update', async (apiRequest) => {
      const { definitionId, clientId } = this.extractDefinitionAndClientId(apiRequest);
      const data = await this.validateData(apiRequest, recurringTicketClientUpdateSchema);
      const row = await this.resolveDefinitionClient(definitionId, clientId);
      if (row instanceof NextResponse) return row;

      const result = await updateRecurringTicketClient(row.definition_client_id, data);
      if (isServerActionErrorResult(result)) return this.actionErrorResponse(result as ActionErrorLike);
      return this.detailResponse(apiRequest, definitionId);
    });
  }

  pauseClient() {
    return this.setClientActive(false);
  }

  resumeClient() {
    return this.setClientActive(true);
  }

  private setClientActive(active: boolean) {
    return this.handler('update', async (apiRequest) => {
      const { definitionId, clientId } = this.extractDefinitionAndClientId(apiRequest);
      const row = await this.resolveDefinitionClient(definitionId, clientId);
      if (row instanceof NextResponse) return row;

      const result = await setRecurringTicketClientActive(row.definition_client_id, active);
      if (isServerActionErrorResult(result)) return this.actionErrorResponse(result as ActionErrorLike);
      return this.detailResponse(apiRequest, definitionId);
    });
  }

  /** Removes the client from the schedule; its occurrence history is kept. The action uses `update`, not `delete`. */
  removeClient() {
    return this.handler('update', async (apiRequest) => {
      const { definitionId, clientId } = this.extractDefinitionAndClientId(apiRequest);
      const row = await this.resolveDefinitionClient(definitionId, clientId);
      if (row instanceof NextResponse) return row;

      const result = await removeClientFromRecurringTicketDefinition(row.definition_client_id);
      if (isServerActionErrorResult(result)) return this.actionErrorResponse(result as ActionErrorLike);
      return new NextResponse(null, { status: 204 });
    });
  }
}
