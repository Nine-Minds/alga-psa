import { createTenantKnex, getUserWithRoles } from '@alga-psa/db';
import { getTeamsIntegrationExecutionStateImpl as getTeamsIntegrationExecutionState } from '../../actions/integrations/teamsActions';
import { NextResponse } from 'next/server';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getTeamsRuntimeAvailability } from '../getTeamsRuntimeAvailability';
import { buildTeamsAvailabilityJsonResponse } from '../teamsAvailabilityResponses';
import { sendBotActivity, isBotConnectorConfigured } from './teamsBotConnector';
import { verifyTeamsBotRequest } from './teamsBotJwtVerifier';
import {
  executeTeamsAction,
  listAvailableTeamsActions,
  type TeamsActionAvailability,
  type TeamsActionEntityReference,
  type TeamsActionLink,
  type TeamsActionResult,
  type TeamsActionResultItem,
  type TeamsActionSurface,
} from '../actions/teamsActionRegistry';
import { resolveTeamsLinkedUser } from '../resolveTeamsLinkedUser';
import { resolveTeamsTenantContext } from '../resolveTeamsTenantContext';

export interface TeamsBotActivity {
  type?: string;
  id?: string | null;
  serviceUrl?: string | null;
  text?: string | null;
  from?: {
    id?: string | null;
    aadObjectId?: string | null;
    name?: string | null;
  } | null;
  recipient?: {
    id?: string | null;
    name?: string | null;
  } | null;
  conversation?: {
    id?: string | null;
    conversationType?: string | null;
  } | null;
  channelData?: {
    tenant?: {
      id?: string | null;
    } | null;
  } | null;
}

interface TeamsBotButton {
  type: 'openUrl' | 'imBack';
  title: string;
  value: string;
}

interface TeamsBotCardAttachment {
  contentType: 'application/vnd.microsoft.card.hero';
  content: {
    title: string;
    text: string;
    buttons?: TeamsBotButton[];
  };
}

export interface TeamsBotResponseActivity {
  type: 'message';
  text: string;
  inputHint?: 'acceptingInput' | 'ignoringInput';
  attachments?: TeamsBotCardAttachment[];
  suggestedActions?: {
    actions: TeamsBotButton[];
  };
  metadata?: {
    tenantId?: string;
    userId?: string;
    commandId?: string;
    conversationType?: string;
  };
}

type ParsedCommand =
  | { kind: 'help' }
  | { kind: 'unsupported'; text: string }
  | { kind: 'my_tickets' }
  | { kind: 'my_approvals' }
  | { kind: 'ticket'; ticketId: string }
  | { kind: 'assign_ticket'; ticketId?: string; assignee?: string }
  | { kind: 'add_note'; ticketId?: string; note?: string }
  | { kind: 'reply_to_contact'; ticketId?: string; reply?: string }
  | { kind: 'log_time'; targetType?: 'ticket' | 'project_task'; targetId?: string; durationMinutes?: number; note?: string }
  | {
      kind: 'approval_response';
      approvalId?: string;
      outcome: 'approve' | 'request_changes';
      comment?: string;
    };

interface HandleTeamsBotActivityOptions {
  tenantIdHint?: string | null;
}

const BOT_SURFACE: TeamsActionSurface = 'bot';

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeActivityText(text: string | null | undefined): string {
  return (text || '')
    .replace(/<at>.*?<\/at>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildOpenUrlButton(title: string, value: string): TeamsBotButton {
  return {
    type: 'openUrl',
    title,
    value,
  };
}

function buildImBackButton(title: string, value: string): TeamsBotButton {
  return {
    type: 'imBack',
    title,
    value,
  };
}

function buildCard(title: string, text: string, buttons: TeamsBotButton[] = []): TeamsBotCardAttachment {
  return {
    contentType: 'application/vnd.microsoft.card.hero',
    content: {
      title,
      text,
      ...(buttons.length > 0 ? { buttons } : {}),
    },
  };
}

function buildMessageResponse(
  text: string,
  options: {
    attachments?: TeamsBotCardAttachment[];
    suggestedActions?: TeamsBotButton[];
    metadata?: TeamsBotResponseActivity['metadata'];
    inputHint?: TeamsBotResponseActivity['inputHint'];
  } = {}
): TeamsBotResponseActivity {
  return {
    type: 'message',
    text,
    inputHint: options.inputHint || 'acceptingInput',
    ...(options.attachments && options.attachments.length > 0 ? { attachments: options.attachments } : {}),
    ...(options.suggestedActions && options.suggestedActions.length > 0
      ? { suggestedActions: { actions: options.suggestedActions } }
      : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}

function parseTicketCommandReference(value: string | null | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized || undefined;
}

function parseDurationMinutes(value: string | null | undefined): number | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i);
  if (!match) {
    return undefined;
  }

  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const total = hours * 60 + minutes;
  return total > 0 ? total : undefined;
}

function parseCommand(text: string): ParsedCommand {
  const normalized = normalizeActivityText(text);
  const lower = normalized.toLowerCase();

  if (!normalized || ['help', '?', 'hello', 'hi'].includes(lower)) {
    return { kind: 'help' };
  }

  if (lower === 'my tickets') {
    return { kind: 'my_tickets' };
  }

  if (lower === 'my approvals') {
    return { kind: 'my_approvals' };
  }

  const ticketMatch = normalized.match(/^ticket\s+(.+)$/i);
  if (ticketMatch) {
    return { kind: 'ticket', ticketId: ticketMatch[1].trim() };
  }

  const assignTicketMatch = normalized.match(/^assign ticket(?:\s+(\S+))?(?:\s+to\s+(.+))?$/i);
  if (assignTicketMatch) {
    return {
      kind: 'assign_ticket',
      ticketId: parseTicketCommandReference(assignTicketMatch[1]),
      assignee: parseTicketCommandReference(assignTicketMatch[2]),
    };
  }

  const addNoteMatch = normalized.match(/^add note(?:\s+(\S+))?(?:\s*:\s*(.+))?$/i);
  if (addNoteMatch) {
    return {
      kind: 'add_note',
      ticketId: parseTicketCommandReference(addNoteMatch[1]),
      note: normalizeOptionalString(addNoteMatch[2]) || undefined,
    };
  }

  const replyMatch = normalized.match(/^reply to contact(?:\s+(\S+))?(?:\s*:\s*(.+))?$/i);
  if (replyMatch) {
    return {
      kind: 'reply_to_contact',
      ticketId: parseTicketCommandReference(replyMatch[1]),
      reply: normalizeOptionalString(replyMatch[2]) || undefined,
    };
  }

  const logTimeMatch = normalized.match(/^log time(?:\s+(ticket|task)\s+(\S+))?(?:\s+([^:]+?))?(?:\s*:\s*(.+))?$/i);
  if (logTimeMatch) {
    const targetType = logTimeMatch[1]?.toLowerCase() === 'task' ? 'project_task' : logTimeMatch[1] ? 'ticket' : undefined;
    return {
      kind: 'log_time',
      targetType,
      targetId: parseTicketCommandReference(logTimeMatch[2]),
      durationMinutes: parseDurationMinutes(logTimeMatch[3]),
      note: normalizeOptionalString(logTimeMatch[4]) || undefined,
    };
  }

  const approveApprovalMatch = normalized.match(/^approve approval(?:\s+(\S+))?(?:\s*:\s*(.+))?$/i);
  if (approveApprovalMatch) {
    return {
      kind: 'approval_response',
      approvalId: parseTicketCommandReference(approveApprovalMatch[1]),
      outcome: 'approve',
      comment: normalizeOptionalString(approveApprovalMatch[2]) || undefined,
    };
  }

  const requestChangesMatch = normalized.match(/^(?:request changes|reject) approval(?:\s+(\S+))?(?:\s*:\s*(.+))?$/i);
  if (requestChangesMatch) {
    return {
      kind: 'approval_response',
      approvalId: parseTicketCommandReference(requestChangesMatch[1]),
      outcome: 'request_changes',
      comment: normalizeOptionalString(requestChangesMatch[2]) || undefined,
    };
  }

  return { kind: 'unsupported', text: normalized };
}

function getTeamsTenantId(activity: TeamsBotActivity): string | null {
  return normalizeOptionalString(activity.channelData?.tenant?.id);
}

function getConversationType(activity: TeamsBotActivity): string {
  return normalizeOptionalString(activity.conversation?.conversationType) || 'unknown';
}

function getMicrosoftAccountId(activity: TeamsBotActivity): string | null {
  return normalizeOptionalString(activity.from?.aadObjectId) || normalizeOptionalString(activity.from?.id);
}

async function buildSupportedCommandButtons(tenantId: string): Promise<TeamsBotButton[]> {
  const integration = await getTeamsIntegrationExecutionState(tenantId);
  const buttons: TeamsBotButton[] = [
    buildImBackButton('My tickets', 'my tickets'),
    buildImBackButton('My approvals', 'my approvals'),
    buildImBackButton('Ticket <id>', 'ticket <id>'),
  ];

  if (integration.allowedActions.includes('assign_ticket')) {
    buttons.push(buildImBackButton('Assign ticket', 'assign ticket <ticket-id> to me'));
  }
  if (integration.allowedActions.includes('add_note')) {
    buttons.push(buildImBackButton('Add note', 'add note <ticket-id>: <note>'));
  }
  if (integration.allowedActions.includes('reply_to_contact')) {
    buttons.push(buildImBackButton('Reply to contact', 'reply to contact <ticket-id>: <reply>'));
  }
  if (integration.allowedActions.includes('log_time')) {
    buttons.push(buildImBackButton('Log time', 'log time ticket <ticket-id> 30m: <note>'));
  }
  if (integration.allowedActions.includes('approval_response')) {
    buttons.push(buildImBackButton('Approve approval', 'approve approval <approval-id>'));
    buttons.push(buildImBackButton('Request changes', 'request changes approval <approval-id>: <comment>'));
  }

  return buttons;
}

async function buildHelpResponse(
  tenantId: string,
  metadata: TeamsBotResponseActivity['metadata'],
  preamble?: string
): Promise<TeamsBotResponseActivity> {
  const buttons = await buildSupportedCommandButtons(tenantId);
  const lines = buttons.map((button) => `• ${button.value}`);
  return buildMessageResponse(
    preamble || 'Alga PSA is ready in Teams. Try one of these commands:',
    {
      attachments: [
        buildCard('Teams bot commands', lines.join('\n'), []),
      ],
      suggestedActions: buttons.slice(0, 6),
      metadata: {
        ...metadata,
        commandId: 'help',
      },
    }
  );
}

async function buildTargetedActionButtons(
  tenantId: string,
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>,
  target: TeamsActionEntityReference
): Promise<TeamsBotButton[]> {
  const actions = await listAvailableTeamsActions({
    surface: BOT_SURFACE,
    tenantId,
    user,
    target,
  });

  return actions
    .filter((action) => action.available)
    .flatMap((action) => mapActionAvailabilityToButtons(action, target))
    .slice(0, 4);
}

function mapActionAvailabilityToButtons(
  action: TeamsActionAvailability,
  target: TeamsActionEntityReference
): TeamsBotButton[] {
  switch (action.actionId) {
    case 'assign_ticket':
      return target.entityType === 'ticket' ? [buildImBackButton('Assign ticket', `assign ticket ${target.ticketId}`)] : [];
    case 'add_note':
      return target.entityType === 'ticket' ? [buildImBackButton('Add note', `add note ${target.ticketId}`)] : [];
    case 'reply_to_contact':
      return target.entityType === 'ticket' ? [buildImBackButton('Reply to contact', `reply to contact ${target.ticketId}`)] : [];
    case 'log_time':
      if (target.entityType === 'ticket') {
        return [buildImBackButton('Log time', `log time ticket ${target.ticketId} 30m: <note>`)];
      }
      if (target.entityType === 'project_task') {
        return [buildImBackButton('Log time', `log time task ${target.taskId} 30m: <note>`)];
      }
      return [];
    case 'approval_response':
      return target.entityType === 'approval'
        ? [
            buildImBackButton('Approve', `approve approval ${target.approvalId}`),
            buildImBackButton('Request changes', `request changes approval ${target.approvalId}: <comment>`),
          ]
        : [];
    default:
      return [];
  }
}

function buildTargetReferenceFromItem(item: TeamsActionResultItem): TeamsActionEntityReference | null {
  switch (item.entityType) {
    case 'ticket':
      return { entityType: 'ticket', ticketId: item.id };
    case 'project_task':
      return { entityType: 'project_task', taskId: item.id };
    case 'approval':
      return { entityType: 'approval', approvalId: item.id };
    case 'time_entry':
      return { entityType: 'time_entry', entryId: item.id };
    case 'contact':
      return { entityType: 'contact', contactId: item.id };
    default:
      return null;
  }
}

function mapLinksToButtons(links: TeamsActionLink[]): TeamsBotButton[] {
  return links.map((link) => buildOpenUrlButton(link.label, link.url));
}

interface TeamsAssignableUserSummary {
  user_id: string;
  username: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

function normalizeLookupToken(value: string): string {
  return value.trim().toLowerCase();
}

function describeAssignableUser(user: TeamsAssignableUserSummary): string {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return fullName || user.email || user.username || user.user_id;
}

async function resolveTicketAssignee(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  assigneeReference?: string;
}): Promise<
  | { status: 'resolved'; assigneeId: string; assigneeLabel: string }
  | { status: 'error'; title: string; message: string }
> {
  const reference = normalizeOptionalString(params.assigneeReference);
  if (!reference || ['me', 'myself', 'self'].includes(normalizeLookupToken(reference))) {
    const fullName = [params.user.first_name, params.user.last_name].filter(Boolean).join(' ').trim();
    return {
      status: 'resolved',
      assigneeId: params.user.user_id,
      assigneeLabel: fullName || params.user.email || params.user.username || 'you',
    };
  }

  const { knex } = await createTenantKnex(params.tenantId);
  const canReadUsers = await hasPermission(params.user, 'user', 'read', knex);
  if (!canReadUsers) {
    return {
      status: 'error',
      title: 'Technician lookup unavailable',
      message:
        'Looking up another technician from Teams requires PSA permission to read users. Use “assign ticket <ticket-id> to me” or open the full PSA application.',
    };
  }

  const rows = (await knex('users')
    .where({
      tenant: params.tenantId,
      user_type: 'internal',
      is_inactive: false,
    })
    .select('user_id', 'username', 'email', 'first_name', 'last_name')) as TeamsAssignableUserSummary[];

  const normalizedReference = normalizeLookupToken(reference);
  const matches = rows.filter((candidate) => {
    const fullName = [candidate.first_name, candidate.last_name].filter(Boolean).join(' ').trim();
    return [
      candidate.user_id,
      candidate.username,
      candidate.email,
      fullName,
    ]
      .filter((value): value is string => Boolean(value && value.trim()))
      .some((value) => normalizeLookupToken(value) === normalizedReference);
  });

  if (matches.length === 0) {
    return {
      status: 'error',
      title: 'Technician not found',
      message: `No active technician matched “${reference}”. Use “me”, an email address, a user ID, or the technician’s full name.`,
    };
  }

  if (matches.length > 1) {
    return {
      status: 'error',
      title: 'Technician lookup is ambiguous',
      message: `More than one technician matched “${reference}”. Use a user ID or email address instead.`,
    };
  }

  return {
    status: 'resolved',
    assigneeId: matches[0].user_id,
    assigneeLabel: describeAssignableUser(matches[0]),
  };
}

async function renderActionResult(
  result: TeamsActionResult,
  context: {
    tenantId: string;
    user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
    metadata: TeamsBotResponseActivity['metadata'];
  }
): Promise<TeamsBotResponseActivity> {
  if (result.success === false) {
    return buildMessageResponse(result.error.message, {
      attachments: [
        buildCard('Teams bot request unavailable', `${result.error.message}\n${result.error.remediation || ''}`.trim()),
      ],
      metadata: {
        ...context.metadata,
        commandId: result.actionId,
      },
    });
  }

  const attachments: TeamsBotCardAttachment[] = [
    buildCard(result.summary.title, result.summary.text, mapLinksToButtons(result.links)),
  ];

  for (const item of result.items) {
    const targetReference = buildTargetReferenceFromItem(item);
    const buttons = [
      ...mapLinksToButtons(item.links),
      ...(targetReference ? await buildTargetedActionButtons(context.tenantId, context.user, targetReference) : []),
    ].slice(0, 5);

    attachments.push(buildCard(item.title, item.summary, buttons));
  }

  return buildMessageResponse(result.summary.text, {
    attachments,
    metadata: {
      ...context.metadata,
      commandId: result.actionId,
    },
  });
}

async function buildGuidedHandoffResponse(params: {
  actionId: 'assign_ticket' | 'add_note' | 'reply_to_contact' | 'log_time';
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  metadata: TeamsBotResponseActivity['metadata'];
  target?: TeamsActionEntityReference;
  missingTargetMessage: string;
}): Promise<TeamsBotResponseActivity> {
  if (!params.target) {
    return buildMessageResponse(params.missingTargetMessage, {
      attachments: [
        buildCard('Command needs a ticket reference', params.missingTargetMessage),
      ],
      metadata: {
        ...params.metadata,
        commandId: params.actionId,
      },
    });
  }

  const availability = await listAvailableTeamsActions({
    surface: BOT_SURFACE,
    tenantId: params.tenantId,
    user: params.user,
    target: params.target,
  });
  const actionAvailability = availability.find((entry) => entry.actionId === params.actionId);

  if (!actionAvailability?.available) {
    return buildMessageResponse(actionAvailability?.message || 'This Teams action is disabled for the tenant.', {
      attachments: [
        buildCard(
          'Teams action unavailable',
          `${actionAvailability?.message || 'This Teams action is disabled for the tenant.'}\nUse the full PSA application if you need to continue right away.`
        ),
      ],
      metadata: {
        ...params.metadata,
        commandId: params.actionId,
      },
    });
  }

  const targetResult = await executeTeamsAction({
    actionId: 'open_record',
    surface: BOT_SURFACE,
    tenantId: params.tenantId,
    user: params.user,
    target: params.target,
  });

  if (targetResult.success === false) {
    return renderActionResult(targetResult, params);
  }

  const buttons = mapLinksToButtons(targetResult.links);
  return buildMessageResponse('Open the record in Teams to continue this workflow.', {
    attachments: [
      buildCard(
        'Continue in Teams tab',
        'This workflow needs richer context than the current bot message. Open the record in Teams or the full PSA app to continue safely.',
        buttons
      ),
    ],
    metadata: {
      ...params.metadata,
      commandId: params.actionId,
    },
  });
}

async function handleAssignTicketCommand(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  metadata: TeamsBotResponseActivity['metadata'];
  ticketId?: string;
  assigneeReference?: string;
}): Promise<TeamsBotResponseActivity> {
  if (!params.ticketId) {
    return buildMessageResponse('Specify a ticket reference, for example: assign ticket <ticket-id> to me.', {
      attachments: [
        buildCard('Command needs a ticket reference', 'Specify a ticket reference, for example: assign ticket <ticket-id> to me.'),
      ],
      metadata: {
        ...params.metadata,
        commandId: 'assign_ticket',
      },
    });
  }

  const assignee = await resolveTicketAssignee({
    tenantId: params.tenantId,
    user: params.user,
    assigneeReference: params.assigneeReference,
  });

  if (assignee.status === 'error') {
    return buildMessageResponse(assignee.message, {
      attachments: [
        buildCard(assignee.title, assignee.message),
      ],
      metadata: {
        ...params.metadata,
        commandId: 'assign_ticket',
      },
    });
  }

  const result = await executeTeamsAction({
    actionId: 'assign_ticket',
    surface: BOT_SURFACE,
    tenantId: params.tenantId,
    user: params.user,
    target: {
      entityType: 'ticket',
      ticketId: params.ticketId,
    },
    input: {
      ticketId: params.ticketId,
      assigneeId: assignee.assigneeId,
    },
  });

  if (result.success === false) {
    return renderActionResult(result, {
      tenantId: params.tenantId,
      user: params.user,
      metadata: params.metadata,
    });
  }

  return renderActionResult(
    {
      ...result,
      summary: {
        title: 'Ticket assigned',
        text: `Ticket ${params.ticketId} was assigned to ${assignee.assigneeLabel}.`,
      },
    },
    {
      tenantId: params.tenantId,
      user: params.user,
      metadata: params.metadata,
    }
  );
}

async function handleAddNoteCommand(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  metadata: TeamsBotResponseActivity['metadata'];
  ticketId?: string;
  note?: string;
}): Promise<TeamsBotResponseActivity> {
  if (!params.ticketId) {
    return buildMessageResponse('Specify a ticket reference, for example: add note <ticket-id>: Waiting on the vendor.', {
      attachments: [
        buildCard(
          'Command needs a ticket reference',
          'Specify a ticket reference, for example: add note <ticket-id>: Waiting on the vendor.'
        ),
      ],
      metadata: {
        ...params.metadata,
        commandId: 'add_note',
      },
    });
  }

  if (!normalizeOptionalString(params.note)) {
    return buildMessageResponse(
      `Add note content after the ticket reference, for example: add note ${params.ticketId}: Waiting on the vendor.`,
      {
        attachments: [
          buildCard(
            'Note content required',
            `Ticket ${params.ticketId} is ready. Add note content after the ticket reference, for example: add note ${params.ticketId}: Waiting on the vendor.`
          ),
        ],
        metadata: {
          ...params.metadata,
          commandId: 'add_note',
        },
      }
    );
  }

  return renderActionResult(
    await executeTeamsAction({
      actionId: 'add_note',
      surface: BOT_SURFACE,
      tenantId: params.tenantId,
      user: params.user,
      target: {
        entityType: 'ticket',
        ticketId: params.ticketId,
      },
      input: {
        ticketId: params.ticketId,
        note: params.note,
      },
    }),
    {
      tenantId: params.tenantId,
      user: params.user,
      metadata: params.metadata,
    }
  );
}

async function handleReplyToContactCommand(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  metadata: TeamsBotResponseActivity['metadata'];
  ticketId?: string;
  reply?: string;
}): Promise<TeamsBotResponseActivity> {
  if (!params.ticketId) {
    return buildMessageResponse(
      'Specify a ticket reference, for example: reply to contact <ticket-id>: I have an update for you.',
      {
        attachments: [
          buildCard(
            'Command needs a ticket reference',
            'Specify a ticket reference, for example: reply to contact <ticket-id>: I have an update for you.'
          ),
        ],
        metadata: {
          ...params.metadata,
          commandId: 'reply_to_contact',
        },
      }
    );
  }

  if (!normalizeOptionalString(params.reply)) {
    return buildMessageResponse(
      `Add reply content after the ticket reference, for example: reply to contact ${params.ticketId}: I have an update for you.`,
      {
        attachments: [
          buildCard(
            'Reply content required',
            `Ticket ${params.ticketId} is ready. Add reply content after the ticket reference, for example: reply to contact ${params.ticketId}: I have an update for you.`
          ),
        ],
        metadata: {
          ...params.metadata,
          commandId: 'reply_to_contact',
        },
      }
    );
  }

  return renderActionResult(
    await executeTeamsAction({
      actionId: 'reply_to_contact',
      surface: BOT_SURFACE,
      tenantId: params.tenantId,
      user: params.user,
      target: {
        entityType: 'ticket',
        ticketId: params.ticketId,
      },
      input: {
        ticketId: params.ticketId,
        reply: params.reply,
      },
    }),
    {
      tenantId: params.tenantId,
      user: params.user,
      metadata: params.metadata,
    }
  );
}

async function handleLogTimeCommand(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  metadata: TeamsBotResponseActivity['metadata'];
  targetType?: 'ticket' | 'project_task';
  targetId?: string;
  durationMinutes?: number;
  note?: string;
}): Promise<TeamsBotResponseActivity> {
  if (!params.targetId || !params.targetType) {
    return buildMessageResponse(
      'Specify a work item, for example: log time ticket <ticket-id> 30m: Investigated the issue.',
      {
        attachments: [
          buildCard(
            'Command needs a work item',
            'Specify a work item, for example: log time ticket <ticket-id> 30m: Investigated the issue.'
          ),
        ],
        metadata: {
          ...params.metadata,
          commandId: 'log_time',
        },
      }
    );
  }

  if (!params.durationMinutes) {
    return buildMessageResponse(
      `Add a duration after the work item, for example: log time ${params.targetType === 'project_task' ? 'task' : 'ticket'} ${params.targetId} 30m: Investigated the issue.`,
      {
        attachments: [
          buildCard(
            'Duration required',
            `Include a duration such as 15m, 30m, 1h, or 1h 30m. Example: log time ${params.targetType === 'project_task' ? 'task' : 'ticket'} ${params.targetId} 30m: Investigated the issue.`
          ),
        ],
        metadata: {
          ...params.metadata,
          commandId: 'log_time',
        },
      }
    );
  }

  const startTime = new Date(Date.now() - params.durationMinutes * 60_000).toISOString();
  return renderActionResult(
    await executeTeamsAction({
      actionId: 'log_time',
      surface: BOT_SURFACE,
      tenantId: params.tenantId,
      user: params.user,
      target:
        params.targetType === 'project_task'
          ? { entityType: 'project_task', taskId: params.targetId }
          : { entityType: 'ticket', ticketId: params.targetId },
      input: {
        entityType: params.targetType,
        workItemId: params.targetId,
        startTime,
        durationMinutes: params.durationMinutes,
        note: params.note || '',
        isBillable: true,
      },
    }),
    {
      tenantId: params.tenantId,
      user: params.user,
      metadata: params.metadata,
    }
  );
}

async function handleApprovalResponseCommand(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  metadata: TeamsBotResponseActivity['metadata'];
  approvalId?: string;
  outcome: 'approve' | 'request_changes';
  comment?: string;
}): Promise<TeamsBotResponseActivity> {
  if (!params.approvalId) {
    const example =
      params.outcome === 'approve'
        ? 'approve approval <approval-id>'
        : 'request changes approval <approval-id>: <comment>';
    return buildMessageResponse(`Specify an approval reference, for example: ${example}.`, {
      attachments: [
        buildCard('Command needs an approval reference', `Specify an approval reference, for example: ${example}.`),
      ],
      metadata: {
        ...params.metadata,
        commandId: 'approval_response',
      },
    });
  }

  if (params.outcome === 'request_changes' && !normalizeOptionalString(params.comment)) {
    return buildMessageResponse(
      `Add a comment so the technician knows what to change, for example: request changes approval ${params.approvalId}: Please add more detail for Friday.`,
      {
        attachments: [
          buildCard(
            'Change request comment required',
            `Approval ${params.approvalId} is ready. Add a comment so the technician knows what to change, for example: request changes approval ${params.approvalId}: Please add more detail for Friday.`
          ),
        ],
        metadata: {
          ...params.metadata,
          commandId: 'approval_response',
        },
      }
    );
  }

  return renderActionResult(
    await executeTeamsAction({
      actionId: 'approval_response',
      surface: BOT_SURFACE,
      tenantId: params.tenantId,
      user: params.user,
      target: {
        entityType: 'approval',
        approvalId: params.approvalId,
      },
      input: {
        approvalId: params.approvalId,
        outcome: params.outcome,
        ...(normalizeOptionalString(params.comment) ? { comment: params.comment } : {}),
      },
    }),
    {
      tenantId: params.tenantId,
      user: params.user,
      metadata: params.metadata,
    }
  );
}

export async function handleTeamsBotActivity(
  activity: TeamsBotActivity,
  options: HandleTeamsBotActivityOptions = {}
): Promise<TeamsBotResponseActivity> {
  const conversationType = getConversationType(activity);
  const tenantContext = await resolveTeamsTenantContext({
    explicitTenantId: options.tenantIdHint || undefined,
    microsoftTenantId: getTeamsTenantId(activity) || undefined,
    requiredCapability: 'personal_bot',
  });

  const baseMetadata: TeamsBotResponseActivity['metadata'] = {
    conversationType,
    ...(tenantContext.status === 'resolved' ? { tenantId: tenantContext.tenantId } : {}),
  };

  if (tenantContext.status !== 'resolved') {
    return buildMessageResponse(tenantContext.message, {
      attachments: [
        buildCard('Teams personal bot unavailable', tenantContext.message),
      ],
      metadata: baseMetadata,
    });
  }

  if (conversationType !== 'personal') {
    return buildMessageResponse('The Alga PSA Teams bot only supports personal chats in v1. Open the bot in personal scope and try again.', {
      attachments: [
        buildCard(
          'Personal scope only',
          'This Teams bot supports personal chats only in v1. Open the Alga PSA bot directly from your personal app rail and try again.'
        ),
      ],
      metadata: baseMetadata,
    });
  }

  const linkedUser = await resolveTeamsLinkedUser({
    tenantId: tenantContext.tenantId,
    microsoftAccountId: getMicrosoftAccountId(activity),
  });

  if (linkedUser.status !== 'linked') {
    return buildMessageResponse(linkedUser.message, {
      attachments: [
        buildCard('Teams sign-in required', linkedUser.message),
      ],
      metadata: baseMetadata,
    });
  }

  const user = await getUserWithRoles(linkedUser.userId, tenantContext.tenantId);
  if (!user || user.user_type !== 'internal') {
    return buildMessageResponse('The Teams bot could not resolve an MSP technician for this request.', {
      attachments: [
        buildCard('Teams sign-in required', 'The Teams bot could not resolve an MSP technician for this request.'),
      ],
      metadata: baseMetadata,
    });
  }

  const metadata: TeamsBotResponseActivity['metadata'] = {
    ...baseMetadata,
    userId: user.user_id,
  };

  if (activity.type === 'conversationUpdate') {
    return buildHelpResponse(tenantContext.tenantId, metadata, 'Alga PSA is ready in your personal Teams bot.');
  }

  const parsed = parseCommand(activity.text || '');

  switch (parsed.kind) {
    case 'help':
      return buildHelpResponse(tenantContext.tenantId, metadata);
    case 'unsupported':
      return buildHelpResponse(
        tenantContext.tenantId,
        metadata,
        `The command “${parsed.text}” is not supported by the Alga PSA Teams bot yet.`
      );
    case 'my_tickets':
      return renderActionResult(
        await executeTeamsAction({
          actionId: 'my_tickets',
          surface: BOT_SURFACE,
          tenantId: tenantContext.tenantId,
          user,
          input: {
            limit: 5,
          },
        }),
        {
          tenantId: tenantContext.tenantId,
          user,
          metadata,
        }
      );
    case 'my_approvals':
      return renderActionResult(
        await executeTeamsAction({
          actionId: 'my_approvals',
          surface: BOT_SURFACE,
          tenantId: tenantContext.tenantId,
          user,
          input: {
            limit: 5,
          },
        }),
        {
          tenantId: tenantContext.tenantId,
          user,
          metadata,
        }
      );
    case 'ticket':
      return renderActionResult(
        await executeTeamsAction({
          actionId: 'open_record',
          surface: BOT_SURFACE,
          tenantId: tenantContext.tenantId,
          user,
          target: {
            entityType: 'ticket',
            ticketId: parsed.ticketId,
          },
        }),
        {
          tenantId: tenantContext.tenantId,
          user,
          metadata,
        }
      );
    case 'assign_ticket':
      return handleAssignTicketCommand({
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        ticketId: parsed.ticketId,
        assigneeReference: parsed.assignee,
      });
    case 'add_note':
      return handleAddNoteCommand({
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        ticketId: parsed.ticketId,
        note: parsed.note,
      });
    case 'reply_to_contact':
      return handleReplyToContactCommand({
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        ticketId: parsed.ticketId,
        reply: parsed.reply,
      });
    case 'approval_response':
      return handleApprovalResponseCommand({
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        approvalId: parsed.approvalId,
        outcome: parsed.outcome,
        comment: parsed.comment,
      });
    case 'log_time': {
      return handleLogTimeCommand({
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        durationMinutes: parsed.durationMinutes,
        note: parsed.note,
      });
    }
  }
}

export async function handleTeamsBotActivityRequest(
  request: Request
): Promise<NextResponse> {
  // Verify inbound JWT before we read the body so attackers can't blast
  // payloads at the action registry. In unconfigured environments (no bot
  // credentials in env) verification is skipped, in which case the handler
  // still runs but sendBotActivity becomes a no-op and no reply is produced.
  const verification = await verifyTeamsBotRequest(request.headers.get('authorization'));
  if (verification.status === 'rejected') {
    console.warn('[teams-bot] rejected inbound request', { reason: verification.reason });
    return NextResponse.json(
      { error: 'unauthorized', message: 'Bot Framework request verification failed.' },
      { status: 401 }
    );
  }

  let activity: TeamsBotActivity;
  try {
    activity = (await request.json()) as TeamsBotActivity;
  } catch {
    return NextResponse.json(
      {
        error: 'invalid_json',
        message: 'The Teams bot request body must be valid JSON.',
      },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const tenantIdHint = url.searchParams.get('tenantId') || url.searchParams.get('tenant');
  const availability = await getTeamsRuntimeAvailability({
    explicitTenantId: tenantIdHint,
    microsoftTenantId: getTeamsTenantId(activity),
    requiredCapability: 'personal_bot',
  });
  if (availability && availability.enabled === false) {
    return buildTeamsAvailabilityJsonResponse(availability);
  }

  const response = await handleTeamsBotActivity(activity, { tenantIdHint });

  // Deliver the reply back to Teams via the Bot Framework connector. For a
  // normal `message` activity Teams ignores the HTTP response body entirely
  // and only sees what arrives via the connector POST. If credentials are
  // not configured we skip sending and return 200 so Teams doesn't retry.
  const serviceUrl = normalizeOptionalString(activity.serviceUrl);
  const conversationId = normalizeOptionalString(activity.conversation?.id);
  const replyToId = normalizeOptionalString(activity.id);

  if (serviceUrl && conversationId && isBotConnectorConfigured()) {
    try {
      const result = await sendBotActivity({
        serviceUrl,
        conversationId,
        replyToId,
        activity: response,
      });
      if (result.status === 'skipped' && result.reason) {
        console.warn('[teams-bot] reply skipped', { reason: result.reason });
      }
    } catch (err) {
      console.error('[teams-bot] failed to send reply', err);
    }
  }

  return NextResponse.json(
    { status: 'ok' },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
