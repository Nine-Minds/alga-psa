/**
 * Transactional, provider-generic ticket creation for RMM alerts. Adapted from
 * the Huntress incident creator (which verified the live tickets schema):
 * tickets have no description/source_reference columns — the body and
 * provenance live in the attributes JSONB — and entered_at is the creation
 * timestamp.
 */

import type { Knex } from 'knex';
import type {
  NormalizedRmmAlertEvent,
  NormalizedRmmAlertSeverity,
  RmmAlertRuleActions,
} from './contracts';

export interface CreateAlertTicketParams {
  event: NormalizedRmmAlertEvent;
  actions: RmmAlertRuleActions;
  clientId: string;
  assetId?: string | null;
  organizationName?: string | null;
}

export interface CreatedAlertTicket {
  ticket_id: string;
  ticket_number: string;
}

export async function createTicketForAlert(
  trx: Knex.Transaction,
  params: CreateAlertTicketParams
): Promise<CreatedAlertTicket> {
  const { event, actions } = params;
  const tenantId = event.tenantId;

  const boardId = await resolveBoardId(trx, tenantId, actions.boardId);
  if (!boardId) {
    throw new Error('No board available for alert ticket (no rule boardId and no default board)');
  }

  const defaultStatus = await trx('statuses')
    .where({ tenant: tenantId, item_type: 'ticket', is_default: true })
    .first('status_id');
  if (!defaultStatus) {
    throw new Error('No default ticket status configured for tenant');
  }

  const priorityId = actions.priorityOverride ?? (await resolvePriorityForSeverity(trx, tenantId, event.severity));

  const title = renderTemplate(actions.ticketTemplate?.titleTemplate, params) ?? defaultTitle(event);
  const description = renderTemplate(actions.ticketTemplate?.descriptionTemplate, params) ?? defaultDescription(event);

  const ticketNumber = await generateTicketNumber(trx, tenantId);
  const now = new Date().toISOString();

  const [ticket] = await trx('tickets')
    .insert({
      tenant: tenantId,
      ticket_number: ticketNumber,
      title,
      client_id: params.clientId,
      status_id: defaultStatus.status_id,
      priority_id: priorityId ?? null,
      board_id: boardId,
      assigned_to: actions.assignToUserId ?? null,
      attributes: JSON.stringify({
        description,
        source_reference: event.externalAlertId,
      }),
      source: event.provider,
      entered_at: now,
      updated_at: now,
    })
    .returning(['ticket_id', 'ticket_number']);

  if (params.assetId) {
    await associateAsset(trx, tenantId, params.assetId, ticket.ticket_id, now);
  }

  await addAlertInternalNote(trx, tenantId, ticket.ticket_id, initialNote(event));

  return ticket as CreatedAlertTicket;
}

/** System-authored internal note (comment_threads row first; thread_id is NOT NULL). */
export async function addAlertInternalNote(
  trx: Knex.Transaction,
  tenantId: string,
  ticketId: string,
  note: string
): Promise<void> {
  const now = new Date().toISOString();
  const generated = await trx.raw('SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id');
  const ids = generated.rows?.[0] as { comment_id: string; thread_id: string } | undefined;
  if (!ids?.comment_id || !ids?.thread_id) {
    throw new Error('Failed to generate comment/thread identifiers');
  }

  await trx('comment_threads').insert({
    tenant: tenantId,
    thread_id: ids.thread_id,
    ticket_id: ticketId,
    project_task_id: null,
    root_comment_id: ids.comment_id,
    is_internal: true,
    reply_count: 0,
    last_activity_at: now,
    created_at: now,
    created_by: null,
  });

  await trx('comments').insert({
    tenant: tenantId,
    comment_id: ids.comment_id,
    thread_id: ids.thread_id,
    ticket_id: ticketId,
    user_id: null,
    note,
    is_internal: true,
    is_resolution: false,
    is_system_generated: true,
    created_at: now,
  });
}

async function associateAsset(
  trx: Knex.Transaction,
  tenantId: string,
  assetId: string,
  ticketId: string,
  now: string
): Promise<void> {
  // asset_associations.created_by is NOT NULL with an FK to users; attribute
  // system-created links to the tenant's earliest user (Huntress convention).
  const auditUser = await trx('users').where({ tenant: tenantId }).orderBy('created_at', 'asc').first('user_id');
  if (!auditUser) return;
  await trx('asset_associations').insert({
    tenant: tenantId,
    asset_id: assetId,
    entity_id: ticketId,
    entity_type: 'ticket',
    relationship_type: 'related',
    created_by: auditUser.user_id,
    created_at: now,
  });
}

async function resolveBoardId(
  trx: Knex.Transaction,
  tenantId: string,
  ruleBoardId?: string
): Promise<string | null> {
  if (ruleBoardId) return ruleBoardId;
  const defaultBoard = await trx('boards')
    .where({ tenant: tenantId, is_default: true })
    .andWhere((qb) => qb.where('is_inactive', false).orWhereNull('is_inactive'))
    .first('board_id');
  return defaultBoard?.board_id ?? null;
}

const SEVERITY_PRIORITY_NAMES: Record<NormalizedRmmAlertSeverity, string[]> = {
  critical: ['urgent', 'critical'],
  major: ['high'],
  moderate: ['medium', 'normal'],
  minor: ['low'],
  none: ['low'],
};

async function resolvePriorityForSeverity(
  trx: Knex.Transaction,
  tenantId: string,
  severity: NormalizedRmmAlertSeverity
): Promise<string | null> {
  const candidates = SEVERITY_PRIORITY_NAMES[severity] ?? [];
  for (const name of candidates) {
    const priority = await trx('priorities')
      .where({ tenant: tenantId })
      .whereRaw('LOWER(priority_name) = ?', [name])
      .first('priority_id');
    if (priority) return priority.priority_id;
  }
  return null;
}

const TEMPLATE_PLACEHOLDERS: Record<string, (params: CreateAlertTicketParams) => string> = {
  device: ({ event }) => event.deviceName ?? event.externalDeviceId ?? 'Unknown device',
  message: ({ event }) => event.message ?? '',
  severity: ({ event }) => event.severity,
  organization: ({ organizationName, event }) => organizationName ?? event.externalOrganizationId ?? '',
};

function renderTemplate(template: string | undefined, params: CreateAlertTicketParams): string | null {
  if (!template) return null;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const resolve = TEMPLATE_PLACEHOLDERS[key.toLowerCase()];
    return resolve ? resolve(params) : match;
  });
}

function defaultTitle(event: NormalizedRmmAlertEvent): string {
  const condition = event.alertClass ?? event.activityType ?? 'Alert';
  const device = event.deviceName ?? event.externalDeviceId ?? 'unknown device';
  const suffix = event.message && event.message.length < 60 ? `: ${event.message}` : '';
  return `[${providerLabel(event.provider)} Alert] ${condition} on ${device}${suffix}`;
}

function defaultDescription(event: NormalizedRmmAlertEvent): string {
  return [
    `Alert from ${providerLabel(event.provider)}.`,
    '',
    `Severity: ${event.severity}`,
    `Device: ${event.deviceName ?? event.externalDeviceId ?? 'unknown'}`,
    event.activityType ? `Activity type: ${event.activityType}` : null,
    event.alertClass ? `Alert class: ${event.alertClass}` : null,
    `Triggered at: ${event.occurredAt}`,
    '',
    event.message ?? '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function initialNote(event: NormalizedRmmAlertEvent): string {
  return [
    `Ticket created automatically from a ${providerLabel(event.provider)} alert.`,
    `External alert ID: ${event.externalAlertId}`,
    event.externalDeviceId ? `External device ID: ${event.externalDeviceId}` : null,
    `Severity: ${event.severity}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

const PROVIDER_LABELS: Record<string, string> = {
  ninjaone: 'NinjaOne',
  tacticalrmm: 'Tactical RMM',
  levelio: 'Level',
  huntress: 'Huntress',
  tanium: 'Tanium',
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** Max ticket_number + 1 with the tenant's configured prefix (Huntress/NinjaOne pattern). */
async function generateTicketNumber(trx: Knex.Transaction, tenantId: string): Promise<string> {
  const result = await trx('tickets').where({ tenant: tenantId }).max('ticket_number as max_number').first();

  let nextNumber = 1;
  if (result?.max_number) {
    const match = String(result.max_number).match(/(\d+)$/);
    if (match) nextNumber = parseInt(match[1], 10) + 1;
  }

  const settingsRow = await trx('tenant_settings').where({ tenant: tenantId }).first();
  const prefix = settingsRow?.settings?.ticket_number_prefix || 'TKT-';

  return `${prefix}${String(nextNumber).padStart(6, '0')}`;
}
