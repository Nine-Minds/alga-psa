import { createTenantKnex, getUserWithRoles } from '@alga-psa/db';
import { getTeamsIntegrationExecutionStateImpl as getTeamsIntegrationExecutionState } from '../../actions/integrations/teamsActions';
import { NextResponse } from 'next/server';
import { hasPermission } from '@alga-psa/auth/rbac';
import { buildTeamsMessageExtensionResultDeepLinkFromPsaUrl } from '../teamsDeepLinks';
import { getTeamsRuntimeAvailability } from '../getTeamsRuntimeAvailability';
import {
  executeTeamsAction,
  listAvailableTeamsActions,
  listTeamsActionDefinitions,
  type TeamsActionEntityReference,
  type TeamsActionLink,
  type TeamsActionResult,
  type TeamsActionSurface,
} from '../actions/teamsActionRegistry';
import { resolveTeamsLinkedUser } from '../resolveTeamsLinkedUser';
import { resolveTeamsTenantContext } from '../resolveTeamsTenantContext';
import { buildTeamsAvailabilityJsonResponse } from '../teamsAvailabilityResponses';
import {
  listPendingApprovalsForTeams,
  searchTeamsContacts,
  searchTeamsTickets,
} from '../teamsPsaData';

const MESSAGE_EXTENSION_SURFACE: TeamsActionSurface = 'message_extension';
const teamsActionTitleById = new Map(listTeamsActionDefinitions().map((definition) => [definition.id, definition.title]));
const SEARCH_SURFACED_ACTION_IDS = new Set(['assign_ticket', 'add_note', 'reply_to_contact', 'log_time', 'approval_response']);
const UPDATE_TARGET_TYPE_VALUES = ['ticket', 'project_task'] as const;
const UPDATE_ACTION_TYPE_VALUES = ['internal_note', 'customer_reply', 'continue_in_tab'] as const;

type TeamsUpdateTargetType = typeof UPDATE_TARGET_TYPE_VALUES[number];
type TeamsUpdateActionType = typeof UPDATE_ACTION_TYPE_VALUES[number];

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
  | { success: true; skip: number; count: number; message?: undefined }
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

function buildUpdateContentFromPreview(preview: NonNullable<ReturnType<typeof buildMessagePreview>>): string {
  return preview.bodyText || preview.summary || preview.subject || 'Forwarded from a Teams message.';
}

function buildTeamsMessageSourceMetadata(preview: NonNullable<ReturnType<typeof buildMessagePreview>>): Record<string, string> {
  return {
    message_id: preview.messageId || '',
    subject: preview.subject || '',
    summary: preview.summary || '',
    author: preview.author || '',
    link_to_message: preview.linkToMessage || '',
  };
}

function getActionData(activity: TeamsMessageExtensionActivity): Record<string, unknown> {
  const raw = activity.value?.data;
  return raw && typeof raw === 'object' ? raw : {};
}

function getActionDataString(activity: TeamsMessageExtensionActivity, key: string): string | null {
  const rawValue = getActionData(activity)[key];
  return typeof rawValue === 'string' ? normalizeOptionalString(rawValue) : null;
}

function getActionDataUpdateTargetType(activity: TeamsMessageExtensionActivity): TeamsUpdateTargetType {
  const rawValue = getActionDataString(activity, 'targetEntityType');
  return rawValue === 'project_task' ? 'project_task' : 'ticket';
}

function getActionDataUpdateType(activity: TeamsMessageExtensionActivity): TeamsUpdateActionType {
  const rawValue = getActionDataString(activity, 'updateType');
  if (rawValue === 'customer_reply') {
    return 'customer_reply';
  }
  if (rawValue === 'continue_in_tab') {
    return 'continue_in_tab';
  }
  return 'internal_note';
}

async function buildMessageExtensionMyWorkLink(tenantId: string): Promise<string | null> {
  const integration = await getTeamsIntegrationExecutionState(tenantId);
  const baseUrl = normalizeOptionalString(
    (integration.packageMetadata as { baseUrl?: string | null } | null | undefined)?.baseUrl ?? null
  );
  const appId = normalizeOptionalString(integration.appId);

  if (!baseUrl || !appId) {
    return null;
  }

  return buildTeamsMessageExtensionResultDeepLinkFromPsaUrl(baseUrl, appId, `${baseUrl}/teams/tab`);
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

function buildTaskActionsFromTeamsResult(result: TeamsActionResult): TeamsAdaptiveCardAction[] {
  if (result.success === false) {
    return [];
  }

  return result.links.map((link) => ({
    type: 'Action.OpenUrl',
    title: link.label,
    url: link.url,
  }));
}

function buildTaskResponseFromTeamsActionResult(params: {
  title: string;
  result: TeamsActionResult;
  fallbackText?: string;
}): TeamsMessageExtensionResponse {
  if (params.result.success === false) {
    return buildTaskMessageResponse(
      [params.result.error.message, params.result.error.remediation].filter(Boolean).join(' ').trim()
    );
  }

  const body: Array<Record<string, unknown>> = [
    {
      type: 'TextBlock',
      text: params.title,
      wrap: true,
      weight: 'Bolder',
      size: 'Medium',
    },
    {
      type: 'TextBlock',
      text: params.result.summary.text || params.fallbackText || params.result.summary.title,
      wrap: true,
      spacing: 'Small',
    },
  ];

  return {
    task: {
      type: 'continue',
      value: {
        title: params.title,
        width: 'medium',
        height: 'medium',
        card: {
          type: 'AdaptiveCard',
          version: '1.5',
          body,
          ...(buildTaskActionsFromTeamsResult(params.result).length > 0
            ? { actions: buildTaskActionsFromTeamsResult(params.result) }
            : {}),
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
  extraActions?: TeamsAdaptiveCardAction[];
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
  } else if (params.commandId === 'updateFromMessage') {
    body.push(
      {
        type: 'Input.ChoiceSet',
        id: 'targetEntityType',
        label: 'Target record type',
        value: 'ticket',
        isRequired: true,
        errorMessage: 'Select the PSA record type to update.',
        style: 'compact',
        choices: [
          { title: 'Ticket', value: 'ticket' },
          { title: 'Project task', value: 'project_task' },
        ],
      },
      {
        type: 'Input.Text',
        id: 'targetId',
        label: 'Target record ID',
        isRequired: true,
        errorMessage: 'Enter the PSA ticket or task ID to update.',
      },
      {
        type: 'Input.Text',
        id: 'projectId',
        label: 'Project ID (optional)',
        placeholder: 'Only needed when the Teams link cannot infer the task project.',
      },
      {
        type: 'Input.ChoiceSet',
        id: 'updateType',
        label: 'Update action',
        value: 'internal_note',
        isRequired: true,
        errorMessage: 'Select how this Teams message should update PSA.',
        style: 'compact',
        choices: [
          { title: 'Add internal note', value: 'internal_note' },
          { title: 'Send customer reply', value: 'customer_reply' },
          { title: 'Continue in Teams tab', value: 'continue_in_tab' },
        ],
      },
      {
        type: 'Input.Text',
        id: 'content',
        label: 'Update content',
        value: buildUpdateContentFromPreview(params.preview),
        isMultiline: true,
        isRequired: true,
        errorMessage: 'Enter the note or reply content.',
      },
      {
        type: 'TextBlock',
        text: 'Customer-visible replies only apply to tickets. Project-task updates that need richer context will hand off to the Teams tab.',
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
          ...((params.commandId === 'createTicketFromMessage' && params.createTicketFormOptions) ||
          params.commandId === 'updateFromMessage'
            ? {
                actions: [
                  {
                    type: 'Action.Submit',
                    title: params.commandId === 'createTicketFromMessage' ? 'Create ticket' : 'Update record',
                    data: {
                      commandId: params.commandId,
                      commandContext: 'message',
                      idempotencyKey: params.idempotencyKey || crypto.randomUUID(),
                      ...(params.messagePayload ? { messagePayload: params.messagePayload } : {}),
                    },
                  },
                  ...(params.extraActions || []),
                ],
              }
            : params.extraActions && params.extraActions.length > 0
              ? {
                  actions: params.extraActions,
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
  if (result.success === false) {
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

  const results = await searchTeamsTickets({
    tenantId: params.tenantId,
    query: params.query,
    limit: params.limit,
    includeClosed: false,
  });

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

  const results = await searchTeamsContacts({
    tenantId: params.tenantId,
    query: params.query,
    limit: params.limit,
  });

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
  | { success: true; user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>; message?: undefined }
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
  if (pagination.success === false) {
    return buildMessageResponse(pagination.message);
  }

  const invokingUser = await resolveInvokingUser({
    activity,
    tenantId,
  });
  if (invokingUser.success === false) {
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

  const result = await executeTeamsAction({
    actionId: 'create_ticket_from_message',
    surface: MESSAGE_EXTENSION_SURFACE,
    tenantId: params.tenantId,
    user: params.user,
    idempotencyKey,
    input: {
      title,
      description,
      boardId,
      statusId,
      clientId,
      ...(contactId ? { contactId } : {}),
      metadata: buildTeamsMessageSourceMetadata(params.preview),
    },
  });

  return buildTaskResponseFromTeamsActionResult({
    title: 'Ticket created',
    result,
    fallbackText: `Created a PSA ticket from the selected Teams message.`,
  });
}

async function handleUpdateFromMessageSubmit(params: {
  activity: TeamsMessageExtensionActivity;
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  preview: NonNullable<ReturnType<typeof buildMessagePreview>>;
}): Promise<TeamsMessageExtensionResponse> {
  const targetEntityType = getActionDataUpdateTargetType(params.activity);
  const targetId = getActionDataString(params.activity, 'targetId');
  const projectId = getActionDataString(params.activity, 'projectId');
  const updateType = getActionDataUpdateType(params.activity);
  const content = getActionDataString(params.activity, 'content') || buildUpdateContentFromPreview(params.preview);
  const idempotencyKey = getActionDataString(params.activity, 'idempotencyKey') || undefined;

  if (!targetId) {
    return buildTaskMessageResponse('Enter the PSA ticket or task ID before updating a record from this Teams message.');
  }

  if (updateType !== 'continue_in_tab' && !content) {
    return buildTaskMessageResponse('Enter the note or reply content before updating PSA from this Teams message.');
  }

  const result = await executeTeamsAction({
    actionId: 'update_from_message',
    surface: MESSAGE_EXTENSION_SURFACE,
    tenantId: params.tenantId,
    user: params.user,
    idempotencyKey,
    input: {
      targetEntityType,
      targetId,
      ...(projectId ? { projectId } : {}),
      updateType,
      content,
      metadata: buildTeamsMessageSourceMetadata(params.preview),
    },
  });

  return buildTaskResponseFromTeamsActionResult({
    title:
      targetEntityType === 'project_task' || updateType === 'continue_in_tab'
        ? 'Continue in Teams tab'
        : updateType === 'customer_reply'
          ? 'Ticket reply sent'
          : 'Ticket updated',
    result,
    fallbackText:
      targetEntityType === 'project_task'
        ? updateType === 'customer_reply'
          ? 'Customer-visible replies are only supported for tickets from Teams. Open the project task in Teams or full PSA to continue.'
          : 'Project task updates from Teams open in the Teams tab so you can add the full task context safely.'
        : updateType === 'continue_in_tab'
          ? 'Open the ticket in Teams or full PSA to continue this workflow.'
          : updateType === 'customer_reply'
            ? `A customer-visible reply was added to ticket ${targetId}.`
            : `An internal note was added to ticket ${targetId}.`,
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
  if (invokingUser.success === false) {
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

    return handleUpdateFromMessageSubmit({
      activity,
      tenantId,
      user: invokingUser.user,
      preview,
    });
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

    const handoffLink = await buildMessageExtensionMyWorkLink(tenantId);

    return buildActionTaskResponse({
      commandId,
      preview,
      createTicketFormOptions,
      idempotencyKey: crypto.randomUUID(),
      messagePayload: getMessagePayload(activity),
      extraActions: handoffLink
        ? [
            {
              type: 'Action.OpenUrl',
              title: 'Continue in Teams tab',
              url: handoffLink,
            },
          ]
        : [],
    });
  }

  const handoffLink = await buildMessageExtensionMyWorkLink(tenantId);

  return buildActionTaskResponse({
    commandId,
    preview,
    messagePayload: getMessagePayload(activity),
    idempotencyKey: crypto.randomUUID(),
    extraActions: handoffLink
      ? [
          {
            type: 'Action.OpenUrl',
            title: 'Continue in Teams tab',
            url: handoffLink,
          },
        ]
      : [],
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
  const availability = await getTeamsRuntimeAvailability({
    explicitTenantId: tenantIdHint,
    microsoftTenantId: getTeamsTenantId(activity),
    requiredCapability: 'message_extension',
  });
  if (availability && availability.enabled === false) {
    return buildTeamsAvailabilityJsonResponse(availability);
  }

  const response = await handleTeamsMessageExtensionActivity(activity, { tenantIdHint });

  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
