import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, tenantTableMetadata } from '@alga-psa/db';
import { reserveCoManagedWorkspace, getCoManagedEntitlementState } from '@alga-psa/licensing';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface CoManagedProvisioningRequest {
  sponsorTenant: string;
  operationId: string;
  requestedBy: string;
  clientId: string;
  workspaceName: string;
  administrator: { firstName: string; lastName: string; email: string };
  seats: number;
  visibilityMode: 'board_scope' | 'escalation_only';
  escalationBoardId: string;
}
export interface CoManagedProvisioningOperation {
  tenant: string;
  operation_id: string;
  allocation_id: string;
  customer_tenant: string;
  relationship_id: string;
  requested_by: string;
  escalation_board_id: string;
  customer_board_id: string;
  customer_client_id: string;
  administrator_invitation_id: string;
  request_fingerprint: string;
  request: Omit<CoManagedProvisioningRequest, 'sponsorTenant' | 'operationId' | 'requestedBy'>;
  state: 'queued' | 'provisioning' | 'pending_acceptance' | 'failed' | 'cleanup_requested' | 'cancelled';
  step: string | null;
  error_code: string | null;
}

export class CoManagedProvisioningError extends Error {
  constructor(public readonly code: 'INVALID_REQUEST' | 'OPERATION_CONFLICT' | 'OPERATION_NOT_FOUND' |
    'ACTOR_NOT_FOUND' | 'DESTINATION_NOT_FOUND' | 'OPERATION_CLOSED' | 'RELATIONSHIP_ACTIVE' |
    'CLEANUP_INCOMPLETE' | 'RESERVATION_NOT_FOUND' | 'CAPACITY_UNAVAILABLE') {
    super({ INVALID_REQUEST: 'Provide a workspace name, customer administrator, and valid provisioning details.',
      OPERATION_CONFLICT: 'This provisioning operation was started with different details.',
      OPERATION_NOT_FOUND: 'Provisioning operation not found.', ACTOR_NOT_FOUND: 'An active internal sponsor user is required.',
      DESTINATION_NOT_FOUND: 'Select an active escalation board in the sponsoring workspace.',
      OPERATION_CLOSED: 'This provisioning operation cannot run in its current state.',
      RELATIONSHIP_ACTIVE: 'An accepted relationship must use the customer departure process.',
      CLEANUP_INCOMPLETE: 'Customer workspace cleanup must complete before releasing its seats.',
      RESERVATION_NOT_FOUND: 'The provisioning reservation is no longer valid.',
      CAPACITY_UNAVAILABLE: 'Restore the sponsoring Pro license and co-managed capacity before provisioning.',
    }[code]);
    this.name = 'CoManagedProvisioningError';
  }
}

function normalizeRequest(input: CoManagedProvisioningRequest): CoManagedProvisioningOperation['request'] {
  if (![input.sponsorTenant, input.operationId, input.requestedBy, input.clientId, input.escalationBoardId].every(id => uuid.test(id)) ||
      !Number.isSafeInteger(input.seats) || input.seats < 1 || input.seats > 2147483647 ||
      !['board_scope', 'escalation_only'].includes(input.visibilityMode)) throw new CoManagedProvisioningError('INVALID_REQUEST');
  const text = (value: unknown, max: number) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new CoManagedProvisioningError('INVALID_REQUEST');
    return value.trim();
  };
  const email = text(input.administrator?.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CoManagedProvisioningError('INVALID_REQUEST');
  return { clientId: input.clientId, workspaceName: text(input.workspaceName, 200),
    administrator: { firstName: text(input.administrator?.firstName, 100), lastName: text(input.administrator?.lastName, 100), email },
    seats: input.seats, visibilityMode: input.visibilityMode, escalationBoardId: input.escalationBoardId };
}

/** Caller authorizes sponsor administration and client access before entering.
 * This durable record contains no password, invitation token, or customer login.
 * Both reservation and full request commit together before scheduling a worker. */
export async function prepareCoManagedProvisioning(db: Knex, input: CoManagedProvisioningRequest): Promise<CoManagedProvisioningOperation> {
  const request = normalizeRequest(input);
  const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  return db.transaction(async trx => {
    const reservation = await reserveCoManagedWorkspace(trx, { ...input, visibilityMode: request.visibilityMode });
    const sponsor = tenantDb(trx, input.sponsorTenant);
    const actor = await sponsor.table('users').where({ user_id: input.requestedBy, user_type: 'internal', is_inactive: false }).first();
    if (!actor) throw new CoManagedProvisioningError('ACTOR_NOT_FOUND');
    const existing: CoManagedProvisioningOperation | undefined = await sponsor.table('co_managed_provisioning_operations')
      .where('operation_id', input.operationId).first();
    if (existing) {
      if (existing.request_fingerprint !== fingerprint) throw new CoManagedProvisioningError('OPERATION_CONFLICT');
      return existing;
    }
    if (reservation.state !== 'reserved') throw new CoManagedProvisioningError('OPERATION_CLOSED');
    const board = await sponsor.table('boards').where({ board_id: input.escalationBoardId, is_inactive: false }).forShare().first();
    if (!board) throw new CoManagedProvisioningError('DESTINATION_NOT_FOUND');
    const [operation] = await sponsor.table('co_managed_provisioning_operations').insert({
      tenant: input.sponsorTenant, operation_id: input.operationId, allocation_id: reservation.allocation_id,
      customer_tenant: reservation.customer_tenant, relationship_id: reservation.relationship_id,
      requested_by: input.requestedBy, escalation_board_id: request.escalationBoardId,
      customer_board_id: randomUUID(), customer_client_id: randomUUID(), administrator_invitation_id: randomUUID(),
      request_fingerprint: fingerprint, request, state: 'queued',
    }).returning('*');
    return operation;
  });
}

async function lockOperation(trx: Knex.Transaction, sponsorTenant: string, operationId: string, allowCompleted = false): Promise<CoManagedProvisioningOperation> {
  const sponsor = tenantDb(trx, sponsorTenant);
  // Capacity mutations use entitlement -> sponsor -> operation -> relationship.
  await sponsor.table('co_managed_entitlements').forUpdate().first();
  await sponsor.table('tenants').forShare().first();
  const operation: CoManagedProvisioningOperation | undefined = await sponsor.table('co_managed_provisioning_operations')
    .where('operation_id', operationId).forUpdate().first();
  if (!operation) throw new CoManagedProvisioningError('OPERATION_NOT_FOUND');
  const relationship = await tenantDb(trx, operation.customer_tenant).table('co_management_relationships')
    .where('relationship_id', operation.relationship_id).forUpdate().first();
  if (!relationship || relationship.sponsor_tenant !== sponsorTenant) throw new CoManagedProvisioningError('RESERVATION_NOT_FOUND');
  if (relationship.state === 'active' && !(allowCompleted && operation.state === 'pending_acceptance')) throw new CoManagedProvisioningError('RELATIONSHIP_ACTIVE');
  if (relationship.ended_at && operation.state !== 'cancelled') throw new CoManagedProvisioningError('OPERATION_CLOSED');
  return operation;
}

async function assertProvisioningCapacity(trx: Knex.Transaction, sponsorTenant: string): Promise<void> {
  const sponsor = tenantDb(trx, sponsorTenant);
  const owner = await sponsor.table('tenants').first();
  const entitlement = await sponsor.table('co_managed_entitlements').first();
  const capacity = await getCoManagedEntitlementState(trx, sponsorTenant);
  if (owner?.product_code !== 'psa' || (entitlement?.source === 'hosted' && owner.plan !== 'pro') ||
      capacity.isReadOnly || capacity.graceEndsAt || capacity.capacity < capacity.allocated ||
      await sponsor.table('co_management_relationships').whereNull('ended_at').first()) {
    throw new CoManagedProvisioningError('CAPACITY_UNAVAILABLE');
  }
}

/** Database-only worker steps commit their changes and progress atomically.
 * Network delivery is a separate idempotent step, outside this transaction. */
const provisioningSteps = ['tenant', 'seeds', 'settings', 'administrator_invitation'] as const;
export async function runCoManagedProvisioningStep<T>(db: Knex, sponsorTenant: string, operationId: string,
  step: typeof provisioningSteps[number],
  work: (trx: Knex.Transaction, operation: CoManagedProvisioningOperation) => Promise<T>): Promise<
    { skipped: true } | { skipped: false; result: T }
  > {
  return db.transaction(async trx => {
    const operation = await lockOperation(trx, sponsorTenant, operationId, true);
    if (operation.state === 'pending_acceptance' && operation.step === 'administrator_invitation') return { skipped: true };
    if (!['queued', 'provisioning', 'failed'].includes(operation.state)) throw new CoManagedProvisioningError('OPERATION_CLOSED');
    const completed = provisioningSteps.indexOf(operation.step as typeof provisioningSteps[number]);
    const requested = provisioningSteps.indexOf(step);
    if (requested < 0 || requested > completed + 1) throw new CoManagedProvisioningError('OPERATION_CLOSED');
    if (requested <= completed) return { skipped: true };
    await assertProvisioningCapacity(trx, sponsorTenant);
    const allocation = await tenantDb(trx, sponsorTenant).table('co_managed_allocations')
      .where({ allocation_id: operation.allocation_id, customer_tenant: operation.customer_tenant,
        relationship_id: operation.relationship_id, state: 'reserved' }).first();
    if (!allocation) throw new CoManagedProvisioningError('RESERVATION_NOT_FOUND');
    const result = await work(trx, operation);
    await tenantDb(trx, sponsorTenant).table('co_managed_provisioning_operations').where('operation_id', operationId)
      .update({ state: 'provisioning', step, error_code: null, updated_at: trx.fn.now() });
    return { skipped: false, result };
  });
}

/** A failure keeps its reservation until a worker proves cleanup completed. */
export async function recordCoManagedProvisioningFailure(db: Knex, sponsorTenant: string, operationId: string): Promise<void> {
  await db.transaction(async trx => {
    const operation = await lockOperation(trx, sponsorTenant, operationId);
    if (!['queued', 'provisioning', 'failed'].includes(operation.state)) return;
    await tenantDb(trx, sponsorTenant).table('co_managed_provisioning_operations').where('operation_id', operationId)
      .update({ state: 'failed', error_code: 'PROVISIONING_FAILED', updated_at: trx.fn.now() });
  });
}

export async function requestCoManagedProvisioningCleanup(db: Knex, sponsorTenant: string, operationId: string): Promise<void> {
  await db.transaction(async trx => {
    const operation = await lockOperation(trx, sponsorTenant, operationId);
    if (operation.state === 'cancelled') return;
    await tenantDb(trx, sponsorTenant).table('co_managed_provisioning_operations').where('operation_id', operationId)
      .update({ state: 'cleanup_requested', updated_at: trx.fn.now() });
  });
}

/** Final cleanup acknowledgement, after deleting the unactivated workspace.
 * Merely receiving a cancel/failure signal is never proof its data is gone. */
export async function completeCoManagedProvisioningCleanup(db: Knex, sponsorTenant: string, operationId: string): Promise<void> {
  await db.transaction(async trx => {
    const operation = await lockOperation(trx, sponsorTenant, operationId);
    if (operation.state === 'cancelled') return;
    if (operation.state !== 'cleanup_requested') throw new CoManagedProvisioningError('OPERATION_CLOSED');
    const customer = tenantDb(trx, operation.customer_tenant);
    if (await customer.table('tenants').first()) throw new CoManagedProvisioningError('CLEANUP_INCOMPLETE');
    const existingTables = await trx('information_schema.tables').where({ table_schema: 'public', table_type: 'BASE TABLE' }).pluck('table_name');
    for (const table of existingTables) {
      if (table === 'co_management_relationships' || tenantTableMetadata[table]?.scope !== 'tenant') continue;
      if (await customer.table(table).first()) throw new CoManagedProvisioningError('CLEANUP_INCOMPLETE');
    }
    await customer.table('co_management_relationships').where('relationship_id', operation.relationship_id)
      .update({ state: 'terminated', ended_at: trx.fn.now(), updated_at: trx.fn.now(), revision: trx.raw('revision + 1') });
    await tenantDb(trx, sponsorTenant).table('co_managed_allocations')
      .where({ allocation_id: operation.allocation_id, customer_tenant: operation.customer_tenant, relationship_id: operation.relationship_id })
      .whereNot('state', 'released').update({ state: 'released', released_at: trx.fn.now(), updated_at: trx.fn.now() });
    await tenantDb(trx, sponsorTenant).table('co_managed_provisioning_operations').where('operation_id', operationId)
      .update({ state: 'cancelled', error_code: null, updated_at: trx.fn.now() });
  });
}

/** Prepare the exact scope the customer administrator will review. A prepared
 * board scope is not an access grant until the relationship is accepted. */
export async function finalizeCoManagedProvisioning(db: Knex, sponsorTenant: string, operationId: string): Promise<void> {
  await db.transaction(async trx => {
    const operation = await lockOperation(trx, sponsorTenant, operationId, true);
    if (operation.state === 'pending_acceptance') return;
    if (operation.state !== 'provisioning' || operation.step !== 'administrator_invitation') {
      throw new CoManagedProvisioningError('OPERATION_CLOSED');
    }
    await assertProvisioningCapacity(trx, sponsorTenant);
    const customer = tenantDb(trx, operation.customer_tenant);
    const owner = await customer.table('tenants').where('product_code', 'co_managed').first();
    const board = await customer.table('boards').where({ board_id: operation.customer_board_id, is_inactive: false }).first();
    const invitation = await customer.table('user_invitations').where({ invitation_id: operation.administrator_invitation_id,
      email: operation.request.administrator.email, used_at: null }).where('expires_at', '>', trx.fn.now()).first();
    const destination = await tenantDb(trx, sponsorTenant).table('boards').where({ board_id: operation.escalation_board_id, is_inactive: false }).first();
    if (!owner || !board || !invitation || !destination) throw new CoManagedProvisioningError('RESERVATION_NOT_FOUND');
    await customer.table('co_management_relationships').where('relationship_id', operation.relationship_id)
      .update({ state: 'pending_acceptance', escalation_board_id: operation.escalation_board_id, updated_at: trx.fn.now() });
    if (operation.request.visibilityMode === 'board_scope') {
      await customer.table('co_management_board_scopes').insert({ tenant: operation.customer_tenant,
        relationship_id: operation.relationship_id, board_id: operation.customer_board_id, can_collaborate: true,
      }).onConflict(['tenant', 'relationship_id', 'board_id']).ignore();
    }
    await tenantDb(trx, sponsorTenant).table('co_managed_provisioning_operations').where('operation_id', operationId)
      .update({ state: 'pending_acceptance', updated_at: trx.fn.now() });
  });
}
