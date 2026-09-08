import type { Knex } from 'knex';
import { observeOrganizationSlaClock } from '@alga-psa/shared/lib/sla/organizationSlaClock';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedNotificationRecipient, withCoManagedSharedWork, type CoManagedNotificationRecipient,
  type CoManagedNotificationRecipientContext, type CoManagedSharedResource } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired,
  type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export interface CoManagedSlaNotification {
  resource: CoManagedSharedResource;
  eventId: string;
  obligationId: string;
  slaType: 'response' | 'resolution';
  notificationType: 'warning' | 'breach';
  thresholdPercent: number;
  dueAt: string | null;
  occurredAt: string;
  elapsedMilliseconds: number;
  targetMinutes: number;
  ticketNumber?: string;
  ticketTitle?: string;
}
export type CoManagedSlaNotificationChannel = 'in_app' | 'email';

async function source(db: Knex, tenant: string, eventId: string, lock = false) {
  const home = tenantDb(db, tenant), query = home.table('sla_organization_notification_events as event')
    .where('event.notification_event_id', eventId);
  home.tenantJoin(query, 'sla_organization_obligations as obligation', 'event.obligation_id', 'obligation.obligation_id');
  if (lock) query.forShare('event', 'obligation');
  return query.first('event.*', 'obligation.source_tenant', 'obligation.ticket_id', 'obligation.work_id', 'obligation.sla_policy_id', 'obligation.clock');
}

/** Threshold recipient roles are MSP-local. Customer assignee and board UUIDs
 * never become MSP directory keys. Snapshot flags and current configuration must
 * both permit a delivery; removal from a role takes effect before a queued send. */
async function recipients(db: Knex, tenant: string, event: any, resource: CoManagedSharedResource, channel: CoManagedSlaNotificationChannel, lock = false): Promise<string[]> {
  const home = tenantDb(db, tenant);
  const configQuery = home.table('sla_notification_thresholds').where({ threshold_id: event.threshold_id,
    sla_policy_id: event.sla_policy_id, threshold_percent: event.threshold_percent });
  if (lock) configQuery.forShare();
  const config = await configQuery.first();
  if (!config || !event.configuration?.channels?.includes(channel) || !(config.channels ?? ['in_app']).includes(channel)) return [];
  const relationship = await tenantDb(db, resource.tenant).table('co_management_relationships').where({ relationship_id: resource.relationshipId,
    sponsor_tenant: tenant, state: 'active' }).whereNull('ended_at').first('sponsor_client_id');
  if (!relationship) return [];
  const referenceQuery = home.table('co_managed_ticket_references').where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
    ticket_id: resource.id, work_id: event.work_id, client_id: relationship.sponsor_client_id });
  if (lock) referenceQuery.forShare();
  const reference = await referenceQuery.first('assigned_to', 'assigned_team_id', 'board_id');
  if (!reference) return [];
  const ids = new Set<string>();
  if (event.configuration.notifyAssignee && config.notify_assignee) {
    if (reference.assigned_to) ids.add(reference.assigned_to);
    if (reference.assigned_team_id) {
      const query = home.table('team_members').where('team_id', reference.assigned_team_id);
      if (lock) query.forShare();
      for (const row of await query.select('user_id')) ids.add(row.user_id);
    }
  }
  if (event.configuration.notifyBoardManager && config.notify_board_manager) {
    const query = home.table('boards').where('board_id', reference.board_id);
    if (lock) query.forShare();
    const board = await query.first('manager_user_id');
    if (board?.manager_user_id) ids.add(board.manager_user_id);
  }
  if (event.configuration.notifyEscalationManager && config.notify_escalation_manager) {
    const query = home.table('escalation_managers').where('board_id', reference.board_id);
    if (lock) query.forShare();
    for (const row of await query.select('manager_user_id')) ids.add(row.manager_user_id);
  }
  return [...ids].sort();
}

/** Rebuild a notice from its durable source while current ticket/recipient locks
 * are held. Interactive inbox reads may retain a historical notice after role
 * reassignment; background sends additionally require current recipient routing. */
export async function withCoManagedSlaNotification<T>(db: Knex, input: CoManagedSessionActor | CoManagedNotificationRecipient,
  eventId: string, channel: CoManagedSlaNotificationChannel,
  consume: (context: CoManagedNotificationRecipientContext, message: CoManagedSlaNotification) => Promise<T>): Promise<T | null> {
  if (!input || ![input.tenant, input.userId, eventId].every(isCoManagedUuid) || !['session', 'notification_recipient'].includes(input.kind) ||
      !['in_app', 'email'].includes(channel)) throw new CoManagedSharedWorkError();
  const actor = input.kind === 'session' ? snapshotCoManagedSessionActor(input) : { kind: 'notification_recipient' as const, tenant: input.tenant, userId: input.userId };
  eventId = eventId.toLowerCase();
  const found = await source(db, actor.tenant, eventId);
  if (!found) return null;
  const work = await tenantDb(db, found.source_tenant).table('co_management_ticket_work').where({ work_id: found.work_id, ticket_id: found.ticket_id }).first('relationship_id');
  if (!work) return null;
  const resource: CoManagedSharedResource = { tenant: found.source_tenant, relationshipId: work.relationship_id, kind: 'ticket', id: found.ticket_id };
  const read = async (context: CoManagedNotificationRecipientContext): Promise<T | null> => {
    const hidden = (names: string[]) => isCoManagedReadFieldHidden(context.redactedFields, names.flatMap(name => [name, `tickets.${name}`]));
    if (hidden(['sla', 'msp_sla', 'sla_organization_obligations', 'sla_organization_notification_events', 'work', 'co_management_ticket_work',
      'clock', 'status', 'status_id', 'statuses', 'priority', 'priority_id', 'first_escalated_at', 'responsibility'])) return null;
    const current = await source(context.trx, actor.tenant, eventId, true);
    if (!current || ['source_tenant', 'ticket_id', 'work_id', 'obligation_id'].some(key => current[key] !== found[key])) return null;
    if (actor.kind === 'notification_recipient') {
      if (!(await recipients(context.trx, actor.tenant, current, resource, channel, true)).includes(actor.userId)) return null;
      // An old warning is no longer useful after the target finishes. A breach
      // remains an outcome worth notifying even when a late response completed it.
      if (current.notification_type === 'warning') {
        const at = (await context.trx.select({ at: context.trx.raw('clock_timestamp()') }).first()).at as Date;
        const clock = at.getTime() >= Date.parse(current.clock.observedAt)
          ? observeOrganizationSlaClock(current.clock, at.toISOString()) : current.clock;
        if (clock[current.sla_type as 'response' | 'resolution'].completedAt || clock[current.sla_type as 'response' | 'resolution'].breached ||
            clock.resolution.completedAt || clock.pauseReasons.length) return null;
      }
    }
    const ticket = await tenantDb(context.trx, resource.tenant).table('tickets').where('ticket_id', resource.id).first('ticket_number', 'title');
    if (!ticket) return null;
    if (actor.kind === 'session') await assertCoManagedSessionUnexpired(context.trx, actor);
    return consume(context, { resource, eventId, obligationId: current.obligation_id, slaType: current.sla_type,
      notificationType: current.notification_type, thresholdPercent: current.threshold_percent,
      dueAt: current.due_at ? new Date(current.due_at).toISOString() : null, occurredAt: new Date(current.occurred_at).toISOString(),
      elapsedMilliseconds: Number(current.elapsed_milliseconds), targetMinutes: Number(current.target_minutes),
      ...(!hidden(['ticket_number']) ? { ticketNumber: ticket.ticket_number } : {}), ...(!hidden(['title']) ? { ticketTitle: ticket.title } : {}) });
  };
  try {
    return actor.kind === 'session' ? await withCoManagedSharedWork(db, actor, resource, 'read', read)
      : await withCoManagedNotificationRecipient(db, actor, resource, read);
  } catch (error) { if (error instanceof CoManagedSharedWorkError) return null; throw error; }
}

export async function fanoutCoManagedSlaNotification(db: Knex, tenant: string, eventId: string,
  consume: (context: CoManagedNotificationRecipientContext, message: CoManagedSlaNotification, channel: CoManagedSlaNotificationChannel) => Promise<void>): Promise<void> {
  if (![tenant, eventId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const event = await source(db, tenant, eventId);
  if (!event) return;
  const work = await tenantDb(db, event.source_tenant).table('co_management_ticket_work').where({ work_id: event.work_id, ticket_id: event.ticket_id }).first('relationship_id');
  if (!work) return;
  const resource: CoManagedSharedResource = { tenant: event.source_tenant, relationshipId: work.relationship_id, kind: 'ticket', id: event.ticket_id };
  const failures: unknown[] = [];
  for (const channel of ['in_app', 'email'] as const) for (const userId of await recipients(db, tenant, event, resource, channel)) {
    try { await withCoManagedSlaNotification(db, { kind: 'notification_recipient', tenant, userId }, eventId, channel,
      (context, message) => consume(context, message, channel)); }
    catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'SLA notification fanout failed; retry retained notices');
}
