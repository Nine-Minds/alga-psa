import { createTenantKnex, runWithTenant, type ServiceContext } from '@alga-psa/db';
import { ServerAnalyticsTracker } from '@alga-psa/analytics';
import { ServerEventPublisher } from '@alga-psa/event-bus';
import type { IUserWithRoles } from '@alga-psa/types';
import { TicketModel } from '@shared/models/ticketModel';
import {
  buildTeamsBotResultDeepLinkFromPsaUrl,
  buildTeamsMessageExtensionResultDeepLinkFromPsaUrl,
  buildTeamsPersonalTabDeepLinkFromPsaUrl,
} from '../teamsDeepLinks';
import {
  type TeamsAllowedAction,
  type TeamsCapability,
} from '../teamsShared';
import type { TeamsIntegrationExecutionState } from '../teamsContracts';
import { getTeamsIntegrationExecutionStateImpl as getTeamsIntegrationExecutionState } from '../../actions/integrations/teamsActions';
import { z, ZodError } from 'zod';
import { hasPermission } from '@alga-psa/auth/rbac';
import { buildTeamsFullPsaUrl } from '../buildTeamsFullPsaUrl';
import type { TeamsTabDestination } from '../resolveTeamsTabDestination';
import { describeTeamsTabDestination } from '../resolveTeamsTabDestination';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from './teamsActionErrors';
import {
  addTeamsTicketComment,
  approveTeamsTimeSheet,
  createTeamsTimeEntry,
  getTeamsApprovalById,
  getTeamsContactById,
  getTeamsProjectTaskById,
  getTeamsTicketById,
  getTeamsTimeEntryById,
  listAssignedOpenTeamsTickets,
  listPendingApprovalsForTeams,
  type TeamsPendingApprovalRecord,
  requestChangesForTeamsTimeSheet,
  resolveTeamsTicketByReference,
  searchTeamsTickets,
  updateTeamsTicketAssignee,
} from '../teamsPsaData';

export const TEAMS_ACTION_SURFACES = ['bot', 'message_extension', 'quick_action'] as const;
export type TeamsActionSurface = typeof TEAMS_ACTION_SURFACES[number];

export const TEAMS_ACTION_OPERATIONS = ['lookup', 'mutation'] as const;
export type TeamsActionOperation = typeof TEAMS_ACTION_OPERATIONS[number];

export const TEAMS_ACTION_TARGET_TYPES = ['ticket', 'project_task', 'approval', 'time_entry', 'contact'] as const;
export type TeamsActionTargetType = typeof TEAMS_ACTION_TARGET_TYPES[number];

export const TEAMS_ACTION_IDS = [
  'my_tickets',
  'my_approvals',
  'open_record',
  'create_ticket_from_message',
  'update_from_message',
  'assign_ticket',
  'add_note',
  'reply_to_contact',
  'log_time',
  'approval_response',
] as const;
export type TeamsActionId = typeof TEAMS_ACTION_IDS[number];

export type TeamsActionEntityReference =
  | { entityType: 'ticket'; ticketId: string }
  | { entityType: 'project_task'; taskId: string; projectId?: string }
  | { entityType: 'approval'; approvalId: string }
  | { entityType: 'time_entry'; entryId: string }
  | { entityType: 'contact'; contactId: string; clientId?: string };

export interface TeamsActionRequest<TInput extends Record<string, unknown> = Record<string, unknown>> {
  actionId: TeamsActionId;
  surface: TeamsActionSurface;
  tenantId: string;
  user: IUserWithRoles;
  input?: TInput;
  target?: TeamsActionEntityReference;
  idempotencyKey?: string;
}

export interface TeamsActionFieldDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'datetime' | 'enum' | 'entity';
  required: boolean;
  description: string;
}

export interface TeamsActionLink {
  type: 'teams_tab' | 'psa';
  label: string;
  url: string;
}

export interface TeamsActionWarning {
  code: 'partial_failure';
  message: string;
  remediation: string;
}

export interface TeamsActionError {
  code:
    | 'validation_error'
    | 'forbidden'
    | 'not_found'
    | 'not_configured'
    | 'capability_disabled'
    | 'unsupported_action'
    | 'duplicate_submission'
    | 'execution_failed';
  message: string;
  fieldErrors?: Record<string, string>;
  remediation?: string;
  retryable?: boolean;
}

export interface TeamsActionResultItem {
  id: string;
  /** Human-friendly identifier such as ticket_number, used for bot command buttons. */
  displayId?: string;
  title: string;
  summary: string;
  entityType: TeamsActionTargetType;
  links: TeamsActionLink[];
}

export interface TeamsActionSuccessResult {
  success: true;
  actionId: TeamsActionId;
  surface: TeamsActionSurface;
  operation: TeamsActionOperation;
  error?: undefined;
  summary: {
    title: string;
    text: string;
  };
  links: TeamsActionLink[];
  items: TeamsActionResultItem[];
  warnings: TeamsActionWarning[];
  target?: {
    entityType: TeamsActionTargetType;
    id: string;
    destination: TeamsTabDestination;
  };
  metadata: {
    surface: TeamsActionSurface;
    idempotencyKey: string | null;
    idempotentReplay: boolean;
    invokingSurface: TeamsActionSurface;
    businessOperations: string[];
  };
}

export interface TeamsActionFailureResult {
  success: false;
  actionId: TeamsActionId;
  surface: TeamsActionSurface;
  operation: TeamsActionOperation;
  error: TeamsActionError;
  warnings: TeamsActionWarning[];
  metadata: {
    surface: TeamsActionSurface;
    idempotencyKey: string | null;
    idempotentReplay: boolean;
    invokingSurface: TeamsActionSurface;
    businessOperations: string[];
  };
}

export type TeamsActionResult = TeamsActionSuccessResult | TeamsActionFailureResult;

export interface TeamsActionAvailability {
  actionId: TeamsActionId;
  operation: TeamsActionOperation;
  available: boolean;
  targetEntityTypes: TeamsActionTargetType[];
  requiredInputs: TeamsActionFieldDefinition[];
  businessOperations: string[];
  reason?: TeamsActionError['code'];
  message?: string;
}

type TeamsResolvedTarget =
  | {
      entityType: 'ticket';
      id: string;
      entity: Awaited<ReturnType<typeof getTeamsTicketById>>;
      destination: TeamsTabDestination;
    }
  | {
      entityType: 'project_task';
      id: string;
      entity: Awaited<ReturnType<typeof getTeamsProjectTaskById>>;
      destination: TeamsTabDestination;
    }
  | {
      entityType: 'approval';
      id: string;
      entity: Awaited<ReturnType<typeof getTeamsApprovalById>>;
      destination: TeamsTabDestination;
    }
  | {
      entityType: 'time_entry';
      id: string;
      entity: Awaited<ReturnType<typeof getTeamsTimeEntryById>>;
      destination: TeamsTabDestination;
    }
  | {
      entityType: 'contact';
      id: string;
      entity: Awaited<ReturnType<typeof getTeamsContactById>>;
      destination: TeamsTabDestination;
    };

type TeamsActionExecutionContext = {
  integration: TeamsIntegrationExecutionState;
  request: TeamsActionRequest;
  serviceContext: ServiceContext;
};

type TeamsActionDefinition<TNormalized extends Record<string, unknown> = Record<string, unknown>> = {
  id: TeamsActionId;
  title: string;
  description: string;
  operation: TeamsActionOperation;
  targetEntityTypes: TeamsActionTargetType[];
  requiredInputs: TeamsActionFieldDefinition[];
  businessOperations: string[];
  allowedAction?: TeamsAllowedAction;
  requiredCapabilities?: TeamsCapability[];
  normalize: (request: TeamsActionRequest) => TNormalized;
  authorize: (
    normalized: TNormalized,
    context: TeamsActionExecutionContext,
    target: TeamsResolvedTarget | null
  ) => Promise<TeamsActionError | null>;
  execute: (
    normalized: TNormalized,
    context: TeamsActionExecutionContext,
    target: TeamsResolvedTarget | null
  ) => Promise<{
    summary: {
      title: string;
      text: string;
    };
    destination?: TeamsTabDestination;
    target?: TeamsResolvedTarget | null;
    items?: TeamsActionResultItem[];
  }>;
};

const duplicateResults = new Map<string, TeamsActionResult>();
const inFlightResults = new Map<string, Promise<TeamsActionResult>>();

const nonEmptyString = z.string().trim().min(1);
const boundedText = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(4000, `${label} is too long`);
const positiveInt = (label: string, max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && value.trim().length > 0) return Number.parseInt(value, 10);
      return value;
    },
    z.number().int().min(1, `${label} must be at least 1`).max(max, `${label} must be ${max} or less`)
  );
const booleanFromUnknown = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}, z.boolean());

const myTicketsInputSchema = z.object({
  limit: positiveInt('Limit', 25).optional().default(10),
});

const myApprovalsInputSchema = z.object({
  limit: positiveInt('Limit', 25).optional().default(10),
});

const entityReferenceSchema = z.discriminatedUnion('entityType', [
  z.object({ entityType: z.literal('ticket'), ticketId: nonEmptyString }),
  z.object({ entityType: z.literal('project_task'), taskId: nonEmptyString, projectId: nonEmptyString.optional() }),
  z.object({ entityType: z.literal('approval'), approvalId: nonEmptyString }),
  z.object({ entityType: z.literal('time_entry'), entryId: nonEmptyString }),
  z.object({ entityType: z.literal('contact'), contactId: nonEmptyString, clientId: nonEmptyString.optional() }),
]);

function parseEntityReference(value: unknown): TeamsActionEntityReference {
  return entityReferenceSchema.parse(value) as TeamsActionEntityReference;
}

const assignTicketInputSchema = z.object({
  ticketId: nonEmptyString,
  assigneeId: nonEmptyString,
  note: boundedText('Assignment note').optional(),
});

const addNoteInputSchema = z.object({
  ticketId: nonEmptyString,
  note: boundedText('Note'),
  metadata: z.record(z.unknown()).optional(),
});

const replyToContactInputSchema = z.object({
  ticketId: nonEmptyString,
  reply: boundedText('Reply'),
  metadata: z.record(z.unknown()).optional(),
});

const logTimeInputSchema = z.object({
  entityType: z.enum(['ticket', 'project_task']),
  workItemId: nonEmptyString,
  startTime: z.string().datetime(),
  durationMinutes: positiveInt('Duration', 1440),
  note: z.string().trim().max(4000).optional().default(''),
  isBillable: booleanFromUnknown.optional().default(true),
});

const approvalResponseInputSchema = z
  .object({
    approvalId: nonEmptyString,
    outcome: z.enum(['approve', 'request_changes']),
    comment: z.string().trim().max(4000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.outcome === 'request_changes' && (!value.comment || value.comment.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comment'],
        message: 'Comment is required when requesting changes',
      });
    }
  });

const createTicketFromMessageInputSchema = z.object({
  title: boundedText('Title'),
  description: boundedText('Description'),
  boardId: nonEmptyString,
  statusId: nonEmptyString,
  clientId: nonEmptyString,
  contactId: nonEmptyString.optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateFromMessageInputSchema = z
  .object({
    targetEntityType: z.enum(['ticket', 'project_task']),
    targetId: nonEmptyString,
    projectId: nonEmptyString.optional(),
    updateType: z.enum(['internal_note', 'customer_reply', 'continue_in_tab']),
    content: z.string().trim().max(4000).optional().default(''),
    metadata: z.record(z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.updateType !== 'continue_in_tab' && value.content.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'Content is required for Teams message updates',
      });
    }
  });

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function cloneResult<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildServiceContext(request: TeamsActionRequest): ServiceContext {
  return {
    tenant: request.tenantId,
    userId: request.user.user_id,
    user: request.user,
  };
}

function buildResultMetadata(
  request: TeamsActionRequest,
  definition: TeamsActionDefinition,
  idempotentReplay: boolean
): TeamsActionSuccessResult['metadata'] {
  return {
    surface: request.surface,
    idempotencyKey: request.idempotencyKey ?? null,
    idempotentReplay,
    invokingSurface: request.surface,
    businessOperations: definition.businessOperations,
  };
}

function parseActionInput<T extends Record<string, unknown>>(schema: z.ZodType<T>, payload: Record<string, unknown>): T {
  return schema.parse(payload);
}

function buildPayloadFromRequest(
  request: Pick<TeamsActionRequest, 'input'>,
  defaults: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...defaults,
    ...(request.input ?? {}),
  };
}

function requireTargetReference(request: TeamsActionRequest): TeamsActionEntityReference {
  if (request.target) {
    return request.target;
  }

  const payload = buildPayloadFromRequest(request);

  if (typeof payload.entityType === 'string') {
    return parseEntityReference(payload);
  }

  if (typeof payload.ticketId === 'string') {
    return parseEntityReference({ entityType: 'ticket', ticketId: payload.ticketId });
  }

  if (typeof payload.targetEntityType === 'string' && typeof payload.targetId === 'string') {
    if (payload.targetEntityType === 'project_task') {
      return parseEntityReference({
        entityType: 'project_task',
        taskId: payload.targetId,
        projectId: payload.projectId,
      });
    }

    return parseEntityReference({
      entityType: 'ticket',
      ticketId: payload.targetId,
    });
  }

  if (typeof payload.taskId === 'string') {
    return parseEntityReference({
      entityType: 'project_task',
      taskId: payload.taskId,
      projectId: payload.projectId,
    });
  }

  if (typeof payload.approvalId === 'string') {
    return parseEntityReference({ entityType: 'approval', approvalId: payload.approvalId });
  }

  if (typeof payload.entryId === 'string') {
    return parseEntityReference({ entityType: 'time_entry', entryId: payload.entryId });
  }

  if (typeof payload.contactId === 'string') {
    return parseEntityReference({
      entityType: 'contact',
      contactId: payload.contactId,
      clientId: payload.clientId,
    });
  }

  throw new ValidationError('Validation failed', [
    {
      path: ['target'],
      message: 'A supported Teams target is required',
    },
  ]);
}

async function resolveTargetInternal(
  reference: TeamsActionEntityReference,
  serviceContext: ServiceContext
): Promise<TeamsResolvedTarget> {
  switch (reference.entityType) {
    case 'ticket': {
      const entity = await resolveTeamsTicketByReference(reference.ticketId, serviceContext);
      if (!entity) {
        throw new NotFoundError('Ticket not found. Use a ticket number (e.g. alga0001833) or a valid ticket ID.');
      }
      const resolvedTicketId = entity.ticket_id;

      return {
        entityType: 'ticket',
        id: resolvedTicketId,
        entity,
        destination: { type: 'ticket', ticketId: resolvedTicketId },
      };
    }

    case 'project_task': {
      const entity = await getTeamsProjectTaskById(reference.taskId, serviceContext);
      if (!entity) {
        throw new NotFoundError('Project task not found');
      }

      const projectId =
        (reference.projectId && reference.projectId.trim()) ||
        (typeof (entity as { project_id?: string }).project_id === 'string'
          ? (entity as { project_id?: string }).project_id
          : undefined);
      if (!projectId) {
        throw new ValidationError('Validation failed', [
          {
            path: ['projectId'],
            message: 'Project task links require a projectId',
          },
        ]);
      }

      return {
        entityType: 'project_task',
        id: reference.taskId,
        entity,
        destination: { type: 'project_task', projectId, taskId: reference.taskId },
      };
    }

    case 'approval': {
      const entity = await getTeamsApprovalById(reference.approvalId, serviceContext);
      if (!entity) {
        throw new NotFoundError('Approval item not found');
      }

      return {
        entityType: 'approval',
        id: reference.approvalId,
        entity,
        destination: { type: 'approval', approvalId: reference.approvalId },
      };
    }

    case 'time_entry': {
      const entity = await getTeamsTimeEntryById(reference.entryId, serviceContext);
      if (!entity) {
        throw new NotFoundError('Time entry not found');
      }

      return {
        entityType: 'time_entry',
        id: reference.entryId,
        entity,
        destination: { type: 'time_entry', entryId: reference.entryId },
      };
    }

    case 'contact': {
      const entity = await getTeamsContactById(reference.contactId, serviceContext);
      if (!entity) {
        throw new NotFoundError('Contact not found');
      }

      return {
        entityType: 'contact',
        id: reference.contactId,
        entity,
        destination: {
          type: 'contact',
          contactId: reference.contactId,
          clientId:
            reference.clientId ||
            (typeof (entity as { client_id?: string }).client_id === 'string'
              ? (entity as { client_id?: string }).client_id
              : undefined),
        },
      };
    }
  }
}

async function resolveDefaultPriorityIdForBoard(tenantId: string, boardId: string): Promise<string | null> {
  const { knex } = await createTenantKnex(tenantId);
  const board = (await knex('boards')
    .where({ tenant: tenantId, board_id: boardId, is_inactive: false })
    .select('default_priority_id', 'priority_type')
    .first()) as { default_priority_id?: string | null; priority_type?: string | null } | null;

  const boardDefaultPriorityId = normalizeOptionalString(board?.default_priority_id);
  if (boardDefaultPriorityId) {
    return boardDefaultPriorityId;
  }

  const desiredPriorityType = normalizeOptionalString(board?.priority_type) || 'custom';
  const primaryPriority = (await knex('priorities')
    .select('priority_id')
    .where({ tenant: tenantId, item_type: 'ticket' })
    .where(function filterPriorityType() {
      if (desiredPriorityType === 'itil') {
        this.where('is_from_itil_standard', true);
      } else {
        this.where(function filterCustomPriorities() {
          this.whereNull('is_from_itil_standard').orWhere('is_from_itil_standard', false);
        });
      }
    })
    .orderByRaw(
      desiredPriorityType === 'itil'
        ? "CASE WHEN itil_priority_level = 3 THEN 0 ELSE 1 END, order_number ASC, priority_name ASC"
        : 'order_number ASC, priority_name ASC'
    )
    .first()) as { priority_id?: string | null } | null;

  if (normalizeOptionalString(primaryPriority?.priority_id)) {
    return normalizeOptionalString(primaryPriority?.priority_id);
  }

  const fallbackPriority = (await knex('priorities')
    .select('priority_id')
    .where({ tenant: tenantId, item_type: 'ticket' })
    .orderBy('order_number', 'asc')
    .orderBy('priority_name', 'asc')
    .first()) as { priority_id?: string | null } | null;

  return normalizeOptionalString(fallbackPriority?.priority_id);
}

async function findTicketByMessageActionIdempotencyKey(
  tenantId: string,
  idempotencyKey: string
): Promise<{ ticketId: string; ticketNumber: string | null; title: string | null } | null> {
  const { knex } = await createTenantKnex(tenantId);
  const row = (await knex('tickets')
    .where({ tenant: tenantId })
    .whereRaw("(attributes::jsonb ->> 'idempotency_key') = ?", [idempotencyKey])
    .select('ticket_id', 'ticket_number', 'title')
    .first()) as { ticket_id?: string | null; ticket_number?: string | null; title?: string | null } | null;

  const ticketId = normalizeOptionalString(row?.ticket_id);
  if (!ticketId) {
    return null;
  }

  return {
    ticketId,
    ticketNumber: normalizeOptionalString(row?.ticket_number),
    title: normalizeOptionalString(row?.title),
  };
}

async function validateCreateTicketMessageSelection(params: {
  tenantId: string;
  boardId: string;
  statusId: string;
  clientId: string;
  contactId?: string;
}): Promise<void> {
  const { knex } = await createTenantKnex(params.tenantId);

  const [board, status, client, contact] = await Promise.all([
    knex('boards')
      .where({ tenant: params.tenantId, board_id: params.boardId, is_inactive: false })
      .select('board_id')
      .first(),
    knex('statuses')
      .where({ tenant: params.tenantId, status_id: params.statusId, status_type: 'ticket', is_closed: false })
      .select('status_id')
      .first(),
    knex('clients')
      .where({ tenant: params.tenantId, client_id: params.clientId, is_inactive: false })
      .select('client_id')
      .first(),
    params.contactId
      ? knex('contacts')
          .where({ tenant: params.tenantId, contact_name_id: params.contactId, is_inactive: false })
          .select('contact_name_id', 'client_id')
          .first()
      : Promise.resolve(null),
  ]);

  if (!board) {
    throw new ValidationError('Validation failed', [
      {
        path: ['boardId'],
        message: 'Select an active PSA board before creating a ticket from this Teams message.',
      },
    ]);
  }

  if (!status) {
    throw new ValidationError('Validation failed', [
      {
        path: ['statusId'],
        message: 'Select an open PSA status before creating a ticket from this Teams message.',
      },
    ]);
  }

  if (!client) {
    throw new ValidationError('Validation failed', [
      {
        path: ['clientId'],
        message: 'Select an active PSA client before creating a ticket from this Teams message.',
      },
    ]);
  }

  if (params.contactId) {
    const resolvedContactId = normalizeOptionalString((contact as { contact_name_id?: string | null } | null)?.contact_name_id);
    const resolvedContactClientId = normalizeOptionalString((contact as { client_id?: string | null } | null)?.client_id);

    if (!resolvedContactId) {
      throw new ValidationError('Validation failed', [
        {
          path: ['contactId'],
          message: 'Select a valid PSA contact or clear the contact field before creating a ticket from this Teams message.',
        },
      ]);
    }

    if (resolvedContactClientId && resolvedContactClientId !== params.clientId) {
      throw new ValidationError('Validation failed', [
        {
          path: ['contactId'],
          message: 'The selected PSA contact does not belong to the selected client.',
        },
      ]);
    }
  }
}

function getCapabilityForSurface(surface: TeamsActionSurface): TeamsCapability | null {
  switch (surface) {
    case 'bot':
      return 'personal_bot';
    case 'message_extension':
      return 'message_extension';
    case 'quick_action':
      return null;
  }
}

async function ensurePermission(
  user: IUserWithRoles,
  resource: string,
  action: string,
  message: string
): Promise<TeamsActionError | null> {
  const allowed = await hasPermission(user, resource, action);
  if (allowed) {
    return null;
  }

  return {
    code: 'forbidden',
    message,
    remediation: 'Use the full PSA application if you need access to this operation.',
  };
}

function mapErrorToActionError(error: unknown): TeamsActionError {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const key = issue.path.map(String).join('.') || 'input';
      if (!fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }

    return {
      code: 'validation_error',
      message: 'The Teams action request is missing required or valid inputs.',
      fieldErrors,
      remediation: 'Update the missing fields and try again.',
    };
  }

  if (error instanceof ValidationError) {
    const fieldErrors: Record<string, string> = {};
    const details = Array.isArray(error.details) ? error.details : [];
    for (const issue of details) {
      const path = Array.isArray(issue?.path) ? issue.path.map(String).join('.') : 'input';
      const message = typeof issue?.message === 'string' ? issue.message : error.message;
      if (!fieldErrors[path]) {
        fieldErrors[path] = message;
      }
    }

    return {
      code: 'validation_error',
      message: error.message || 'The Teams action request is invalid.',
      fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
      remediation: 'Correct the highlighted fields and submit the action again.',
    };
  }

  if (error instanceof ForbiddenError) {
    return {
      code: 'forbidden',
      message: error.message || 'You do not have permission to run this Teams action.',
      remediation: 'Open the full PSA application if you need broader access.',
    };
  }

  if (error instanceof NotFoundError) {
    return {
      code: 'not_found',
      message: error.message || 'The requested record could not be found.',
      remediation: 'Refresh the Teams result or open the full PSA application to verify the record still exists.',
    };
  }

  const message = error instanceof Error ? error.message : 'Teams action execution failed';
  if (/not found/i.test(message)) {
    return {
      code: 'not_found',
      message,
      remediation: 'Refresh the Teams result or open the full PSA application to verify the record still exists.',
    };
  }

  if (/permission denied|forbidden/i.test(message)) {
    return {
      code: 'forbidden',
      message,
      remediation: 'Open the full PSA application if you need broader access.',
    };
  }

  return {
    code: 'execution_failed',
    message,
    remediation: 'Try the action again or continue in the full PSA application.',
    retryable: true,
  };
}

function buildActionLinks(
  destination: TeamsTabDestination | undefined,
  integration: TeamsIntegrationExecutionState,
  surface: TeamsActionSurface
): { links: TeamsActionLink[]; warnings: TeamsActionWarning[] } {
  if (!destination) {
    return { links: [], warnings: [] };
  }

  const psaUrl = buildTeamsFullPsaUrl(destination);
  if (!psaUrl) {
    return { links: [], warnings: [] };
  }

  const baseUrl =
    integration.packageMetadata && typeof integration.packageMetadata.baseUrl === 'string'
      ? integration.packageMetadata.baseUrl
      : null;

  // Hero Card openUrl buttons require absolute URLs — Teams cannot navigate
  // to a relative path. Use baseUrl when available to make the PSA link work.
  const absolutePsaUrl = psaUrl.startsWith('http') ? psaUrl : (baseUrl ? `${baseUrl}${psaUrl}` : psaUrl);

  const links: TeamsActionLink[] = [
    {
      type: 'psa',
      label: 'Open in full PSA',
      url: absolutePsaUrl,
    },
  ];
  const warnings: TeamsActionWarning[] = [];

  if (baseUrl && integration.appId) {
    const teamsUrl =
      surface === 'bot'
        ? buildTeamsBotResultDeepLinkFromPsaUrl(baseUrl, integration.appId, absolutePsaUrl)
        : surface === 'message_extension'
          ? buildTeamsMessageExtensionResultDeepLinkFromPsaUrl(baseUrl, integration.appId, absolutePsaUrl)
          : buildTeamsPersonalTabDeepLinkFromPsaUrl(baseUrl, integration.appId, absolutePsaUrl);

    links.unshift({
      type: 'teams_tab',
      label: 'Open in Teams tab',
      url: teamsUrl,
    });
  } else {
    warnings.push({
      code: 'partial_failure',
      message: 'The tenant Teams package metadata is incomplete, so only the PSA fallback link is available.',
      remediation: 'Regenerate the Teams package in settings to restore Teams-tab links for action results.',
    });
  }

  return { links, warnings };
}

async function buildItemForDestination(
  entityType: TeamsActionTargetType,
  id: string,
  title: string,
  summary: string,
  destination: TeamsTabDestination,
  integration: TeamsIntegrationExecutionState,
  surface: TeamsActionSurface,
  displayId?: string
): Promise<TeamsActionResultItem> {
  const { links } = buildActionLinks(destination, integration, surface);
  return {
    id,
    ...(displayId ? { displayId } : {}),
    title,
    summary,
    entityType,
    links,
  };
}

function describeTicketListSummary(ticket: Record<string, unknown>): string {
  const parts = [
    typeof ticket.title === 'string' ? ticket.title.trim() : '',
    typeof ticket.status_name === 'string' ? ticket.status_name.trim() : '',
    typeof ticket.priority_name === 'string' ? ticket.priority_name.trim() : '',
  ].filter(Boolean);

  return parts.join(' • ') || 'Ticket opened from Teams';
}

function formatApprovalPeriod(startDate: string | null, endDate: string | null): string {
  if (!startDate || !endDate) {
    return 'Period unavailable';
  }

  return `${startDate} to ${endDate}`;
}

function describeApprovalListSummary(approval: TeamsPendingApprovalRecord): string {
  const employeeName = [approval.first_name, approval.last_name].filter(Boolean).join(' ').trim() || 'Unknown employee';
  const status = approval.approval_status?.trim() || 'SUBMITTED';
  return `${employeeName} • ${formatApprovalPeriod(approval.period_start_date, approval.period_end_date)} • ${status}`;
}

function describeResolvedTarget(target: TeamsResolvedTarget): { title: string; summary: string } {
  switch (target.entityType) {
    case 'ticket': {
      const entity = (target.entity || {}) as unknown as Record<string, unknown>;
      const ticketNumber =
        typeof entity.ticket_number === 'string' && entity.ticket_number.trim().length > 0
          ? entity.ticket_number.trim()
          : target.id;
      return {
        title: `Ticket ${ticketNumber}`,
        summary: describeTicketListSummary(entity),
      };
    }
    case 'project_task': {
      const entity = (target.entity || {}) as unknown as Record<string, unknown>;
      const taskName =
        typeof entity.task_name === 'string' && entity.task_name.trim().length > 0
          ? entity.task_name.trim()
          : target.id;
      return {
        title: `Project task ${taskName}`,
        summary: typeof entity.description === 'string' && entity.description.trim().length > 0
          ? entity.description.trim()
          : `Project task ${target.id} is ready to open from Teams.`,
      };
    }
    case 'approval':
      return {
        title: `Approval ${target.id}`,
        summary: `Approval ${target.id} is ready to open from Teams.`,
      };
    case 'time_entry':
      return {
        title: `Time entry ${target.id}`,
        summary: `Time entry ${target.id} is ready to open from Teams.`,
      };
    case 'contact': {
      const entity = (target.entity || {}) as unknown as Record<string, unknown>;
      const contactName =
        typeof entity.full_name === 'string' && entity.full_name.trim().length > 0
          ? entity.full_name.trim()
          : target.id;
      const clientName =
        typeof entity.client_name === 'string' && entity.client_name.trim().length > 0
          ? entity.client_name.trim()
          : '';
      return {
        title: `Contact ${contactName}`,
        summary: clientName ? `${contactName} • ${clientName}` : `Contact ${contactName} is ready to open from Teams.`,
      };
    }
  }
}

const actionDefinitions: Record<TeamsActionId, TeamsActionDefinition> = {
  my_tickets: {
    id: 'my_tickets',
    title: 'My tickets',
    description: 'List the signed-in technician’s assigned tickets.',
    operation: 'lookup',
    targetEntityTypes: [],
    requiredInputs: [
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: 'Optional maximum number of tickets to return.',
      },
    ],
    businessOperations: ['TicketService.list'],
    requiredCapabilities: ['personal_bot'],
    normalize: (request) => parseActionInput(myTicketsInputSchema, buildPayloadFromRequest(request)),
    authorize: async (_normalized, context) =>
      ensurePermission(
        context.request.user,
        'ticket',
        'read',
        'You do not have permission to view tickets from Teams.'
      ),
    execute: async (normalized, context) => {
      const tickets = await listAssignedOpenTeamsTickets({
        tenantId: context.request.tenantId,
        assignedToUserId: context.request.user.user_id,
        limit: normalized.limit as number,
      });

      const items = await Promise.all(
        tickets.map((ticket) => {
          const ticketId = String((ticket as { ticket_id?: string }).ticket_id ?? '');
          const ticketNumber = String((ticket as { ticket_number?: string }).ticket_number || '').trim() || undefined;
          return buildItemForDestination(
            'ticket',
            ticketId,
            ticketNumber || ticketId || 'Ticket',
            describeTicketListSummary(ticket as unknown as Record<string, unknown>),
            { type: 'ticket', ticketId },
            context.integration,
            context.request.surface,
            ticketNumber
          );
        })
      );

      return {
        summary: {
          title: 'My tickets',
          text:
            items.length > 0
              ? `Found ${items.length} assigned ticket${items.length === 1 ? '' : 's'} for the signed-in technician.`
              : 'No assigned tickets matched this Teams request.',
        },
        items,
      };
    },
  },
  my_approvals: {
    id: 'my_approvals',
    title: 'My approvals',
    description: 'List time-sheet approvals the signed-in approver can act on from Teams.',
    operation: 'lookup',
    targetEntityTypes: [],
    requiredInputs: [
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: 'Optional maximum number of approval items to return.',
      },
    ],
    businessOperations: ['TimeSheetApprovalQuery.listPendingApprovals'],
    requiredCapabilities: ['personal_bot'],
    normalize: (request) => parseActionInput(myApprovalsInputSchema, buildPayloadFromRequest(request)),
    authorize: async (_normalized, context) =>
      ensurePermission(
        context.request.user,
        'timesheet',
        'approve',
        'You do not have permission to view approvals from Teams.'
      ),
    execute: async (normalized, context) => {
      const approvals = await listPendingApprovalsForTeams({
        tenantId: context.request.tenantId,
        user: context.request.user,
        limit: normalized.limit as number,
      });

      const items = await Promise.all(
        approvals.map((approval) =>
          buildItemForDestination(
            'approval',
            approval.id,
            `Approval ${approval.id}`,
            describeApprovalListSummary(approval),
            { type: 'approval', approvalId: approval.id },
            context.integration,
            context.request.surface
          )
        )
      );

      return {
        summary: {
          title: 'My approvals',
          text:
            items.length > 0
              ? `Found ${items.length} approval item${items.length === 1 ? '' : 's'} ready for review in Teams.`
              : 'No pending approvals matched this Teams request.',
        },
        items,
      };
    },
  },
  open_record: {
    id: 'open_record',
    title: 'Open record',
    description: 'Resolve a supported PSA record into Teams-safe summary data and links.',
    operation: 'lookup',
    targetEntityTypes: [...TEAMS_ACTION_TARGET_TYPES],
    requiredInputs: [
      {
        name: 'target',
        type: 'entity',
        required: true,
        description: 'The ticket, task, approval, time entry, or contact to open.',
      },
    ],
    businessOperations: [
      'TicketService.getById',
      'ProjectService.getTaskById',
      'TimeSheetService.getById',
      'TimeEntryService.getById',
      'ContactService.getById',
    ],
    normalize: (request) => requireTargetReference(request),
    authorize: async (_normalized, context, target) => {
      if (!target) {
        return {
          code: 'validation_error',
          message: 'A Teams record target is required.',
        };
      }

      switch (target.entityType) {
        case 'ticket':
          return ensurePermission(context.request.user, 'ticket', 'read', 'You do not have permission to view tickets from Teams.');
        case 'project_task':
          return ensurePermission(context.request.user, 'project', 'read', 'You do not have permission to view project tasks from Teams.');
        case 'approval':
          return ensurePermission(context.request.user, 'timesheet', 'approve', 'You do not have permission to view approval work from Teams.');
        case 'time_entry':
          return ensurePermission(context.request.user, 'time_entry', 'read', 'You do not have permission to view time entries from Teams.');
        case 'contact':
          return ensurePermission(context.request.user, 'contact', 'read', 'You do not have permission to view contacts from Teams.');
      }
    },
    execute: async (_normalized, context, target) => {
      if (!target) {
        throw new ValidationError('Validation failed', [{ path: ['target'], message: 'Target is required' }]);
      }

      const description = describeResolvedTarget(target);
      const ticketDisplayId = target.entityType === 'ticket'
        ? (typeof (target.entity as any)?.ticket_number === 'string' ? (target.entity as any).ticket_number.trim() : undefined) || undefined
        : undefined;
      const item = await buildItemForDestination(
        target.entityType,
        target.id,
        description.title,
        description.summary,
        target.destination,
        context.integration,
        context.request.surface,
        ticketDisplayId
      );
      return {
        summary: {
          title: description.title,
          text: description.summary,
        },
        destination: target.destination,
        target,
        items: [item],
      };
    },
  },
  create_ticket_from_message: {
    id: 'create_ticket_from_message',
    title: 'Create ticket from message',
    description: 'Create a PSA ticket from Teams message content using the shared Teams action layer.',
    operation: 'mutation',
    targetEntityTypes: [],
    requiredInputs: [
      { name: 'title', type: 'string', required: true, description: 'Ticket title derived from the Teams message.' },
      { name: 'description', type: 'string', required: true, description: 'Ticket description derived from the Teams message.' },
      { name: 'boardId', type: 'string', required: true, description: 'Target PSA board.' },
      { name: 'statusId', type: 'string', required: true, description: 'Open PSA status for the new ticket.' },
      { name: 'clientId', type: 'string', required: true, description: 'Target PSA client.' },
      { name: 'contactId', type: 'string', required: false, description: 'Optional PSA contact for the new ticket.' },
    ],
    businessOperations: ['TicketModel.createTicketWithRetry'],
    requiredCapabilities: ['message_extension'],
    normalize: (request) => parseActionInput(createTicketFromMessageInputSchema, buildPayloadFromRequest(request)),
    authorize: async (_normalized, context) =>
      ensurePermission(context.request.user, 'ticket', 'create', 'You do not have permission to create PSA tickets from Teams messages.'),
    execute: async (normalized, context) => {
      if (!context.request.idempotencyKey) {
        throw new ValidationError('Validation failed', [
          {
            path: ['idempotencyKey'],
            message: 'Reopen the Teams message action before creating a ticket so the submission can be applied safely once.',
          },
        ]);
      }

      const existingTicket = await findTicketByMessageActionIdempotencyKey(context.request.tenantId, context.request.idempotencyKey);
      if (existingTicket) {
        return {
          summary: {
            title: existingTicket.ticketNumber ? `Created ticket ${existingTicket.ticketNumber}` : 'Ticket created',
            text: existingTicket.title || `Ticket ${existingTicket.ticketId} is ready to open from Teams.`,
          },
          destination: {
            type: 'ticket',
            ticketId: existingTicket.ticketId,
          },
        };
      }

      await validateCreateTicketMessageSelection({
        tenantId: context.request.tenantId,
        boardId: String(normalized.boardId),
        statusId: String(normalized.statusId),
        clientId: String(normalized.clientId),
        ...(normalizeOptionalString(normalized.contactId) ? { contactId: normalizeOptionalString(normalized.contactId)! } : {}),
      });

      const priorityId = await resolveDefaultPriorityIdForBoard(context.request.tenantId, String(normalized.boardId));
      if (!priorityId) {
        throw new ValidationError('Validation failed', [
          {
            path: ['boardId'],
            message:
              'The selected PSA board does not have a usable default priority. Update board priority defaults before creating a ticket from Teams.',
          },
        ]);
      }

      const { knex } = await createTenantKnex(context.request.tenantId);
      const createdTicket = await knex.transaction((trx: any) =>
        TicketModel.createTicketWithRetry(
          {
            title: String(normalized.title),
            description: String(normalized.description),
            client_id: String(normalized.clientId),
            contact_id: normalizeOptionalString(normalized.contactId) || undefined,
            board_id: String(normalized.boardId),
            status_id: String(normalized.statusId),
            priority_id: priorityId,
            entered_by: context.request.user.user_id,
            source: 'teams_message_extension',
            ticket_origin: 'internal',
            attributes: {
              idempotency_key: context.request.idempotencyKey,
              teams_message_source: normalized.metadata || {},
            },
          },
          context.request.tenantId,
          trx,
          {},
          new ServerEventPublisher(),
          new ServerAnalyticsTracker(),
          context.request.user.user_id,
          3
        )
      );

      const ticketNumber = normalizeOptionalString((createdTicket as { ticket_number?: string | null }).ticket_number);
      return {
        summary: {
          title: ticketNumber ? `Created ticket ${ticketNumber}` : 'Ticket created',
          text: ticketNumber
            ? `Created ticket ${ticketNumber} from the selected Teams message.`
            : `Created ticket ${String((createdTicket as { ticket_id?: string | null }).ticket_id || normalized.title)} from the selected Teams message.`,
        },
        destination: {
          type: 'ticket',
          ticketId: String((createdTicket as { ticket_id?: string | null }).ticket_id),
        },
      };
    },
  },
  update_from_message: {
    id: 'update_from_message',
    title: 'Update from message',
    description: 'Apply a Teams message as a PSA ticket update or safe Teams-tab handoff.',
    operation: 'mutation',
    targetEntityTypes: ['ticket', 'project_task'],
    requiredInputs: [
      { name: 'targetEntityType', type: 'enum', required: true, description: 'Whether the Teams message targets a ticket or project task.' },
      { name: 'targetId', type: 'entity', required: true, description: 'Ticket or task ID to update.' },
      { name: 'projectId', type: 'string', required: false, description: 'Optional parent project ID for project-task targets.' },
      { name: 'updateType', type: 'enum', required: true, description: 'Whether to add an internal note, send a customer reply, or continue in the Teams tab.' },
      { name: 'content', type: 'string', required: false, description: 'Note or reply body derived from the Teams message.' },
    ],
    businessOperations: ['TicketService.addComment', 'TicketService.getById', 'ProjectService.getTaskById'],
    requiredCapabilities: ['message_extension'],
    normalize: (request) => parseActionInput(updateFromMessageInputSchema, buildPayloadFromRequest(request)),
    authorize: async (normalized, context, target) => {
      if (!target) {
        return {
          code: 'validation_error',
          message: 'A supported PSA record target is required.',
        };
      }

      if (target.entityType === 'project_task') {
        return ensurePermission(
          context.request.user,
          'project',
          'read',
          'You do not have permission to open project tasks from Teams.'
        );
      }

      if (normalized.updateType === 'continue_in_tab') {
        return ensurePermission(
          context.request.user,
          'ticket',
          'read',
          'You do not have permission to open tickets from Teams.'
        );
      }

      return ensurePermission(
        context.request.user,
        'ticket',
        'update',
        normalized.updateType === 'customer_reply'
          ? 'You do not have permission to send ticket replies from Teams.'
          : 'You do not have permission to add ticket notes from Teams.'
      );
    },
    execute: async (normalized, context, target) => {
      if (!target) {
        throw new ValidationError('Validation failed', [
          {
            path: ['targetId'],
            message: 'A supported PSA record target is required.',
          },
        ]);
      }

      if (target.entityType === 'project_task') {
        return {
          summary: {
            title: 'Continue in Teams tab',
            text:
              normalized.updateType === 'customer_reply'
                ? 'Customer-visible replies are only supported for tickets from Teams. Open the project task in Teams or full PSA to continue.'
                : 'Project task updates from Teams open in the Teams tab so you can add the full task context safely.',
          },
          destination: target.destination,
          target,
        };
      }

      if (normalized.updateType === 'continue_in_tab') {
        return {
          summary: {
            title: 'Continue in Teams tab',
            text: 'Open the ticket in Teams or full PSA to continue this workflow.',
          },
          destination: target.destination,
          target,
        };
      }

      await addTeamsTicketComment({
        ticketId: target.id,
        tenantId: context.request.tenantId,
        actorUserId: context.request.user.user_id,
        commentText: String(normalized.content),
        isInternal: normalized.updateType !== 'customer_reply',
        metadata: normalized.metadata as Record<string, unknown> | undefined,
      });

      const ticketLabel = typeof (target.entity as any)?.ticket_number === 'string'
        ? (target.entity as any).ticket_number.trim()
        : target.id;
      return {
        summary: {
          title: normalized.updateType === 'customer_reply' ? 'Reply sent' : 'Internal note added',
          text:
            normalized.updateType === 'customer_reply'
              ? `A customer-visible reply was added to ticket ${ticketLabel}.`
              : `An internal note was added to ticket ${ticketLabel}.`,
        },
        destination: target.destination,
        target,
      };
    },
  },
  assign_ticket: {
    id: 'assign_ticket',
    title: 'Assign ticket',
    description: 'Assign a ticket to a technician using the shared Teams action layer.',
    operation: 'mutation',
    targetEntityTypes: ['ticket'],
    requiredInputs: [
      { name: 'ticketId', type: 'entity', required: true, description: 'Ticket to assign.' },
      { name: 'assigneeId', type: 'string', required: true, description: 'User ID of the technician to assign.' },
      { name: 'note', type: 'string', required: false, description: 'Optional internal note to attach after assignment.' },
    ],
    businessOperations: ['TicketService.update', 'TicketService.addComment'],
    allowedAction: 'assign_ticket',
    requiredCapabilities: ['personal_bot', 'message_extension'],
    normalize: (request) =>
      parseActionInput(
        assignTicketInputSchema,
        buildPayloadFromRequest(request, request.target?.entityType === 'ticket' ? { ticketId: request.target.ticketId } : {})
      ),
    authorize: async (_normalized, context) =>
      ensurePermission(context.request.user, 'ticket', 'update', 'You do not have permission to assign tickets from Teams.'),
    execute: async (normalized, context, target) => {
      const resolvedTicketId = target?.entityType === 'ticket' ? target.id : String(normalized.ticketId);
      await updateTeamsTicketAssignee({
        ticketId: resolvedTicketId,
        tenantId: context.request.tenantId,
        assigneeId: String(normalized.assigneeId),
        actorUserId: context.request.user.user_id,
      });
      if (normalized.note) {
        await addTeamsTicketComment({
          ticketId: resolvedTicketId,
          tenantId: context.request.tenantId,
          actorUserId: context.request.user.user_id,
          commentText: String(normalized.note),
          isInternal: true,
        });
      }

      const refreshedTarget = await resolveTargetInternal(
        { entityType: 'ticket', ticketId: resolvedTicketId },
        context.serviceContext
      );
      const ticketLabel = typeof (refreshedTarget.entity as any)?.ticket_number === 'string'
        ? (refreshedTarget.entity as any).ticket_number.trim()
        : resolvedTicketId;
      return {
        summary: {
          title: 'Ticket assigned',
          text: `Ticket ${ticketLabel} was reassigned successfully.`,
        },
        destination: refreshedTarget.destination,
        target: refreshedTarget,
      };
    },
  },
  add_note: {
    id: 'add_note',
    title: 'Add note',
    description: 'Append an internal ticket note from Teams.',
    operation: 'mutation',
    targetEntityTypes: ['ticket'],
    requiredInputs: [
      { name: 'ticketId', type: 'entity', required: true, description: 'Ticket receiving the internal note.' },
      { name: 'note', type: 'string', required: true, description: 'Internal note body.' },
    ],
    businessOperations: ['TicketService.addComment'],
    allowedAction: 'add_note',
    requiredCapabilities: ['personal_bot', 'message_extension'],
    normalize: (request) =>
      parseActionInput(
        addNoteInputSchema,
        buildPayloadFromRequest(request, request.target?.entityType === 'ticket' ? { ticketId: request.target.ticketId } : {})
      ),
    authorize: async (_normalized, context) =>
      ensurePermission(context.request.user, 'ticket', 'update', 'You do not have permission to add ticket notes from Teams.'),
    execute: async (normalized, context, target) => {
      const resolvedTicketId = target?.entityType === 'ticket' ? target.id : String(normalized.ticketId);
      await addTeamsTicketComment({
        ticketId: resolvedTicketId,
        tenantId: context.request.tenantId,
        actorUserId: context.request.user.user_id,
        commentText: String(normalized.note),
        isInternal: true,
        metadata: normalized.metadata as Record<string, unknown> | undefined,
      });

      const refreshedTarget = await resolveTargetInternal(
        { entityType: 'ticket', ticketId: resolvedTicketId },
        context.serviceContext
      );
      const ticketLabel = typeof (refreshedTarget.entity as any)?.ticket_number === 'string'
        ? (refreshedTarget.entity as any).ticket_number.trim()
        : resolvedTicketId;
      return {
        summary: {
          title: 'Internal note added',
          text: `A new internal note was added to ticket ${ticketLabel}.`,
        },
        destination: refreshedTarget.destination,
        target: refreshedTarget,
      };
    },
  },
  reply_to_contact: {
    id: 'reply_to_contact',
    title: 'Reply to contact',
    description: 'Add a customer-visible ticket reply from Teams.',
    operation: 'mutation',
    targetEntityTypes: ['ticket'],
    requiredInputs: [
      { name: 'ticketId', type: 'entity', required: true, description: 'Ticket receiving the customer reply.' },
      { name: 'reply', type: 'string', required: true, description: 'Customer-visible reply body.' },
    ],
    businessOperations: ['TicketService.addComment'],
    allowedAction: 'reply_to_contact',
    requiredCapabilities: ['personal_bot', 'message_extension'],
    normalize: (request) =>
      parseActionInput(
        replyToContactInputSchema,
        buildPayloadFromRequest(request, request.target?.entityType === 'ticket' ? { ticketId: request.target.ticketId } : {})
      ),
    authorize: async (_normalized, context) =>
      ensurePermission(context.request.user, 'ticket', 'update', 'You do not have permission to send ticket replies from Teams.'),
    execute: async (normalized, context, target) => {
      const resolvedTicketId = target?.entityType === 'ticket' ? target.id : String(normalized.ticketId);
      await addTeamsTicketComment({
        ticketId: resolvedTicketId,
        tenantId: context.request.tenantId,
        actorUserId: context.request.user.user_id,
        commentText: String(normalized.reply),
        isInternal: false,
        metadata: normalized.metadata as Record<string, unknown> | undefined,
      });

      const refreshedTarget = await resolveTargetInternal(
        { entityType: 'ticket', ticketId: resolvedTicketId },
        context.serviceContext
      );
      const ticketLabel = typeof (refreshedTarget.entity as any)?.ticket_number === 'string'
        ? (refreshedTarget.entity as any).ticket_number.trim()
        : resolvedTicketId;
      return {
        summary: {
          title: 'Reply sent',
          text: `A customer-visible reply was added to ticket ${ticketLabel}.`,
        },
        destination: refreshedTarget.destination,
        target: refreshedTarget,
      };
    },
  },
  log_time: {
    id: 'log_time',
    title: 'Log time',
    description: 'Create a time entry against a ticket or project task from Teams.',
    operation: 'mutation',
    targetEntityTypes: ['ticket', 'project_task'],
    requiredInputs: [
      { name: 'workItemId', type: 'entity', required: true, description: 'Ticket or project task receiving time.' },
      { name: 'startTime', type: 'datetime', required: true, description: 'Start time for the time entry.' },
      { name: 'durationMinutes', type: 'number', required: true, description: 'Duration in minutes.' },
      { name: 'note', type: 'string', required: false, description: 'Optional time-entry note.' },
      { name: 'isBillable', type: 'boolean', required: false, description: 'Whether the time entry is billable.' },
    ],
    businessOperations: ['TimeEntryService.create'],
    allowedAction: 'log_time',
    requiredCapabilities: ['personal_bot', 'message_extension'],
    normalize: (request) => {
      const defaults =
        request.target?.entityType === 'ticket'
          ? { entityType: 'ticket', workItemId: request.target.ticketId }
          : request.target?.entityType === 'project_task'
            ? { entityType: 'project_task', workItemId: request.target.taskId }
            : {};
      return parseActionInput(logTimeInputSchema, buildPayloadFromRequest(request, defaults));
    },
    authorize: async (normalized, context) => {
      const timePermission = await ensurePermission(
        context.request.user,
        'timeentry',
        'create',
        'You do not have permission to create time entries from Teams.'
      );
      if (timePermission) {
        return timePermission;
      }

      return normalized.entityType === 'ticket'
        ? ensurePermission(context.request.user, 'ticket', 'read', 'You do not have permission to read tickets for Teams time entry logging.')
        : ensurePermission(context.request.user, 'project', 'read', 'You do not have permission to read project tasks for Teams time entry logging.');
    },
    execute: async (normalized, context) => {
      const startTime = new Date(String(normalized.startTime));
      const endTime = new Date(startTime.getTime() + Number(normalized.durationMinutes) * 60_000);
      const created = await createTeamsTimeEntry({
        tenantId: context.request.tenantId,
        actorUserId: context.request.user.user_id,
        workItemType: String(normalized.entityType) as 'ticket' | 'project_task',
        workItemId: String(normalized.workItemId),
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        notes: String(normalized.note || ''),
        billable: Boolean(normalized.isBillable),
      });

      const workItemType = String(normalized.entityType);
      const destination =
        workItemType === 'ticket'
          ? ({ type: 'ticket', ticketId: String(normalized.workItemId) } as TeamsTabDestination)
          : ({
              type: 'project_task',
              projectId: String((created as { project_id?: string }).project_id || ''),
              taskId: String(normalized.workItemId),
            } as TeamsTabDestination);

      return {
        summary: {
          title: 'Time logged',
          text: `Logged ${normalized.durationMinutes} minute${Number(normalized.durationMinutes) === 1 ? '' : 's'} from Teams.`,
        },
        destination,
      };
    },
  },
  approval_response: {
    id: 'approval_response',
    title: 'Approval response',
    description: 'Approve a time-sheet approval item or request changes from Teams.',
    operation: 'mutation',
    targetEntityTypes: ['approval'],
    requiredInputs: [
      { name: 'approvalId', type: 'entity', required: true, description: 'Approval item to update.' },
      { name: 'outcome', type: 'enum', required: true, description: 'Approval outcome to apply.' },
      { name: 'comment', type: 'string', required: false, description: 'Optional approval note or required change request comment.' },
    ],
    businessOperations: ['TimeSheetService.approveTimeSheet', 'TimeSheetService.requestChanges'],
    allowedAction: 'approval_response',
    requiredCapabilities: ['personal_bot', 'message_extension'],
    normalize: (request) =>
      parseActionInput(
        approvalResponseInputSchema,
        buildPayloadFromRequest(
          request,
          request.target?.entityType === 'approval' ? { approvalId: request.target.approvalId } : {}
        )
      ),
    authorize: async (_normalized, context) =>
      ensurePermission(context.request.user, 'timesheet', 'approve', 'You do not have permission to respond to approvals from Teams.'),
    execute: async (normalized, context) => {
      const approvalId = String(normalized.approvalId);
      if (normalized.outcome === 'approve') {
        await approveTeamsTimeSheet({
          approvalId,
          tenantId: context.request.tenantId,
          actorUserId: context.request.user.user_id,
          approvalNotes: normalized.comment ? String(normalized.comment) : undefined,
        });
      } else {
        await requestChangesForTeamsTimeSheet({
          approvalId,
          tenantId: context.request.tenantId,
          actorUserId: context.request.user.user_id,
          changeReason: String(normalized.comment),
          detailedFeedback: String(normalized.comment),
        });
      }

      const target = await resolveTargetInternal(
        { entityType: 'approval', approvalId },
        context.serviceContext
      );
      return {
        summary: {
          title: normalized.outcome === 'approve' ? 'Approval completed' : 'Changes requested',
          text:
            normalized.outcome === 'approve'
              ? `Approval ${approvalId} was approved successfully.`
              : `Approval ${approvalId} was returned with requested changes.`,
        },
        destination: target.destination,
        target,
      };
    },
  },
};

function getDefinition(actionId: TeamsActionId): TeamsActionDefinition {
  return actionDefinitions[actionId];
}

async function evaluateActionAvailability(
  definition: TeamsActionDefinition,
  request: Pick<TeamsActionRequest, 'surface' | 'tenantId' | 'user' | 'input'>,
  integration: TeamsIntegrationExecutionState,
  targetReference?: TeamsActionEntityReference
): Promise<TeamsActionAvailability> {
  const surfaceCapability = getCapabilityForSurface(request.surface);
  if (integration.installStatus !== 'active') {
    return {
      actionId: definition.id,
      operation: definition.operation,
      available: false,
      targetEntityTypes: definition.targetEntityTypes,
      requiredInputs: definition.requiredInputs,
      businessOperations: definition.businessOperations,
      reason: 'not_configured',
      message: 'Teams is not active for this tenant.',
    };
  }

  if (surfaceCapability && !integration.enabledCapabilities.includes(surfaceCapability)) {
    return {
      actionId: definition.id,
      operation: definition.operation,
      available: false,
      targetEntityTypes: definition.targetEntityTypes,
      requiredInputs: definition.requiredInputs,
      businessOperations: definition.businessOperations,
      reason: 'capability_disabled',
      message: `The ${request.surface} surface is disabled for this tenant.`,
    };
  }

  if (
    definition.requiredCapabilities &&
    definition.requiredCapabilities.length > 0 &&
    !definition.requiredCapabilities.some((capability) => integration.enabledCapabilities.includes(capability))
  ) {
    return {
      actionId: definition.id,
      operation: definition.operation,
      available: false,
      targetEntityTypes: definition.targetEntityTypes,
      requiredInputs: definition.requiredInputs,
      businessOperations: definition.businessOperations,
      reason: 'capability_disabled',
      message: 'The Teams capabilities required for this action are disabled.',
    };
  }

  if (definition.allowedAction && !integration.allowedActions.includes(definition.allowedAction)) {
    return {
      actionId: definition.id,
      operation: definition.operation,
      available: false,
      targetEntityTypes: definition.targetEntityTypes,
      requiredInputs: definition.requiredInputs,
      businessOperations: definition.businessOperations,
      reason: 'capability_disabled',
      message: 'This Teams quick action is disabled for the tenant.',
    };
  }

  if (targetReference && definition.targetEntityTypes.length > 0 && !definition.targetEntityTypes.includes(targetReference.entityType)) {
    return {
      actionId: definition.id,
      operation: definition.operation,
      available: false,
      targetEntityTypes: definition.targetEntityTypes,
      requiredInputs: definition.requiredInputs,
      businessOperations: definition.businessOperations,
      reason: 'unsupported_action',
      message: `This Teams action does not support ${targetReference.entityType} targets.`,
    };
  }

  const permissionRequirement =
    definition.id === 'create_ticket_from_message'
      ? ['ticket', 'create']
      : definition.id === 'update_from_message'
        ? targetReference?.entityType === 'project_task'
          ? ['project', 'read']
          : buildPayloadFromRequest(request).updateType === 'continue_in_tab'
            ? ['ticket', 'read']
            : ['ticket', 'update']
      : definition.id === 'my_tickets' || definition.id === 'my_approvals' || definition.id === 'open_record'
      ? definition.id === 'open_record' && targetReference?.entityType === 'project_task'
        ? ['project', 'read']
        : definition.id === 'open_record' && targetReference?.entityType === 'approval'
          ? ['timesheet', 'approve']
          : definition.id === 'open_record' && targetReference?.entityType === 'time_entry'
            ? ['time_entry', 'read']
            : definition.id === 'open_record' && targetReference?.entityType === 'contact'
              ? ['contact', 'read']
              : definition.id === 'my_approvals'
                ? ['timesheet', 'approve']
                : ['ticket', 'read']
      : definition.id === 'log_time'
        ? ['timeentry', 'create']
        : definition.id === 'approval_response'
          ? ['timesheet', 'approve']
          : ['ticket', 'update'];

  const allowed = await hasPermission(request.user, permissionRequirement[0], permissionRequirement[1]);

  return {
    actionId: definition.id,
    operation: definition.operation,
    available: allowed,
    targetEntityTypes: definition.targetEntityTypes,
    requiredInputs: definition.requiredInputs,
    businessOperations: definition.businessOperations,
    reason: allowed ? undefined : 'forbidden',
    message: allowed ? undefined : 'The signed-in user does not have permission to run this Teams action.',
  };
}

export function listTeamsActionDefinitions(): Array<{
  id: TeamsActionId;
  title: string;
  description: string;
  operation: TeamsActionOperation;
  targetEntityTypes: TeamsActionTargetType[];
  requiredInputs: TeamsActionFieldDefinition[];
  businessOperations: string[];
}> {
  return Object.values(actionDefinitions).map((definition) => ({
    id: definition.id,
    title: definition.title,
    description: definition.description,
    operation: definition.operation,
    targetEntityTypes: definition.targetEntityTypes,
    requiredInputs: definition.requiredInputs,
    businessOperations: definition.businessOperations,
  }));
}

export async function resolveTeamsActionTarget(
  tenantId: string,
  user: IUserWithRoles,
  reference: TeamsActionEntityReference
): Promise<TeamsResolvedTarget> {
  return runWithTenant(tenantId, async () => resolveTargetInternal(reference, { tenant: tenantId, userId: user.user_id, user }));
}

export async function listAvailableTeamsActions(params: {
  surface: TeamsActionSurface;
  tenantId: string;
  user: IUserWithRoles;
  target?: TeamsActionEntityReference;
}): Promise<TeamsActionAvailability[]> {
  return runWithTenant(params.tenantId, async () => {
    const integration = await getTeamsIntegrationExecutionState(params.tenantId);
    const definitions = Object.values(actionDefinitions);
    return Promise.all(
      definitions.map((definition) => evaluateActionAvailability(definition, params, integration, params.target))
    );
  });
}

export function normalizeTeamsActionRequest(
  request: TeamsActionRequest
): {
  action: ReturnType<typeof listTeamsActionDefinitions>[number];
  normalizedInput: Record<string, unknown>;
  targetReference?: TeamsActionEntityReference;
} {
  const definition = getDefinition(request.actionId);
  const normalizedInput = definition.normalize(request);
  const targetReference =
    definition.targetEntityTypes.length > 0 ? requireTargetReference({ ...request, input: normalizedInput }) : undefined;

  return {
    action: listTeamsActionDefinitions().find((item) => item.id === definition.id)!,
    normalizedInput,
    targetReference,
  };
}

async function executeTeamsActionInternal(request: TeamsActionRequest): Promise<TeamsActionResult> {
  const definition = getDefinition(request.actionId);
  const integration = await getTeamsIntegrationExecutionState(request.tenantId);
  const availability = await evaluateActionAvailability(definition, request, integration, request.target);

  if (!availability.available) {
    return {
      success: false,
      actionId: request.actionId,
      surface: request.surface,
      operation: definition.operation,
      error: {
        code: availability.reason || 'capability_disabled',
        message: availability.message || 'Teams action is unavailable.',
        remediation:
          availability.reason === 'not_configured'
            ? 'Finish Teams setup for this tenant and try again.'
            : 'Review the tenant Teams settings or use the full PSA application instead.',
      },
      warnings: [],
      metadata: buildResultMetadata(request, definition, false),
    };
  }

  try {
    if (!request.user?.user_id || request.user.tenant !== request.tenantId || request.user.user_type === 'client') {
      throw new ForbiddenError('Teams actions are limited to authenticated MSP users in the current tenant.');
    }

    const serviceContext = buildServiceContext(request);
    const normalized = definition.normalize(request);
    const target =
      definition.targetEntityTypes.length > 0
        ? await resolveTargetInternal(requireTargetReference({ ...request, input: normalized }), serviceContext)
        : null;

    const authorizationFailure = await definition.authorize(normalized, { integration, request, serviceContext }, target);
    if (authorizationFailure) {
      return {
        success: false,
        actionId: request.actionId,
        surface: request.surface,
        operation: definition.operation,
        error: authorizationFailure,
        warnings: [],
        metadata: buildResultMetadata(request, definition, false),
      };
    }

    const executed = await definition.execute(normalized, { integration, request, serviceContext }, target);
    const destination = executed.destination ?? target?.destination;
    const targetSummary = executed.target ?? target;
    const { links, warnings } = buildActionLinks(destination, integration, request.surface);

    return {
      success: true,
      actionId: request.actionId,
      surface: request.surface,
      operation: definition.operation,
      summary: executed.summary,
      links,
      items: executed.items ?? [],
      warnings,
      target: targetSummary
        ? {
            entityType: targetSummary.entityType,
            id: targetSummary.id,
            destination: targetSummary.destination,
          }
        : undefined,
      metadata: buildResultMetadata(request, definition, false),
    };
  } catch (error) {
    return {
      success: false,
      actionId: request.actionId,
      surface: request.surface,
      operation: definition.operation,
      error: mapErrorToActionError(error),
      warnings: [],
      metadata: buildResultMetadata(request, definition, false),
    };
  }
}

export async function executeTeamsAction(request: TeamsActionRequest): Promise<TeamsActionResult> {
  return runWithTenant(request.tenantId, async () => {
    const definition = getDefinition(request.actionId);

    if (definition.operation === 'mutation' && request.idempotencyKey) {
      const cacheKey = `${request.tenantId}:${request.user.user_id}:${request.actionId}:${request.idempotencyKey}`;
      const existing = duplicateResults.get(cacheKey);
      if (existing) {
        const cloned = cloneResult(existing);
        cloned.metadata.idempotentReplay = true;
        return cloned;
      }

      const inFlight = inFlightResults.get(cacheKey);
      if (inFlight) {
        const replayed = cloneResult(await inFlight);
        replayed.metadata.idempotentReplay = true;
        return replayed;
      }

      const promise = executeTeamsActionInternal(request);
      inFlightResults.set(cacheKey, promise);
      try {
        const result = await promise;
        duplicateResults.set(cacheKey, result);
        return result;
      } finally {
        inFlightResults.delete(cacheKey);
      }
    }

    return executeTeamsActionInternal(request);
  });
}

export function resetTeamsActionIdempotencyCache(): void {
  duplicateResults.clear();
  inFlightResults.clear();
}
