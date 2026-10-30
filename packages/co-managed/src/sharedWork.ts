import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedOperationalState, assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import type { AuthorizationRecord, AuthorizationSubject } from '@alga-psa/authorization';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { evaluateCoManagedAccess, effectiveCoManagedGrant, type CoManagedAccessDecision, type CoManagedAccessFacts, type CoManagedGrantFacts,
  type CoManagedHomeActor, type CoManagedStaffRole, type CoManagedVisibilityMode } from './policy';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, lockCoManagedRecipientIdentity,
  authorizeCoManagedWorkRecord, type CoManagedSessionActor } from './sharedWorkIdentity';
export { CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';

export interface CoManagedSharedResource {
  tenant: string;
  relationshipId: string;
  kind: 'ticket' | 'project' | 'project_task';
  id: string;
}
export interface CoManagedSharedWorkContext<Action extends 'read' | 'update' = 'read' | 'update'> {
  trx: Knex.Transaction;
  actor: CoManagedHomeActor;
  /** Internal verified session identity for commands that wait before writing. */
  sessionId: string;
  resource: CoManagedSharedResource;
  revision: number;
  action: Action;
  /** The command must omit these home-policy fields from its response. */
  redactedFields: readonly string[];
}
const deny = (): never => { throw new CoManagedSharedWorkError(); };

/** A notification identity: read-only, no session, never a mutation actor. */
export interface CoManagedNotificationRecipient extends CoManagedHomeActor { kind: 'notification_recipient' }
export type CoManagedNotificationRecipientContext = Omit<CoManagedSharedWorkContext<'read'>, 'sessionId'>;
type SharedPrincipal = CoManagedAuthenticatedActor | CoManagedNotificationRecipient;
type SharedPrincipalContext<Action extends 'read' | 'update' = 'read' | 'update'> =
  Omit<CoManagedSharedWorkContext<Action>, 'sessionId'> & { assertCurrent(): Promise<void>; decision: CoManagedAccessDecision };

// ---------------------------------------------------------------------------
// Fact loaders. They only READ rows (under shared locks) and describe them; the
// four layers are combined by `evaluateCoManagedAccess` in policy.ts, nowhere else.
// ---------------------------------------------------------------------------

/** The project a resource's grant is configured on (a task's grant is its project's). */
async function projectOf(trx: Knex.Transaction, resource: CoManagedSharedResource, lock: 'update' | 'share' | null): Promise<string | null> {
  const owner = tenantDb(trx, resource.tenant);
  if (resource.kind === 'project') return resource.id;
  const query = owner.table('project_tasks').where('project_tasks.task_id', resource.id);
  owner.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
  if (lock === 'update') query.forUpdate('project_tasks', 'project_phases'); else if (lock === 'share') query.forShare('project_tasks', 'project_phases');
  return (await query.first('project_phases.project_id'))?.project_id ?? null;
}

/** Customer-side grant facts for a resource. Returns null if the work itself does not exist. */
export async function loadCoManagedGrantFacts(trx: Knex.Transaction, resource: CoManagedSharedResource, visibilityMode: CoManagedVisibilityMode,
  lock: 'update' | 'share' | null = 'share'): Promise<CoManagedGrantFacts | null> {
  const owner = tenantDb(trx, resource.tenant);
  let scope: { canCollaborate: boolean } | null = null;
  if (resource.kind === 'ticket') {
    const query = owner.table('tickets').where('ticket_id', resource.id);
    if (lock === 'update') query.forUpdate(); else if (lock === 'share') query.forShare();
    const ticket = await query.first('board_id');
    if (!ticket) return null;
    // Rows are read in every mode: escalation_only keeps them dormant, and the evaluator (not this loader) gates them.
    const row = ticket.board_id ? await owner.table('co_management_board_scopes')
      .where({ relationship_id: resource.relationshipId, board_id: ticket.board_id }).forShare().first() : null;
    scope = row ? { canCollaborate: row.can_collaborate } : null;
    // L3b1: an escalation is an explicit per-ticket grant, live in either visibility mode until revoked.
    const work = await owner.table('co_management_ticket_work').where({ relationship_id: resource.relationshipId, ticket_id: resource.id })
      .whereNull('grant_revoked_at').whereNotNull('first_escalated_at').forShare().first('can_collaborate');
    return { visibilityMode, scope, explicit: work ? { canCollaborate: work.can_collaborate } : null };
  } else {
    const projectId = await projectOf(trx, resource, lock);
    if (!projectId) return null;
    const projectQuery = owner.table('projects').where('project_id', projectId);
    if (lock === 'update') projectQuery.forUpdate(); else if (lock === 'share') projectQuery.forShare();
    if (!await projectQuery.first('project_id')) return null;
    const row = await owner.table('co_management_project_scopes').where({ relationship_id: resource.relationshipId, project_id: projectId }).forShare().first();
    scope = row ? { canCollaborate: row.can_collaborate } : null;
  }
  return { visibilityMode, scope, explicit: null };
}

/** The effective grant for one resource (scope gated by visibility mode), as a plain read. */
export async function readCoManagedResourceGrant(trx: Knex.Transaction, resource: CoManagedSharedResource, visibilityMode: CoManagedVisibilityMode) {
  const facts = await loadCoManagedGrantFacts(trx, resource, visibilityMode);
  return facts ? effectiveCoManagedGrant(facts) : null;
}

/** Staff roles from the actor's direct and team assignments in the sponsor's own tenant. */
export async function loadCoManagedStaffRoles(trx: Knex.Transaction, actor: CoManagedHomeActor, customerTenant: string, relationshipId: string,
  teamIds: readonly string[]): Promise<CoManagedStaffRole[]> {
  const rows = await tenantDb(trx, actor.tenant).table('co_management_staff_assignments')
    .where({ customer_tenant: customerTenant, relationship_id: relationshipId })
    .where(query => query.where({ principal_type: 'user', principal_id: actor.userId })
      .orWhere(team => team.where('principal_type', 'team').whereIn('principal_id', [...teamIds])))
    .forShare();
  return [...new Set<CoManagedStaffRole>(rows.map((row: any) => row.relationship_role))];
}

/** Home RBAC is decided by L1a's locked authorizer; it signals denial by throwing. */
export async function loadCoManagedHomeFacts(trx: Knex.Transaction, actor: CoManagedHomeActor, subject: AuthorizationSubject,
  resourceType: 'ticket' | 'project', record: AuthorizationRecord) {
  const attempt = async (action: 'read' | 'update') => {
    try { return await authorizeCoManagedWorkRecord(trx, actor, subject, resourceType, action, record); } catch { return null; }
  };
  const read = await attempt('read');
  const update = read ? await attempt('update') : null;
  return { facts: { read: Boolean(read), update: Boolean(update) }, redactedFields: [...(read?.redactedFields ?? [])] as string[] };
}

export interface CoManagedRelationshipFacts {
  relationship: any;
  lifecycle: CoManagedAccessFacts['lifecycle'];
}
/** Lifecycle layer: relationship row (shared lock) + both workspaces' product and suspension state. */
export async function loadCoManagedLifecycleFacts(trx: Knex.Transaction, actorTenant: string, customerTenant: string, relationshipId: string): Promise<CoManagedRelationshipFacts | null> {
  const owner = tenantDb(trx, customerTenant);
  const found = await owner.table('co_management_relationships').where({ relationship_id: relationshipId, sponsor_tenant: actorTenant }).first();
  if (!found) return null;
  const operational = await getCoManagedOperationalState(trx, customerTenant);
  const relationship = await owner.table('co_management_relationships').where({ relationship_id: relationshipId, sponsor_tenant: actorTenant }).forShare().first();
  const customer = await owner.table('tenants').first('product_code', 'suspended_at');
  const home = await tenantDb(trx, actorTenant).table('tenants').forShare().first('product_code', 'suspended_at');
  return { relationship, lifecycle: {
    relationshipState: relationship?.state ?? 'missing', ended: Boolean(relationship?.ended_at),
    workspacesAvailable: customer?.product_code === 'co_managed' && home?.product_code === 'psa' && !customer.suspended_at && !home.suspended_at,
    canWrite: operational.canWrite } };
}

/** Verified API keys and sessions share live source admission without creating a
 * synthetic session or granting notification identities mutation authority. */
export async function withCoManagedAuthenticatedSharedWork<T>(db: Knex, input: CoManagedAuthenticatedActor, resource: CoManagedSharedResource,
  action: 'read' | 'update', command: (context: SharedPrincipalContext) => Promise<T>): Promise<T> {
  return withCoManagedSharedPrincipal(db, snapshotCoManagedAuthenticatedActor(input), resource, action, command);
}

export async function withCoManagedSharedWork<T, Action extends 'read' | 'update' = 'read' | 'update'>(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  action: Action, command: (context: CoManagedSharedWorkContext<Action> & { assertCurrent(): Promise<void> }) => Promise<T>): Promise<T> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  return withCoManagedSharedPrincipal(db, actor, inputResource, action,
    context => command({ ...context, sessionId: actor.sessionId }));
}

/** Retains each recipient's own current policy through delivery. Audience and field redactions remain the adapter's job. */
export async function withCoManagedNotificationRecipient<T>(db: Knex, input: CoManagedNotificationRecipient, resource: CoManagedSharedResource,
  deliver: (context: CoManagedNotificationRecipientContext) => Promise<T>): Promise<T> {
  if (!input || input.kind !== 'notification_recipient' || ![input.tenant, input.userId].every(isCoManagedUuid)) deny();
  const recipient: CoManagedNotificationRecipient = { kind: 'notification_recipient', tenant: input.tenant, userId: input.userId };
  return withCoManagedSharedPrincipal(db, recipient, resource, 'read', context => deliver({ ...context, action: 'read' }));
}

/** Loads fresh facts inside one transaction (no cross-request cache), asks the single evaluator, and
 * answers a denial as the same opaque `CoManagedSharedWorkError` whichever layer refused (404, never 403). */
async function withCoManagedSharedPrincipal<T, Action extends 'read' | 'update' = 'read' | 'update'>(db: Knex, inputActor: SharedPrincipal, inputResource: CoManagedSharedResource,
  action: Action, command: (context: SharedPrincipalContext<Action>) => Promise<T>): Promise<T> {
  if (!inputActor || !inputResource) deny();
  const actor = inputActor;
  const resource: CoManagedSharedResource = { tenant: inputResource.tenant, relationshipId: inputResource.relationshipId, kind: inputResource.kind, id: inputResource.id };
  if ((!['session', 'api_key'].includes(actor.kind) && (actor.kind !== 'notification_recipient' || action !== 'read')) || !['read', 'update'].includes(action) ||
      !['ticket', 'project', 'project_task'].includes(resource.kind) || actor.tenant === resource.tenant ||
      ![resource.tenant, resource.relationshipId, resource.id].every(isCoManagedUuid)) deny();
  return withTransaction(db, async trx => {
    const lifecycle = await loadCoManagedLifecycleFacts(trx, actor.tenant, resource.tenant, resource.relationshipId);
    if (!lifecycle?.relationship) return deny();
    const credential = actor.kind !== 'notification_recipient' ? await lockCoManagedLocalAuthentication(trx, actor) : null;
    const subject = credential?.subject ?? await lockCoManagedRecipientIdentity(trx, actor);
    const roles = await loadCoManagedStaffRoles(trx, actor, resource.tenant, resource.relationshipId, subject.teamIds ?? []);
    const grant = await loadCoManagedGrantFacts(trx, resource, lifecycle.relationship.visibility_mode, action === 'update' ? 'update' : 'share');
    if (!grant) return deny();
    // Customer UUIDs never become home policy IDs: the home record carries only the sponsor client.
    const record: AuthorizationRecord = { id: `${resource.tenant}:${resource.kind}:${resource.id}`,
      clientId: lifecycle.relationship.sponsor_client_id, assignedUserIds: [], teamIds: [] };
    const home = await loadCoManagedHomeFacts(trx, actor, subject, resource.kind === 'ticket' ? 'ticket' : 'project', record);
    const decision = evaluateCoManagedAccess({ lifecycle: lifecycle.lifecycle, staff: { roles }, grant, home: home.facts });
    if (!(action === 'update' ? decision.write : decision.read)) return deny();
    // Recheck session expiry and lifecycle after any lock wait.
    const assertCurrent = async () => {
      await credential?.assertCurrent();
      if (action === 'update') await assertCoManagedOperationalWrite(trx, resource.tenant);
    };
    await assertCurrent();
    return command({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, resource: { ...resource },
      action, revision: lifecycle.relationship.revision, redactedFields: [...new Set([...home.redactedFields, ...(lifecycle.relationship.redacted_fields ?? [])])], assertCurrent, decision });
  });
}
