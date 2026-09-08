import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { resolveBundleNarrowingRulesForEvaluation, type BundleNarrowingRule, type AuthorizationSubject } from '@alga-psa/authorization';
import { changeCoManagedAllocation, getCoManagedEntitlementState } from '@alga-psa/licensing';
import { applyCoManagedQueuePolicy } from './queuePolicy';
import { lockCoManagedLocalAuthentication } from './localAuthentication';
import { hasCoManagedLocalPermission } from './localPermission';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { prepareCoManagedProvisioning, type CoManagedProvisioningRequest, type CoManagedProvisioningOperation } from './provisioning';

const deny = (): never => { throw new CoManagedSharedWorkError(); };
interface ManagementContext {
  trx: Knex.Transaction; actor: CoManagedSessionActor; subject: AuthorizationSubject;
  home: ReturnType<typeof tenantDb>; owner: any; action: 'read' | 'manage';
  clientRules: BundleNarrowingRule[]; boardRules: BundleNarrowingRule[]; managementRules: BundleNarrowingRule[];
  redactions: string[]; canManage: boolean;
}

/** Sponsor management keeps home record policy through the corresponding read
 * or write. Capacity is locked first so nested reservation/resize cannot invert
 * the admission order used by provisioning, invitations and acceptance. */
async function withManagement<T>(db: Knex, inputActor: CoManagedSessionActor, action: 'read' | 'manage', work: (context: ManagementContext) => Promise<T>) {
  const actor = snapshotCoManagedSessionActor(inputActor);
  return withTransaction(db, async trx => {
    const home = tenantDb(trx, actor.tenant);
    await home.table('co_managed_entitlements').forUpdate().first();
    const owner = await home.table('tenants').forShare().first('product_code', 'plan', 'suspended_at');
    if (owner?.product_code !== 'psa' || owner.suspended_at) deny();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    for (const [resource, operation] of [['co_management', action], ['client', 'read'], ['ticket', 'read']])
      if (!await hasCoManagedLocalPermission(trx, actor, resource, operation, true)) deny();
    const rules = async (type: string, operation: string) => (await resolveBundleNarrowingRulesForEvaluation(trx,
      { subject: credential.subject, resource: { type, action: operation }, knex: trx }, { lock: true }))
      .filter(rule => rule.resource === type && rule.action === operation);
    const clientRules = await rules('client', 'read'), boardRules = await rules('ticket', 'read'), managementRules = await rules('co_management', action);
    const canManage = await hasCoManagedLocalPermission(trx, actor, 'co_management', 'manage', true);
    const result = await work({ trx, actor, subject: credential.subject, home, owner, action, clientRules, boardRules, managementRules,
      redactions: [...clientRules, ...boardRules, ...managementRules].flatMap(rule => rule.redactedFields ?? []), canManage });
    await credential.assertCurrent();
    return result;
  });
}

const hidden = (context: ManagementContext, names: string[]) => isCoManagedReadFieldHidden(context.redactions, names);
function authorizeProjection(context: ManagementContext, base: Knex.QueryBuilder) {
  const query = context.trx.from(base.as('q'));
  for (const [resourceType, action, rules] of [
    ['client', 'read', context.clientRules], ['ticket', 'read', context.boardRules], ['co_management', context.action, context.managementRules],
  ] as const) applyCoManagedQueuePolicy(query, context.subject, rules, { resourceType, action, shared: true, ownerAvailable: false });
  if (hidden(context, ['client_id', 'clients.client_id', 'board_id', 'boards.board_id', 'tickets.board_id', 'operation_id', 'co_managed_provisioning_operations.operation_id'])) query.whereRaw('false');
  return query;
}
function policyColumns(context: ManagementContext, client: string, board: string) {
  return { auth_client: client, auth_board: board, auth_owner: context.trx.raw('NULL::uuid'),
    auth_assigned: context.trx.raw('NULL::uuid'), auth_team: context.trx.raw('NULL::uuid') };
}

/** One home client/board pair must be authorized before either setup picker can
 * reveal labels. This also handles ticket rules narrowed to selected clients. */
function setupChoices(context: ManagementContext) {
  const base = context.home.table('clients as c').where({ 'c.is_inactive': false, 'b.is_inactive': false });
  context.home.tenantJoin(base, 'boards as b', 'c.tenant', 'b.tenant');
  return authorizeProjection(context, base.select('c.client_id', 'c.client_name', 'b.board_id', 'b.board_name',
    policyColumns(context, 'c.client_id', 'b.board_id')));
}

const workspaceNames = ['name', 'client_name', 'clients.client_name', 'workspaceName', 'workspace_name', 'request.workspaceName', 'co_managed_provisioning_operations.request.workspaceName'];
const administratorEmails = ['email', 'administratorEmail', 'administrator', 'request.administrator', 'request.administrator.email', 'co_managed_provisioning_operations.request.administrator'];

export async function getCoManagedManagementOptions(db: Knex, actor: CoManagedSessionActor, search = '', selectedClientId?: string) {
  if (typeof search !== 'string' || search.length > 200 || selectedClientId !== undefined && !isCoManagedUuid(selectedClientId)) deny();
  return withManagement(db, actor, 'manage', async context => {
    const query = setupChoices(context);
    if (hidden(context, workspaceNames)) query.whereRaw('false');
    if (search.trim()) query.whereILike('q.client_name', `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`);
    const clients = await query.distinct('q.client_id', 'q.client_name').orderBy('q.client_name').orderBy('q.client_id').limit(50);
    const selected = selectedClientId && !hidden(context, workspaceNames) ? await setupChoices(context).where('q.client_id', selectedClientId)
      .select('q.client_id', 'q.client_name').first() : null;
    if (selected && !clients.some(client => client.client_id === selected.client_id)) clients.push(selected);
    const boards = selected && !hidden(context, ['board_name', 'boards.board_name', 'name'])
      ? await setupChoices(context).where('q.client_id', selectedClientId).distinct('q.board_id', 'q.board_name').orderBy('q.board_name').orderBy('q.board_id') : [];
    return { clients: clients.map(client => ({ id: client.client_id as string, name: client.client_name as string })),
      boards: boards.map(board => ({ id: board.board_id as string, name: board.board_name as string })) };
  });
}

export async function canManageCoManagedClient(db: Knex, actor: CoManagedSessionActor, clientId: string): Promise<boolean> {
  if (!isCoManagedUuid(clientId)) return false;
  try {
    return await withManagement(db, actor, 'manage', async context => {
      if (!await hasCoManagedLocalPermission(context.trx, context.actor, 'co_management', 'read', true) ||
          hidden(context, workspaceNames) || !await setupChoices(context).where('q.client_id', clientId).first()) return false;
      if (context.owner.plan === 'pro') return true;
      const entitlement = await context.home.table('co_managed_entitlements').first('source');
      return entitlement?.source === 'self_host' && (await getCoManagedEntitlementState(context.trx, context.actor.tenant)).capacity > 0;
    });
  } catch (error) { if (error instanceof CoManagedSharedWorkError) return false; throw error; }
}

function operations(context: ManagementContext) {
  const base = context.home.table('co_managed_provisioning_operations as o');
  context.home.tenantJoin(base, 'clients as c', 'o.tenant', 'c.tenant', { on: join => join.andOn(context.trx.raw("c.client_id::text = lower(o.request->>'clientId')")) });
  context.home.tenantJoin(base, 'boards as b', 'o.escalation_board_id', 'b.board_id');
  return authorizeProjection(context, base.select('o.*', policyColumns(context, 'c.client_id', 'b.board_id')));
}

async function retainOperation(context: ManagementContext, operationId: string): Promise<CoManagedProvisioningOperation> {
  if (!isCoManagedUuid(operationId)) deny();
  const allowed = await operations(context).where('q.operation_id', operationId).first();
  if (!allowed) deny();
  const operation = await context.home.table('co_managed_provisioning_operations').where('operation_id', operationId).forUpdate().first();
  if (!operation || operation.request.clientId?.toLowerCase() !== allowed.auth_client || operation.escalation_board_id !== allowed.auth_board) deny();
  // Retain the actual local records, then recheck policy under the same locks as
  // the command. A guessed customer or board ID never substitutes a home row.
  if (!await context.home.table('clients').where('client_id', allowed.auth_client).forShare().first('client_id') ||
      !await context.home.table('boards').where('board_id', allowed.auth_board).forShare().first('board_id')) deny();
  for (const [resource, action] of [['client', 'read'], ['ticket', 'read'], ['co_management', context.action]])
    await authorizeCoManagedLocalRecord(context.trx, context.actor, context.subject, resource, action,
      { id: resource === 'client' ? allowed.auth_client : operationId, clientId: allowed.auth_client, boardId: allowed.auth_board });
  return operation;
}

export async function withCoManagedManagementOperation<T>(db: Knex, actor: CoManagedSessionActor, operationId: string,
  work: (trx: Knex.Transaction, operation: CoManagedProvisioningOperation) => Promise<T>) {
  return withManagement(db, actor, 'manage', async context => work(context.trx, await retainOperation(context, operationId)));
}

export async function prepareCoManagedProvisioningForActor(db: Knex, actor: CoManagedSessionActor,
  input: Omit<CoManagedProvisioningRequest, 'sponsorTenant' | 'requestedBy'>) {
  // Snapshot before waiting for authority/capacity locks; caller-owned objects
  // cannot change the selected client or board during admission.
  if (!input || ![input.clientId, input.escalationBoardId, input.operationId].every(isCoManagedUuid)) deny();
  const request = { ...input, administrator: { ...input.administrator } };
  return withManagement(db, actor, 'manage', async context => {
    const choice = await setupChoices(context).where({ 'q.client_id': request.clientId, 'q.board_id': request.escalationBoardId }).first();
    if (!choice) deny();
    if (!await context.home.table('clients').where({ client_id: request.clientId, is_inactive: false }).forShare().first() ||
        !await context.home.table('boards').where({ board_id: request.escalationBoardId, is_inactive: false }).forShare().first()) deny();
    return prepareCoManagedProvisioning(context.trx, { ...request, sponsorTenant: context.actor.tenant, requestedBy: context.actor.userId });
  });
}

export async function changeCoManagedAllocationForActor(db: Knex, actor: CoManagedSessionActor,
  input: { operationId: string; seats: number; expectedSeats: number }) {
  const request = { operationId: input?.operationId, seats: input?.seats, expectedSeats: input?.expectedSeats };
  return withCoManagedManagementOperation(db, actor, request.operationId, (trx, operation) => changeCoManagedAllocation(trx, operation.tenant,
    { customerTenant: operation.customer_tenant, relationshipId: operation.relationship_id, seats: request.seats, expectedSeats: request.expectedSeats }));
}

export async function getCoManagedManagementStatus(db: Knex, actor: CoManagedSessionActor, page = 0) {
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000000) deny();
  return withManagement(db, actor, 'read', async context => {
    const query = operations(context);
    if (!hidden(context, ['created_at', 'co_managed_provisioning_operations.created_at'])) query.orderBy('q.created_at', 'desc');
    const rows = await query.orderBy('q.operation_id').offset(page * 25).limit(26);
    const items = [];
    for (const operation of rows.slice(0, 25)) {
      let canManage = context.canManage;
      if (canManage) try { await authorizeCoManagedLocalRecord(context.trx, context.actor, context.subject, 'co_management', 'manage',
        { id: operation.operation_id, clientId: operation.auth_client, boardId: operation.auth_board }); }
      catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; canManage = false; }
      const customer = tenantDb(context.trx, operation.customer_tenant);
      const relationship = await customer.table('co_management_relationships').where({ relationship_id: operation.relationship_id, sponsor_tenant: context.actor.tenant,
        sponsor_client_id: operation.auth_client }).first('state');
      const allocation = await context.home.table('co_managed_allocations').where({ operation_id: operation.operation_id,
        customer_tenant: operation.customer_tenant, relationship_id: operation.relationship_id }).first('seats', 'state');
      const invitation = operation.state === 'pending_acceptance' && relationship?.state === 'pending_acceptance'
        ? await customer.table('user_invitations').where({ invitation_id: operation.administrator_invitation_id, used_at: null }).first('expires_at', 'email') : null;
      const awaitingAdministrator = Boolean(invitation && !await customer.table('users').where('user_type', 'internal')
        .whereRaw('lower(trim(email)) = ?', [invitation.email.trim().toLowerCase()]).first('user_id'));
      const invitationExpired = awaitingAdministrator && new Date(invitation.expires_at).getTime() <= Date.now();
      items.push({ operationId: operation.operation_id as string,
        workspaceName: hidden(context, workspaceNames) ? null : operation.request.workspaceName as string,
        administratorEmail: hidden(context, administratorEmails) ? null : operation.request.administrator.email as string,
        seats: Number(allocation?.seats ?? operation.request.seats), canManage,
        canChangeSeats: Boolean(canManage && allocation && allocation.state !== 'released' && operation.state === 'pending_acceptance' && ['active', 'pending_acceptance'].includes(relationship?.state)),
        state: (['active', 'terminated'].includes(relationship?.state) ? relationship.state : operation.state) as string,
        invitationSent: Boolean(operation.invitation_sent_at), invitationExpired, deliveryFailed: Boolean(operation.invitation_delivery_error),
        canRetry: canManage && (['queued', 'provisioning', 'failed'].includes(operation.state) || awaitingAdministrator && (!operation.invitation_sent_at || invitationExpired)),
      });
    }
    return { items, hasMore: rows.length > 25, canManage: context.canManage, canCreate: context.canManage };
  });
}
