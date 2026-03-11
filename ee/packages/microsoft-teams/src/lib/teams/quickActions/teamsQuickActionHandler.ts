import { createTenantKnex, getUserWithRoles } from '@alga-psa/db';
import { NextResponse } from 'next/server';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getTeamsRuntimeAvailability } from '../getTeamsRuntimeAvailability';
import { buildTeamsAvailabilityJsonResponse } from '../teamsAvailabilityResponses';
import {
  executeTeamsAction,
  listAvailableTeamsActions,
  type TeamsActionAvailability,
  type TeamsActionEntityReference,
  type TeamsActionLink,
  type TeamsActionResult,
} from '../actions/teamsActionRegistry';
import { resolveTeamsLinkedUser } from '../resolveTeamsLinkedUser';
import { resolveTeamsTenantContext } from '../resolveTeamsTenantContext';

const QUICK_ACTION_IDS = ['assign_ticket', 'add_note', 'reply_to_contact', 'log_time', 'approval_response'] as const;
type QuickActionId = typeof QUICK_ACTION_IDS[number];

type QuickActionCommand = 'fetch' | 'submit' | 'cancel';

interface TeamsQuickActionMessagePayload {
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

export interface TeamsQuickActionActivity {
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
    actionId?: string | null;
    command?: string | null;
    target?: Record<string, unknown> | null;
    messagePayload?: TeamsQuickActionMessagePayload | null;
    data?: Record<string, unknown> | null;
  } | null;
}

interface TeamsAdaptiveCardAction {
  type: 'Action.OpenUrl' | 'Action.Submit';
  title: string;
  url?: string;
  data?: Record<string, unknown>;
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

type TeamsQuickActionResponse = TeamsTaskModuleResponse;

interface HandleTeamsQuickActionActivityOptions {
  tenantIdHint?: string | null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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

function getTeamsTenantId(activity: TeamsQuickActionActivity): string | null {
  return normalizeOptionalString(activity.channelData?.tenant?.id);
}

function getMicrosoftAccountId(activity: TeamsQuickActionActivity): string | null {
  return normalizeOptionalString(activity.from?.aadObjectId) || normalizeOptionalString(activity.from?.id);
}

function getValueData(activity: TeamsQuickActionActivity): Record<string, unknown> {
  const raw = activity.value?.data;
  return raw && typeof raw === 'object' ? raw : {};
}

function getQuickActionCommand(activity: TeamsQuickActionActivity): QuickActionCommand {
  const rawCommand =
    normalizeOptionalString(activity.value?.command) ||
    normalizeOptionalString(getValueData(activity).command) ||
    (normalizeOptionalString(activity.name) === 'task/submit' ? 'submit' : 'fetch');

  return rawCommand === 'cancel' ? 'cancel' : rawCommand === 'submit' ? 'submit' : 'fetch';
}

function getActionId(activity: TeamsQuickActionActivity): QuickActionId | null {
  const rawActionId = normalizeOptionalString(activity.value?.actionId) || normalizeOptionalString(getValueData(activity).actionId);
  return rawActionId && QUICK_ACTION_IDS.includes(rawActionId as QuickActionId) ? (rawActionId as QuickActionId) : null;
}

function parseTargetReference(raw: unknown): TeamsActionEntityReference | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const entityType = normalizeOptionalString(value.entityType);
  if (entityType === 'ticket') {
    const ticketId = normalizeOptionalString(value.ticketId);
    return ticketId ? { entityType: 'ticket', ticketId } : null;
  }

  if (entityType === 'project_task') {
    const taskId = normalizeOptionalString(value.taskId);
    if (!taskId) {
      return null;
    }

    const projectId = normalizeOptionalString(value.projectId);
    return {
      entityType: 'project_task',
      taskId,
      ...(projectId ? { projectId } : {}),
    };
  }

  if (entityType === 'approval') {
    const approvalId = normalizeOptionalString(value.approvalId);
    return approvalId ? { entityType: 'approval', approvalId } : null;
  }

  if (entityType === 'contact') {
    const contactId = normalizeOptionalString(value.contactId);
    if (!contactId) {
      return null;
    }

    const clientId = normalizeOptionalString(value.clientId);
    return {
      entityType: 'contact',
      contactId,
      ...(clientId ? { clientId } : {}),
    };
  }

  return null;
}

function getTargetReference(activity: TeamsQuickActionActivity): TeamsActionEntityReference | null {
  return parseTargetReference(activity.value?.target) || parseTargetReference(getValueData(activity).target);
}

function buildTaskMessageResponse(text: string): TeamsQuickActionResponse {
  return {
    task: {
      type: 'message',
      value: text,
    },
  };
}

function buildTaskResponse(title: string, body: Array<Record<string, unknown>>, actions: TeamsAdaptiveCardAction[] = []): TeamsQuickActionResponse {
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
          ...(actions.length > 0 ? { actions } : {}),
        },
      },
    },
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
}): TeamsQuickActionResponse {
  if (params.result.success === false) {
    return buildTaskMessageResponse(
      [params.result.error.message, params.result.error.remediation].filter(Boolean).join(' ').trim()
    );
  }

  return buildTaskResponse(
    params.title,
    [
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
    ],
    buildTaskActionsFromTeamsResult(params.result)
  );
}

function buildOpenUrlActions(links: TeamsActionLink[]): TeamsAdaptiveCardAction[] {
  return links.map((link) => ({
    type: 'Action.OpenUrl',
    title: link.label,
    url: link.url,
  }));
}

function buildMessagePreview(activity: TeamsQuickActionActivity): {
  author: string | null;
  subject: string | null;
  summary: string | null;
  bodyText: string | null;
} | null {
  const payload = activity.value?.messagePayload || (getValueData(activity).messagePayload as TeamsQuickActionMessagePayload | undefined);
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const bodyText = normalizeOptionalString(stripHtml(payload.body?.content || ''));
  const summary = bodyText ? truncateText(bodyText, 280) : normalizeOptionalString(payload.summary);
  const author = normalizeOptionalString(payload.from?.user?.displayName);
  const subject = normalizeOptionalString(payload.subject) || summary;

  if (!author && !subject && !summary && !bodyText) {
    return null;
  }

  return {
    author,
    subject,
    summary,
    bodyText,
  };
}

function buildPrefillText(activity: TeamsQuickActionActivity): string {
  const preview = buildMessagePreview(activity);
  return preview?.bodyText || preview?.summary || preview?.subject || '';
}

function describeTarget(target: TeamsActionEntityReference | null): string {
  if (!target) {
    return 'the selected PSA record';
  }

  switch (target.entityType) {
    case 'ticket':
      return `ticket ${target.ticketId}`;
    case 'project_task':
      return `project task ${target.taskId}`;
    case 'approval':
      return `approval ${target.approvalId}`;
    case 'contact':
      return `contact ${target.contactId}`;
    case 'time_entry':
      return `time entry ${target.entryId}`;
  }
}

async function resolveInvokingUser(params: {
  activity: TeamsQuickActionActivity;
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
      message: 'The Teams quick action could not resolve an MSP technician for this request.',
    };
  }

  return {
    success: true,
    user,
  };
}

async function loadAssignableUsers(
  tenantId: string,
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>
): Promise<Array<{ id: string; title: string }>> {
  if (!(await hasPermission(user, 'user', 'read'))) {
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return [
      {
        id: user.user_id,
        title: fullName || user.email || 'You',
      },
    ];
  }

  const { knex } = await createTenantKnex(tenantId);
  const rows = (await knex('users')
    .where({ tenant: tenantId, user_type: 'internal', is_inactive: false })
    .select('user_id', 'first_name', 'last_name', 'email')
    .orderBy('first_name', 'asc')
    .orderBy('last_name', 'asc')
    .limit(25)) as Array<{
    user_id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  }>;

  return rows
    .map((row) => {
      const id = normalizeOptionalString(row.user_id);
      const title =
        [normalizeOptionalString(row.first_name), normalizeOptionalString(row.last_name)].filter(Boolean).join(' ').trim() ||
        normalizeOptionalString(row.email);

      return id && title ? { id, title } : null;
    })
    .filter((row): row is { id: string; title: string } => Boolean(row));
}

function buildChoiceSetChoices(rows: Array<{ id: string; title: string }>): Array<{ title: string; value: string }> {
  return rows.map((row) => ({ title: row.title, value: row.id }));
}

async function buildHandoffLinks(params: {
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  target: TeamsActionEntityReference | null;
}): Promise<TeamsAdaptiveCardAction[]> {
  if (!params.target) {
    return [];
  }

  const result = await executeTeamsAction({
    actionId: 'open_record',
    surface: 'quick_action',
    tenantId: params.tenantId,
    user: params.user,
    target: params.target,
  });

  return result.success ? buildTaskActionsFromTeamsResult(result) : [];
}

async function buildQuickActionFetchResponse(params: {
  activity: TeamsQuickActionActivity;
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  actionId: QuickActionId;
  target: TeamsActionEntityReference | null;
}): Promise<TeamsQuickActionResponse> {
  if (!params.target) {
    return buildTaskMessageResponse('Select a PSA record before opening a Teams quick action.');
  }

  const availability = (await listAvailableTeamsActions({
    surface: 'quick_action',
    tenantId: params.tenantId,
    user: params.user,
    target: params.target,
  })).find((item) => item.actionId === params.actionId);

  if (!availability?.available) {
    const handoffActions = await buildHandoffLinks({
      tenantId: params.tenantId,
      user: params.user,
      target: params.target,
    });

    if (handoffActions.length > 0) {
      return buildTaskResponse(
        'Continue in Teams tab',
        [
          {
            type: 'TextBlock',
            text: 'Continue in Teams tab',
            wrap: true,
            weight: 'Bolder',
            size: 'Medium',
          },
          {
            type: 'TextBlock',
            text:
              availability?.message ||
              `This Teams quick action is not available for ${describeTarget(params.target)}, so the richer Teams tab flow is the safer path.`,
            wrap: true,
            spacing: 'Small',
          },
        ],
        handoffActions
      );
    }

    return buildTaskMessageResponse(availability?.message || 'This Teams quick action is not currently available.');
  }

  const prefillText = buildPrefillText(params.activity);
  const actions: TeamsAdaptiveCardAction[] = [
    {
      type: 'Action.Submit',
      title: 'Submit',
      data: {
        command: 'submit',
        actionId: params.actionId,
        target: params.target,
      },
    },
    {
      type: 'Action.Submit',
      title: 'Cancel',
      data: {
        command: 'cancel',
        actionId: params.actionId,
        target: params.target,
      },
    },
    ...(await buildHandoffLinks({
      tenantId: params.tenantId,
      user: params.user,
      target: params.target,
    })),
  ];

  const body: Array<Record<string, unknown>> = [
    {
      type: 'TextBlock',
      text:
        params.actionId === 'assign_ticket'
          ? 'Assign ticket'
          : params.actionId === 'add_note'
            ? 'Add note'
            : params.actionId === 'reply_to_contact'
              ? 'Reply to contact'
              : params.actionId === 'log_time'
                ? 'Log time'
                : 'Respond to approval',
      wrap: true,
      weight: 'Bolder',
      size: 'Medium',
    },
    {
      type: 'TextBlock',
      text: `Quick action target: ${describeTarget(params.target)}`,
      wrap: true,
      spacing: 'Small',
    },
  ];

  if (params.actionId === 'assign_ticket') {
    const assignees = await loadAssignableUsers(params.tenantId, params.user);
    body.push(
      {
        type: 'Input.ChoiceSet',
        id: 'assigneeId',
        label: 'Assign to',
        isRequired: true,
        errorMessage: 'Select a technician.',
        choices: buildChoiceSetChoices(assignees),
        value: params.user.user_id,
      },
      {
        type: 'Input.Text',
        id: 'note',
        label: 'Assignment note (optional)',
        isMultiline: true,
        value: prefillText,
      }
    );
  } else if (params.actionId === 'add_note') {
    body.push({
      type: 'Input.Text',
      id: 'note',
      label: 'Internal note',
      isMultiline: true,
      isRequired: true,
      errorMessage: 'Enter the note to save in PSA.',
      value: prefillText,
    });
  } else if (params.actionId === 'reply_to_contact') {
    body.push({
      type: 'Input.Text',
      id: 'reply',
      label: 'Customer reply',
      isMultiline: true,
      isRequired: true,
      errorMessage: 'Enter the reply to send.',
      value: prefillText,
    });
  } else if (params.actionId === 'log_time') {
    body.push(
      {
        type: 'Input.Text',
        id: 'durationMinutes',
        label: 'Duration (minutes)',
        isRequired: true,
        errorMessage: 'Enter the number of minutes to log.',
        value: '30',
      },
      {
        type: 'Input.Text',
        id: 'note',
        label: 'Time note',
        isMultiline: true,
        value: prefillText,
      },
      {
        type: 'Input.ChoiceSet',
        id: 'isBillable',
        label: 'Billing',
        value: 'true',
        style: 'compact',
        choices: [
          { title: 'Billable', value: 'true' },
          { title: 'Non-billable', value: 'false' },
        ],
      }
    );
  } else {
    body.push(
      {
        type: 'Input.ChoiceSet',
        id: 'outcome',
        label: 'Outcome',
        value: 'approve',
        isRequired: true,
        errorMessage: 'Select an approval outcome.',
        style: 'compact',
        choices: [
          { title: 'Approve', value: 'approve' },
          { title: 'Request changes', value: 'request_changes' },
        ],
      },
      {
        type: 'Input.Text',
        id: 'comment',
        label: 'Comment (required for request changes)',
        isMultiline: true,
        value: prefillText,
      }
    );
  }

  return buildTaskResponse(
    params.actionId === 'approval_response' ? 'Approval quick action' : 'Teams quick action',
    body,
    actions
  );
}

function parseBooleanString(value: string | null): boolean {
  return value !== 'false';
}

function getStringField(activity: TeamsQuickActionActivity, key: string): string | null {
  return normalizeOptionalString(getValueData(activity)[key]);
}

function validateQuickActionSubmit(actionId: QuickActionId, activity: TeamsQuickActionActivity): string | null {
  if (actionId === 'assign_ticket' && !getStringField(activity, 'assigneeId')) {
    return 'Select a technician before submitting this Teams quick action.';
  }

  if (actionId === 'add_note' && !getStringField(activity, 'note')) {
    return 'Enter the note before submitting this Teams quick action.';
  }

  if (actionId === 'reply_to_contact' && !getStringField(activity, 'reply')) {
    return 'Enter the customer reply before submitting this Teams quick action.';
  }

  if (actionId === 'log_time') {
    const duration = Number.parseInt(getStringField(activity, 'durationMinutes') || '', 10);
    if (!Number.isFinite(duration) || duration <= 0) {
      return 'Enter a valid duration in minutes before logging time from Teams.';
    }
  }

  if (actionId === 'approval_response') {
    const outcome = getStringField(activity, 'outcome') || 'approve';
    if (outcome === 'request_changes' && !getStringField(activity, 'comment')) {
      return 'Enter a comment when requesting changes from Teams.';
    }
  }

  return null;
}

async function handleQuickActionSubmit(params: {
  activity: TeamsQuickActionActivity;
  tenantId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
  actionId: QuickActionId;
  target: TeamsActionEntityReference | null;
}): Promise<TeamsQuickActionResponse> {
  if (!params.target) {
    return buildTaskMessageResponse('Select a PSA record before submitting a Teams quick action.');
  }

  const validationMessage = validateQuickActionSubmit(params.actionId, params.activity);
  if (validationMessage) {
    return buildTaskMessageResponse(validationMessage);
  }

  const logTimeTarget =
    params.target.entityType === 'project_task'
      ? { entityType: 'project_task' as const, workItemId: params.target.taskId }
      : params.target.entityType === 'ticket'
        ? { entityType: 'ticket' as const, workItemId: params.target.ticketId }
        : null;

  const payload =
    params.actionId === 'assign_ticket'
      ? {
          assigneeId: getStringField(params.activity, 'assigneeId'),
          note: getStringField(params.activity, 'note') || '',
        }
      : params.actionId === 'add_note'
        ? {
            note: getStringField(params.activity, 'note'),
          }
        : params.actionId === 'reply_to_contact'
          ? {
              reply: getStringField(params.activity, 'reply'),
            }
          : params.actionId === 'log_time' && logTimeTarget
            ? {
                entityType: logTimeTarget.entityType,
                workItemId: logTimeTarget.workItemId,
                startTime: new Date().toISOString(),
                durationMinutes: Number.parseInt(getStringField(params.activity, 'durationMinutes') || '0', 10),
                note: getStringField(params.activity, 'note') || '',
                isBillable: parseBooleanString(getStringField(params.activity, 'isBillable')),
              }
            : {
                outcome: getStringField(params.activity, 'outcome') || 'approve',
                comment: getStringField(params.activity, 'comment') || undefined,
              };

  const result = await executeTeamsAction({
    actionId: params.actionId,
    surface: 'quick_action',
    tenantId: params.tenantId,
    user: params.user,
    target: params.target,
    idempotencyKey: normalizeOptionalString(getStringField(params.activity, 'idempotencyKey')) || undefined,
    input: payload,
  });

  return buildTaskResponseFromTeamsActionResult({
    title:
      params.actionId === 'assign_ticket'
        ? 'Ticket assigned'
        : params.actionId === 'add_note'
          ? 'Note added'
          : params.actionId === 'reply_to_contact'
            ? 'Reply sent'
            : params.actionId === 'log_time'
              ? 'Time logged'
              : 'Approval updated',
    result,
  });
}

export async function handleTeamsQuickActionActivity(
  activity: TeamsQuickActionActivity,
  options: HandleTeamsQuickActionActivityOptions = {}
): Promise<TeamsQuickActionResponse> {
  const tenantContext = await resolveTeamsTenantContext({
    explicitTenantId: options.tenantIdHint || undefined,
    microsoftTenantId: getTeamsTenantId(activity) || undefined,
  });

  if (tenantContext.status !== 'resolved') {
    return buildTaskMessageResponse(tenantContext.message);
  }

  const invokingUser = await resolveInvokingUser({
    activity,
    tenantId: tenantContext.tenantId,
  });
  if (invokingUser.success === false) {
    return buildTaskMessageResponse(invokingUser.message);
  }

  const command = getQuickActionCommand(activity);
  if (command === 'cancel') {
    return buildTaskMessageResponse('The Teams quick action was dismissed without saving changes.');
  }

  const actionId = getActionId(activity);
  if (!actionId) {
    return buildTaskMessageResponse('Select a supported Teams quick action before continuing.');
  }

  const target = getTargetReference(activity);
  if (command === 'fetch') {
    return buildQuickActionFetchResponse({
      activity,
      tenantId: tenantContext.tenantId,
      user: invokingUser.user,
      actionId,
      target,
    });
  }

  return handleQuickActionSubmit({
    activity,
    tenantId: tenantContext.tenantId,
    user: invokingUser.user,
    actionId,
    target,
  });
}

export async function handleTeamsQuickActionRequest(request: Request): Promise<NextResponse> {
  let activity: TeamsQuickActionActivity;
  try {
    activity = (await request.json()) as TeamsQuickActionActivity;
  } catch {
    return NextResponse.json(
      {
        error: 'invalid_json',
        message: 'The Teams quick-action request body must be valid JSON.',
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

  const response = await handleTeamsQuickActionActivity(activity, { tenantIdHint });

  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
