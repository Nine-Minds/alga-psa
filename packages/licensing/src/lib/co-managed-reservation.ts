import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getCoManagedLicenseCapacity } from './co-managed-license';
import { admitCoManagedPermissions } from './co-managed-admission-permissions';
import { readCoManagedPoolCapacity, type CoManagedAllocationKind } from './co-managed-capacity';
import { materializeState } from './co-managed-entitlements';

export class CoManagedReservationError extends Error {
  /**
   * @param existingKind Set with `CLIENT_HAS_ARRANGEMENT`: the shape of the live allocation the
   * client already holds.
   */
  constructor(public readonly code:
    | 'INVALID_RESERVATION' | 'SPONSOR_NOT_ELIGIBLE' | 'CAPACITY_UNAVAILABLE'
    | 'CLIENT_NOT_FOUND' | 'OPERATION_CONFLICT' | 'ENTITLEMENT_LAPSED' | 'CLIENT_HAS_ARRANGEMENT',
    public readonly existingKind?: CoManagedAllocationKind) {
    super(code);
    this.name = 'CoManagedReservationError';
  }
}

interface ReservationInput {
  sponsorTenant: string;
  clientId: string;
  operationId: string;
  seats: number;
  visibilityMode: 'board_scope' | 'escalation_only';
}

export interface CoManagedReservation {
  allocation_id: string;
  operation_id: string;
  customer_tenant: string;
  relationship_id: string;
  seats: number;
  state: 'reserved' | 'active' | 'released';
}

export interface CoManagedSeatAllocationRecord {
  allocation_id: string;
  operation_id: string;
  sponsor_client_id: string;
  seats: number;
  state: 'reserved' | 'active' | 'released';
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A sponsor that may hold a pool at all: a PSA tenant, on Pro when hosted, that is not itself a
 * co-managed customer. Caller holds the sponsor entitlement row lock. */
async function readEligibleSponsor(trx: Knex.Transaction, sponsorTenant: string, entitlement: { source: string }):
  Promise<{ suspended_at: unknown } | null> {
  const sponsor = tenantDb(trx, sponsorTenant);
  const tenant = await sponsor.table('tenants').select('product_code', 'plan', 'suspended_at').forShare().first();
  const sponsorship = await sponsor.table('co_management_relationships').whereNull('ended_at').first();
  if (!tenant || tenant.product_code !== 'psa' || sponsorship ||
      (entitlement.source === 'hosted' && tenant.plan !== 'pro')) return null;
  return tenant;
}

/**
 * The shape of the live allocation a client already holds, if any. A client has one live
 * arrangement, of either kind. Caller holds the sponsor entitlement row lock, which every
 * allocation writer takes, so the answer cannot change before the caller's own insert.
 *
 * A workspace allocation written before `sponsor_client_id` was recorded on the row names its
 * client only on the relationship, in the customer tenant; those are resolved one tenant at a time.
 */
async function liveAllocationKindForClient(trx: Knex.Transaction, sponsorTenant: string, clientId: string):
  Promise<CoManagedAllocationKind | null> {
  const live: Array<{ allocation_kind: CoManagedAllocationKind; sponsor_client_id: string | null;
    customer_tenant: string | null; relationship_id: string | null }> =
    await tenantDb(trx, sponsorTenant).table('co_managed_allocations').whereNot('state', 'released')
      .where((scope) => scope.where('sponsor_client_id', clientId).orWhereNull('sponsor_client_id'))
      .select('allocation_kind', 'sponsor_client_id', 'customer_tenant', 'relationship_id');
  const named = live.find((row) => row.sponsor_client_id === clientId);
  if (named) return named.allocation_kind;
  for (const row of live) {
    if (!row.customer_tenant || !row.relationship_id) continue;
    const relationship = await tenantDb(trx, row.customer_tenant).table('co_management_relationships')
      .where({ relationship_id: row.relationship_id, sponsor_tenant: sponsorTenant, sponsor_client_id: clientId })
      .first('relationship_id');
    if (relationship) return row.allocation_kind;
  }
  return null;
}

/**
 * Internal provisioning primitive; caller must authorize sponsor administration.
 * Reserves a new workspace identity and capacity atomically. Does not create a
 * login, start a worker, or grant access to customer data. Capacity writers and
 * allocation changes must take this same sponsor entitlement row lock.
 */
export async function reserveCoManagedWorkspace(
  db: Knex,
  input: ReservationInput,
): Promise<CoManagedReservation> {
  if (![input.sponsorTenant, input.clientId, input.operationId].every((id) => uuid.test(id)) ||
      !Number.isSafeInteger(input.seats) || input.seats < 1 || input.seats > 2147483647 ||
      !['board_scope', 'escalation_only'].includes(input.visibilityMode)) {
    throw new CoManagedReservationError('INVALID_RESERVATION');
  }

  const fingerprint = createHash('sha256').update(JSON.stringify([
    input.sponsorTenant, input.clientId, input.seats, input.visibilityMode,
  ])).digest('hex');

  return db.transaction(async (trx) => {
    const sponsor = tenantDb(trx, input.sponsorTenant);
    const entitlement = await sponsor.table('co_managed_entitlements').forUpdate().first();
    if (!entitlement) throw new CoManagedReservationError('CAPACITY_UNAVAILABLE');

    const existing = await sponsor.table('co_managed_allocations')
      .where('operation_id', input.operationId).first();
    if (existing) {
      // A seat allocation has no customer tenant; its operation id is not this request's.
      if (existing.allocation_kind === 'seat') throw new CoManagedReservationError('OPERATION_CONFLICT');
      const relationship = await tenantDb(trx, existing.customer_tenant)
        .table('co_management_relationships').where('relationship_id', existing.relationship_id).first();
      if (existing.request_fingerprint !== fingerprint || relationship?.sponsor_tenant !== input.sponsorTenant) {
        throw new CoManagedReservationError('OPERATION_CONFLICT');
      }
      return reservationResult(existing);
    }

    if (!await readEligibleSponsor(trx, input.sponsorTenant, entitlement)) {
      throw new CoManagedReservationError('SPONSOR_NOT_ELIGIBLE');
    }
    const client = await sponsor.table('clients').where('client_id', input.clientId).first();
    if (!client) throw new CoManagedReservationError('CLIENT_NOT_FOUND');
    const held = await liveAllocationKindForClient(trx, input.sponsorTenant, input.clientId);
    if (held) throw new CoManagedReservationError('CLIENT_HAS_ARRANGEMENT', held);

    // Read the clock after acquiring the lock: a waiter cannot grow a pool using
    // an entitlement that expired while it was blocked on another reservation.
    const clock = await trx.raw('SELECT clock_timestamp() AS now');
    const now = new Date(clock.rows[0].now);
    if (entitlement.lapse_started_at || new Date(entitlement.valid_until).getTime() <= now.getTime() ||
        new Date(entitlement.verified_at).getTime() > now.getTime()) {
      throw new CoManagedReservationError('CAPACITY_UNAVAILABLE');
    }
    const capacity = entitlement.source === 'self_host'
      ? getCoManagedLicenseCapacity(entitlement.signed_license, input.sponsorTenant, now)
      : entitlement.source === 'hosted' || entitlement.source === 'admin_grant' ? entitlement.capacity : 0;
    const pool = await readCoManagedPoolCapacity(trx, input.sponsorTenant, capacity);
    if (input.seats > pool.available) {
      throw new CoManagedReservationError('CAPACITY_UNAVAILABLE');
    }

    // A direct caller may bypass the server's admission step; retain a first-use
    // fallback here, without restoring grants removed after admission.
    if (!await sponsor.table('permissions').where({ resource: 'co_management' }).first('permission_id')) {
      await admitCoManagedPermissions(trx, input.sponsorTenant);
    }

    const customerTenant = randomUUID();
    const relationshipId = randomUUID();
    const allocationId = randomUUID();
    // write-admission: exempt — seat reservation lifecycle owned by licensing; it decides admission rather than being subject to it
    await tenantDb(trx, customerTenant).table('co_management_relationships').insert({
      tenant: customerTenant,
      relationship_id: relationshipId,
      sponsor_tenant: input.sponsorTenant,
      sponsor_client_id: input.clientId,
      visibility_mode: input.visibilityMode,
      state: 'provisioning',
    });
    // write-admission: exempt — seat reservation lifecycle owned by licensing; it decides admission rather than being subject to it
    const [allocation] = await sponsor.table('co_managed_allocations').insert({
      tenant: input.sponsorTenant,
      allocation_id: allocationId,
      operation_id: input.operationId,
      request_fingerprint: fingerprint,
      customer_tenant: customerTenant,
      relationship_id: relationshipId,
      sponsor_client_id: input.clientId,
      seats: input.seats,
      state: 'reserved',
    }).returning('*');
    return reservationResult(allocation);
  });
}

interface SeatAllocationInput {
  sponsorTenant: string;
  clientId: string;
  operationId: string;
  seats: number;
}

/**
 * Internal primitive; caller must authorize sponsor administration and access to the client.
 * Takes seats from the sponsor's pool for one of its own clients: the allocation is reserved and
 * active in one step, because a seat arrangement has no workspace to provision in between. Creates
 * no arrangement, invitation or login.
 *
 * Idempotent on `operationId`: a replay of the same request returns the allocation as it now
 * stands, whatever has happened to the pool since; the same id with different details is a
 * conflict. Refusals are not recorded, so a refused request may be retried under the same id.
 *
 * Refuses with `SPONSOR_NOT_ELIGIBLE`, `CLIENT_NOT_FOUND`, `CLIENT_HAS_ARRANGEMENT` (carrying the
 * existing shape), `ENTITLEMENT_LAPSED` (lapse grace or read-only) or `CAPACITY_UNAVAILABLE`.
 */
export async function reserveAndActivateCoManagedSeatAllocation(
  db: Knex,
  input: SeatAllocationInput,
): Promise<CoManagedSeatAllocationRecord> {
  if (![input.sponsorTenant, input.clientId, input.operationId].every((id) => uuid.test(id)) ||
      !Number.isSafeInteger(input.seats) || input.seats < 1 || input.seats > 2147483647) {
    throw new CoManagedReservationError('INVALID_RESERVATION');
  }

  const fingerprint = createHash('sha256').update(JSON.stringify([
    'seat', input.sponsorTenant, input.clientId, input.seats,
  ])).digest('hex');

  return db.transaction(async (trx) => {
    const sponsor = tenantDb(trx, input.sponsorTenant);
    const entitlement = await sponsor.table('co_managed_entitlements').forUpdate().first();
    if (!entitlement) throw new CoManagedReservationError('CAPACITY_UNAVAILABLE');

    const existing = await sponsor.table('co_managed_allocations')
      .where('operation_id', input.operationId).first();
    if (existing) {
      if (existing.allocation_kind !== 'seat' || existing.request_fingerprint !== fingerprint) {
        throw new CoManagedReservationError('OPERATION_CONFLICT');
      }
      return seatAllocationResult(existing);
    }

    // A suspended sponsor sponsors nothing new; say so rather than reporting its lapsed pool.
    const tenant = await readEligibleSponsor(trx, input.sponsorTenant, entitlement);
    if (!tenant || tenant.suspended_at) throw new CoManagedReservationError('SPONSOR_NOT_ELIGIBLE');
    const client = await sponsor.table('clients').where('client_id', input.clientId).first();
    if (!client) throw new CoManagedReservationError('CLIENT_NOT_FOUND');
    const held = await liveAllocationKindForClient(trx, input.sponsorTenant, input.clientId);
    if (held) throw new CoManagedReservationError('CLIENT_HAS_ARRANGEMENT', held);

    // The entitlement's own reading of the pool, taken under the lock: it reads the clock after
    // the lock, so a waiter cannot take seats from a pool that lapsed while it was blocked.
    const pool = await materializeState(trx, input.sponsorTenant, entitlement, new Date());
    if (pool.isReadOnly || pool.graceEndsAt) throw new CoManagedReservationError('ENTITLEMENT_LAPSED');
    if (input.seats > pool.available) throw new CoManagedReservationError('CAPACITY_UNAVAILABLE');

    // write-admission: exempt — seat reservation lifecycle owned by licensing; it decides admission rather than being subject to it
    const [allocation] = await sponsor.table('co_managed_allocations').insert({
      tenant: input.sponsorTenant,
      allocation_id: randomUUID(),
      operation_id: input.operationId,
      request_fingerprint: fingerprint,
      allocation_kind: 'seat',
      sponsor_client_id: input.clientId,
      seats: input.seats,
      state: 'active',
    }).returning('*');
    return seatAllocationResult(allocation);
  });
}

function seatAllocationResult(row: CoManagedSeatAllocationRecord): CoManagedSeatAllocationRecord {
  return {
    allocation_id: row.allocation_id, operation_id: row.operation_id,
    sponsor_client_id: row.sponsor_client_id, seats: row.seats, state: row.state,
  };
}

function reservationResult(row: CoManagedReservation): CoManagedReservation {
  return {
    allocation_id: row.allocation_id, operation_id: row.operation_id,
    customer_tenant: row.customer_tenant, relationship_id: row.relationship_id,
    seats: row.seats, state: row.state,
  };
}
