import { createTenantKnex, getUserWithRoles } from '@alga-psa/db';
import { NextResponse } from 'next/server';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { ContactService } from 'server/src/lib/api/services/ContactService';
import { TicketService } from 'server/src/lib/api/services/TicketService';
import {
  executeTeamsAction,
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

interface TeamsMessageExtensionParameter {
  name?: string | null;
  value?: string | null;
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

export interface TeamsMessageExtensionResponse {
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
  return normalizeOptionalString(activity.value?.commandContext);
}

function getCommandId(activity: TeamsMessageExtensionActivity): string | null {
  return normalizeOptionalString(activity.value?.commandId);
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

function buildAttachmentFromActionResult(result: TeamsActionResult): TeamsMessageExtensionAttachment | null {
  if (!result.success) {
    return null;
  }

  const primaryItem = result.items[0];
  const title = primaryItem?.title || result.summary.title;
  const text = primaryItem?.summary || result.summary.text;
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

    const attachment = buildAttachmentFromActionResult(result);
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
}): Promise<TeamsMessageSearchHit[]> {
  if (!(await hasPermission(params.user, 'ticket', 'read'))) {
    return [];
  }

  const results = await ticketService.search(
    {
      query: params.query,
      fields: ['title', 'ticket_number', 'client_name', 'contact_name'],
      include_closed: false,
      limit: 5,
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
    .limit(5)) as Array<{ task_id?: string | null; project_id?: string | null }>;

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
}): Promise<TeamsMessageSearchHit[]> {
  if (!(await hasPermission(params.user, 'contact', 'read'))) {
    return [];
  }

  const results = await contactService.search(
    {
      query: params.query,
      fields: ['full_name', 'email', 'phone_number', 'role'],
      include_inactive: false,
      limit: 5,
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
}): Promise<TeamsMessageSearchHit[]> {
  if (!(await hasPermission(params.user, 'timesheet', 'approve'))) {
    return [];
  }

  const approvals = await listPendingApprovalsForTeams({
    tenantId: params.tenantId,
    user: params.user,
    limit: 5,
    query: params.query,
  });

  return approvals.map((approval) => ({
    target: {
      entityType: 'approval',
      approvalId: approval.id,
    },
  }));
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
    return buildMessageResponse(tenantContext.message);
  }

  if (activity.type !== 'invoke' || normalizeOptionalString(activity.name) !== 'composeExtension/query') {
    return buildMessageResponse('The Teams message extension only supports search queries in v1.');
  }

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

  const linkedUser = await resolveTeamsLinkedUser({
    tenantId: tenantContext.tenantId,
    microsoftAccountId: getMicrosoftAccountId(activity),
  });

  if (linkedUser.status !== 'linked') {
    return buildMessageResponse(linkedUser.message);
  }

  const user = await getUserWithRoles(linkedUser.userId, tenantContext.tenantId);
  if (!user || user.user_type !== 'internal') {
    return buildMessageResponse('The Teams message extension could not resolve an MSP technician for this search.');
  }

  const hits = [
    ...(await searchTicketHits({ tenantId: tenantContext.tenantId, user, query })),
    ...(await searchTaskHits({ tenantId: tenantContext.tenantId, user, query })),
    ...(await searchContactHits({ tenantId: tenantContext.tenantId, user, query })),
    ...(await searchApprovalHits({ tenantId: tenantContext.tenantId, user, query })),
  ].slice(0, 12);

  const attachments = await buildSearchAttachments({
    tenantId: tenantContext.tenantId,
    user,
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
