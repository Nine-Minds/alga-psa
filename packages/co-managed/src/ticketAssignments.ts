import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, isCoManagedLifecycleError } from '@alga-psa/licensing';
import { withCoManagedCustomerTicket } from './customerWork';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { snapshotCoManagedSessionActor, CoManagedSharedWorkError, isCoManagedUuid, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedAssigneeOption, type CoManagedAssignee, type CoManagedAssigneeOption } from './sharedWorkAssignees';
import { recordCoManagedWorkAudit } from './sharedWorkAudit';

export interface CoManagedTicketAssignee extends CoManagedAssignee {}
export interface CoManagedTicketAssignmentRequest { operationId: string; expectedRevision: number; assignee: CoManagedTicketAssignee | null }
export class CoManagedTicketAssignmentError extends Error {
  constructor(readonly code: 'INVALID_TICKET_ASSIGNMENT' | 'TICKET_ASSIGNMENT_CONFLICT' | 'TICKET_ASSIGNMENT_OPERATION_CONFLICT') { super(code); }
}
const denied = (): never => { throw new CoManagedSharedWorkError(); };
const hidden = (fields: readonly string[]) => isCoManagedReadFieldHidden(fields, ['mspAssignment', 'msp_assignment', 'assignee', 'users', 'teams', 'tenants', 'assignee_name', 'organization_name', 'assigned_to', 'assigned_team_id', 'work', 'work_revision', 'revision', 'co_management_ticket_work', 'co_managed_ticket_references'].flatMap(name => [name, `values.${name}`, `tickets.${name}`]));
const boundary = (actor: CoManagedSessionActor, resource: CoManagedSharedResource) => actor.tenant === resource.tenant ? withCoManagedCustomerTicket : withCoManagedSharedWork;
function snapshot(input: CoManagedSharedResource): CoManagedSharedResource {
  if (!input || input.kind !== 'ticket' || ![input.tenant, input.relationshipId, input.id].every(isCoManagedUuid)) denied();
  return { kind: 'ticket', tenant: input.tenant.toLowerCase(), relationshipId: input.relationshipId.toLowerCase(), id: input.id.toLowerCase() };
}
async function current(context: CoManagedSharedWorkContext, write = false) {
  await assertCoManagedSessionUnexpired(context.trx, { ...context.actor, kind: 'session', sessionId: context.sessionId });
  if (write) await assertCoManagedOperationalWrite(context.trx, context.resource.tenant);
}
async function retainedRouting(context: CoManagedSharedWorkContext) {
  const owner = tenantDb(context.trx, context.resource.tenant), key = { relationship_id: context.resource.relationshipId, ticket_id: context.resource.id };
  const relationship = await owner.table('co_management_relationships').where({ relationship_id: key.relationship_id, state: 'active' }).whereNull('ended_at').forShare().first('sponsor_tenant', 'sponsor_client_id', 'visibility_mode', 'escalation_board_id');
  if (!relationship) denied();
  const workQuery = owner.table('co_management_ticket_work').where(key);
  if (context.action === 'update') workQuery.forUpdate(); else workQuery.forShare();
  const work = await workQuery.first();
  const refQuery = tenantDb(context.trx, relationship.sponsor_tenant).table('co_managed_ticket_references').where({ ...key, customer_tenant: context.resource.tenant });
  if (context.action === 'update') refQuery.forUpdate(); else refQuery.forShare();
  const reference = await refQuery.first();
  if (reference && (!work || reference.work_id !== work.work_id || reference.client_id !== relationship.sponsor_client_id)) denied();
  const ticket = await owner.table('tickets').where('ticket_id', context.resource.id).first('board_id');
  const boardGrant = relationship.visibility_mode === 'board_scope' && ticket
    ? await owner.table('co_management_board_scopes').where({ relationship_id: key.relationship_id, board_id: ticket.board_id }).forShare().first('can_collaborate') : null;
  const canCollaborate = Boolean(work && !work.grant_revoked_at && work.can_collaborate || boardGrant?.can_collaborate);
  return { relationship, work, reference, canCollaborate, boardId: reference?.board_id ?? relationship.escalation_board_id };
}
async function option(context: CoManagedSharedWorkContext, routing: Awaited<ReturnType<typeof retainedRouting>>, assignee: CoManagedTicketAssignee) {
  if (!routing.canCollaborate || routing.work && !routing.reference) denied();
  const board = await tenantDb(context.trx, routing.relationship.sponsor_tenant).table('boards').where({ board_id: routing.boardId, is_inactive: false }).forShare().first('board_id');
  if (!board) denied();
  return coManagedAssigneeOption(context, routing.relationship, assignee, { boardId: routing.boardId, hidden });
}
async function state(context: CoManagedSharedWorkContext, canEdit: boolean) {
  if (hidden(context.redactedFields)) return { resource: context.resource, canEdit: false, canAssign: false };
  const routing = await retainedRouting(context), { reference, work } = routing;
  let mspAssignment: CoManagedAssigneeOption | null = null;
  if (reference?.assigned_to || reference?.assigned_team_id) {
    try { mspAssignment = await option(context, routing, { tenant: routing.relationship.sponsor_tenant, kind: reference.assigned_to ? 'user' : 'team', id: reference.assigned_to ?? reference.assigned_team_id }); }
    catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
  }
  await current(context, canEdit);
  return { resource: context.resource, canEdit: canEdit && (!!reference || !work && routing.canCollaborate), canAssign: canEdit && (!!reference || !work) && routing.canCollaborate,
    revision: work?.revision ?? (routing.canCollaborate ? 0 : undefined), hasAssignment: !!(reference?.assigned_to || reference?.assigned_team_id), mspAssignment };
}
export async function getCoManagedTicketAssignment(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource) {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = snapshot(inputResource), withWork = boundary(actor, resource);
  try { return await withWork(db, actor, resource, 'update', write => withWork(write.trx, actor, resource, 'read', read => state({ ...write, redactedFields: [...write.redactedFields, ...read.redactedFields] }, !hidden(write.redactedFields) && !hidden(read.redactedFields)))); }
  catch (error) {
    if (!(error instanceof CoManagedSharedWorkError) && !isCoManagedLifecycleError(error)) throw error;
    return withWork(db, actor, resource, 'read', read => state(read, false));
  }
}
export async function listCoManagedTicketAssignees(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource, kind: 'user' | 'team', afterId?: string) {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = snapshot(inputResource), withWork = boundary(actor, resource);
  if (!['user', 'team'].includes(kind) || afterId !== undefined && !isCoManagedUuid(afterId)) denied();
  return withWork(db, actor, resource, 'update', write => withWork(write.trx, actor, resource, 'read', async read => {
    if (hidden(write.redactedFields) || hidden(read.redactedFields)) denied();
    const routing = await retainedRouting(write), home = tenantDb(write.trx, routing.relationship.sponsor_tenant);
    if (!routing.canCollaborate || routing.work && !routing.reference) denied();
    const key = kind === 'user' ? 'user_id' : 'team_id', options: CoManagedAssigneeOption[] = []; let scanned = afterId;
    // LEVERAGE: pattern co-managed-assignee-pagination — source scans differ from eligible option pages; keep the candidate boundary shared.
    while (options.length < 26) {
      const query = home.table(kind === 'user' ? 'users' : 'teams').orderBy(key).limit(50);
      if (kind === 'user') query.where({ user_type: 'internal', is_inactive: false });
      if (scanned) query.where(key, '>', scanned);
      const rows = await query.select(key); if (!rows.length) break;
      for (const row of rows) {
        scanned = row[key];
        try { options.push(await option(write, routing, { tenant: routing.relationship.sponsor_tenant, kind, id: row[key] })); }
        catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
        if (options.length === 26) break;
      }
      if (rows.length < 50) break;
    }
    await current(write, true);
    return { options: options.slice(0, 25), nextAfterId: options.length > 25 ? options[24].id : null };
  }));
}
export async function assignCoManagedTicket(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource, input: CoManagedTicketAssignmentRequest) {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = snapshot(inputResource), withWork = boundary(actor, resource);
  const invalid = (): never => { throw new CoManagedTicketAssignmentError('INVALID_TICKET_ASSIGNMENT'); };
  if (!input || !isCoManagedUuid(input.operationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= 2147483647 || Object.keys(input).some(key => !['operationId', 'expectedRevision', 'assignee'].includes(key))) invalid();
  const candidate = input.assignee;
  if (candidate !== null && (!candidate || !['user', 'team'].includes(candidate.kind) || ![candidate.tenant, candidate.id].every(isCoManagedUuid) || Object.keys(candidate).some(key => !['tenant', 'kind', 'id'].includes(key)))) invalid();
  const request = { operationId: input.operationId.toLowerCase(), expectedRevision: input.expectedRevision, assignee: candidate ? { tenant: candidate.tenant.toLowerCase(), kind: candidate.kind, id: candidate.id.toLowerCase() } : null };
  const hash = createHash('sha256').update(JSON.stringify({ actor: { tenant: actor.tenant, userId: actor.userId }, resource, command: 'ticket_assignment', request })).digest('hex');
  try { return await withWork(db, actor, resource, 'update', write => withWork(write.trx, actor, resource, 'read', async read => {
    if (hidden(write.redactedFields) || hidden(read.redactedFields)) denied();
    const owner = tenantDb(write.trx, resource.tenant), previous = await owner.table('co_management_command_receipts').where('operation_id', request.operationId).forShare().first();
    if (previous) {
      if (previous.request_hash !== hash) throw new CoManagedTicketAssignmentError('TICKET_ASSIGNMENT_OPERATION_CONFLICT');
      await current(write, true); return { operationId: request.operationId, appliedAt: new Date(previous.applied_at).toISOString() };
    }
    const routing = await retainedRouting(write), { work, reference } = routing;
    if (work && !reference) invalid();
    if ((work?.revision ?? 0) !== request.expectedRevision) throw new CoManagedTicketAssignmentError('TICKET_ASSIGNMENT_CONFLICT');
    if (!request.assignee && !reference?.assigned_to && !reference?.assigned_team_id) invalid();
    const selected = request.assignee ? await option(write, routing, request.assignee) : null;
    const revision = (work?.revision ?? 0) + 1, referenceId = reference?.reference_id ?? randomUUID();
    const values = { assigned_to: selected?.kind === 'user' ? selected.id : null, assigned_team_id: selected?.kind === 'team' ? selected.id : null, updated_at: write.trx.raw('clock_timestamp()') };
    if (!work) {
      const workId = randomUUID();
      // Board sharing admits participation, not a new permanent ticket grant.
      // No escalation timestamp or handoff is manufactured by assignment.
      await owner.table('co_management_ticket_work').insert({ tenant: resource.tenant, relationship_id: resource.relationshipId, ticket_id: resource.id, work_id: workId,
        revision, responsibility: 'customer', can_collaborate: false, grant_revoked_at: write.trx.raw('clock_timestamp()'), first_escalated_at: null, last_transition_at: null });
      await tenantDb(write.trx, routing.relationship.sponsor_tenant).table('co_managed_ticket_references').insert({ ...values, tenant: routing.relationship.sponsor_tenant,
        reference_id: referenceId, customer_tenant: resource.tenant, relationship_id: resource.relationshipId, ticket_id: resource.id, work_id: workId,
        client_id: routing.relationship.sponsor_client_id, board_id: routing.boardId, created_at: write.trx.raw('clock_timestamp()') });
    } else {
      await tenantDb(write.trx, routing.relationship.sponsor_tenant).table('co_managed_ticket_references').where('reference_id', referenceId).update(values);
      await owner.table('co_management_ticket_work').where({ relationship_id: resource.relationshipId, ticket_id: resource.id }).update({ revision });
    }
    await recordCoManagedWorkAudit(write, { operation: 'co_managed_ticket_assignment', operationId: request.operationId,
      changes: { msp_assignment: selected ? `${selected.organizationName} · ${selected.name}` : null }, details: { assignment_reference_id: referenceId, work_revision: revision, assignee: request.assignee } });
    const [receipt] = await owner.table('co_management_command_receipts').insert({ tenant: resource.tenant, operation_id: request.operationId, relationship_id: resource.relationshipId, resource_type: 'ticket', resource_id: resource.id,
      actor_tenant: actor.tenant, actor_user_id: actor.userId, command_type: 'ticket_assignment', request_hash: hash, applied_at: write.trx.raw('clock_timestamp()') }).returning('applied_at');
    await current(write, true);
    return { operationId: request.operationId, appliedAt: new Date(receipt.applied_at).toISOString() };
  })); } catch (error) {
    if ((error as any)?.code === '23505' && (error as any)?.constraint === 'co_management_command_receipts_pkey') throw new CoManagedTicketAssignmentError('TICKET_ASSIGNMENT_OPERATION_CONFLICT');
    throw error;
  }
}
