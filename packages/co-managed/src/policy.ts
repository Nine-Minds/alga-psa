import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { hasCoManagedLocalPermission } from './localPermission';
import { getCoManagedOperationalState, CoManagedLifecycleError } from '@alga-psa/licensing/lifecycle';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { retainCoManagedSharedConversationBeforeReduction } from './conversationParticipationEvidence';
import { resolveSlaPolicy } from '@alga-psa/shared/lib/sla/slaPolicyResolver';

/** Authentication adapters supply the live home identity, never request fields. */
export interface CoManagedHomeActor { tenant: string; userId: string }
export interface CoManagedPolicyTarget { customerTenant: string; relationshipId: string }
export interface CoManagedResourceGrant { id: string; canCollaborate: boolean }
export interface CoManagedCustomerScope {
  visibilityMode: 'board_scope' | 'escalation_only';
  boards: CoManagedResourceGrant[];
  projects: CoManagedResourceGrant[];
}
export interface CoManagedStaffAssignment {
  kind: 'user' | 'team'; principalId: string; role: 'viewer' | 'technician';
}
export interface CoManagedSlaPriorityMapping { customerPriorityId: string; mspPriorityId: string }
export interface CoManagedCollaborationPolicy extends CoManagedCustomerScope {
  revision: number;
  assignments: CoManagedStaffAssignment[];
}
export class CoManagedPolicyError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'INVALID_POLICY' | 'POLICY_CHANGED' | 'RESOURCE_NOT_FOUND') {
    super({ FORBIDDEN: 'This co-management policy is not available to this actor.',
      INVALID_POLICY: 'Provide a valid co-management policy.', POLICY_CHANGED: 'The policy changed. Refresh it before saving.',
      RESOURCE_NOT_FOUND: 'A selected resource or principal is not available in its owning workspace.',
    }[code]);
    this.name = 'CoManagedPolicyError';
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** No cached roles or caller-provided user type; retain current permission rows. */
async function requirePolicyAdministrator(trx: Knex.Transaction, actor: CoManagedHomeActor): Promise<void> {
  if (!await hasCoManagedLocalPermission(trx, actor, 'co_management', 'manage', true)) throw new CoManagedPolicyError('FORBIDDEN');
}

async function lockPolicy(trx: Knex.Transaction, actor: CoManagedHomeActor, target: CoManagedPolicyTarget, write = true) {
  if (![actor.tenant, actor.userId, target.customerTenant, target.relationshipId].every(id => uuid.test(id))) {
    throw new CoManagedPolicyError('INVALID_POLICY');
  }
  const customer = tenantDb(trx, target.customerTenant);
  const found = await customer.table('co_management_relationships').where('relationship_id', target.relationshipId).first();
  if (!found || (actor.tenant !== target.customerTenant && actor.tenant !== found.sponsor_tenant)) throw new CoManagedPolicyError('FORBIDDEN');
  // Preserve entitlement -> sponsor -> relationship -> customer lock order.
  // A pause can still permit a narrowly checked reduction in existing access.
  const lifecycle = await getCoManagedOperationalState(trx, target.customerTenant);
  const query = customer.table('co_management_relationships').where('relationship_id', target.relationshipId);
  if (write) query.forUpdate(); else query.forShare();
  const relationship = await query.first();
  const owner = await customer.table('tenants').first('product_code');
  if (!relationship || relationship.state !== 'active' || relationship.ended_at ||
      relationship.sponsor_tenant !== found.sponsor_tenant || owner?.product_code !== 'co_managed') throw new CoManagedPolicyError('FORBIDDEN');
  if (actor.tenant === relationship.sponsor_tenant) {
    const home = await tenantDb(trx, actor.tenant).table('tenants').first('product_code');
    if (home?.product_code !== 'psa') throw new CoManagedPolicyError('FORBIDDEN');
  }
  await requirePolicyAdministrator(trx, actor);
  return { customer, relationship, lifecycle };
}

/** Shared customer-administration boundary for scope changes and object-grant
 * revocation. It admits security reductions during a license pause, so callers
 * must independently reject any expansion when lifecycle.canWrite is false. */
export async function lockCoManagedCustomerPolicy(trx: Knex.Transaction, actor: CoManagedHomeActor, target: CoManagedPolicyTarget) {
  if (!trx.isTransaction || actor.tenant !== target.customerTenant) throw new CoManagedPolicyError('FORBIDDEN');
  return lockPolicy(trx, actor, target);
}

async function readCustomerScope(trx: Knex.Transaction, target: CoManagedPolicyTarget, visibilityMode: CoManagedCustomerScope['visibilityMode']): Promise<CoManagedCustomerScope> {
  const customer = tenantDb(trx, target.customerTenant);
  const boards = await customer.table('co_management_board_scopes').where('relationship_id', target.relationshipId).orderBy('board_id');
  const projects = await customer.table('co_management_project_scopes').where('relationship_id', target.relationshipId).orderBy('project_id');
  return { visibilityMode, boards: boards.map(row => ({ id: row.board_id, canCollaborate: row.can_collaborate })),
    projects: projects.map(row => ({ id: row.project_id, canCollaborate: row.can_collaborate })) };
}
async function readAssignments(trx: Knex.Transaction, sponsorTenant: string, target: CoManagedPolicyTarget): Promise<CoManagedStaffAssignment[]> {
  const rows = await tenantDb(trx, sponsorTenant).table('co_management_staff_assignments')
    .where({ customer_tenant: target.customerTenant, relationship_id: target.relationshipId }).orderBy('principal_type').orderBy('principal_id');
  return rows.map(row => ({ kind: row.principal_type, principalId: row.principal_id, role: row.relationship_role }));
}
function normalizeGrants(grants: CoManagedResourceGrant[]): CoManagedResourceGrant[] {
  if (!Array.isArray(grants) || grants.some(grant => !grant || !uuid.test(grant.id) || typeof grant.canCollaborate !== 'boolean') ||
      new Set(grants.map(grant => grant.id.toLowerCase())).size !== grants.length) throw new CoManagedPolicyError('INVALID_POLICY');
  return grants.map(grant => ({ id: grant.id.toLowerCase(), canCollaborate: grant.canCollaborate })).sort((a, b) => a.id.localeCompare(b.id));
}
function grantsReduce(next: CoManagedResourceGrant[], previous: CoManagedResourceGrant[]): boolean {
  return next.every(grant => previous.some(old => old.id === grant.id && (!grant.canCollaborate || old.canCollaborate)));
}
async function isReplay(trx: Knex.Transaction, actor: CoManagedHomeActor, target: CoManagedPolicyTarget,
  revision: number, current: number, eventType: string, desired: unknown): Promise<boolean> {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new CoManagedPolicyError('INVALID_POLICY');
  if (current === revision) return false;
  if (current === revision + 1 && await tenantDb(trx, target.customerTenant).table('co_management_relationship_events').where({
    relationship_id: target.relationshipId, revision: current, actor_tenant: actor.tenant, actor_user_id: actor.userId,
    event_type: eventType, scope_fingerprint: hash(desired),
  }).first('event_id')) return true;
  throw new CoManagedPolicyError('POLICY_CHANGED');
}
async function recordPolicyChange(trx: Knex.Transaction, actor: CoManagedHomeActor, target: CoManagedPolicyTarget,
  revision: number, eventType: string, scope: unknown, eventId = randomUUID()): Promise<number> {
  const customer = tenantDb(trx, target.customerTenant);
  await customer.table('co_management_relationships').where('relationship_id', target.relationshipId)
    .update({ revision: revision + 1, updated_at: trx.fn.now() });
  await customer.table('co_management_relationship_events').insert({ tenant: target.customerTenant, event_id: eventId,
    relationship_id: target.relationshipId, actor_tenant: actor.tenant, actor_user_id: actor.userId,
    event_type: eventType, revision: revision + 1, scope, scope_fingerprint: hash(scope) });
  return revision + 1;
}

export async function getCoManagedCollaborationPolicy(db: Knex, actor: CoManagedHomeActor, target: CoManagedPolicyTarget): Promise<CoManagedCollaborationPolicy> {
  return withTransaction(db, async trx => {
    const { relationship } = await lockPolicy(trx, actor, target, false);
    return { ...await readCustomerScope(trx, target, relationship.visibility_mode), revision: relationship.revision,
      assignments: await readAssignments(trx, relationship.sponsor_tenant, target) };
  });
}

export async function replaceCoManagedCustomerScope(db: Knex, actor: CoManagedHomeActor, target: CoManagedPolicyTarget,
  expectedRevision: number, scope: CoManagedCustomerScope): Promise<number> {
  if (actor.tenant !== target.customerTenant) throw new CoManagedPolicyError('FORBIDDEN');
  if (!scope || !['board_scope', 'escalation_only'].includes(scope.visibilityMode)) throw new CoManagedPolicyError('INVALID_POLICY');
  const desired: CoManagedCustomerScope = { visibilityMode: scope.visibilityMode, boards: normalizeGrants(scope.boards), projects: normalizeGrants(scope.projects) };
  if (desired.visibilityMode === 'escalation_only' && desired.boards.length) throw new CoManagedPolicyError('INVALID_POLICY');
  return withTransaction(db, async trx => {
    const { customer, relationship, lifecycle } = await lockCoManagedCustomerPolicy(trx, actor, target);
    if (await isReplay(trx, actor, target, expectedRevision, relationship.revision, 'customer_scope_changed', desired)) return relationship.revision;
    const previous = await readCustomerScope(trx, target, relationship.visibility_mode);
    if (hash(previous) === hash(desired)) return relationship.revision;
    const reduction = (desired.visibilityMode === previous.visibilityMode || desired.visibilityMode === 'escalation_only') &&
      grantsReduce(desired.boards, previous.boards) && grantsReduce(desired.projects, previous.projects);
    if (!lifecycle.canWrite && !reduction) throw new CoManagedLifecycleError(lifecycle);
    for (const [table, idColumn, grants] of [['boards', 'board_id', desired.boards], ['projects', 'project_id', desired.projects]] as const) {
      const rows = await customer.table(table).whereIn(idColumn, grants.map(grant => grant.id)).forShare().select(idColumn);
      if (rows.length !== grants.length) throw new CoManagedPolicyError('RESOURCE_NOT_FOUND');
    }
    const removedBoards = previous.visibilityMode === 'board_scope' ? previous.boards.filter(old =>
      desired.visibilityMode !== 'board_scope' || !desired.boards.some(next => next.id === old.id)).map(grant => grant.id) : [];
    const removedProjects = previous.projects.filter(old => !desired.projects.some(next => next.id === old.id)).map(grant => grant.id);
    const captureOperationId = randomUUID();
    if (removedBoards.length) {
      const tickets = await customer.table('tickets').whereIn('board_id', removedBoards).orderBy('ticket_id').select('ticket_id');
      for (const ticket of tickets) await retainCoManagedSharedConversationBeforeReduction(trx,
        { tenant: target.customerTenant, relationshipId: target.relationshipId, kind: 'ticket', id: ticket.ticket_id }, captureOperationId);
    }
    if (removedProjects.length) {
      const tasks = customer.table('project_tasks as task');
      customer.tenantJoin(tasks, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
      for (const task of await tasks.whereIn('phase.project_id', removedProjects).orderBy('task.task_id').select('task.task_id')) {
        await retainCoManagedSharedConversationBeforeReduction(trx,
          { tenant: target.customerTenant, relationshipId: target.relationshipId, kind: 'project_task', id: task.task_id }, captureOperationId);
      }
    }
    await customer.table('co_management_relationships').where('relationship_id', target.relationshipId).update({ visibility_mode: desired.visibilityMode });
    for (const [table, idColumn, grants] of [['co_management_board_scopes', 'board_id', desired.boards], ['co_management_project_scopes', 'project_id', desired.projects]] as const) {
      await customer.table(table).where('relationship_id', target.relationshipId).del();
      if (grants.length) await customer.table(table).insert(grants.map(grant => ({ tenant: target.customerTenant,
        relationship_id: target.relationshipId, [idColumn]: grant.id, can_collaborate: grant.canCollaborate })));
    }
    return recordPolicyChange(trx, actor, target, relationship.revision, 'customer_scope_changed', desired, captureOperationId);
  });
}

export async function replaceCoManagedStaffAssignments(db: Knex, actor: CoManagedHomeActor, target: CoManagedPolicyTarget,
  expectedRevision: number, assignments: CoManagedStaffAssignment[]): Promise<number> {
  if (!Array.isArray(assignments) || assignments.some(item => !item || !['user', 'team'].includes(item.kind) ||
      !uuid.test(item.principalId) || !['viewer', 'technician'].includes(item.role))) throw new CoManagedPolicyError('INVALID_POLICY');
  const desired = assignments.map(item => ({ kind: item.kind, principalId: item.principalId.toLowerCase(), role: item.role }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.principalId.localeCompare(b.principalId));
  if (new Set(desired.map(item => `${item.kind}:${item.principalId}`)).size !== desired.length) throw new CoManagedPolicyError('INVALID_POLICY');
  return withTransaction(db, async trx => {
    const { relationship, lifecycle } = await lockPolicy(trx, actor, target);
    if (actor.tenant !== relationship.sponsor_tenant) throw new CoManagedPolicyError('FORBIDDEN');
    if (await isReplay(trx, actor, target, expectedRevision, relationship.revision, 'staff_assignments_changed', { assignments: desired })) return relationship.revision;
    const previous = await readAssignments(trx, actor.tenant, target);
    if (hash(previous) === hash(desired)) return relationship.revision;
    const reduction = desired.every(item => previous.some(old => old.kind === item.kind && old.principalId === item.principalId &&
      (item.role === 'viewer' || old.role === 'technician')));
    if (!lifecycle.canWrite && !reduction) throw new CoManagedLifecycleError(lifecycle);
    const home = tenantDb(trx, actor.tenant);
    for (const kind of ['user', 'team'] as const) {
      const ids = desired.filter(item => item.kind === kind).map(item => item.principalId);
      const query = home.table(kind === 'user' ? 'users' : 'teams').whereIn(kind === 'user' ? 'user_id' : 'team_id', ids);
      if (kind === 'user' && !reduction) query.where({ user_type: 'internal', is_inactive: false });
      const rows = await query.forShare();
      if (rows.length !== ids.length) throw new CoManagedPolicyError('RESOURCE_NOT_FOUND');
    }
    await home.table('co_management_staff_assignments').where({ customer_tenant: target.customerTenant, relationship_id: target.relationshipId }).del();
    if (desired.length) await home.table('co_management_staff_assignments').insert(desired.map(item => ({ tenant: actor.tenant,
      customer_tenant: target.customerTenant, relationship_id: target.relationshipId, principal_type: item.kind,
      principal_id: item.principalId, relationship_role: item.role })));
    return recordPolicyChange(trx, actor, target, relationship.revision, 'staff_assignments_changed', { assignments: desired });
  });
}

async function assertSlaPolicyTenantsAvailable(trx: Knex.Transaction, sponsorTenant: string, customerTenant: string) {
  for (const tenant of [sponsorTenant, customerTenant]) {
    const owner = await tenantDb(trx, tenant).table('tenants').forShare().first('suspended_at');
    if (!owner || owner.suspended_at) throw new CoManagedPolicyError('FORBIDDEN');
  }
}

/** MSP configuration requires the real tracked administrator session. Customer
 * priorities here are routing reference values, not access to customer tickets. */
export async function getCoManagedSlaPriorityMappings(db: Knex, inputActor: CoManagedSessionActor, inputTarget: CoManagedPolicyTarget) {
  const actor = snapshotCoManagedSessionActor(inputActor), target = structuredClone(inputTarget);
  return withTransaction(db, async trx => {
    const { customer, relationship, lifecycle } = await lockPolicy(trx, actor, target, false);
    if (actor.tenant !== relationship.sponsor_tenant) throw new CoManagedPolicyError('FORBIDDEN');
    await assertSlaPolicyTenantsAvailable(trx, actor.tenant, target.customerTenant);
    await lockCoManagedSessionIdentity(trx, actor);
    const home = tenantDb(trx, actor.tenant);
    const rows = await home.table('co_managed_sla_priority_mappings').where({ customer_tenant: target.customerTenant, relationship_id: target.relationshipId })
      .orderBy('customer_priority_id');
    const customerPriorities = await customer.table('priorities').where('item_type', 'ticket').orderBy('order_number').select('priority_id', 'priority_name');
    const mspPriorities = await home.table('priorities').where('item_type', 'ticket').orderBy('order_number').select('priority_id', 'priority_name');
    const policy = await resolveSlaPolicy(trx, actor.tenant, relationship.sponsor_client_id, relationship.escalation_board_id);
    await assertCoManagedSessionUnexpired(trx, actor);
    return { revision: relationship.revision as number, canWrite: lifecycle.canWrite, customerPriorities, mspPriorities,
      policyName: policy?.policy_name ?? null,
      mappings: rows.map(row => ({ customerPriorityId: row.customer_priority_id, mspPriorityId: row.msp_priority_id })) as CoManagedSlaPriorityMapping[] };
  });
}

export async function replaceCoManagedSlaPriorityMappings(db: Knex, inputActor: CoManagedSessionActor, inputTarget: CoManagedPolicyTarget,
  expectedRevision: number, input: CoManagedSlaPriorityMapping[]): Promise<number> {
  const actor = snapshotCoManagedSessionActor(inputActor), target = structuredClone(inputTarget);
  if (!Array.isArray(input) || input.length > 1000 || input.some(row => !row || !uuid.test(row.customerPriorityId) || !uuid.test(row.mspPriorityId))) {
    throw new CoManagedPolicyError('INVALID_POLICY');
  }
  const desired = input.map(row => ({ customerPriorityId: row.customerPriorityId.toLowerCase(), mspPriorityId: row.mspPriorityId.toLowerCase() }))
    .sort((a, b) => a.customerPriorityId.localeCompare(b.customerPriorityId));
  if (new Set(desired.map(row => row.customerPriorityId)).size !== desired.length) throw new CoManagedPolicyError('INVALID_POLICY');
  return withTransaction(db, async trx => {
    const { customer, relationship, lifecycle } = await lockPolicy(trx, actor, target);
    if (actor.tenant !== relationship.sponsor_tenant) throw new CoManagedPolicyError('FORBIDDEN');
    await assertSlaPolicyTenantsAvailable(trx, actor.tenant, target.customerTenant);
    await lockCoManagedSessionIdentity(trx, actor);
    if (!lifecycle.canWrite) throw new CoManagedLifecycleError(lifecycle);
    const home = tenantDb(trx, actor.tenant), key = { customer_tenant: target.customerTenant, relationship_id: target.relationshipId };
    const replay = await isReplay(trx, actor, target, expectedRevision, relationship.revision, 'sla_priority_mappings_changed', { mappings: desired });
    if (!replay) {
      for (const [owner, ids] of [[customer, desired.map(row => row.customerPriorityId)], [home, [...new Set(desired.map(row => row.mspPriorityId))]]] as const) {
        const rows = await owner.table('priorities').where({ item_type: 'ticket' }).whereIn('priority_id', ids).forShare().select('priority_id');
        if (rows.length !== ids.length) throw new CoManagedPolicyError('RESOURCE_NOT_FOUND');
      }
      await home.table('co_managed_sla_priority_mappings').where(key).del();
      if (desired.length) await home.table('co_managed_sla_priority_mappings').insert(desired.map(row => ({ tenant: actor.tenant, ...key,
        customer_priority_id: row.customerPriorityId, msp_priority_id: row.mspPriorityId })));
      await recordPolicyChange(trx, actor, target, relationship.revision, 'sla_priority_mappings_changed', { mappings: desired });
    }
    await assertCoManagedSessionUnexpired(trx, actor);
    const finalLifecycle = await getCoManagedOperationalState(trx, target.customerTenant);
    if (!finalLifecycle.canWrite) throw new CoManagedLifecycleError(finalLifecycle);
    return replay ? relationship.revision : relationship.revision + 1;
  });
}
