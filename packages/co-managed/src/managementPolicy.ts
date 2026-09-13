import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { resolveBundleNarrowingRulesForEvaluation, type BundleNarrowingRule, type AuthorizationSubject } from '@alga-psa/authorization';
import { changeCoManagedAllocation, countCoManagedCommittedSeats, getCoManagedEntitlementState } from '@alga-psa/licensing';
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
  return authorizeProjection(context, base.select('o.*', { auth_client_name: 'c.client_name' }, policyColumns(context, 'c.client_id', 'b.board_id')));
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

/** Every sponsor-owned provisioning operation mapped to a local client, including
 * mappings hidden from the actor by board/management policy. The sponsor-serialized
 * entitlement lock in `withManagement` makes this a safe duplicate-setup check and
 * never returns a hidden workspace identity to the caller. */
async function liveClientMappings(context: ManagementContext, clientId: string, excludeOperationId?: string) {
  const query = context.home.table('co_managed_provisioning_operations as o')
    .whereRaw("lower(o.request->>'clientId') = ?", [clientId.toLowerCase()])
    .whereNot('o.state', 'cancelled').select('o.operation_id', 'o.customer_tenant', 'o.relationship_id');
  if (excludeOperationId) query.whereNot('o.operation_id', excludeOperationId);
  const mappings = await query;
  const live: Array<{ operation_id: string; customer_tenant: string; relationship_id: string }> = [];
  for (const mapping of mappings) {
    const relationship = await tenantDb(context.trx, mapping.customer_tenant).table('co_management_relationships')
      .where('relationship_id', mapping.relationship_id).first('ended_at');
    if (relationship && !relationship.ended_at) live.push(mapping);
  }
  return live;
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
    // Enable is a single-setup action per client: while any current setup or
    // relationship maps to this authorized client, resume its original operation
    // instead of creating a second workspace. The entitlement lock serializes the
    // race, so a concurrent submission observes the first committed mapping.
    const [live] = await liveClientMappings(context, request.clientId, request.operationId);
    if (live) {
      const operation = await context.home.table('co_managed_provisioning_operations')
        .where('operation_id', live.operation_id).first() as CoManagedProvisioningOperation | undefined;
      if (operation) return operation;
    }
    return prepareCoManagedProvisioning(context.trx, { ...request, sponsorTenant: context.actor.tenant, requestedBy: context.actor.userId });
  });
}

/** Explicit selector replacing operation-ID navigation for the normal MSP
 * policy/settings interface. A customer resolves only its own relationship; a
 * sponsor resolves one authorized local client to its exact relationship. */
export type CoManagedManagementSelector =
  | { kind: 'customer-home' }
  | { kind: 'sponsor-client'; clientId: string; relationshipId?: string };

export interface CoManagedManagementTarget {
  side: 'customer' | 'sponsor';
  customerTenant: string;
  relationshipId: string;
  otherTenant: string;
  operationId: string | null;
  clientId: string | null;
  relationshipState: string;
  ended: boolean;
}

export interface CoManagedRelationshipOption {
  relationshipId: string;
  operationId: string;
  state: string;
  ended: boolean;
  workspaceName: string | null;
}

export type CoManagedTargetResolution =
  | { kind: 'resolved'; target: CoManagedManagementTarget }
  | { kind: 'absent' }
  | { kind: 'selection-required'; relationships: CoManagedRelationshipOption[] };

function relationshipEnded(relationship: { state: string; ended_at?: unknown }): boolean {
  return relationship.state === 'terminated' || Boolean(relationship.ended_at);
}

interface ClientRelationshipEntry {
  operation: any; relationship: { state: string; ended_at?: unknown; revision?: number }; ended: boolean;
}

/** Authorized discovery of every sponsor-owned operation mapped to a local client.
 * Policy-hidden mappings are intentionally omitted from the projection. */
async function discoverClientRelationships(context: ManagementContext, clientId: string): Promise<ClientRelationshipEntry[]> {
  const query = operations(context).where('q.auth_client', clientId);
  const rows = await query.orderBy('q.created_at', 'desc').orderBy('q.operation_id');
  const entries: ClientRelationshipEntry[] = [];
  for (const operation of rows) {
    const relationship = await tenantDb(context.trx, operation.customer_tenant).table('co_management_relationships')
      .where({ relationship_id: operation.relationship_id, sponsor_tenant: context.actor.tenant, sponsor_client_id: operation.auth_client })
      .first('state', 'ended_at', 'revision');
    if (!relationship) continue;
    entries.push({ operation, relationship, ended: relationshipEnded(relationship) });
  }
  return entries;
}

function relationshipOption(context: ManagementContext, entry: ClientRelationshipEntry): CoManagedRelationshipOption {
  return { relationshipId: entry.operation.relationship_id as string, operationId: entry.operation.operation_id as string,
    state: entry.relationship.state, ended: entry.ended,
    workspaceName: hidden(context, workspaceNames) ? null : entry.operation.request.workspaceName as string };
}

function resolvedTarget(context: ManagementContext, clientId: string | null, entry: ClientRelationshipEntry): CoManagedTargetResolution {
  return { kind: 'resolved', target: { side: 'sponsor', customerTenant: entry.operation.customer_tenant as string,
    relationshipId: entry.operation.relationship_id as string, otherTenant: entry.operation.customer_tenant as string,
    operationId: entry.operation.operation_id as string, clientId, relationshipState: entry.relationship.state, ended: entry.ended } };
}

async function resolveCustomerHome(self: Knex, actor: CoManagedSessionActor): Promise<CoManagedTargetResolution> {
  return withTransaction(self, async trx => {
    const home = tenantDb(trx, actor.tenant);
    if ((await home.table('tenants').first('product_code'))?.product_code !== 'co_managed') deny();
    const relationship = await home.table('co_management_relationships').whereNull('ended_at')
      .first('relationship_id', 'sponsor_tenant', 'state');
    if (!relationship) return { kind: 'absent' };
    return { kind: 'resolved', target: { side: 'customer', customerTenant: actor.tenant,
      relationshipId: relationship.relationship_id as string, otherTenant: relationship.sponsor_tenant as string,
      operationId: null, clientId: null, relationshipState: relationship.state as string, ended: false } };
  });
}

async function resolveSponsorClient(self: Knex, actor: CoManagedSessionActor,
  selector: { clientId: string; relationshipId?: string }): Promise<CoManagedTargetResolution> {
  if (!isCoManagedUuid(selector.clientId) || (selector.relationshipId !== undefined && !isCoManagedUuid(selector.relationshipId))) deny();
  const clientId = selector.clientId;
  return withManagement(self, actor, 'read', async context => {
    if (hidden(context, ['client_id', 'clients.client_id'])) deny();
    if (!await setupChoices(context).where('q.client_id', clientId).first('q.client_id')) deny();
    const entries = await discoverClientRelationships(context, clientId);
    if (selector.relationshipId) {
      const selected = entries.find(entry => entry.operation.relationship_id === selector.relationshipId);
      if (!selected) return deny();
      return resolvedTarget(context, clientId, selected);
    }
    const current = entries.filter(entry => !entry.ended);
    if (current.length === 1) return resolvedTarget(context, clientId, current[0]);
    if (current.length === 0 && entries.length === 0) return { kind: 'absent' };
    // Multiple current relationships, or only a terminated history, require an
    // explicit relationship selection rather than an implicit first/newest pick.
    return { kind: 'selection-required', relationships: entries.map(entry => relationshipOption(context, entry)) };
  });
}

export async function resolveCoManagedManagementTarget(db: Knex, actor: CoManagedSessionActor,
  selector: CoManagedManagementSelector): Promise<CoManagedTargetResolution> {
  if (!selector || typeof selector !== 'object') deny();
  if (selector.kind === 'customer-home') return resolveCustomerHome(db, actor);
  if (selector.kind === 'sponsor-client') return resolveSponsorClient(db, actor, selector);
  return deny();
}

export interface CoManagedOperationTarget {
  clientId: string;
  relationshipId: string;
  operationId: string;
  customerTenant: string;
  state: string;
  ended: boolean;
  workspaceName: string | null;
}

/** Maps a legacy sponsor operation URL to its authorized canonical local client
 * and exact relationship for presentation redirection. A supplied client ID is
 * never allowed to override a mismatching persisted operation. */
export async function getCoManagedOperationTarget(db: Knex, actor: CoManagedSessionActor, operationId: string,
  expectedClientId?: string): Promise<CoManagedOperationTarget | null> {
  if (!isCoManagedUuid(operationId) || (expectedClientId !== undefined && !isCoManagedUuid(expectedClientId))) return null;
  try {
    return await withManagement(db, actor, 'read', async context => {
      const allowed = await operations(context).where('q.operation_id', operationId).first();
      if (!allowed) return null;
      if (expectedClientId !== undefined && allowed.auth_client !== expectedClientId) return null;
      const operation = await retainOperation(context, operationId);
      const relationship = await tenantDb(context.trx, operation.customer_tenant).table('co_management_relationships')
        .where('relationship_id', operation.relationship_id).first('state', 'ended_at');
      return { clientId: allowed.auth_client as string, relationshipId: operation.relationship_id,
        operationId: operation.operation_id, customerTenant: operation.customer_tenant,
        state: relationship?.state ?? 'unknown', ended: relationship ? relationshipEnded(relationship) : true,
        workspaceName: hidden(context, workspaceNames) ? null : operation.request.workspaceName as string };
    });
  } catch (error) { if (error instanceof CoManagedSharedWorkError) return null; throw error; }
}

export interface CoManagedClientRelationshipView extends CoManagedRelationshipOption {
  seats: number;
  usedSeats: number | null;
  administratorEmail: string | null;
  canManage: boolean;
  canChangeSeats: boolean;
  canRetry: boolean;
  canCancel: boolean;
  invitationExpired: boolean;
  deliveryFailed: boolean;
}

export interface CoManagedClientManagementView {
  clientId: string;
  clientName: string | null;
  selectionRequired: boolean;
  selectedRelationshipId: string | null;
  canManage: boolean;
  relationships: CoManagedClientRelationshipView[];
}

/** Per-client read adapter backed by the management domain. Discovers all
 * authorized sponsor-owned mappings directly instead of filtering a paginated
 * global list. Seat usage uses the shared admission count and is never returned
 * without per-relationship management authority. */
export async function getCoManagedClientManagement(db: Knex, actor: CoManagedSessionActor, clientId: string,
  relationshipId?: string): Promise<CoManagedClientManagementView> {
  if (!isCoManagedUuid(clientId) || (relationshipId !== undefined && !isCoManagedUuid(relationshipId))) deny();
  return withManagement(db, actor, 'read', async context => {
    if (hidden(context, ['client_id', 'clients.client_id'])) deny();
    const client = await setupChoices(context).where('q.client_id', clientId).first('q.client_id', 'q.client_name');
    if (!client) deny();
    const entries = await discoverClientRelationships(context, clientId);
    const relationships: CoManagedClientRelationshipView[] = [];
    for (const entry of entries) {
      const operation = entry.operation;
      const customer = tenantDb(context.trx, operation.customer_tenant);
      let canManage = client !== null && context.canManage;
      if (canManage) try { await authorizeCoManagedLocalRecord(context.trx, context.actor, context.subject, 'co_management', 'manage',
        { id: operation.operation_id, clientId: operation.auth_client, boardId: operation.auth_board }); }
      catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; canManage = false; }
      const allocation = await context.home.table('co_managed_allocations').where({ operation_id: operation.operation_id,
        customer_tenant: operation.customer_tenant, relationship_id: operation.relationship_id }).first('seats', 'state');
      const invitation = operation.state === 'pending_acceptance' && entry.relationship.state === 'pending_acceptance'
        ? await customer.table('user_invitations').where({ invitation_id: operation.administrator_invitation_id }).first('expires_at', 'email', 'used_at') : null;
      const invitationExpired = Boolean(invitation && !invitation.used_at && new Date(invitation.expires_at).getTime() <= Date.now());
      relationships.push({ ...relationshipOption(context, entry),
        seats: Number(allocation?.seats ?? operation.request.seats),
        // Aggregate seat usage is only reported to a relationship manager while
        // the relationship is live; an ended relationship never refreshes
        // current customer-private state.
        usedSeats: canManage && !entry.ended ? await countCoManagedCommittedSeats(context.trx, operation.customer_tenant) : null,
        administratorEmail: hidden(context, administratorEmails) ? null : operation.request.administrator.email as string,
        canManage,
        canChangeSeats: Boolean(canManage && allocation && allocation.state !== 'released' && operation.state === 'pending_acceptance' &&
          ['active', 'pending_acceptance'].includes(entry.relationship.state)),
        canCancel: Boolean(canManage && allocation?.state === 'reserved' && ['provisioning', 'pending_acceptance'].includes(entry.relationship.state) &&
          ['queued', 'provisioning', 'failed', 'pending_acceptance'].includes(operation.state)),
        canRetry: canManage && (['queued', 'provisioning', 'failed', 'cleanup_requested'].includes(operation.state) ||
          Boolean(invitation && !invitation.used_at && (!operation.invitation_sent_at || invitationExpired))),
        invitationExpired, deliveryFailed: Boolean(operation.invitation_delivery_error) });
    }
    const current = relationships.filter(entry => !entry.ended);
    const selected = relationshipId ? relationships.find(entry => entry.relationshipId === relationshipId)
      : current.length === 1 ? current[0] : undefined;
    return { clientId, clientName: hidden(context, workspaceNames) ? null : client.client_name as string,
      selectionRequired: !selected && relationships.length > 0,
      selectedRelationshipId: selected?.relationshipId ?? null, canManage: context.canManage, relationships };
  });
}

export async function changeCoManagedAllocationForActor(db: Knex, actor: CoManagedSessionActor,
  input: { operationId: string; seats: number; expectedSeats: number }) {
  const request = { operationId: input?.operationId, seats: input?.seats, expectedSeats: input?.expectedSeats };
  return withCoManagedManagementOperation(db, actor, request.operationId, (trx, operation) => changeCoManagedAllocation(trx, operation.tenant,
    { customerTenant: operation.customer_tenant, relationshipId: operation.relationship_id, seats: request.seats, expectedSeats: request.expectedSeats }));
}

export interface CoManagedManagementStatusItem {
  operationId: string; workspaceName: string | null; administratorEmail: string | null; seats: number; canManage: boolean;
  canChangeSeats: boolean; canCancel: boolean; cleanupFailed: boolean; state: string; invitationSent: boolean;
  invitationExpired: boolean; deliveryFailed: boolean; canRetry: boolean;
}

export interface CoManagedClientOverviewRow {
  clientId: string;
  clientName: string | null;
  relationshipId: string;
  operationId: string;
  workspaceName: string | null;
  administratorEmail: string | null;
  state: string;
  ended: boolean;
  seats: number;
  usedSeats: number | null;
  invitationExpired: boolean;
  deliveryFailed: boolean;
  cleanupFailed: boolean;
  canManage: boolean;
  canRetry: boolean;
  canCancel: boolean;
}

export interface CoManagedClientOverviewPage {
  rows: CoManagedClientOverviewRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/** Authorized, searchable, paginated cross-client overview. Search, sort, and
 * count run inside the same record-policy projection before pagination, so a
 * viewer can never infer restricted-client counts by subtraction. */
export async function getCoManagedClientOverview(db: Knex, actor: CoManagedSessionActor,
  input: { search?: string; page?: number; pageSize?: number } = {}): Promise<CoManagedClientOverviewPage> {
  const search = input.search ?? '';
  const page = input.page ?? 1, pageSize = input.pageSize ?? 25;
  if (typeof search !== 'string' || search.length > 200 || !Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) deny();
  return withManagement(db, actor, 'read', async context => {
    const build = () => {
      const query = operations(context);
      if (search.trim()) query.whereILike('q.auth_client_name', `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`);
      return query;
    };
    const total = await build().count({ count: '*' }).first();
    const rows = await build().orderBy('q.auth_client_name').orderBy('q.operation_id').offset((page - 1) * pageSize).limit(pageSize);
    const out: CoManagedClientOverviewRow[] = [];
    for (const operation of rows) {
      let canManage = context.canManage;
      if (canManage) try { await authorizeCoManagedLocalRecord(context.trx, context.actor, context.subject, 'co_management', 'manage',
        { id: operation.operation_id, clientId: operation.auth_client, boardId: operation.auth_board }); }
      catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; canManage = false; }
      const customer = tenantDb(context.trx, operation.customer_tenant);
      const relationship = await customer.table('co_management_relationships').where({ relationship_id: operation.relationship_id,
        sponsor_tenant: context.actor.tenant, sponsor_client_id: operation.auth_client }).first('state', 'ended_at');
      const ended = relationship ? relationshipEnded(relationship) : true;
      const allocation = await context.home.table('co_managed_allocations').where({ operation_id: operation.operation_id,
        customer_tenant: operation.customer_tenant, relationship_id: operation.relationship_id }).first('seats', 'state');
      const invitation = operation.state === 'pending_acceptance' && relationship?.state === 'pending_acceptance'
        ? await customer.table('user_invitations').where({ invitation_id: operation.administrator_invitation_id }).first('expires_at', 'used_at') : null;
      const invitationExpired = Boolean(invitation && !invitation.used_at && new Date(invitation.expires_at).getTime() <= Date.now());
      out.push({ clientId: operation.auth_client as string,
        clientName: hidden(context, ['client_name', 'clients.client_name']) ? null : operation.auth_client_name ?? null,
        relationshipId: operation.relationship_id, operationId: operation.operation_id,
        workspaceName: hidden(context, workspaceNames) ? null : operation.request.workspaceName as string,
        administratorEmail: hidden(context, administratorEmails) ? null : operation.request.administrator.email as string,
        state: (operation.state === 'cancelled' ? 'cancelled'
          : relationship && ['active', 'terminated'].includes(relationship.state) ? relationship.state : operation.state) as string,
        ended, seats: Number(allocation?.seats ?? operation.request.seats),
        usedSeats: canManage && !ended ? await countCoManagedCommittedSeats(context.trx, operation.customer_tenant) : null,
        invitationExpired, deliveryFailed: Boolean(operation.invitation_delivery_error),
        cleanupFailed: operation.error_code === 'PROVISIONING_CLEANUP_FAILED', canManage,
        canRetry: canManage && (['queued', 'provisioning', 'failed', 'cleanup_requested'].includes(operation.state) || invitationExpired),
        canCancel: Boolean(canManage && allocation?.state === 'reserved' && ['provisioning', 'pending_acceptance'].includes(relationship?.state ?? '') &&
          ['queued', 'provisioning', 'failed', 'pending_acceptance'].includes(operation.state)) });
    }
    return { rows: out, totalCount: Number(total?.count ?? 0), page, pageSize };
  });
}

export async function getCoManagedManagementStatus(db: Knex, actor: CoManagedSessionActor, page = 0) {
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000000) deny();
  return withManagement(db, actor, 'read', async context => {
    const query = operations(context);
    if (!hidden(context, ['created_at', 'co_managed_provisioning_operations.created_at'])) query.orderBy('q.created_at', 'desc');
    const rows = await query.orderBy('q.operation_id').offset(page * 25).limit(26);
    const items: CoManagedManagementStatusItem[] = [];
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
        ? await customer.table('user_invitations').where({ invitation_id: operation.administrator_invitation_id }).first('expires_at', 'email', 'used_at') : null;
      const awaitingAdministrator = Boolean(invitation && !invitation.used_at && !await customer.table('users').where('user_type', 'internal')
        .whereRaw('lower(trim(email)) = ?', [invitation.email.trim().toLowerCase()]).first('user_id'));
      const customerClaimed = Boolean(invitation?.used_at || await customer.table('users').first('user_id'));
      const invitationExpired = awaitingAdministrator && new Date(invitation.expires_at).getTime() <= Date.now();
      items.push({ operationId: operation.operation_id as string,
        workspaceName: hidden(context, workspaceNames) ? null : operation.request.workspaceName as string,
        administratorEmail: hidden(context, administratorEmails) ? null : operation.request.administrator.email as string,
        seats: Number(allocation?.seats ?? operation.request.seats), canManage,
        canChangeSeats: Boolean(canManage && allocation && allocation.state !== 'released' && operation.state === 'pending_acceptance' && ['active', 'pending_acceptance'].includes(relationship?.state)),
        canCancel: Boolean(canManage && allocation?.state === 'reserved' && !customerClaimed && ['provisioning', 'pending_acceptance'].includes(relationship?.state) &&
          ['queued', 'provisioning', 'failed', 'pending_acceptance'].includes(operation.state)),
        cleanupFailed: operation.error_code === 'PROVISIONING_CLEANUP_FAILED',
        state: (operation.state === 'cancelled' ? 'cancelled' : ['active', 'terminated'].includes(relationship?.state) ? relationship.state : operation.state) as string,
        invitationSent: Boolean(operation.invitation_sent_at), invitationExpired, deliveryFailed: Boolean(operation.invitation_delivery_error),
        canRetry: canManage && (['queued', 'provisioning', 'failed', 'cleanup_requested'].includes(operation.state) || awaitingAdministrator && (!operation.invitation_sent_at || invitationExpired)),
      });
    }
    return { items, hasMore: rows.length > 25, canManage: context.canManage, canCreate: context.canManage };
  });
}
