import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getCoManagedLicenseCapacity } from './co-managed-license';

export class CoManagedReservationError extends Error {
  constructor(public readonly code:
    | 'INVALID_RESERVATION' | 'SPONSOR_NOT_ELIGIBLE' | 'CAPACITY_UNAVAILABLE'
    | 'CLIENT_NOT_FOUND' | 'OPERATION_CONFLICT') {
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

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const relationship = await tenantDb(trx, existing.customer_tenant)
        .table('co_management_relationships').where('relationship_id', existing.relationship_id).first();
      if (existing.request_fingerprint !== fingerprint || relationship?.sponsor_tenant !== input.sponsorTenant) {
        throw new CoManagedReservationError('OPERATION_CONFLICT');
      }
      return reservationResult(existing);
    }

    const tenant = await sponsor.table('tenants').select('product_code', 'plan').forShare().first();
    const sponsorship = await sponsor.table('co_management_relationships').whereNull('ended_at').first();
    if (!tenant || tenant.product_code !== 'psa' || sponsorship ||
        (entitlement.source === 'hosted' && tenant.plan !== 'pro')) {
      throw new CoManagedReservationError('SPONSOR_NOT_ELIGIBLE');
    }
    // A payment provider may have applied a reduction whose response was lost.
    // Preserve existing reservations, but do not grow until that operation is
    // reconciled or its checkout is known to have expired.
    if (await sponsor.table('co_managed_purchase_operations').whereIn('state', ['preparing', 'checkout']).first()) {
      throw new CoManagedReservationError('CAPACITY_UNAVAILABLE');
    }
    const client = await sponsor.table('clients').where('client_id', input.clientId).first();
    if (!client) throw new CoManagedReservationError('CLIENT_NOT_FOUND');

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
      : entitlement.source === 'hosted' ? entitlement.capacity : 0;
    const totals = await sponsor.table('co_managed_allocations')
      .whereNot('state', 'released').sum('seats as used').first();
    if (Number(totals?.used ?? 0) + input.seats > capacity) {
      throw new CoManagedReservationError('CAPACITY_UNAVAILABLE');
    }

    const customerTenant = randomUUID();
    const relationshipId = randomUUID();
    const allocationId = randomUUID();
    await tenantDb(trx, customerTenant).table('co_management_relationships').insert({
      tenant: customerTenant,
      relationship_id: relationshipId,
      sponsor_tenant: input.sponsorTenant,
      sponsor_client_id: input.clientId,
      visibility_mode: input.visibilityMode,
      state: 'provisioning',
    });
    const [allocation] = await sponsor.table('co_managed_allocations').insert({
      tenant: input.sponsorTenant,
      allocation_id: allocationId,
      operation_id: input.operationId,
      request_fingerprint: fingerprint,
      customer_tenant: customerTenant,
      relationship_id: relationshipId,
      seats: input.seats,
      state: 'reserved',
    }).returning('*');
    return reservationResult(allocation);
  });
}

function reservationResult(row: CoManagedReservation): CoManagedReservation {
  return {
    allocation_id: row.allocation_id, operation_id: row.operation_id,
    customer_tenant: row.customer_tenant, relationship_id: row.relationship_id,
    seats: row.seats, state: row.state,
  };
}
