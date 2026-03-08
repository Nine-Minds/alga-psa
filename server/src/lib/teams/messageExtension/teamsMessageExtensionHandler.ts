import { createTenantKnex, getUserWithRoles } from '@alga-psa/db';
import { ServerAnalyticsTracker } from '@alga-psa/analytics';
import { NextResponse } from 'next/server';
import { ServerEventPublisher } from '@alga-psa/event-bus';
import { TicketModel } from '@shared/models/ticketModel';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { ContactService } from 'server/src/lib/api/services/ContactService';
import { TicketService } from 'server/src/lib/api/services/TicketService';
import {
  executeTeamsAction,
  listAvailableTeamsActions,
  listTeamsActionDefinitions,
  type TeamsActionEntityReference,
  type TeamsActionLink,
  type TeamsActionResult,
  type TeamsActionSurface,
} from 'server/src/lib/teams/actions/teamsActionRegistry';
import { listPendingApprovalsForTeams } from 'server/src/lib/teams/approvals/queryPendingApprovalsForTeams';
import { resolveTeamsLinkedUser } from 'server/src/lib/teams/resolveTeamsLinkedUser';
import { resolveTeamsTenantContext } from 'server/src/lib/teams/resolveTeamsTenantContext';

const MESSAGE_EXTENSION_SURFACE: TeamsActionSurface = 'message_extension';
const ticketService = new TicketService();
const contactService = new ContactService();
const teamsActionTitleById = new Map(listTeamsActionDefinitions().map((definition) => [definition.id, definition.title]));
const SEARCH_SURFACED_ACTION_IDS = new Set(['assign_ticket', 'add_note', 'reply_to_contact', 'log_time', 'approval_response']);

interface TeamsMessageExtensionParameter {
  name?: string | null;
  value?: string | null;
}

interface TeamsMessagePayload {
  id?: string | null;
  subject?: string | null;
  summary?: string | null;
  body?: {
    content?: string | null;
  } | null;
  from?: {
    user?: {
      displayName?: string | null;
    } | null;
  } | null;
  linkToMessage?: string | null;
}

interface TeamsMessageExtensionQueryOptions {
  skip?: number | string | null;
  count?: number | string | null;
}

export interface TeamsMessageExtensionActivity {
  type?: string;
  name?: string | null;
  from?: {
    id?: string | null;
    aadObjectId?: string | null;
  } | null;
  channelData?: {
    tenant?: {
      id?: string | null;
    } | null;
  } | null;
  value?: {
    commandId?: string | null;
    commandContext?: string | null;
    parameters?: TeamsMessageExtensionParameter[] | null;
    queryOptions?: TeamsMessageExtensionQueryOptions | null;
    messagePayload?: TeamsMessagePayload | null;
    data?: Record<string, unknown> | null;
  } | null;
}

interface TeamsMessageExtensionButton {
  type: 'openUrl';
  title: string;
  value: string;
}

interface TeamsMessageExtensionAttachment {
  contentType: 'application/vnd.microsoft.card.hero';
  content: {
    title: string;
    text: string;
    buttons?: TeamsMessageExtensionButton[];
  };
  preview: {
    contentType: 'application/vnd.microsoft.card.hero';
    content: {
      title: string;
      text: string;
    };
  };
}

interface TeamsAdaptiveCardAction {
  type: 'Action.OpenUrl' | 'Action.Submit';
  title: string;
  url?: string;
  data?: Record<string, unknown>;
}

interface TeamsMessageExtensionComposeResponse {
  composeExtension: {
    type: 'result' | 'message';
    attachmentLayout?: 'list';
    attachments?: TeamsMessageExtensionAttachment[];
    text?: string;
  };
  cacheInfo?: {
    cacheType: 'no-cache';
  };
}

interface TeamsTaskModuleResponse {
  task: {
    type: 'continue' | 'message';
    value:
      | string
      | {
          title: string;
          width: 'medium' | 'large';
          height: 'medium' | 'large';
          card: {
            type: 'AdaptiveCard';
            version: '1.5';
            body: Array<Record<string, unknown>>;
            actions?: TeamsAdaptiveCardAction[];
          };
        };
  };
}

export type TeamsMessageExtensionResponse = TeamsMessageExtensionComposeResponse | TeamsTaskModuleResponse;

interface HandleTeamsMessageExtensionActivityOptions {
  tenantIdHint?: string | null;
}

interface TeamsMessageSearchHit {
  target: TeamsActionEntityReference;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getTeamsTenantId(activity: TeamsMessageExtensionActivity): string | null {
  return normalizeOptionalString(activity.channelData?.tenant?.id);
}

function getMicrosoftAccountId(activity: TeamsMessageExtensionActivity): string | null {
  return normalizeOptionalString(activity.from?.aadObjectId) || normalizeOptionalString(activity.from?.id);
}

function getCommandContext(activity: TeamsMessageExtensionActivity): string | null {
  const rawContext =
    activity.value?.commandContext ||
    (typeof activity.value?.data?.commandContext === 'string' ? activity.value.data.commandContext : undefined);
  return normalizeOptionalString(rawContext);
}

function getCommandId(activity: TeamsMessageExtensionActivity): string | null {
  const rawCommandId =
    activity.value?.commandId ||
    (typeof activity.value?.data?.commandId === 'string' ? activity.value.data.commandId : undefined);
  return normalizeOptionalString(rawCommandId);
}

function getQueryParameter(activity: TeamsMessageExtensionActivity): string | null {
  const parameters = Array.isArray(activity.value?.parameters) ? activity.value?.parameters : [];
  for (const parameter of parameters) {
    if (normalizeOptionalString(parameter?.name)?.toLowerCase() === 'query') {
      return normalizeOptionalString(parameter?.value);
    }
  }

  return null;
}

function parseQueryOption(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return null;
}

function getQueryPagination(activity: TeamsMessageExtensionActivity):
  | { success: true; skip: number; count: number }
  | { success: false; message: string } {
  const rawSkip = parseQueryOption(activity.value?.queryOptions?.skip);
  const rawCount = parseQueryOption(activity.value?.queryOptions?.count);
  const skip = rawSkip ?? 0;
  const count = rawCount ?? 10;

  if (skip < 0) {
    return {
      success: false,
      message: 'Search pagination must use a non-negative skip value.',
    };
  }

  if (count < 1 || count > 25) {
    return {
      success: false,
      message: 'Search pagination count must be between 1 and 25 results.',
    };
  }

  return {
    success: true,
    skip,
    count,
  };
}

function buildOpenUrlButton(link: TeamsActionLink): TeamsMessageExtensionButton {
  return {
    type: 'openUrl',
    title: link.label,
    value: link.url,
  };
}

function buildMessageResponse(text: string): TeamsMessageExtensionResponse {
  return {
    composeExtension: {
      type: 'message',
      text,
    },
    cacheInfo: {
      cacheType: 'no-cache',
    },
  };
}

function buildTaskMessageResponse(text: string): TeamsMessageExtensionResponse {
  return {
    task: {
      type: 'message',
      value: text,
    },
  };
}

function isQueryRequest(activity: TeamsMessageExtensionActivity): boolean {
  return activity.type === 'invoke' && normalizeOptionalString(activity.name) === 'composeExtension/query';
}

function isActionRequest(activity: TeamsMessageExtensionActivity): boolean {
  const name = normalizeOptionalString(activity.name);
  return activity.type === 'invoke' && (name === 'composeExtension/fetchTask' || name === 'composeExtension/submitAction');
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function getMessagePayload(activity: TeamsMessageExtensionActivity): TeamsMessagePayload | null {
  const directPayload = activity.value?.messagePayload;
  if (directPayload && typeof directPayload === 'object') {
    return directPayload;
  }

  const nestedPayload = activity.value?.data?.messagePayload;
  if (nestedPayload && typeof nestedPayload === 'object') {
    return nestedPayload as TeamsMessagePayload;
  }

  return null;
}

function buildMessagePreview(activity: TeamsMessageExtensionActivity): {
  messageId: string | null;
  author: string | null;
  subject: string | null;
  summary: string | null;
  bodyText: string | null;
  linkToMessage: string | null;
} | null {
  const payload = getMessagePayload(activity);
  if (!payload) {
    return null;
  }

  const messageId = normalizeOptionalString(payload.id);
  const subject = normalizeOptionalString(payload.subject) || normalizeOptionalString(payload.summary);
  const bodyText = normalizeOptionalString(stripHtml(payload.body?.content || ''));
  const summary = bodyText ? truncateText(bodyText, 280) : null;
  const author = normalizeOptionalString(payload.from?.user?.displayName);
  const linkToMessage = normalizeOptionalString(payload.linkToMessage);

  if (!subject && !summary && !author && !linkToMessage) {
    return null;
  }

  return {
    messageId,
    author,
    subject,
    summary,
    bodyText,
    linkToMessage,
  };
}

type TeamsCreateTicketFormOptions = {
  boards: Array<{ id: string; title: string; defaultPriorityId: string | null }>;
  statuses: Array<{ id: string; title: string }>;
  clients: Array<{ id: string; title: string }>;
  contacts: Array<{ id: string; title: string; clientId: string | null }>;
  defaultBoardId: string | null;
  defaultStatusId: string | null;
};

function buildChoiceSetChoices(
  rows: Array<{ id: string; title: string }>,
  options: { includeEmpty?: { title: string; value?: string } } = {}
): Array<{ title: string; value: string }> {
  const choices = options.includeEmpty ? [{ title: options.includeEmpty.title, value: options.includeEmpty.value ?? '' }] : [];
  return choices.concat(rows.map((row) => ({ title: row.title, value: row.id })));
}

function buildTicketTitleFromPreview(preview: NonNullable<ReturnType<typeof buildMessagePreview>>): string {
  return preview.subject || preview.summary || (preview.author ? `Teams message from ${preview.author}` : 'Teams message');
}

function buildTicketDescriptionFromPreview(preview: NonNullable<ReturnType<typeof buildMessagePreview>>): string {
  const sections: string[] = [];

  if (preview.author) {
    sections.push(`From: ${preview.author}`);
  }

  if (preview.subject) {
    sections.push(`Subject: ${preview.subject}`);
  }

  if (preview.bodyText) {
    sections.push(preview.bodyText);
  } else if (preview.summary) {
    sections.push(preview.summary);
  }

  if (preview.linkToMessage) {
    sections.push(`Source message: ${preview.linkToMessage}`);
  }

  return sections.join('\n\n').trim();
}

function getActionData(activity: TeamsMessageExtensionActivity): Record<string, unknown> {
  const raw = activity.value?.data;
  return raw && typeof raw === 'object' ? raw : {};
}

function getActionDataString(activity: TeamsMessageExtensionActivity, key: string): string | null {
  const rawValue = getActionData(activity)[key];
  return typeof rawValue === 'string' ? normalizeOptionalString(rawValue) : null;
}

async function loadCreateTicketFormOptions(tenantId: string): Promise<TeamsCreateTicketFormOptions> {
  const { knex } = await createTenantKnex(tenantId);

  const [boards, statuses, clients, contacts] = await Promise.all([
    (await knex('boards')
      .where({ tenant: tenantId, is_inactive: false })
      .select('board_id', 'board_name', 'default_priority_id', 'is_default')
      .orderBy('is_default', 'desc')
      .orderBy('display_order', 'asc')
      .orderBy('board_name', 'asc')
      .limit(25)) as Array<{
      board_id?: string | null;
      board_name?: string | null;
      default_priority_id?: string | null;
      is_default?: boolean | null;
    }>,
    (await knex('statuses')
      .where({ tenant: tenantId, status_type: 'ticket', is_closed: false })
      .select('status_id', 'name', 'is_default')
      .orderBy('is_default', 'desc')
      .orderBy('name', 'asc')
      .limit(25)) as Array<{ status_id?: string | null; name?: string | null; is_default?: boolean | null }>,
    (await knex('clients')
      .where({ tenant: tenantId, is_inactive: false })
      .select('client_id', 'client_name')
      .orderBy('client_name', 'asc')
      .limit(25)) as Array<{ client_id?: string | null; client_name?: string | null }>,
    (await knex('contacts as c')
      .leftJoin('clients as comp', function joinClients() {
        this.on('c.client_id', '=', 'comp.client_id').andOn('c.tenant', '=', 'comp.tenant');
      })
      .where('c.tenant', tenantId)
      .where('c.is_inactive', false)
      .select('c.contact_name_id', 'c.full_name', 'c.client_id', 'comp.client_name')
      .orderBy('c.full_name', 'asc')
      .limit(25)) as Array<{
      contact_name_id?: string | null;
      full_name?: string | null;
      client_id?: string | null;
      client_name?: string | null;
    }>,
  ]);

  const normalizedBoards = boards
    .map((row) => ({
      id: normalizeOptionalString(row.board_id),
      title: normalizeOptionalString(row.board_name),
      defaultPriorityId: normalizeOptionalString(row.default_priority_id),
      isDefault: Boolean(row.is_default),
    }))
    .filter((row): row is { id: string; title: string; defaultPriorityId: string | null; isDefault: boolean } => Boolean(row.id && row.title));

  const normalizedStatuses = statuses
    .map((row) => ({
      id: normalizeOptionalString(row.status_id),
      title: normalizeOptionalString(row.name),
      isDefault: Boolean(row.is_default),
    }))
    .filter((row): row is { id: string; title: string; isDefault: boolean } => Boolean(row.id && row.title));

  const normalizedClients = clients
    .map((row) => ({
      id: normalizeOptionalString(row.client_id),
      title: normalizeOptionalString(row.client_name),
    }))
    .filter((row): row is { id: string; title: string } => Boolean(row.id && row.title));

  const normalizedContacts = contacts
    .map((row) => {
      const fullName = normalizeOptionalString(row.full_name);
      const clientName = normalizeOptionalString(row.client_name);
      return {
        id: normalizeOptionalString(row.contact_name_id),
        title: fullName ? (clientName ? `${fullName} (${clientName})` : fullName) : null,
        clientId: normalizeOptionalString(row.client_id),
      };
    })
    .filter((row): row is { id: string; title: string; clientId: string | null } => Boolean(row.id && row.title));

  return {
    boards: normalizedBoards.map(({ id, title, defaultPriorityId }) => ({ id, title, defaultPriorityId })),
    statuses: normalizedStatuses.map(({ id, title }) => ({ id, title })),
    clients: normalizedClients,
    contacts: normalizedContacts,
    defaultBoardId: normalizedBoards.find((row) => row.isDefault)?.id || normalizedBoards[0]?.id || null,
    defaultStatusId: normalizedStatuses.find((row) => row.isDefault)?.id || normalizedStatuses[0]?.id || null,
  };
}

async function resolveDefaultPriorityIdForBoard(
  tenantId: string,
  boardId: string
): Promise<string | null> {
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
  contactId: string | null;
}): Promise<{ success: true } | { success: false; message: string }> {
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
    return {
      success: false,
      message: 'Select an active PSA board before creating a ticket from this Teams message.',
    };
  }

  if (!status) {
    return {
      success: false,
      message: 'Select an open PSA status before creating a ticket from this Teams message.',
    };
  }

  if (!client) {
    return {
      success: false,
      message: 'Select an active PSA client before creating a ticket from this Teams message.',
    };
  }

  if (params.contactId) {
    const resolvedContactId = normalizeOptionalString((contact as { contact_name_id?: string | null } | null)?.contact_name_id);
    const resolvedContactClientId = normalizeOptionalString((contact as { client_id?: string | null } | null)?.client_id);

    if (!resolvedContactId) {
      return {
        success: false,
        message: 'Select a valid PSA contact or clear the contact field before creating a ticket from this Teams message.',
      };
    }

    if (resolvedContactClientId && resolvedContactClientId !== params.clientId) {
      return {
        success: false,
        message: 'The selected PSA contact does not belong to the selected client.',
      };
    }
  }

  return { success: true };
}

async function buildCreatedTicketTaskResponse(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  ticketId: string;
  ticketNumber: string | null;
  fallbackTitle: string;
}): Promise<TeamsMessageExtensionResponse> {
  const openResult = await executeTeamsAction({
    actionId: 'open_record',
    surface: MESSAGE_EXTENSION_SURFACE,
    tenantId: params.tenantId,
    user: params.user,
    target: {
      entityType: 'ticket',
      ticketId: params.ticketId,
    },
  });

  const body: Array<Record<string, unknown>> = [
    {
      type: 'TextBlock',
      text: params.ticketNumber ? `Created ticket ${params.ticketNumber}` : 'Created ticket from Teams message',
      wrap: true,
      weight: 'Bolder',
      size: 'Medium',
    },
    {
      type: 'TextBlock',
      text: openResult.success ? openResult.summary.text : params.fallbackTitle,
      wrap: true,
      spacing: 'Small',
    },
  ];

  const actions: TeamsAdaptiveCardAction[] = openResult.success
    ? openResult.links.map((link) => ({
        type: 'Action.OpenUrl',
        title: link.label,
        url: link.url,
      }))
    : [];

  return {
    task: {
      type: 'continue',
      value: {
        title: 'Ticket created',
        width: 'medium',
        height: 'medium',
        card: {
          type: 'AdaptiveCard',
          version: '1.5',
          body,
          ...(actions.length > 0 ? { actions } : {}),
        },
      },
    },
  };
}

function buildActionTaskResponse(params: {
  commandId: 'createTicketFromMessage' | 'updateFromMessage';
  preview: NonNullable<ReturnType<typeof buildMessagePreview>>;
  createTicketFormOptions?: TeamsCreateTicketFormOptions;
  idempotencyKey?: string | null;
  messagePayload?: TeamsMessagePayload | null;
}): TeamsMessageExtensionResponse {
  const title =
    params.commandId === 'createTicketFromMessage'
      ? 'Create ticket from Teams message'
      : 'Update PSA record from Teams message';
  const guidance =
    params.commandId === 'createTicketFromMessage'
      ? 'Capture the Teams message as a PSA ticket with the minimum required context.'
      : 'Review the selected Teams message before the PSA update workflow is completed in a follow-up slice.';

  const body: Array<Record<string, unknown>> = [
    {
      type: 'TextBlock',
      text: title,
      wrap: true,
      weight: 'Bolder',
      size: 'Medium',
    },
  ];

  if (params.preview.author) {
    body.push({
      type: 'TextBlock',
      text: `From: ${params.preview.author}`,
      wrap: true,
      spacing: 'Small',
    });
  }

  if (params.preview.subject) {
    body.push({
      type: 'TextBlock',
      text: `Subject: ${params.preview.subject}`,
      wrap: true,
      spacing: 'Small',
    });
  }

  if (params.preview.summary) {
    body.push({
      type: 'TextBlock',
      text: params.preview.summary,
      wrap: true,
      spacing: 'Small',
    });
  }

  if (params.commandId === 'createTicketFromMessage' && params.createTicketFormOptions) {
    body.push(
      {
        type: 'Input.Text',
        id: 'title',
        label: 'Ticket title',
        value: buildTicketTitleFromPreview(params.preview),
        isRequired: true,
        errorMessage: 'Ticket title is required.',
      },
      {
        type: 'Input.Text',
        id: 'description',
        label: 'Ticket details',
        value: buildTicketDescriptionFromPreview(params.preview),
        isMultiline: true,
        isRequired: true,
        errorMessage: 'Ticket details are required.',
      },
      {
        type: 'Input.ChoiceSet',
        id: 'boardId',
        label: 'Board',
        value: params.createTicketFormOptions.defaultBoardId || '',
        isRequired: true,
        errorMessage: 'Select a board.',
        style: 'compact',
        choices: buildChoiceSetChoices(params.createTicketFormOptions.boards),
      },
      {
        type: 'Input.ChoiceSet',
        id: 'statusId',
        label: 'Status',
        value: params.createTicketFormOptions.defaultStatusId || '',
        isRequired: true,
        errorMessage: 'Select a status.',
        style: 'compact',
        choices: buildChoiceSetChoices(params.createTicketFormOptions.statuses),
      },
      {
        type: 'Input.ChoiceSet',
        id: 'clientId',
        label: 'Client',
        isRequired: true,
        errorMessage: 'Select a client.',
        style: 'compact',
        choices: buildChoiceSetChoices(params.createTicketFormOptions.clients),
      },
      {
        type: 'Input.ChoiceSet',
        id: 'contactId',
        label: 'Contact (optional)',
        style: 'compact',
        choices: buildChoiceSetChoices(params.createTicketFormOptions.contacts, {
          includeEmpty: { title: 'No contact', value: '' },
        }),
      },
      {
        type: 'TextBlock',
        text: 'The ticket uses your tenant defaults for assignment and priority unless the selected board defines a different default priority.',
        wrap: true,
        spacing: 'Medium',
        isSubtle: true,
      }
    );
  } else {
    body.push({
      type: 'TextBlock',
      text: guidance,
      wrap: true,
      spacing: 'Medium',
      isSubtle: true,
    });
  }

  if (params.preview.linkToMessage) {
    body.push({
      type: 'TextBlock',
      text: `Source message: ${params.preview.linkToMessage}`,
      wrap: true,
      spacing: 'Small',
      isSubtle: true,
    });
  }

  return {
    task: {
      type: 'continue',
      value: {
        title,
        width: 'medium',
        height: 'medium',
        card: {
          type: 'AdaptiveCard',
          version: '1.5',
          body,
          ...(params.commandId === 'createTicketFromMessage' && params.createTicketFormOptions
            ? {
                actions: [
                  {
                    type: 'Action.Submit',
                    title: 'Create ticket',
                    data: {
                      commandId: params.commandId,
                      commandContext: 'message',
                      idempotencyKey: params.idempotencyKey || crypto.randomUUID(),
                      ...(params.messagePayload ? { messagePayload: params.messagePayload } : {}),
                    },
                  },
                ],
              }
            : {}),
        },
      },
    },
  };
}

function buildAttachmentFromActionResult(
  result: TeamsActionResult,
  quickActionTitles: string[] = []
): TeamsMessageExtensionAttachment | null {
  if (!result.success) {
    return null;
  }

  const primaryItem = result.items[0];
  const title = primaryItem?.title || result.summary.title;
  const baseText = primaryItem?.summary || result.summary.text;
  const text =
    quickActionTitles.length > 0 ? `${baseText}\nQuick actions: ${quickActionTitles.join(', ')}` : baseText;
  const buttons = result.links.map(buildOpenUrlButton);

  return {
    contentType: 'application/vnd.microsoft.card.hero',
    content: {
      title,
      text,
      ...(buttons.length > 0 ? { buttons } : {}),
    },
    preview: {
      contentType: 'application/vnd.microsoft.card.hero',
      content: {
        title,
        text,
      },
    },
  };
}

async function buildSearchAttachments(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  hits: TeamsMessageSearchHit[];
}): Promise<TeamsMessageExtensionAttachment[]> {
  const attachments: TeamsMessageExtensionAttachment[] = [];

  for (const hit of params.hits) {
    const result = await executeTeamsAction({
      actionId: 'open_record',
      surface: MESSAGE_EXTENSION_SURFACE,
      tenantId: params.tenantId,
      user: params.user,
      target: hit.target,
    });

    const availableActions = await listAvailableTeamsActions({
      surface: MESSAGE_EXTENSION_SURFACE,
      tenantId: params.tenantId,
      user: params.user,
      target: hit.target,
    });
    const quickActionTitles = availableActions
      .filter((action) => action.available && action.operation === 'mutation' && SEARCH_SURFACED_ACTION_IDS.has(action.actionId))
      .map((action) => teamsActionTitleById.get(action.actionId) || action.actionId);

    const attachment = buildAttachmentFromActionResult(result, quickActionTitles);
    if (attachment) {
      attachments.push(attachment);
    }
  }

  return attachments;
}

async function searchTicketHits(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  query: string;
  limit: number;
}): Promise<TeamsMessageSearchHit[]> {
  if (!(await hasPermission(params.user, 'ticket', 'read'))) {
    return [];
  }

  const results = await ticketService.search(
    {
      query: params.query,
      fields: ['title', 'ticket_number', 'client_name', 'contact_name'],
      include_closed: false,
      limit: params.limit,
    } as any,
    {
      tenant: params.tenantId,
      userId: params.user.user_id,
      user: params.user,
    }
  );

  return results
    .map((ticket) => normalizeOptionalString((ticket as { ticket_id?: string }).ticket_id))
    .filter((ticketId): ticketId is string => Boolean(ticketId))
    .map((ticketId) => ({
      target: {
        entityType: 'ticket',
        ticketId,
      },
    }));
}

async function searchTaskHits(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  query: string;
  limit: number;
}): Promise<TeamsMessageSearchHit[]> {
  if (!(await hasPermission(params.user, 'project', 'read'))) {
    return [];
  }

  const { knex } = await createTenantKnex(params.tenantId);
  const rows = (await knex('project_tasks as pt')
    .join('projects as p', function joinProjects() {
      this.on('pt.project_id', '=', 'p.project_id').andOn('pt.tenant', '=', 'p.tenant');
    })
    .where('pt.tenant', params.tenantId)
    .where((builder) => {
      builder
        .whereILike('pt.task_name', `%${params.query}%`)
        .orWhereILike('pt.description', `%${params.query}%`)
        .orWhereILike('p.project_name', `%${params.query}%`);
    })
    .select('pt.task_id', 'pt.project_id')
    .orderBy('pt.updated_at', 'desc')
    .limit(params.limit)) as Array<{ task_id?: string | null; project_id?: string | null }>;

  return rows
    .map((row) => ({
      taskId: normalizeOptionalString(row.task_id),
      projectId: normalizeOptionalString(row.project_id),
    }))
    .filter((row): row is { taskId: string; projectId: string } => Boolean(row.taskId && row.projectId))
    .map((row) => ({
      target: {
        entityType: 'project_task',
        taskId: row.taskId,
        projectId: row.projectId,
      },
    }));
}

async function searchContactHits(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  query: string;
  limit: number;
}): Promise<TeamsMessageSearchHit[]> {
  if (!(await hasPermission(params.user, 'contact', 'read'))) {
    return [];
  }

  const results = await contactService.search(
    {
      query: params.query,
      fields: ['full_name', 'email', 'phone_number', 'role'],
      include_inactive: false,
      limit: params.limit,
    } as any,
    {
      tenant: params.tenantId,
      userId: params.user.user_id,
      user: params.user,
    }
  );

  return results
    .map((contact) => ({
      contactId: normalizeOptionalString((contact as { contact_name_id?: string }).contact_name_id),
      clientId: normalizeOptionalString((contact as { client_id?: string }).client_id),
    }))
    .filter((contact): contact is { contactId: string; clientId: string | null } => Boolean(contact.contactId))
    .map((contact) => ({
      target: {
        entityType: 'contact',
        contactId: contact.contactId,
        ...(contact.clientId ? { clientId: contact.clientId } : {}),
      },
    }));
}

async function searchApprovalHits(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  query: string;
  limit: number;
}): Promise<TeamsMessageSearchHit[]> {
  if (!(await hasPermission(params.user, 'timesheet', 'approve'))) {
    return [];
  }

  const approvals = await listPendingApprovalsForTeams({
    tenantId: params.tenantId,
    user: params.user,
    limit: params.limit,
    query: params.query,
  });

  return approvals.map((approval) => ({
    target: {
      entityType: 'approval',
      approvalId: approval.id,
    },
  }));
}

async function resolveInvokingUser(params: {
  activity: TeamsMessageExtensionActivity;
  tenantId: string;
}): Promise<
  | { success: true; user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>> }
  | { success: false; message: string }
> {
  const linkedUser = await resolveTeamsLinkedUser({
    tenantId: params.tenantId,
    microsoftAccountId: getMicrosoftAccountId(params.activity),
  });

  if (linkedUser.status !== 'linked') {
    return {
      success: false,
      message: linkedUser.message,
    };
  }

  const user = await getUserWithRoles(linkedUser.userId, params.tenantId);
  if (!user || user.user_type !== 'internal') {
    return {
      success: false,
      message: 'The Teams message extension could not resolve an MSP technician for this request.',
    };
  }

  return {
    success: true,
    user,
  };
}

async function handleQueryRequest(
  activity: TeamsMessageExtensionActivity,
  tenantId: string
): Promise<TeamsMessageExtensionResponse> {
  const commandId = getCommandId(activity);
  if (commandId !== 'searchRecords') {
    return buildMessageResponse('This Teams message extension command is not supported yet.');
  }

  const commandContext = getCommandContext(activity);
  if (commandContext !== 'compose' && commandContext !== 'commandBox') {
    return buildMessageResponse('This Teams message extension search is available from compose and command box contexts only.');
  }

  const query = getQueryParameter(activity);
  if (!query) {
    return buildMessageResponse('Enter a search query to look up PSA records from Teams.');
  }

  const pagination = getQueryPagination(activity);
  if (!pagination.success) {
    return buildMessageResponse(pagination.message);
  }

  const invokingUser = await resolveInvokingUser({
    activity,
    tenantId,
  });
  if (!invokingUser.success) {
    return buildMessageResponse(invokingUser.message);
  }

  const fetchLimit = Math.min(pagination.skip + pagination.count, 25);
  const hits = [
    ...(await searchTicketHits({ tenantId, user: invokingUser.user, query, limit: fetchLimit })),
    ...(await searchTaskHits({ tenantId, user: invokingUser.user, query, limit: fetchLimit })),
    ...(await searchContactHits({ tenantId, user: invokingUser.user, query, limit: fetchLimit })),
    ...(await searchApprovalHits({ tenantId, user: invokingUser.user, query, limit: fetchLimit })),
  ].slice(pagination.skip, pagination.skip + pagination.count);

  const attachments = await buildSearchAttachments({
    tenantId,
    user: invokingUser.user,
    hits,
  });

  if (attachments.length === 0) {
    return buildMessageResponse(`No PSA records matched “${query}” for the current Teams user.`);
  }

  return {
    composeExtension: {
      type: 'result',
      attachmentLayout: 'list',
      attachments,
    },
    cacheInfo: {
      cacheType: 'no-cache',
    },
  };
}

async function handleCreateTicketFromMessageSubmit(params: {
  activity: TeamsMessageExtensionActivity;
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  preview: NonNullable<ReturnType<typeof buildMessagePreview>>;
}): Promise<TeamsMessageExtensionResponse> {
  if (!(await hasPermission(params.user, 'ticket', 'create'))) {
    return buildTaskMessageResponse('You do not have permission to create PSA tickets from Teams messages.');
  }

  const idempotencyKey = getActionDataString(params.activity, 'idempotencyKey');
  if (!idempotencyKey) {
    return buildTaskMessageResponse(
      'Reopen the Teams message action before creating a ticket so the submission can be applied safely once.'
    );
  }

  const existingTicket = await findTicketByMessageActionIdempotencyKey(params.tenantId, idempotencyKey);
  if (existingTicket) {
    return buildCreatedTicketTaskResponse({
      tenantId: params.tenantId,
      user: params.user,
      ticketId: existingTicket.ticketId,
      ticketNumber: existingTicket.ticketNumber,
      fallbackTitle: existingTicket.title || buildTicketTitleFromPreview(params.preview),
    });
  }

  const title = getActionDataString(params.activity, 'title') || buildTicketTitleFromPreview(params.preview);
  const description = getActionDataString(params.activity, 'description') || buildTicketDescriptionFromPreview(params.preview);
  const boardId = getActionDataString(params.activity, 'boardId');
  const statusId = getActionDataString(params.activity, 'statusId');
  const clientId = getActionDataString(params.activity, 'clientId');
  const contactId = getActionDataString(params.activity, 'contactId');

  if (!title) {
    return buildTaskMessageResponse('Enter a ticket title before creating a PSA ticket from this Teams message.');
  }

  if (!description) {
    return buildTaskMessageResponse('Enter ticket details before creating a PSA ticket from this Teams message.');
  }

  if (!boardId || !statusId || !clientId) {
    return buildTaskMessageResponse(
      'Select a PSA board, open status, and client before creating a ticket from this Teams message.'
    );
  }

  const validatedSelection = await validateCreateTicketMessageSelection({
    tenantId: params.tenantId,
    boardId,
    statusId,
    clientId,
    contactId,
  });
  if (!validatedSelection.success) {
    return buildTaskMessageResponse(validatedSelection.message);
  }

  const priorityId = await resolveDefaultPriorityIdForBoard(params.tenantId, boardId);
  if (!priorityId) {
    return buildTaskMessageResponse(
      'The selected PSA board does not have a usable default priority. Update board priority defaults before creating a ticket from Teams.'
    );
  }

  const { knex } = await createTenantKnex(params.tenantId);
  const createdTicket = await knex.transaction(async (trx: any) =>
    TicketModel.createTicketWithRetry(
      {
        title,
        description,
        client_id: clientId,
        contact_id: contactId || undefined,
        board_id: boardId,
        status_id: statusId,
        priority_id: priorityId,
        entered_by: params.user.user_id,
        source: 'teams_message_extension',
        ticket_origin: 'internal',
        attributes: {
          idempotency_key: idempotencyKey,
          teams_message_source: {
            message_id: params.preview.messageId,
            subject: params.preview.subject,
            summary: params.preview.summary,
            author: params.preview.author,
            link_to_message: params.preview.linkToMessage,
          },
        },
      },
      params.tenantId,
      trx,
      {},
      new ServerEventPublisher(),
      new ServerAnalyticsTracker(),
      params.user.user_id,
      3
    )
  );

  return buildCreatedTicketTaskResponse({
    tenantId: params.tenantId,
    user: params.user,
    ticketId: createdTicket.ticket_id,
    ticketNumber: normalizeOptionalString(createdTicket.ticket_number),
    fallbackTitle: createdTicket.title,
  });
}

async function handleActionRequest(
  activity: TeamsMessageExtensionActivity,
  tenantId: string
): Promise<TeamsMessageExtensionResponse> {
  const commandId = getCommandId(activity);
  if (commandId !== 'createTicketFromMessage' && commandId !== 'updateFromMessage') {
    return buildTaskMessageResponse('This Teams message action is not supported yet.');
  }

  const commandContext = getCommandContext(activity);
  if (commandContext !== 'message') {
    return buildTaskMessageResponse('This Teams message action is available from message context only.');
  }

  const preview = buildMessagePreview(activity);
  if (!preview) {
    return buildTaskMessageResponse('Select a Teams message with usable content before starting this PSA workflow.');
  }

  const invokingUser = await resolveInvokingUser({
    activity,
    tenantId,
  });
  if (!invokingUser.success) {
    return buildTaskMessageResponse(invokingUser.message);
  }

  if (commandId === 'createTicketFromMessage' && !(await hasPermission(invokingUser.user, 'ticket', 'create'))) {
    return buildTaskMessageResponse('You do not have permission to create PSA tickets from Teams messages.');
  }

  if (normalizeOptionalString(activity.name) === 'composeExtension/submitAction') {
    if (commandId === 'createTicketFromMessage') {
      return handleCreateTicketFromMessageSubmit({
        activity,
        tenantId,
        user: invokingUser.user,
        preview,
      });
    }

    return buildTaskMessageResponse(
      'The Teams message-to-update handoff is ready. Continue in the Alga PSA personal tab while inline submission is completed in a follow-up slice.'
    );
  }

  if (commandId === 'createTicketFromMessage') {
    const createTicketFormOptions = await loadCreateTicketFormOptions(tenantId);
    if (
      createTicketFormOptions.boards.length === 0 ||
      createTicketFormOptions.statuses.length === 0 ||
      createTicketFormOptions.clients.length === 0
    ) {
      return buildTaskMessageResponse(
        'Teams ticket creation needs at least one active PSA board, one open ticket status, and one active client before a message can be converted into a ticket.'
      );
    }

    return buildActionTaskResponse({
      commandId,
      preview,
      createTicketFormOptions,
      idempotencyKey: crypto.randomUUID(),
      messagePayload: getMessagePayload(activity),
    });
  }

  return buildActionTaskResponse({
    commandId,
    preview,
    messagePayload: getMessagePayload(activity),
  });
}

export async function handleTeamsMessageExtensionActivity(
  activity: TeamsMessageExtensionActivity,
  options: HandleTeamsMessageExtensionActivityOptions = {}
): Promise<TeamsMessageExtensionResponse> {
  const tenantContext = await resolveTeamsTenantContext({
    explicitTenantId: options.tenantIdHint || undefined,
    microsoftTenantId: getTeamsTenantId(activity) || undefined,
    requiredCapability: 'message_extension',
  });

  if (tenantContext.status !== 'resolved') {
    return isActionRequest(activity)
      ? buildTaskMessageResponse(tenantContext.message)
      : buildMessageResponse(tenantContext.message);
  }

  if (isQueryRequest(activity)) {
    return handleQueryRequest(activity, tenantContext.tenantId);
  }

  if (isActionRequest(activity)) {
    return handleActionRequest(activity, tenantContext.tenantId);
  }

  return buildMessageResponse('The Teams message extension supports search queries and message actions in v1.');
}

export async function handleTeamsMessageExtensionRequest(request: Request): Promise<NextResponse> {
  let activity: TeamsMessageExtensionActivity;
  try {
    activity = (await request.json()) as TeamsMessageExtensionActivity;
  } catch {
    return NextResponse.json(
      {
        error: 'invalid_json',
        message: 'The Teams message extension request body must be valid JSON.',
      },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const tenantIdHint = url.searchParams.get('tenantId') || url.searchParams.get('tenant');
  const response = await handleTeamsMessageExtensionActivity(activity, { tenantIdHint });

  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
