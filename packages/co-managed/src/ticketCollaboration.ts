import type { Knex } from 'knex';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { CoManagedLifecycleError, getCoManagedOperationalState } from '@alga-psa/licensing';
import { getCoManagedSharedWorkSummary } from './sharedWorkRead';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { withCoManagedCustomerTicket } from './customerWork';
import { hasCoManagedLocalPermission } from './localPermission';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired,
  lockCoManagedSessionIdentity, type CoManagedSessionActor } from './sharedWorkIdentity';
import { lockCoManagedCustomerPolicy } from './policy';

function ticketOnly(resource: CoManagedSharedResource): void {
  if (!resource || resource.kind !== 'ticket') throw new CoManagedSharedWorkError();
}
function readTicket<T>(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource,
  command: (context: CoManagedSharedWorkContext) => Promise<T>) {
  ticketOnly(resource);
  return actor?.tenant === resource.tenant ? withCoManagedCustomerTicket(db, actor, resource, 'read', command)
    : withCoManagedSharedWork(db, actor, resource, 'read', command);
}
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : value;

/** UI capability hints use the actual command authority and never replace the
 * command's own admission. All reads stay in the authenticated home context. */
export async function getCoManagedTicketScreen(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource) {
  const actor = snapshotCoManagedSessionActor(inputActor);
  ticketOnly(inputResource);
  return withTransaction(db, async trx => {
    const summary = await getCoManagedSharedWorkSummary(trx, actor, inputResource);
    const resource = summary.resource, customer = tenantDb(trx, resource.tenant);
    const relationship = await customer.table('co_management_relationships').where('relationship_id', resource.relationshipId).first();
    const sponsor = tenantDb(trx, relationship.sponsor_tenant);
    const side = actor.tenant === resource.tenant ? 'customer' as const : 'sponsor' as const;
    const customerName = (await customer.table('tenants').first('client_name')).client_name as string;
    const sponsorName = (await sponsor.table('tenants').first('client_name')).client_name as string;
    const destination = await sponsor.table('boards').where({ board_id: relationship.escalation_board_id, is_inactive: false }).first('board_name');
    let canWrite = (await getCoManagedOperationalState(trx, resource.tenant)).canWrite;
    let canUpdate = false;
    if (canWrite) try {
      const allow = async () => true;
      canUpdate = side === 'customer' ? await withCoManagedCustomerTicket(trx, actor, resource, 'update', allow)
        : await withCoManagedSharedWork(trx, actor, resource, 'update', allow);
    } catch (error) {
      if (error instanceof CoManagedLifecycleError) canWrite = false;
      else if (!(error instanceof CoManagedSharedWorkError)) throw error;
    }
    const workRevisionVisible = typeof summary.fields.work_revision === 'number';
    const canManage = side === 'customer' && await hasCoManagedLocalPermission(trx, actor, 'co_management', 'manage', true);
    await assertCoManagedSessionUnexpired(trx, actor);
    return { summary, side, customerName, sponsorName, destinationName: ('board' in summary.fields ? destination?.board_name : undefined) as string | undefined, canWrite,
      canEscalate: side === 'customer' && canUpdate && workRevisionVisible && summary.fields.responsibility === 'customer' && Boolean(destination),
      canHandBack: canUpdate && workRevisionVisible && summary.fields.responsibility === 'msp',
      canRevoke: canManage && workRevisionVisible && summary.fields.explicit_grant_active === true };
  });
}

export interface CoManagedHandoffHistoryItem {
  operationId: string;
  revision: number;
  transition: 'escalated' | 'handed_back' | 'access_revoked';
  occurredAt: string;
  note?: string;
  author?: { tenant: string; userId: string; name: string; organization: string };
}
/** This reader admits only the explicitly shared IT handoff journal. It does
 * not union legacy comments, requester replies, or organization-private notes. */
export async function getCoManagedTicketHandoffHistory(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource,
  beforeRevision?: number): Promise<{ items: CoManagedHandoffHistoryItem[]; nextBeforeRevision: number | null }> {
  if (beforeRevision !== undefined && (!Number.isSafeInteger(beforeRevision) || beforeRevision < 1)) throw new CoManagedSharedWorkError();
  return readTicket(db, actor, resource, async context => {
    const hidden = (names: string[]) => isCoManagedReadFieldHidden(context.redactedFields,
      names.flatMap(name => [name, `co_management_ticket_handoffs.${name}`, `tickets.${name}`]));
    if (hidden(['history', 'handoffs', 'comments', 'notes', 'co_management_ticket_handoffs', 'work', 'co_management_ticket_work',
      'operationId', 'operation_id', 'revision', 'work_revision', 'transition', 'occurredAt', 'occurred_at'])) return { items: [], nextBeforeRevision: null };
    const query = tenantDb(context.trx, context.resource.tenant).table('co_management_ticket_handoffs')
      .where({ relationship_id: context.resource.relationshipId, ticket_id: context.resource.id, audience: 'shared_it' })
      .orderBy('revision', 'desc').limit(26);
    if (beforeRevision !== undefined) query.where('revision', '<', beforeRevision);
    const rows = await query.select('operation_id', 'revision', 'transition', 'occurred_at', 'note',
      'actor_tenant', 'actor_user_id', 'actor_name', 'actor_organization');
    const items = rows.slice(0, 25).map(row => ({ operationId: row.operation_id, revision: row.revision,
      transition: row.transition, occurredAt: iso(row.occurred_at),
      ...(!hidden(['note', 'notes', 'comments', 'description']) ? { note: row.note } : {}),
      ...(!hidden(['actor', 'author', 'actor_tenant', 'actor_user_id', 'actor_name', 'actor_organization']) ? {
        author: { tenant: row.actor_tenant, userId: row.actor_user_id, name: row.actor_name, organization: row.actor_organization },
      } : {}),
    }));
    await assertCoManagedSessionUnexpired(context.trx, { ...context.actor, kind: 'session', sessionId: context.sessionId });
    return { items, nextBeforeRevision: rows.length > 25 ? items.at(-1)!.revision : null };
  });
}

/** Scope administrators can inventory their own explicit grants. Ticket labels
 * remain subject to ticket read permission/redaction; otherwise only the grant's
 * qualified identity is returned. Pagination counts grants, not private tickets. */
export async function getCoManagedExplicitTicketGrants(db: Knex, inputActor: CoManagedSessionActor, afterTicketId?: string) {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (afterTicketId !== undefined && !isCoManagedUuid(afterTicketId)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    const customer = tenantDb(trx, actor.tenant);
    const found = await customer.table('co_management_relationships').where({ state: 'active' }).whereNull('ended_at').first('relationship_id');
    if (!found) throw new CoManagedSharedWorkError();
    await lockCoManagedCustomerPolicy(trx, actor, { customerTenant: actor.tenant, relationshipId: found.relationship_id });
    await lockCoManagedSessionIdentity(trx, actor);
    if ((await customer.table('tenants').first('suspended_at'))?.suspended_at) throw new CoManagedSharedWorkError();
    const query = customer.table('co_management_ticket_work').where('relationship_id', found.relationship_id).whereNull('grant_revoked_at')
      .orderBy('ticket_id').limit(26);
    if (afterTicketId !== undefined) query.where('ticket_id', '>', afterTicketId);
    const rows = await query.select('ticket_id', 'revision');
    const items: Array<{ resource: CoManagedSharedResource; revision: number; ticketNumber?: string; title?: string }> = [];
    for (const row of rows.slice(0, 25)) {
      const resource: CoManagedSharedResource = { tenant: actor.tenant, relationshipId: found.relationship_id, kind: 'ticket', id: row.ticket_id };
      let fields: Record<string, unknown> = {};
      try { fields = (await getCoManagedSharedWorkSummary(trx, actor, resource)).fields; }
      catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
      items.push({ resource, revision: row.revision,
        ...(typeof fields.ticket_number === 'string' ? { ticketNumber: fields.ticket_number } : {}),
        ...(typeof fields.title === 'string' ? { title: fields.title } : {}) });
    }
    await assertCoManagedSessionUnexpired(trx, actor);
    return { items, nextAfterTicketId: rows.length > 25 ? items.at(-1)!.resource.id : null };
  });
}
