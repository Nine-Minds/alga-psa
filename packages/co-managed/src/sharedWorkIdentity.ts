import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createAuthorizationKernel, BuiltinAuthorizationKernelProvider, BundleAuthorizationKernelProvider,
  resolveBundleNarrowingRulesForEvaluation, type AuthorizationRecord, type AuthorizationSubject, type ScopeConstraint } from '@alga-psa/authorization';
import { hasCoManagedLocalPermission } from './localPermission';
import type { CoManagedHomeActor } from './policy';

/** Authentication adapters construct this from a verified home session. */
export interface CoManagedSessionActor extends CoManagedHomeActor { kind: 'session'; sessionId: string }
export class CoManagedSharedWorkError extends Error {
  readonly code = 'CO_MANAGED_SHARED_WORK_FORBIDDEN';
  constructor() { super('This shared resource is not available for the requested operation.'); this.name = 'CoManagedSharedWorkError'; }
}
export function isCoManagedUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function snapshotCoManagedSessionActor(input: CoManagedSessionActor): CoManagedSessionActor {
  if (!input || input.kind !== 'session' || ![input.tenant, input.userId, input.sessionId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return { kind: 'session', tenant: input.tenant, userId: input.userId, sessionId: input.sessionId };
}
async function lockCoManagedHomeIdentity(trx: Knex.Transaction, actor: CoManagedHomeActor, sessionId?: string): Promise<AuthorizationSubject> {
  const home = tenantDb(trx, actor.tenant);
  const user = await home.table('users').where({ user_id: actor.userId, user_type: 'internal', is_inactive: false }).forShare().first('user_id');
  if (!user) throw new CoManagedSharedWorkError();
  if (sessionId && !await home.table('sessions').where({ session_id: sessionId, user_id: actor.userId })
    .whereNull('revoked_at').forShare().first('session_id')) throw new CoManagedSharedWorkError();
  const memberships = await home.table('team_members').where('user_id', actor.userId).forShare().select('team_id');
  const roles = await home.table('user_roles').where('user_id', actor.userId).forShare().select('role_id');
  const managed = await home.table('users').where({ reports_to: actor.userId, user_type: 'internal', is_inactive: false }).forShare().select('user_id');
  return { tenant: actor.tenant, userId: actor.userId, userType: 'internal', roleIds: roles.map(row => row.role_id),
    teamIds: memberships.map(row => row.team_id), managedUserIds: managed.map(row => row.user_id) };
}
export async function lockCoManagedSessionIdentity(trx: Knex.Transaction, actor: CoManagedSessionActor): Promise<AuthorizationSubject> {
  const verified = snapshotCoManagedSessionActor(actor);
  return lockCoManagedHomeIdentity(trx, verified, verified.sessionId);
}
/** Background recipients have their own active home identity, never an author's session. */
export async function lockCoManagedRecipientIdentity(trx: Knex.Transaction, actor: CoManagedHomeActor): Promise<AuthorizationSubject> {
  return lockCoManagedActiveHomeIdentity(trx, actor);
}
/** Active home identity for non-session policy evaluation (recipients and
 * proposed assignees). Callers must separately retain resource authority. */
export async function lockCoManagedActiveHomeIdentity(trx: Knex.Transaction, actor: CoManagedHomeActor): Promise<AuthorizationSubject> {
  if (!actor || ![actor.tenant, actor.userId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return lockCoManagedHomeIdentity(trx, actor);
}
export async function assertCoManagedSessionUnexpired(trx: Knex.Transaction, actor: CoManagedSessionActor): Promise<void> {
  if (!await tenantDb(trx, actor.tenant).table('sessions').where({ session_id: actor.sessionId, user_id: actor.userId })
    .whereNull('revoked_at').where('expires_at', '>', trx.raw('clock_timestamp()')).first('session_id')) throw new CoManagedSharedWorkError();
}

/** Evaluate only fields for which the caller supplied a meaningful home-tenant
 * projection. Unknown fields cannot accidentally compare against customer IDs. */
function matchesCoManagedScopeConstraints(constraints: ScopeConstraint[], record: AuthorizationRecord): boolean {
  const fields: Record<string, unknown> = { client_id: record.clientId, board_id: record.boardId,
    owner_user_id: record.ownerUserId, assigned_to: record.assignedUserIds?.[0] };
  return constraints.every(constraint => {
    if (!(constraint.field in fields) || fields[constraint.field] === undefined) return false;
    if (constraint.operator === 'eq') return fields[constraint.field] === constraint.value;
    if (constraint.operator === 'in' && Array.isArray(constraint.value)) return constraint.value.includes(fields[constraint.field]);
    return false;
  });
}


/** The same locked home authority applies to customer-local handoffs and MSP
 * shared commands; only their qualified record projection differs. */
export async function authorizeCoManagedWorkRecord(trx: Knex.Transaction, actor: CoManagedHomeActor,
  subject: AuthorizationSubject, resourceType: 'ticket' | 'project', action: 'read' | 'update' | 'create', record: AuthorizationRecord) {
  return authorizeCoManagedLocalRecord(trx, actor, subject, resourceType, action, record);
}

/** Current local RBAC and bundle policy for a concrete tenant-owned record. */
export async function authorizeCoManagedLocalRecord(trx: Knex.Transaction, actor: CoManagedHomeActor,
  subject: AuthorizationSubject, resourceType: string, action: string, record: AuthorizationRecord, mutationKind?: 'approve') {
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: input => resolveBundleNarrowingRulesForEvaluation(trx, input, { lock: true }) }),
    rbacEvaluator: () => hasCoManagedLocalPermission(trx, actor, resourceType, action, true),
  });
  const input = { knex: trx, subject, resource: { type: resourceType, action, id: record.id }, record };
  const decision = await kernel.authorizeResource(input);
  if (!decision.allowed || !matchesCoManagedScopeConstraints(decision.scope.constraints, record)) throw new CoManagedSharedWorkError();
  if (mutationKind && !(await kernel.authorizeMutation({ ...input, mutation: { kind: mutationKind, record } })).allowed) throw new CoManagedSharedWorkError();
  return decision;
}
