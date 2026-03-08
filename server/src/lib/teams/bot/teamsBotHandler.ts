import { getUserWithRoles } from '@alga-psa/db';
import { getTeamsIntegrationExecutionState } from '@alga-psa/integrations/actions/integrations/teamsActions';
import { NextResponse } from 'next/server';
import {
  executeTeamsAction,
  listAvailableTeamsActions,
  type TeamsActionAvailability,
  type TeamsActionEntityReference,
  type TeamsActionLink,
  type TeamsActionResult,
  type TeamsActionSurface,
} from 'server/src/lib/teams/actions/teamsActionRegistry';
import { resolveTeamsLinkedUser } from 'server/src/lib/teams/resolveTeamsLinkedUser';
import { resolveTeamsTenantContext } from 'server/src/lib/teams/resolveTeamsTenantContext';

export interface TeamsBotActivity {
  type?: string;
  text?: string | null;
  from?: {
    id?: string | null;
    aadObjectId?: string | null;
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
  | { kind: 'ticket'; ticketId: string }
  | { kind: 'assign_ticket'; ticketId?: string }
  | { kind: 'add_note'; ticketId?: string }
  | { kind: 'reply_to_contact'; ticketId?: string }
  | { kind: 'log_time'; targetType?: 'ticket' | 'project_task'; targetId?: string };

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

function parseCommand(text: string): ParsedCommand {
  const normalized = normalizeActivityText(text);
  const lower = normalized.toLowerCase();

  if (!normalized || ['help', '?', 'hello', 'hi'].includes(lower)) {
    return { kind: 'help' };
  }

  if (lower === 'my tickets') {
    return { kind: 'my_tickets' };
  }

  const ticketMatch = normalized.match(/^ticket\s+(.+)$/i);
  if (ticketMatch) {
    return { kind: 'ticket', ticketId: ticketMatch[1].trim() };
  }

  const assignTicketMatch = normalized.match(/^assign ticket(?:\s+(.+))?$/i);
  if (assignTicketMatch) {
    return { kind: 'assign_ticket', ticketId: parseTicketCommandReference(assignTicketMatch[1]) };
  }

  const addNoteMatch = normalized.match(/^add note(?:\s+(.+))?$/i);
  if (addNoteMatch) {
    return { kind: 'add_note', ticketId: parseTicketCommandReference(addNoteMatch[1]) };
  }

  const replyMatch = normalized.match(/^reply to contact(?:\s+(.+))?$/i);
  if (replyMatch) {
    return { kind: 'reply_to_contact', ticketId: parseTicketCommandReference(replyMatch[1]) };
  }

  const logTimeMatch = normalized.match(/^log time(?:\s+(ticket|task)\s+(.+))?$/i);
  if (logTimeMatch) {
    const targetType = logTimeMatch[1]?.toLowerCase() === 'task' ? 'project_task' : logTimeMatch[1] ? 'ticket' : undefined;
    return {
      kind: 'log_time',
      targetType,
      targetId: parseTicketCommandReference(logTimeMatch[2]),
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
    buildImBackButton('Ticket <id>', 'ticket <id>'),
  ];

  if (integration.allowedActions.includes('assign_ticket')) {
    buttons.push(buildImBackButton('Assign ticket', 'assign ticket <ticket-id>'));
  }
  if (integration.allowedActions.includes('add_note')) {
    buttons.push(buildImBackButton('Add note', 'add note <ticket-id>'));
  }
  if (integration.allowedActions.includes('reply_to_contact')) {
    buttons.push(buildImBackButton('Reply to contact', 'reply to contact <ticket-id>'));
  }
  if (integration.allowedActions.includes('log_time')) {
    buttons.push(buildImBackButton('Log time', 'log time ticket <ticket-id>'));
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
        return [buildImBackButton('Log time', `log time ticket ${target.ticketId}`)];
      }
      if (target.entityType === 'project_task') {
        return [buildImBackButton('Log time', `log time task ${target.taskId}`)];
      }
      return [];
    default:
      return [];
  }
}

function mapLinksToButtons(links: TeamsActionLink[]): TeamsBotButton[] {
  return links.map((link) => buildOpenUrlButton(link.label, link.url));
}

async function renderActionResult(
  result: TeamsActionResult,
  context: {
    tenantId: string;
    user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
    metadata: TeamsBotResponseActivity['metadata'];
  }
): Promise<TeamsBotResponseActivity> {
  if (!result.success) {
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
    const buttons = [
      ...mapLinksToButtons(item.links),
      ...(item.entityType === 'ticket'
        ? await buildTargetedActionButtons(context.tenantId, context.user, {
            entityType: 'ticket',
            ticketId: item.id,
          })
        : []),
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

  if (!targetResult.success) {
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
      return buildGuidedHandoffResponse({
        actionId: 'assign_ticket',
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        target: parsed.ticketId ? { entityType: 'ticket', ticketId: parsed.ticketId } : undefined,
        missingTargetMessage: 'Specify a ticket reference, for example: assign ticket <ticket-id>.',
      });
    case 'add_note':
      return buildGuidedHandoffResponse({
        actionId: 'add_note',
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        target: parsed.ticketId ? { entityType: 'ticket', ticketId: parsed.ticketId } : undefined,
        missingTargetMessage: 'Specify a ticket reference, for example: add note <ticket-id>.',
      });
    case 'reply_to_contact':
      return buildGuidedHandoffResponse({
        actionId: 'reply_to_contact',
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        target: parsed.ticketId ? { entityType: 'ticket', ticketId: parsed.ticketId } : undefined,
        missingTargetMessage: 'Specify a ticket reference, for example: reply to contact <ticket-id>.',
      });
    case 'log_time': {
      const target =
        parsed.targetId && parsed.targetType === 'project_task'
          ? ({ entityType: 'project_task', taskId: parsed.targetId } satisfies TeamsActionEntityReference)
          : parsed.targetId
            ? ({ entityType: 'ticket', ticketId: parsed.targetId } satisfies TeamsActionEntityReference)
            : undefined;
      return buildGuidedHandoffResponse({
        actionId: 'log_time',
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        target,
        missingTargetMessage: 'Specify a work item, for example: log time ticket <ticket-id>.',
      });
    }
  }
}

export async function handleTeamsBotActivityRequest(
  request: Request
): Promise<NextResponse> {
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
  const response = await handleTeamsBotActivity(activity, { tenantIdHint });
  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
