import { createTenantKnex, getUserWithRoles } from '@alga-psa/db';
import { NextResponse } from 'next/server';
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
  author: string | null;
  subject: string | null;
  summary: string | null;
  linkToMessage: string | null;
} | null {
  const payload = getMessagePayload(activity);
  if (!payload) {
    return null;
  }

  const subject = normalizeOptionalString(payload.subject) || normalizeOptionalString(payload.summary);
  const bodyText = normalizeOptionalString(stripHtml(payload.body?.content || ''));
  const summary = bodyText ? truncateText(bodyText, 280) : null;
  const author = normalizeOptionalString(payload.from?.user?.displayName);
  const linkToMessage = normalizeOptionalString(payload.linkToMessage);

  if (!subject && !summary && !author && !linkToMessage) {
    return null;
  }

  return {
    author,
    subject,
    summary,
    linkToMessage,
  };
}

function buildActionTaskResponse(params: {
  commandId: 'createTicketFromMessage' | 'updateFromMessage';
  preview: NonNullable<ReturnType<typeof buildMessagePreview>>;
}): TeamsMessageExtensionResponse {
  const title =
    params.commandId === 'createTicketFromMessage'
      ? 'Create ticket from Teams message'
      : 'Update PSA record from Teams message';
  const guidance =
    params.commandId === 'createTicketFromMessage'
      ? 'Review the selected Teams message before the ticket-create workflow is completed in a follow-up slice.'
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

  body.push({
    type: 'TextBlock',
    text: guidance,
    wrap: true,
    spacing: 'Medium',
    isSubtle: true,
  });

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

  if (normalizeOptionalString(activity.name) === 'composeExtension/submitAction') {
    return buildTaskMessageResponse(
      commandId === 'createTicketFromMessage'
        ? 'The Teams message-to-ticket handoff is ready. Continue in the Alga PSA personal tab while inline submission is completed in a follow-up slice.'
        : 'The Teams message-to-update handoff is ready. Continue in the Alga PSA personal tab while inline submission is completed in a follow-up slice.'
    );
  }

  return buildActionTaskResponse({
    commandId,
    preview,
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
