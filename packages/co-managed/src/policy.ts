import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedOperationalState, CoManagedLifecycleError } from '@alga-psa/licensing/lifecycle';
import { hasCoManagedLocalPermission } from './localPermission';
import { isCoManagedUuid, type CoManagedHomeActor } from './sharedWorkIdentity';
import { retainCoManagedBeforeAccessReduction } from './participationEvidence';

export type { CoManagedHomeActor } from './sharedWorkIdentity';

// ===========================================================================
// THE ACCESS MATRIX
//
//   customer grant  ∩  MSP staff assignment  ∩  home RBAC  ∩  relationship lifecycle
//
// `evaluateCoManagedAccess` is the ONLY place the four layers are combined.
// Every reader (shared-work admission, the Customer Tickets queue, the
// Effective-access explanation) loads facts and calls it; nothing else may
// intersect these layers. It is pure: no I/O, no clock, no cache — a
// revocation is visible on the very next call because the next call reloads
// the facts.
// ===========================================================================

export type CoManagedVisibilityMode = 'board_scope' | 'escalation_only';
export type CoManagedStaffRole = 'viewer' | 'technician';
export type CoManagedAccessLayer = 'lifecycle' | 'staff' | 'grant' | 'home';
export type CoManagedDenyReason =
  | 'relationship_not_active' | 'workspace_unavailable' | 'no_staff_assignment' | 'no_customer_grant'
  | 'grant_dormant_escalation_only' | 'home_permission_denied';

export interface CoManagedLifecycleFacts {
  relationshipState: 'provisioning' | 'pending_acceptance' | 'active' | 'terminated' | 'missing';
  ended: boolean;
  /** The customer workspace is `co_managed` and the sponsor is `psa`, and neither is suspended. */
  workspacesAvailable: boolean;
  /** Licensing/lifecycle admission for writes (false while read-only or paused). */
  canWrite: boolean;
}
export interface CoManagedStaffFacts {
  /** Roles from direct and team assignments of the acting MSP user. */
  roles: readonly CoManagedStaffRole[];
}
export interface CoManagedGrantFacts {
  visibilityMode: CoManagedVisibilityMode;
  /** A configured board/project scope row for this resource, whatever the mode. */
  scope?: { canCollaborate: boolean } | null;
  /** A per-resource grant not derived from a scope (L3 escalation); live in either mode. */
  explicit?: { canCollaborate: boolean } | null;
}
export interface CoManagedHomeFacts { read: boolean; update: boolean }
export interface CoManagedAccessFacts {
  lifecycle: CoManagedLifecycleFacts; staff: CoManagedStaffFacts; grant: CoManagedGrantFacts; home: CoManagedHomeFacts;
}
export interface CoManagedLayerVerdict { ok: boolean; reason?: CoManagedDenyReason }
export interface CoManagedAccessDecision {
  read: boolean;
  /** Shared writes: technician ∩ Collaborate grant ∩ home update ∩ writable lifecycle. */
  write: boolean;
  /** Delegated administration is a write-class action: same bar as `write`. */
  delegate: boolean;
  layers: Record<CoManagedAccessLayer, CoManagedLayerVerdict>;
  /** First failing layer for reading, for explanation views; undefined when readable. */
  deniedBy?: { layer: CoManagedAccessLayer; reason: CoManagedDenyReason };
}

const ok = (): CoManagedLayerVerdict => ({ ok: true });
const no = (reason: CoManagedDenyReason): CoManagedLayerVerdict => ({ ok: false, reason });

/** Under escalation_only the scope grants are retained but dormant; only an explicit grant confers access. */
export function effectiveCoManagedGrant(grant: CoManagedGrantFacts): { canCollaborate: boolean } | null {
  return grant.explicit ?? (grant.visibilityMode === 'board_scope' ? grant.scope ?? null : null);
}

export function evaluateCoManagedAccess(facts: CoManagedAccessFacts): CoManagedAccessDecision {
  const { lifecycle, staff, grant, home } = facts;
  const live = lifecycle.relationshipState === 'active' && !lifecycle.ended;
  const lifecycleVerdict = !live ? no('relationship_not_active') : !lifecycle.workspacesAvailable ? no('workspace_unavailable') : ok();
  const staffVerdict = staff.roles.length ? ok() : no('no_staff_assignment');
  const effective = effectiveCoManagedGrant(grant);
  const grantVerdict = effective ? ok() : no(grant.scope && grant.visibilityMode !== 'board_scope' ? 'grant_dormant_escalation_only' : 'no_customer_grant');
  const homeVerdict = home.read ? ok() : no('home_permission_denied');
  const layers = { lifecycle: lifecycleVerdict, staff: staffVerdict, grant: grantVerdict, home: homeVerdict };
  const read = lifecycleVerdict.ok && staffVerdict.ok && grantVerdict.ok && homeVerdict.ok;
  const collaborate = Boolean(effective?.canCollaborate);
  const write = read && lifecycle.canWrite && home.update && collaborate && staff.roles.includes('technician');
  const failed = (['lifecycle', 'staff', 'grant', 'home'] as const).find(layer => !layers[layer].ok);
  return { read, write, delegate: write, layers, deniedBy: failed ? { layer: failed, reason: layers[failed].reason! } : undefined };
}

// ===========================================================================
// Policy administration (customer grants and MSP staff assignments)
// ===========================================================================

export interface CoManagedPolicyTarget { customerTenant: string; relationshipId: string }
export interface CoManagedResourceGrant { id: string; canCollaborate: boolean }
export interface CoManagedCustomerScope {
  visibilityMode: CoManagedVisibilityMode;
  /** The customer's configured board grants. They are in effect only in board_scope: under escalation_only they
   * are retained but dormant (every reader gates them on visibility_mode), so switching modes never discards them. */
  boards: CoManagedResourceGrant[];
  projects: CoManagedResourceGrant[];
}
export interface CoManagedStaffAssignment { kind: 'user' | 'team'; principalId: string; role: CoManagedStaffRole }
export interface CoManagedCollaborationPolicy extends CoManagedCustomerScope {
  revision: number;
  /** The sponsor workspace that owns the staff assignments' principals (users and teams); read from the relationship row, never from the caller. */
  sponsorTenant: string;
  assignments: CoManagedStaffAssignment[];
  /** Customer-owned redaction list (a mechanism with no configuration UI yet). */
  redactedFields: string[];
}
export class CoManagedPolicyError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'PERMISSION_DENIED' | 'INVALID_POLICY' | 'POLICY_CHANGED' | 'RESOURCE_NOT_FOUND') {
    super({ FORBIDDEN: 'This co-management policy is not available to this actor.',
      PERMISSION_DENIED: 'Your role does not include permission to view or change co-management access.',
      INVALID_POLICY: 'Provide a valid co-management policy.', POLICY_CHANGED: 'The policy changed. Refresh it before saving.',
      RESOURCE_NOT_FOUND: 'A selected resource or principal is not available in its owning workspace.',
    }[code]);
    this.name = 'CoManagedPolicyError';
  }
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** No cached roles or caller-provided user type; retain current permission rows. */
async function requirePolicyAdministrator(trx: Knex.Transaction, actor: CoManagedHomeActor): Promise<void> {
  if (!await hasCoManagedLocalPermission(trx, actor, 'co_management', 'manage', true)) throw new CoManagedPolicyError('PERMISSION_DENIED');
}
/** Reading a policy (and explaining access) needs `co_management:read` or `:manage`; changing it still needs `:manage`.
 * Checked against the actor's current home permission rows, never a caller-supplied user type. */
export async function requireCoManagedPolicyReader(trx: Knex.Transaction, actor: CoManagedHomeActor): Promise<void> {
  if (await hasCoManagedLocalPermission(trx, actor, 'co_management', 'read', true)) return;
  await requirePolicyAdministrator(trx, actor);
}

/** Lock order is fixed everywhere: entitlement -> sponsor -> relationship -> customer. */
async function lockPolicy(trx: Knex.Transaction, actor: CoManagedHomeActor, target: CoManagedPolicyTarget, write = true) {
  if (![actor.tenant, actor.userId, target.customerTenant, target.relationshipId].every(isCoManagedUuid)) throw new CoManagedPolicyError('INVALID_POLICY');
  const customer = tenantDb(trx, target.customerTenant);
  const found = await customer.table('co_management_relationships').where('relationship_id', target.relationshipId).first();
  if (!found || (actor.tenant !== target.customerTenant && actor.tenant !== found.sponsor_tenant)) throw new CoManagedPolicyError('FORBIDDEN');
  // 1. entitlement (lifecycle admission reads and retains the sponsor entitlement)
  const lifecycle = await getCoManagedOperationalState(trx, target.customerTenant);
  // 2. sponsor
  const sponsor = await tenantDb(trx, found.sponsor_tenant).table('tenants').forShare().first('product_code', 'suspended_at');
  // 3. relationship
  const query = customer.table('co_management_relationships').where('relationship_id', target.relationshipId);
  if (write) query.forUpdate(); else query.forShare();
  const relationship = await query.first();
  // 4. customer
  const owner = await customer.table('tenants').forShare().first('product_code', 'suspended_at');
  if (!relationship || relationship.state !== 'active' || relationship.ended_at || relationship.sponsor_tenant !== found.sponsor_tenant ||
      owner?.product_code !== 'co_managed' || owner.suspended_at || sponsor?.product_code !== 'psa' || sponsor.suspended_at) throw new CoManagedPolicyError('FORBIDDEN');
  if (write) await requirePolicyAdministrator(trx, actor); else await requireCoManagedPolicyReader(trx, actor);
  return { customer, relationship, lifecycle };
}

/** Shared customer-administration boundary for scope changes and object-grant
 * revocation. It admits security reductions during a license pause, so callers
 * must independently reject any expansion when lifecycle.canWrite is false. */
export async function lockCoManagedCustomerPolicy(trx: Knex.Transaction, actor: CoManagedHomeActor, target: CoManagedPolicyTarget) {
  if (!trx.isTransaction || actor.tenant !== target.customerTenant) throw new CoManagedPolicyError('FORBIDDEN');
  return lockPolicy(trx, actor, target);
}

async function readCustomerScope(trx: Knex.Transaction, target: CoManagedPolicyTarget, visibilityMode: CoManagedVisibilityMode): Promise<CoManagedCustomerScope> {
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
  if (!Array.isArray(grants) || grants.some(grant => !grant || !isCoManagedUuid(grant.id) || typeof grant.canCollaborate !== 'boolean') ||
      new Set(grants.map(grant => grant.id.toLowerCase())).size !== grants.length) throw new CoManagedPolicyError('INVALID_POLICY');
  return grants.map(grant => ({ id: grant.id.toLowerCase(), canCollaborate: grant.canCollaborate })).sort((a, b) => a.id.localeCompare(b.id));
}
function grantsReduce(next: CoManagedResourceGrant[], previous: CoManagedResourceGrant[]): boolean {
  return next.every(grant => previous.some(old => old.id === grant.id && (!grant.canCollaborate || old.canCollaborate)));
}
/** Optimistic revision with replay-by-fingerprint: a retry of the very change that produced the current revision is a no-op. */
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
export async function recordCoManagedPolicyChange(trx: Knex.Transaction, actor: CoManagedHomeActor, target: CoManagedPolicyTarget,
  revision: number, eventType: string, scope: unknown, eventId = randomUUID()): Promise<number> {
  const customer = tenantDb(trx, target.customerTenant);
  // write-admission: exempt — co-managed policy/delegation state, written under the relationship lock after lifecycle admission (lockPolicy / getCoManagedOperationalState)
  await customer.table('co_management_relationships').where('relationship_id', target.relationshipId)
    .update({ revision: revision + 1, updated_at: trx.fn.now() });
  // write-admission: exempt — co-managed policy/delegation state, written under the relationship lock after lifecycle admission (lockPolicy / getCoManagedOperationalState)
  await customer.table('co_management_relationship_events').insert({ tenant: target.customerTenant, event_id: eventId,
    relationship_id: target.relationshipId, actor_tenant: actor.tenant, actor_user_id: actor.userId,
    event_type: eventType, revision: revision + 1, scope, scope_fingerprint: hash(scope) });
  return revision + 1;
}

export async function getCoManagedCollaborationPolicy(db: Knex, actor: CoManagedHomeActor, target: CoManagedPolicyTarget): Promise<CoManagedCollaborationPolicy> {
  return withTransaction(db, async trx => {
    const { relationship } = await lockPolicy(trx, actor, target, false);
    const scope = await readCustomerScope(trx, target, relationship.visibility_mode);
    // The sponsor sees the scope in effect; dormant board grants stay the customer's own configuration.
    if (actor.tenant !== target.customerTenant && scope.visibilityMode !== 'board_scope') scope.boards = [];
    return { ...scope, revision: relationship.revision, sponsorTenant: relationship.sponsor_tenant, redactedFields: relationship.redacted_fields ?? [],
      assignments: await readAssignments(trx, relationship.sponsor_tenant, target) };
  });
}

export async function replaceCoManagedCustomerScope(db: Knex, actor: CoManagedHomeActor, target: CoManagedPolicyTarget,
  expectedRevision: number, scope: CoManagedCustomerScope): Promise<number> {
  if (actor.tenant !== target.customerTenant) throw new CoManagedPolicyError('FORBIDDEN');
  if (!scope || !['board_scope', 'escalation_only'].includes(scope.visibilityMode)) throw new CoManagedPolicyError('INVALID_POLICY');
  const desired: CoManagedCustomerScope = { visibilityMode: scope.visibilityMode, boards: normalizeGrants(scope.boards), projects: normalizeGrants(scope.projects) };
  return withTransaction(db, async trx => {
    const { customer, relationship, lifecycle } = await lockCoManagedCustomerPolicy(trx, actor, target);
    if (await isReplay(trx, actor, target, expectedRevision, relationship.revision, 'customer_scope_changed', desired)) return relationship.revision;
    const previous = await readCustomerScope(trx, target, relationship.visibility_mode);
    if (hash(previous) === hash(desired)) return relationship.revision;
    // Dormant board grants confer nothing, so only the boards in effect after the change can expand access.
    const boardsReduce = desired.visibilityMode === 'escalation_only' ||
      (previous.visibilityMode === 'board_scope' && grantsReduce(desired.boards, previous.boards));
    const reduction = boardsReduce && grantsReduce(desired.projects, previous.projects);
    if (!lifecycle.canWrite && !reduction) throw new CoManagedLifecycleError(lifecycle);
    for (const [table, idColumn, grants] of [['boards', 'board_id', desired.boards], ['projects', 'project_id', desired.projects]] as const) {
      const rows = await customer.table(table).whereIn(idColumn, grants.map(grant => grant.id)).forShare().select(idColumn);
      if (rows.length !== grants.length) throw new CoManagedPolicyError('RESOURCE_NOT_FOUND');
    }
    const removedBoards = previous.visibilityMode === 'board_scope' ? previous.boards.filter(old =>
      desired.visibilityMode !== 'board_scope' || !desired.boards.some(next => next.id === old.id)).map(grant => grant.id) : [];
    const removedProjects = previous.projects.filter(old => !desired.projects.some(next => next.id === old.id)).map(grant => grant.id);
    const operationId = randomUUID();
    // Access-reduction retainer registry: let shared-history owners retain what the MSP already participated in.
    const resources: Array<{ kind: 'ticket' | 'project_task'; id: string }> = [];
    if (removedBoards.length) {
      for (const ticket of await customer.table('tickets').whereIn('board_id', removedBoards).orderBy('ticket_id').select('ticket_id')) resources.push({ kind: 'ticket', id: ticket.ticket_id });
    }
    if (removedProjects.length) {
      const tasks = customer.table('project_tasks as task');
      customer.tenantJoin(tasks, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
      for (const task of await tasks.whereIn('phase.project_id', removedProjects).orderBy('task.task_id').select('task.task_id')) resources.push({ kind: 'project_task', id: task.task_id });
    }
    await retainCoManagedBeforeAccessReduction({ trx, customerTenant: target.customerTenant, relationshipId: target.relationshipId, operationId, resources });
    // write-admission: exempt — co-managed policy/delegation state, written under the relationship lock after lifecycle admission (lockPolicy / getCoManagedOperationalState)
    await customer.table('co_management_relationships').where('relationship_id', target.relationshipId).update({ visibility_mode: desired.visibilityMode });
    for (const [table, idColumn, grants] of [['co_management_board_scopes', 'board_id', desired.boards], ['co_management_project_scopes', 'project_id', desired.projects]] as const) {
      // write-admission: exempt — co-managed policy/delegation state, written under the relationship lock after lifecycle admission (lockPolicy / getCoManagedOperationalState)
      await customer.table(table).where('relationship_id', target.relationshipId).del();
      // write-admission: exempt — co-managed policy/delegation state, written under the relationship lock after lifecycle admission (lockPolicy / getCoManagedOperationalState)
      if (grants.length) await customer.table(table).insert(grants.map(grant => ({ tenant: target.customerTenant,
        relationship_id: target.relationshipId, [idColumn]: grant.id, can_collaborate: grant.canCollaborate })));
    }
    return recordCoManagedPolicyChange(trx, actor, target, relationship.revision, 'customer_scope_changed', desired, operationId);
  });
}

export async function replaceCoManagedStaffAssignments(db: Knex, actor: CoManagedHomeActor, target: CoManagedPolicyTarget,
  expectedRevision: number, assignments: CoManagedStaffAssignment[]): Promise<number> {
  if (!Array.isArray(assignments) || assignments.some(item => !item || !['user', 'team'].includes(item.kind) ||
      !isCoManagedUuid(item.principalId) || !['viewer', 'technician'].includes(item.role))) throw new CoManagedPolicyError('INVALID_POLICY');
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
    // write-admission: exempt — co-managed policy/delegation state, written under the relationship lock after lifecycle admission (lockPolicy / getCoManagedOperationalState)
    await home.table('co_management_staff_assignments').where({ customer_tenant: target.customerTenant, relationship_id: target.relationshipId }).del();
    // write-admission: exempt — co-managed policy/delegation state, written under the relationship lock after lifecycle admission (lockPolicy / getCoManagedOperationalState)
    if (desired.length) await home.table('co_management_staff_assignments').insert(desired.map(item => ({ tenant: actor.tenant,
      customer_tenant: target.customerTenant, relationship_id: target.relationshipId, principal_type: item.kind,
      principal_id: item.principalId, relationship_role: item.role })));
    return recordCoManagedPolicyChange(trx, actor, target, relationship.revision, 'staff_assignments_changed', { assignments: desired });
  });
}

/** Field redaction is a mechanism: the customer-owned list lives on the relationship row (`redacted_fields`). */
export async function replaceCoManagedRedactedFields(db: Knex, actor: CoManagedHomeActor, target: CoManagedPolicyTarget,
  expectedRevision: number, fields: string[]): Promise<number> {
  if (actor.tenant !== target.customerTenant) throw new CoManagedPolicyError('FORBIDDEN');
  if (!Array.isArray(fields) || fields.length > 200 || fields.some(field => typeof field !== 'string' || !/^[a-z_*][a-z0-9_.*]{0,99}$/i.test(field))) throw new CoManagedPolicyError('INVALID_POLICY');
  const desired = [...new Set(fields)].sort();
  return withTransaction(db, async trx => {
    const { customer, relationship } = await lockCoManagedCustomerPolicy(trx, actor, target);
    if (await isReplay(trx, actor, target, expectedRevision, relationship.revision, 'redacted_fields_changed', { redactedFields: desired })) return relationship.revision;
    // write-admission: exempt — co-managed policy/delegation state, written under the relationship lock after lifecycle admission (lockPolicy / getCoManagedOperationalState)
    await customer.table('co_management_relationships').where('relationship_id', target.relationshipId).update({ redacted_fields: desired });
    return recordCoManagedPolicyChange(trx, actor, target, relationship.revision, 'redacted_fields_changed', { redactedFields: desired });
  });
}

/** Every live relationship this sponsor holds, for the Effective access view. Independent of delegated grants:
 * it needs the actor's own `co_management:read` or `:manage` (checked here, against current rows) and nothing else.
 * Each relationship is re-checked in its owning workspace, so an ended or paused one never appears. */
export async function listCoManagedLiveSponsoredRelationships(db: Knex, actor: CoManagedHomeActor): Promise<{ relationshipId: string; customerTenant: string; name: string }[]> {
  if (![actor.tenant, actor.userId].every(isCoManagedUuid)) throw new CoManagedPolicyError('INVALID_POLICY');
  return withTransaction(db, async trx => {
    await requireCoManagedPolicyReader(trx, actor);
    const home = tenantDb(trx, actor.tenant);
    if (!await home.table('tenants').where({ product_code: 'psa' }).whereNull('suspended_at').first('tenant')) throw new CoManagedPolicyError('FORBIDDEN');
    const operations = await home.table('co_managed_provisioning_operations').whereNotNull('relationship_id').select('relationship_id', 'customer_tenant');
    const seen = new Set<string>(), result: { relationshipId: string; customerTenant: string; name: string }[] = [];
    for (const operation of operations) {
      if (seen.has(operation.relationship_id) || !isCoManagedUuid(operation.customer_tenant)) continue;
      seen.add(operation.relationship_id);
      const customer = tenantDb(trx, operation.customer_tenant as string);
      const relationship = await customer.table('co_management_relationships')
        .where({ relationship_id: operation.relationship_id, sponsor_tenant: actor.tenant, state: 'active' }).whereNull('ended_at').first('relationship_id');
      const owner = relationship ? await customer.table('tenants').whereNull('suspended_at').where({ product_code: 'co_managed' }).first('client_name') : null;
      if (owner) result.push({ relationshipId: operation.relationship_id, customerTenant: operation.customer_tenant, name: owner.client_name ?? '' });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  });
}
