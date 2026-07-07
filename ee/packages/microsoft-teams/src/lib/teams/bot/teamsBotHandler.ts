import { randomUUID } from 'node:crypto';
import { createTenantKnex, getUserWithRoles, tenantDb } from '@alga-psa/db';
import { getTeamsIntegrationExecutionStateImpl as getTeamsIntegrationExecutionState } from '../../actions/integrations/teamsActions';
import { NextResponse } from 'next/server';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getTeamsRuntimeAvailability } from '../getTeamsRuntimeAvailability';
import { buildTeamsAvailabilityJsonResponse } from '../teamsAvailabilityResponses';
import {
  BotConnectorRequestError,
  isBotConnectorConfigured,
  sendBotActivity,
  updateBotActivity,
} from './teamsBotConnector';
import {
  authenticateTeamsInboundRequest,
  type TeamsVerifiedInboundIdentity,
} from './teamsInboundAuth';
import {
  getTeamsConversationContext,
  saveTeamsConversationContext,
  upsertTeamsConversationReference,
} from './teamsConversationReferences';
import {
  buildAdaptiveCardFromHeroContent,
  buildTicketAdaptiveCard,
  type TeamsAdaptiveCardAttachment,
} from './teamsAdaptiveCards';
import {
  suggestTeamsBotCommand,
  TEAMS_BOT_COMMAND_DEFINITIONS,
} from './teamsBotCommands';
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
import {
  searchTeamsTickets,
  searchTeamsClientsByName,
  listTeamsActiveClients,
  getTeamsTicketCreationDefaults,
} from '../teamsPsaData';
import { resolveTeamsLinkedUser } from '../resolveTeamsLinkedUser';
import { resolveTeamsTenantContext } from '../resolveTeamsTenantContext';

export interface TeamsBotActivity {
  type?: string;
  id?: string | null;
  replyToId?: string | null;
  channelId?: string | null;
  serviceUrl?: string | null;
  text?: string | null;
  value?: Record<string, unknown> | null;
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
  /**
   * Adaptive Card rendering sent as the primary reply; the hero-card
   * `attachments` remain the fallback used when a client rejects adaptive
   * content (the send path retries once with the hero rendering).
   */
  adaptiveAttachments?: TeamsAdaptiveCardAttachment[];
  /**
   * When set, the send path updates this existing activity in place (card
   * refresh after an inline action) instead of posting a new reply.
   */
  replaceActivityId?: string;
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
  | { kind: 'new_ticket'; title?: string; clientName?: string }
  | { kind: 'assign_ticket'; ticketId?: string; assignee?: string; ordinalOnly?: boolean }
  | { kind: 'add_note'; ticketId?: string; note?: string }
  | { kind: 'reply_to_contact'; ticketId?: string; reply?: string }
  | { kind: 'log_time'; targetType?: 'ticket' | 'project_task'; targetId?: string; durationMinutes?: number; note?: string }
  | {
      kind: 'approval_response';
      approvalId?: string;
      outcome: 'approve' | 'request_changes';
      comment?: string;
      ordinalOnly?: boolean;
    };

interface HandleTeamsBotActivityOptions {
  tenantIdHint?: string | null;
  verifiedIdentity?: TeamsVerifiedInboundIdentity | null;
}

const BOT_SURFACE: TeamsActionSurface = 'bot';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEAMS_SCOPE_DOCS_URL = 'https://docs.algapsa.com/integrations/teams-setup#supported-scopes';
const ORDINAL_MAX = 20;

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
    adaptiveAttachments?: TeamsAdaptiveCardAttachment[];
    suggestedActions?: TeamsBotButton[];
    metadata?: TeamsBotResponseActivity['metadata'];
    inputHint?: TeamsBotResponseActivity['inputHint'];
  } = {}
): TeamsBotResponseActivity {
  const attachments = options.attachments ?? [];
  // Every carded reply gets an Adaptive Card primary rendering; the hero
  // cards stay on the response as the delivery fallback.
  const adaptiveAttachments =
    options.adaptiveAttachments ??
    attachments.map((attachment) => buildAdaptiveCardFromHeroContent(attachment.content));

  return {
    type: 'message',
    text,
    inputHint: options.inputHint || 'acceptingInput',
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(adaptiveAttachments.length > 0 ? { adaptiveAttachments } : {}),
    ...(options.suggestedActions && options.suggestedActions.length > 0
      ? { suggestedActions: { actions: options.suggestedActions } }
      : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}

function parseTicketCommandReference(value: string | null | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }
  // Accept human forms with a leading '#' ("ticket #1234").
  return normalized.replace(/^#/, '') || undefined;
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

  const newTicketMatch = normalized.match(/^new ticket(?:\s+(.+))?$/i);
  if (newTicketMatch) {
    const rest = normalizeOptionalString(newTicketMatch[1]);
    if (!rest) {
      return { kind: 'new_ticket' };
    }
    const clientMatch = rest.match(/^(.+?)\s+for\s+(.+)$/i);
    if (clientMatch) {
      return {
        kind: 'new_ticket',
        title: clientMatch[1].trim(),
        clientName: clientMatch[2].trim(),
      };
    }
    return { kind: 'new_ticket', title: rest };
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
      assignee: normalizeOptionalString(assignTicketMatch[2]) || undefined,
    };
  }

  // Ordinal short form: "assign 2 to me" targets entry 2 of the last list.
  const assignOrdinalMatch = normalized.match(/^assign\s+(\d{1,2})(?:\s+to\s+(.+))?$/i);
  if (assignOrdinalMatch) {
    return {
      kind: 'assign_ticket',
      ticketId: assignOrdinalMatch[1],
      assignee: normalizeOptionalString(assignOrdinalMatch[2]) || undefined,
      ordinalOnly: true,
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
      approvalId: normalizeOptionalString(approveApprovalMatch[1]) || undefined,
      outcome: 'approve',
      comment: normalizeOptionalString(approveApprovalMatch[2]) || undefined,
    };
  }

  const requestChangesMatch = normalized.match(/^(?:request changes|reject) approval(?:\s+(\S+))?(?:\s*:\s*(.+))?$/i);
  if (requestChangesMatch) {
    return {
      kind: 'approval_response',
      approvalId: normalizeOptionalString(requestChangesMatch[1]) || undefined,
      outcome: 'request_changes',
      comment: normalizeOptionalString(requestChangesMatch[2]) || undefined,
    };
  }

  // Ordinal short forms: "approve 2" / "request changes 2: <comment>" act on
  // the numbered entries of the most recent "my approvals" list.
  const approveOrdinalMatch = normalized.match(/^approve\s+(\d{1,2})(?:\s*:\s*(.+))?$/i);
  if (approveOrdinalMatch) {
    return {
      kind: 'approval_response',
      approvalId: approveOrdinalMatch[1],
      outcome: 'approve',
      comment: normalizeOptionalString(approveOrdinalMatch[2]) || undefined,
      ordinalOnly: true,
    };
  }

  const requestChangesOrdinalMatch = normalized.match(/^(?:request changes|reject)\s+(\d{1,2})(?:\s*:\s*(.+))?$/i);
  if (requestChangesOrdinalMatch) {
    return {
      kind: 'approval_response',
      approvalId: requestChangesOrdinalMatch[1],
      outcome: 'request_changes',
      comment: normalizeOptionalString(requestChangesOrdinalMatch[2]) || undefined,
      ordinalOnly: true,
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

function getActivityMicrosoftAccountId(activity: TeamsBotActivity): string | null {
  return normalizeOptionalString(activity.from?.aadObjectId) || normalizeOptionalString(activity.from?.id);
}

type BotUser = NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;

async function buildHelpResponse(
  tenantId: string,
  user: BotUser,
  metadata: TeamsBotResponseActivity['metadata'],
  preamble?: string
): Promise<TeamsBotResponseActivity> {
  // RBAC-aware help: only list commands whose registry action is available
  // to this user (tenant allowed_actions + capability + permission checks all
  // run inside listAvailableTeamsActions). Read-only commands stay visible.
  let availableActionIds = new Set<string>();
  try {
    const availability = await listAvailableTeamsActions({
      surface: BOT_SURFACE,
      tenantId,
      user,
    });
    availableActionIds = new Set(
      availability.filter((action) => action.available).map((action) => action.actionId)
    );
  } catch {
    availableActionIds = new Set();
  }

  const visibleDefinitions = TEAMS_BOT_COMMAND_DEFINITIONS.filter(
    (definition) =>
      definition.readOnly ||
      !definition.requiredAction ||
      availableActionIds.has(definition.requiredAction)
  );

  const buttons = visibleDefinitions
    .filter((definition) => definition.id !== 'help')
    .map((definition) => buildImBackButton(definition.title, definition.example));
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

async function resolveTeamsBotBaseUrl(tenantId: string): Promise<string> {
  let metadataBaseUrl = '';
  try {
    const integration = await getTeamsIntegrationExecutionState(tenantId);
    metadataBaseUrl =
      integration.packageMetadata && typeof integration.packageMetadata.baseUrl === 'string'
        ? integration.packageMetadata.baseUrl.trim()
        : '';
  } catch {
    metadataBaseUrl = '';
  }

  const base =
    metadataBaseUrl ||
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    'http://localhost:3000';
  return base.replace(/\/+$/, '');
}

async function buildSignInResponse(params: {
  tenantId: string;
  conversationId: string | null;
  microsoftTenantId?: string | null;
  message: string;
  metadata: TeamsBotResponseActivity['metadata'];
}): Promise<TeamsBotResponseActivity> {
  const baseUrl = await resolveTeamsBotBaseUrl(params.tenantId);
  const query = new URLSearchParams({ tenantId: params.tenantId });
  if (params.conversationId) {
    // Carry the conversation so the auth callback can resume with a
    // proactive welcome card once the Microsoft account link completes.
    query.set('conversationId', params.conversationId);
  }
  if (normalizeOptionalString(params.microsoftTenantId)) {
    query.set('microsoftTenantId', params.microsoftTenantId!.trim());
  }
  const signInUrl = `${baseUrl}/api/teams/auth/callback/bot?${query.toString()}`;

  return buildMessageResponse(params.message, {
    attachments: [
      buildCard(
        'Teams sign-in required',
        `${params.message}\nSign in with your Microsoft work account to link it to your PSA user. The bot will confirm here once you are linked.`,
        [buildOpenUrlButton('Sign in to Alga PSA', signInUrl)]
      ),
    ],
    metadata: {
      ...params.metadata,
      commandId: 'sign_in',
    },
  });
}

async function getAvailableActionsForTarget(
  tenantId: string,
  user: BotUser,
  target: TeamsActionEntityReference
): Promise<TeamsActionAvailability[]> {
  try {
    const actions = await listAvailableTeamsActions({
      surface: BOT_SURFACE,
      tenantId,
      user,
      target,
    });
    return actions.filter((action) => action.available);
  } catch {
    return [];
  }
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
      // Use displayId (ticket_number) when available so bot command buttons
      // show human-friendly references instead of UUIDs.
      return { entityType: 'ticket', ticketId: item.displayId || item.id };
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

function pickOpenUrlFromLinks(links: TeamsActionLink[]): string | null {
  const teamsLink = links.find((link) => link.type === 'teams_tab');
  return teamsLink?.url || links[0]?.url || null;
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
  user: BotUser;
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

  const rows = (await tenantDb(knex, params.tenantId).table<TeamsAssignableUserSummary>('users')
    .where('user_type', 'internal')
    .andWhere('is_inactive', false)
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
    user: BotUser;
    metadata: TeamsBotResponseActivity['metadata'];
  },
  options: { numbered?: boolean } = {}
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

  const summaryCard = buildCard(result.summary.title, result.summary.text, mapLinksToButtons(result.links));
  const attachments: TeamsBotCardAttachment[] = [summaryCard];
  const adaptiveAttachments: TeamsAdaptiveCardAttachment[] = [
    buildAdaptiveCardFromHeroContent(summaryCard.content),
  ];

  for (const [index, item] of result.items.entries()) {
    const title = options.numbered ? `${index + 1}. ${item.title}` : item.title;
    const targetReference = buildTargetReferenceFromItem(item);
    const availableActions = targetReference
      ? await getAvailableActionsForTarget(context.tenantId, context.user, targetReference)
      : [];
    const buttons = [
      ...mapLinksToButtons(item.links),
      ...(targetReference
        ? availableActions.flatMap((action) => mapActionAvailabilityToButtons(action, targetReference)).slice(0, 4)
        : []),
    ].slice(0, 5);

    attachments.push(buildCard(title, item.summary, buttons));

    if (item.entityType === 'ticket') {
      // Ticket cards get inline Adaptive Card actions (Assign to me / Add
      // note / Open) that round-trip through the action registry.
      adaptiveAttachments.push(
        buildTicketAdaptiveCard({
          title,
          text: item.summary,
          ticketId: item.displayId || item.id,
          idempotencyKey: randomUUID(),
          openUrl: pickOpenUrlFromLinks(item.links.length > 0 ? item.links : result.links),
          canAssign: availableActions.some((action) => action.actionId === 'assign_ticket'),
          canAddNote: availableActions.some((action) => action.actionId === 'add_note'),
        })
      );
    } else {
      adaptiveAttachments.push(
        buildAdaptiveCardFromHeroContent({ title, text: item.summary, buttons })
      );
    }
  }

  return buildMessageResponse(result.summary.text, {
    attachments,
    adaptiveAttachments,
    metadata: {
      ...context.metadata,
      commandId: result.actionId,
    },
  });
}

// --- Ordinal references -----------------------------------------------------
//
// List-producing commands persist their ordered results to the conversation
// context (30-minute TTL). Follow-up commands may reference entries by their
// list position ("ticket 2", "approve 2", "assign 2 to me").
//
// NOTE: ordinal ticket references collide with real ticket numbers
// ("ticket 2" could be ticket_number 2). The ordinal interpretation wins ONLY
// while an unexpired ticket list context exists for this conversation;
// otherwise the value falls through to normal ticket-number parsing. The
// pick-list footer tells users this ('Reply "ticket 2" to open the second
// result').

function parseOrdinalCandidate(reference: string | undefined): number | null {
  if (!reference || !/^\d{1,2}$/.test(reference)) {
    return null;
  }
  const value = Number.parseInt(reference, 10);
  return value >= 1 && value <= ORDINAL_MAX ? value : null;
}

type OrdinalResolution =
  | { status: 'resolved'; id: string; displayId?: string }
  | { status: 'no_context' }
  | { status: 'out_of_range'; count: number }
  | { status: 'not_ordinal' };

async function resolveOrdinalReference(params: {
  tenantId: string;
  conversationId: string | null;
  entityType: 'ticket' | 'approval';
  reference?: string;
}): Promise<OrdinalResolution> {
  const ordinal = parseOrdinalCandidate(params.reference);
  if (!ordinal) {
    return { status: 'not_ordinal' };
  }
  if (!params.conversationId) {
    return { status: 'no_context' };
  }

  const context = await getTeamsConversationContext({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
  });
  if (!context) {
    return { status: 'no_context' };
  }

  const item = context.items[ordinal - 1];
  if (!item) {
    return context.items.some((candidate) => candidate.entityType === params.entityType)
      ? { status: 'out_of_range', count: context.items.length }
      : { status: 'no_context' };
  }

  if (item.entityType !== params.entityType) {
    return { status: 'no_context' };
  }

  return { status: 'resolved', id: item.id, ...(item.displayId ? { displayId: item.displayId } : {}) };
}

function buildOrdinalGuidanceResponse(params: {
  entityType: 'ticket' | 'approval';
  reference: string;
  resolution: Extract<OrdinalResolution, { status: 'no_context' | 'out_of_range' }>;
  metadata: TeamsBotResponseActivity['metadata'];
  commandId: string;
}): TeamsBotResponseActivity {
  const listCommand = params.entityType === 'approval' ? 'my approvals' : 'my tickets';
  const message =
    params.resolution.status === 'out_of_range'
      ? `Only ${params.resolution.count} result${params.resolution.count === 1 ? ' was' : 's were'} listed recently, so “${params.reference}” is out of range. Run “${listCommand}” again and reply with a number from the new list.`
      : `I couldn’t match “${params.reference}” to a recent list — numbered references expire after 30 minutes. Run “${listCommand}” (or “ticket <search>”) first, then reply with the number from that list.`;

  return buildMessageResponse(message, {
    attachments: [buildCard('List reference expired', message)],
    metadata: {
      ...params.metadata,
      commandId: params.commandId,
    },
  });
}

type TicketOrdinalOutcome =
  | { kind: 'reference'; reference?: string }
  | { kind: 'response'; response: TeamsBotResponseActivity };

async function applyTicketOrdinal(params: {
  tenantId: string;
  conversationId: string | null;
  reference?: string;
  ordinalOnly?: boolean;
  metadata: TeamsBotResponseActivity['metadata'];
  commandId: string;
}): Promise<TicketOrdinalOutcome> {
  if (!params.reference) {
    return { kind: 'reference', reference: undefined };
  }

  const resolution = await resolveOrdinalReference({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    entityType: 'ticket',
    reference: params.reference,
  });

  if (resolution.status === 'resolved') {
    return { kind: 'reference', reference: resolution.id };
  }
  if (resolution.status === 'out_of_range') {
    return {
      kind: 'response',
      response: buildOrdinalGuidanceResponse({
        entityType: 'ticket',
        reference: params.reference,
        resolution,
        metadata: params.metadata,
        commandId: params.commandId,
      }),
    };
  }
  if (resolution.status === 'no_context' && params.ordinalOnly) {
    return {
      kind: 'response',
      response: buildOrdinalGuidanceResponse({
        entityType: 'ticket',
        reference: params.reference,
        resolution,
        metadata: params.metadata,
        commandId: params.commandId,
      }),
    };
  }

  // No usable context — treat the value as a literal ticket reference.
  return { kind: 'reference', reference: params.reference };
}

async function applyApprovalOrdinal(params: {
  tenantId: string;
  conversationId: string | null;
  reference?: string;
  metadata: TeamsBotResponseActivity['metadata'];
}): Promise<TicketOrdinalOutcome> {
  if (!params.reference) {
    return { kind: 'reference', reference: undefined };
  }

  const resolution = await resolveOrdinalReference({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    entityType: 'approval',
    reference: params.reference,
  });

  if (resolution.status === 'resolved') {
    return { kind: 'reference', reference: resolution.id };
  }
  if (resolution.status === 'not_ordinal') {
    return { kind: 'reference', reference: params.reference };
  }

  // Approval ids are UUIDs, so an ordinal-looking approval reference without
  // a matching unexpired list is always a stale/mistyped ordinal — answer
  // with guidance instead of a not-found error.
  return {
    kind: 'response',
    response: buildOrdinalGuidanceResponse({
      entityType: 'approval',
      reference: params.reference,
      resolution,
      metadata: params.metadata,
      commandId: 'approval_response',
    }),
  };
}

async function saveListContext(params: {
  tenantId: string;
  conversationId: string | null;
  items: Array<{ entityType: string; id: string; displayId?: string }>;
}): Promise<void> {
  if (!params.conversationId || params.items.length === 0) {
    return;
  }
  await saveTeamsConversationContext({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    items: params.items,
  });
}

async function saveActionResultListContext(params: {
  tenantId: string;
  conversationId: string | null;
  result: TeamsActionResult;
}): Promise<void> {
  if (params.result.success !== true) {
    return;
  }
  await saveListContext({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    items: params.result.items.map((item) => ({
      entityType: item.entityType,
      id: item.id,
      ...(item.displayId ? { displayId: item.displayId } : {}),
    })),
  });
}

async function handleTicketCommand(params: {
  tenantId: string;
  user: BotUser;
  metadata: TeamsBotResponseActivity['metadata'];
  microsoftUserId?: string | null;
  conversationId: string | null;
  reference: string;
}): Promise<TeamsBotResponseActivity> {
  const rawReference = params.reference.trim().replace(/^#/, '');

  const ordinal = await applyTicketOrdinal({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    reference: rawReference,
    metadata: params.metadata,
    commandId: 'open_record',
  });
  if (ordinal.kind === 'response') {
    return ordinal.response;
  }
  const resolvedReference = ordinal.reference || rawReference;

  // Direct lookup when the reference looks like an identifier (a ticket
  // number, an id-ish token, or a UUID); otherwise fall back to title search.
  const looksLikeIdentifier =
    !/\s/.test(resolvedReference) && (/\d/.test(resolvedReference) || UUID_PATTERN.test(resolvedReference));

  if (looksLikeIdentifier) {
    return renderActionResult(
      await executeTeamsAction({
        actionId: 'open_record',
        surface: BOT_SURFACE,
        tenantId: params.tenantId,
        user: params.user,
        microsoftUserId: params.microsoftUserId,
        target: {
          entityType: 'ticket',
          ticketId: resolvedReference,
        },
      }),
      {
        tenantId: params.tenantId,
        user: params.user,
        metadata: params.metadata,
      }
    );
  }

  return handleTicketSearchCommand({
    tenantId: params.tenantId,
    user: params.user,
    metadata: params.metadata,
    conversationId: params.conversationId,
    query: resolvedReference,
  });
}

async function handleTicketSearchCommand(params: {
  tenantId: string;
  user: BotUser;
  metadata: TeamsBotResponseActivity['metadata'];
  conversationId: string | null;
  query: string;
}): Promise<TeamsBotResponseActivity> {
  const metadata = { ...params.metadata, commandId: 'ticket_search' };

  const { knex } = await createTenantKnex(params.tenantId);
  const canReadTickets = await hasPermission(params.user, 'ticket', 'read', knex);
  if (!canReadTickets) {
    const message = 'You do not have permission to search tickets from Teams.';
    return buildMessageResponse(message, {
      attachments: [
        buildCard('Ticket search unavailable', `${message}\nOpen the full PSA application if you need broader access.`),
      ],
      metadata,
    });
  }

  const matches = await searchTeamsTickets({
    tenantId: params.tenantId,
    query: params.query,
    limit: 5,
  });

  if (matches.length === 0) {
    const message = `No open tickets matched “${params.query}”.`;
    return buildMessageResponse(message, {
      attachments: [
        buildCard(
          'No tickets found',
          `${message}\nTry a ticket number (“ticket 1234”), different search words, or “my tickets” to see your queue.`
        ),
      ],
      suggestedActions: [
        buildImBackButton('My tickets', 'my tickets'),
        buildImBackButton('Help', 'help'),
      ],
      metadata,
    });
  }

  await saveListContext({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    items: matches.map((ticket) => ({
      entityType: 'ticket',
      id: ticket.ticket_id,
      ...(normalizeOptionalString(ticket.ticket_number) ? { displayId: ticket.ticket_number!.trim() } : {}),
    })),
  });

  const summaryText = `Found ${matches.length} ticket${matches.length === 1 ? '' : 's'} matching “${params.query}”. Reply “ticket 2” to open the second result.`;
  const attachments: TeamsBotCardAttachment[] = [
    buildCard(`Tickets matching “${params.query}”`, summaryText),
  ];

  matches.forEach((ticket, index) => {
    const reference = normalizeOptionalString(ticket.ticket_number) || ticket.ticket_id;
    const summaryParts = [
      normalizeOptionalString(ticket.title),
      normalizeOptionalString(ticket.status_name),
      normalizeOptionalString(ticket.priority_name),
      normalizeOptionalString(ticket.client_name),
    ].filter(Boolean);
    attachments.push(
      buildCard(
        `${index + 1}. ${reference}`,
        summaryParts.join(' • ') || 'Ticket found in PSA.',
        [buildImBackButton('Open', `ticket ${reference}`)]
      )
    );
  });

  return buildMessageResponse(summaryText, {
    attachments,
    suggestedActions: matches
      .slice(0, 5)
      .map((_, index) => buildImBackButton(`Ticket ${index + 1}`, `ticket ${index + 1}`)),
    metadata,
  });
}

async function handleNewTicketCommand(params: {
  tenantId: string;
  user: BotUser;
  metadata: TeamsBotResponseActivity['metadata'];
  microsoftUserId?: string | null;
  title?: string;
  clientName?: string;
}): Promise<TeamsBotResponseActivity> {
  const metadata = { ...params.metadata, commandId: 'create_ticket_from_message' };
  const title = normalizeOptionalString(params.title);

  if (!title) {
    const message = 'Add a ticket title, for example: new ticket Printer offline for Acme.';
    return buildMessageResponse(message, {
      attachments: [buildCard('Command needs a ticket title', message)],
      metadata,
    });
  }

  const clientName = normalizeOptionalString(params.clientName);
  let clientId: string | null = null;
  let clientLabel: string | null = null;

  if (clientName) {
    const candidates = await searchTeamsClientsByName({
      tenantId: params.tenantId,
      name: clientName,
      limit: 5,
    });
    const exactMatches = candidates.filter(
      (candidate) => (candidate.client_name || '').trim().toLowerCase() === clientName.toLowerCase()
    );
    const matches = exactMatches.length > 0 ? exactMatches : candidates;

    if (matches.length === 0) {
      const message = `No active client matched “${clientName}”. Check the client name and try again, for example: new ticket ${title} for <client>.`;
      return buildMessageResponse(message, {
        attachments: [buildCard('Client not found', message)],
        metadata,
      });
    }
    if (matches.length > 1) {
      const names = matches
        .map((candidate) => normalizeOptionalString(candidate.client_name))
        .filter(Boolean)
        .slice(0, 5)
        .join(', ');
      const message = `More than one client matched “${clientName}” (${names}). Use the full client name, for example: new ticket ${title} for <client>.`;
      return buildMessageResponse(message, {
        attachments: [buildCard('Client name is ambiguous', message)],
        metadata,
      });
    }
    clientId = matches[0].client_id;
    clientLabel = normalizeOptionalString(matches[0].client_name);
  } else {
    const clients = await listTeamsActiveClients({ tenantId: params.tenantId, limit: 2 });
    if (clients.length === 1) {
      clientId = clients[0].client_id;
      clientLabel = normalizeOptionalString(clients[0].client_name);
    } else {
      const message = `Add a client so the ticket lands in the right place, for example: new ticket ${title} for <client>.`;
      return buildMessageResponse(message, {
        attachments: [buildCard('Command needs a client', message)],
        metadata,
      });
    }
  }

  const defaults = await getTeamsTicketCreationDefaults({ tenantId: params.tenantId });
  if (!defaults.boardId || !defaults.statusId) {
    const message =
      'No default board or open ticket status is configured for this tenant, so tickets cannot be created from chat yet. Ask an administrator to configure board defaults, or create the ticket in the full PSA application.';
    return buildMessageResponse(message, {
      attachments: [buildCard('Ticket creation unavailable', message)],
      metadata,
    });
  }

  const result = await executeTeamsAction({
    actionId: 'create_ticket_from_message',
    surface: BOT_SURFACE,
    tenantId: params.tenantId,
    user: params.user,
    microsoftUserId: params.microsoftUserId,
    idempotencyKey: randomUUID(),
    input: {
      title,
      description: title,
      boardId: defaults.boardId,
      statusId: defaults.statusId,
      clientId: clientId!,
      metadata: {
        source: 'teams_bot_command',
        ...(clientLabel ? { clientName: clientLabel } : {}),
      },
    },
  });

  return renderActionResult(result, {
    tenantId: params.tenantId,
    user: params.user,
    metadata: params.metadata,
  });
}

async function buildGuidedHandoffResponse(params: {
  actionId: 'assign_ticket' | 'add_note' | 'reply_to_contact' | 'log_time';
  tenantId: string;
  user: BotUser;
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
  user: BotUser;
  metadata: TeamsBotResponseActivity['metadata'];
  microsoftUserId?: string | null;
  ticketId?: string;
  assigneeReference?: string;
  idempotencyKey?: string;
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
    microsoftUserId: params.microsoftUserId,
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
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

  // The action result summary already uses the resolved ticket_number. Swap
  // "was reassigned successfully" with the assignee name so the bot message
  // reads naturally while preserving the human-friendly ticket reference.
  return renderActionResult(
    {
      ...result,
      summary: {
        title: 'Ticket assigned',
        text: result.summary.text.replace('was reassigned successfully', `was assigned to ${assignee.assigneeLabel}`),
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
  user: BotUser;
  metadata: TeamsBotResponseActivity['metadata'];
  microsoftUserId?: string | null;
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
      microsoftUserId: params.microsoftUserId,
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
  user: BotUser;
  metadata: TeamsBotResponseActivity['metadata'];
  microsoftUserId?: string | null;
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
      microsoftUserId: params.microsoftUserId,
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
  user: BotUser;
  metadata: TeamsBotResponseActivity['metadata'];
  microsoftUserId?: string | null;
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
      microsoftUserId: params.microsoftUserId,
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
  user: BotUser;
  metadata: TeamsBotResponseActivity['metadata'];
  microsoftUserId?: string | null;
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
      microsoftUserId: params.microsoftUserId,
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

function extractBotCardActionValue(activity: TeamsBotActivity): Record<string, unknown> | null {
  const value = activity.value;
  if (!value || typeof value !== 'object') {
    return null;
  }
  return (value as Record<string, unknown>).command === 'bot_card_action'
    ? (value as Record<string, unknown>)
    : null;
}

async function handleBotCardAction(params: {
  tenantId: string;
  user: BotUser;
  metadata: TeamsBotResponseActivity['metadata'];
  microsoftUserId?: string | null;
  value: Record<string, unknown>;
  replyToId: string | null;
}): Promise<TeamsBotResponseActivity> {
  const actionId = normalizeOptionalString(
    typeof params.value.actionId === 'string' ? params.value.actionId : null
  );
  const ticketId = normalizeOptionalString(
    typeof params.value.ticketId === 'string' ? params.value.ticketId : null
  );

  if (actionId === 'assign_ticket' && ticketId) {
    const idempotencyKey =
      normalizeOptionalString(
        typeof params.value.idempotencyKey === 'string' ? params.value.idempotencyKey : null
      ) || randomUUID();

    // RBAC + tenant allowed_actions + audit + idempotency all live inside
    // the registry — the card action is just another executeTeamsAction call.
    const result = await executeTeamsAction({
      actionId: 'assign_ticket',
      surface: BOT_SURFACE,
      tenantId: params.tenantId,
      user: params.user,
      microsoftUserId: params.microsoftUserId,
      idempotencyKey,
      target: {
        entityType: 'ticket',
        ticketId,
      },
      input: {
        ticketId,
        assigneeId: params.user.user_id,
      },
    });

    const assigneeLabel =
      [params.user.first_name, params.user.last_name].filter(Boolean).join(' ').trim() ||
      params.user.email ||
      'you';
    const renderedResult =
      result.success === true
        ? {
            ...result,
            summary: {
              title: 'Ticket assigned',
              text: result.summary.text.replace('was reassigned successfully', `was assigned to ${assigneeLabel}`),
            },
          }
        : result;

    const response = await renderActionResult(renderedResult, {
      tenantId: params.tenantId,
      user: params.user,
      metadata: params.metadata,
    });

    // Refresh the originating card in place only after a successful mutation;
    // failures are delivered as a normal reply so the card stays actionable.
    if (result.success === true && params.replyToId) {
      response.replaceActivityId = params.replyToId;
    }
    return response;
  }

  if (actionId === 'add_note' && ticketId) {
    const message = `Reply with “add note ${ticketId}: <your note>” to append an internal note to this ticket.`;
    return buildMessageResponse(message, {
      attachments: [buildCard('Add a note', message)],
      suggestedActions: [buildImBackButton('Add note', `add note ${ticketId}: `)],
      metadata: {
        ...params.metadata,
        commandId: 'add_note',
      },
    });
  }

  return buildHelpResponse(
    params.tenantId,
    params.user,
    params.metadata,
    'That card action is no longer supported. Try one of these commands:'
  );
}

export async function handleTeamsBotActivity(
  activity: TeamsBotActivity,
  options: HandleTeamsBotActivityOptions = {}
): Promise<TeamsBotResponseActivity> {
  const conversationType = getConversationType(activity);
  const conversationId = normalizeOptionalString(activity.conversation?.id);
  // Verified token claims win over body identity fields; the activity value
  // is only the fallback when no verified identity is available.
  const getMicrosoftAccountId = (source: TeamsBotActivity): string | null =>
    options.verifiedIdentity?.microsoftUserId || getActivityMicrosoftAccountId(source);
  const tenantContext = await resolveTeamsTenantContext({
    explicitTenantId: options.tenantIdHint || undefined,
    microsoftTenantId:
      options.verifiedIdentity?.microsoftTenantId || getTeamsTenantId(activity) || undefined,
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

  await upsertTeamsConversationReference({
    tenantId: tenantContext.tenantId,
    activity,
  });

  if (conversationType !== 'personal' && conversationType !== 'groupChat') {
    return buildMessageResponse('The Alga PSA Teams bot supports personal and group chats. Channel conversations are not supported yet.', {
      attachments: [
        buildCard(
          'Unsupported conversation type',
          'The Alga PSA Teams bot works in personal and group chats. Channel conversations are not supported yet. Open the bot in a personal or group chat and try again.',
          [buildOpenUrlButton('View supported scopes', TEAMS_SCOPE_DOCS_URL)]
        ),
      ],
      metadata: baseMetadata,
    });
  }

  // Group-chat responses are visible to every chat member regardless of their
  // PSA permissions. Require an explicit per-tenant capability so admins
  // knowingly opt in before the bot echoes ticket data into a shared chat.
  if (conversationType === 'groupChat' && !tenantContext.enabledCapabilities.includes('group_chat_bot')) {
    return buildMessageResponse('The Alga PSA Teams bot is not enabled for group chats in this tenant. Ask an administrator to enable the group chat capability in Teams integration settings.', {
      attachments: [
        buildCard(
          'Group chat not enabled',
          'Group chat is not enabled for Alga PSA in this tenant. Administrators can enable it under Settings → Integrations → Teams → Capabilities.'
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
    // No dead ends: the sign-in card deep-links into the Microsoft
    // account-link flow, carrying tenant + conversation so the callback can
    // resume with a proactive welcome card.
    return buildSignInResponse({
      tenantId: tenantContext.tenantId,
      conversationId,
      microsoftTenantId: tenantContext.microsoftTenantId,
      message: linkedUser.message,
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
  const microsoftUserId = getMicrosoftAccountId(activity);

  if (activity.type === 'conversationUpdate') {
    return buildHelpResponse(tenantContext.tenantId, user, metadata, 'Alga PSA is ready in your personal Teams bot.');
  }

  // Inline Adaptive Card actions (Assign to me / Add note) arrive as message
  // or invoke activities carrying value.command === 'bot_card_action'.
  const cardActionValue = extractBotCardActionValue(activity);
  if (cardActionValue) {
    return handleBotCardAction({
      tenantId: tenantContext.tenantId,
      user,
      metadata,
      microsoftUserId,
      value: cardActionValue,
      replyToId: normalizeOptionalString(activity.replyToId),
    });
  }

  const parsed = parseCommand(activity.text || '');

  switch (parsed.kind) {
    case 'help':
      return buildHelpResponse(tenantContext.tenantId, user, metadata);
    case 'unsupported': {
      const suggestion = suggestTeamsBotCommand(parsed.text);
      if (suggestion) {
        return buildHelpResponse(
          tenantContext.tenantId,
          user,
          metadata,
          `Did you mean “${suggestion.example}”?`
        );
      }
      return buildHelpResponse(
        tenantContext.tenantId,
        user,
        metadata,
        `The command “${parsed.text}” is not supported by the Alga PSA Teams bot yet.`
      );
    }
    case 'my_tickets': {
      const result = await executeTeamsAction({
        actionId: 'my_tickets',
        surface: BOT_SURFACE,
        tenantId: tenantContext.tenantId,
        user,
        input: {
          limit: 5,
        },
      });
      await saveActionResultListContext({
        tenantId: tenantContext.tenantId,
        conversationId,
        result,
      });
      return renderActionResult(
        result,
        {
          tenantId: tenantContext.tenantId,
          user,
          metadata,
        },
        { numbered: true }
      );
    }
    case 'my_approvals': {
      const result = await executeTeamsAction({
        actionId: 'my_approvals',
        surface: BOT_SURFACE,
        tenantId: tenantContext.tenantId,
        user,
        input: {
          limit: 5,
        },
      });
      await saveActionResultListContext({
        tenantId: tenantContext.tenantId,
        conversationId,
        result,
      });
      return renderActionResult(
        result,
        {
          tenantId: tenantContext.tenantId,
          user,
          metadata,
        },
        { numbered: true }
      );
    }
    case 'ticket':
      return handleTicketCommand({
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        microsoftUserId,
        conversationId,
        reference: parsed.ticketId,
      });
    case 'new_ticket':
      return handleNewTicketCommand({
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        microsoftUserId,
        title: parsed.title,
        clientName: parsed.clientName,
      });
    case 'assign_ticket': {
      const ordinal = await applyTicketOrdinal({
        tenantId: tenantContext.tenantId,
        conversationId,
        reference: parsed.ticketId,
        ordinalOnly: parsed.ordinalOnly,
        metadata,
        commandId: 'assign_ticket',
      });
      if (ordinal.kind === 'response') {
        return ordinal.response;
      }
      return handleAssignTicketCommand({
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        microsoftUserId,
        ticketId: ordinal.reference,
        assigneeReference: parsed.assignee,
      });
    }
    case 'add_note': {
      const ordinal = await applyTicketOrdinal({
        tenantId: tenantContext.tenantId,
        conversationId,
        reference: parsed.ticketId,
        metadata,
        commandId: 'add_note',
      });
      if (ordinal.kind === 'response') {
        return ordinal.response;
      }
      return handleAddNoteCommand({
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        microsoftUserId,
        ticketId: ordinal.reference,
        note: parsed.note,
      });
    }
    case 'reply_to_contact': {
      const ordinal = await applyTicketOrdinal({
        tenantId: tenantContext.tenantId,
        conversationId,
        reference: parsed.ticketId,
        metadata,
        commandId: 'reply_to_contact',
      });
      if (ordinal.kind === 'response') {
        return ordinal.response;
      }
      return handleReplyToContactCommand({
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        microsoftUserId,
        ticketId: ordinal.reference,
        reply: parsed.reply,
      });
    }
    case 'approval_response': {
      const ordinal = await applyApprovalOrdinal({
        tenantId: tenantContext.tenantId,
        conversationId,
        reference: parsed.approvalId,
        metadata,
      });
      if (ordinal.kind === 'response') {
        return ordinal.response;
      }
      return handleApprovalResponseCommand({
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        microsoftUserId,
        approvalId: ordinal.reference,
        outcome: parsed.outcome,
        comment: parsed.comment,
      });
    }
    case 'log_time': {
      return handleLogTimeCommand({
        tenantId: tenantContext.tenantId,
        user,
        metadata,
        microsoftUserId,
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        durationMinutes: parsed.durationMinutes,
        note: parsed.note,
      });
    }
  }
}

function buildWireActivity(
  response: TeamsBotResponseActivity,
  useAdaptive: boolean
): TeamsBotResponseActivity {
  const { adaptiveAttachments, replaceActivityId: _replaceActivityId, ...wire } = response;
  if (useAdaptive && adaptiveAttachments && adaptiveAttachments.length > 0) {
    return {
      ...wire,
      attachments: adaptiveAttachments as unknown as TeamsBotCardAttachment[],
    };
  }
  return wire;
}

function isCardRejectionError(error: unknown): boolean {
  if (error instanceof BotConnectorRequestError) {
    return error.status >= 400 && error.status < 500;
  }
  if (error instanceof Error) {
    const match = error.message.match(/\((\d{3})\s/);
    if (match) {
      const status = Number.parseInt(match[1], 10);
      return status >= 400 && status < 500;
    }
  }
  return false;
}

export async function handleTeamsBotActivityRequest(
  request: Request
): Promise<NextResponse> {
  // Verify the inbound Bot Framework JWT before we read the body so attackers
  // can't blast payloads at the action registry. Fails closed (403) when bot
  // credentials are unconfigured — unauthenticated activities are never
  // processed.
  const auth = await authenticateTeamsInboundRequest<TeamsBotActivity>(request, 'bot');
  if (!auth.ok) {
    return auth.response;
  }
  const { activity, identity } = auth;

  const url = new URL(request.url);
  const tenantIdHint = url.searchParams.get('tenantId') || url.searchParams.get('tenant');
  const availability = await getTeamsRuntimeAvailability({
    explicitTenantId: tenantIdHint,
    microsoftTenantId: identity.microsoftTenantId || getTeamsTenantId(activity),
    requiredCapability: 'personal_bot',
  });
  if (availability && availability.enabled === false) {
    return buildTeamsAvailabilityJsonResponse(availability);
  }

  const response = await handleTeamsBotActivity(activity, { tenantIdHint, verifiedIdentity: identity });

  // Deliver the reply back to Teams via the Bot Framework connector. For a
  // normal `message` activity Teams ignores the HTTP response body entirely
  // and only sees what arrives via the connector POST. If credentials are
  // not configured we skip sending and return 200 so Teams doesn't retry.
  const serviceUrl = normalizeOptionalString(activity.serviceUrl);
  const conversationId = normalizeOptionalString(activity.conversation?.id);
  const replyToId = normalizeOptionalString(activity.id);

  if (serviceUrl && conversationId && isBotConnectorConfigured()) {
    const primary = buildWireActivity(response, true);
    const fallback = buildWireActivity(response, false);
    const hasAdaptive = Boolean(response.adaptiveAttachments && response.adaptiveAttachments.length > 0);

    const sendReplyWithFallback = async (): Promise<void> => {
      try {
        const result = await sendBotActivity({
          serviceUrl,
          conversationId,
          replyToId,
          activity: primary,
        });
        if (result.status === 'skipped' && result.reason) {
          console.warn('[teams-bot] reply skipped', { reason: result.reason });
        }
      } catch (sendError) {
        // Some clients/channels reject Adaptive Cards with a 4xx — retry once
        // with the hero-card fallback rendering kept on the response.
        if (hasAdaptive && isCardRejectionError(sendError)) {
          const result = await sendBotActivity({
            serviceUrl,
            conversationId,
            replyToId,
            activity: fallback,
          });
          if (result.status === 'skipped' && result.reason) {
            console.warn('[teams-bot] fallback reply skipped', { reason: result.reason });
          }
        } else {
          throw sendError;
        }
      }
    };

    try {
      if (response.replaceActivityId) {
        // Inline card action: update the originating card in place; if the
        // update fails, deliver the result as a normal reply instead.
        try {
          await updateBotActivity({
            serviceUrl,
            conversationId,
            activityId: response.replaceActivityId,
            activity: primary,
          });
        } catch (updateError) {
          console.warn('[teams-bot] in-place card update failed; sending reply instead', {
            error: updateError instanceof Error ? updateError.message : String(updateError),
          });
          await sendReplyWithFallback();
        }
      } else {
        await sendReplyWithFallback();
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
