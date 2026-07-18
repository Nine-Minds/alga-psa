import { tenantDb } from '@alga-psa/db';
import type { IClientLocation } from '@alga-psa/types';
import type { Knex } from 'knex';

export type CreateClientLocationInput = Omit<
  IClientLocation,
  'location_id' | 'tenant' | 'client_id' | 'created_at' | 'updated_at'
>;

export type UpdateClientLocationInput = Partial<Omit<
  IClientLocation,
  'location_id' | 'tenant' | 'client_id' | 'created_at' | 'updated_at'
>>;

async function lockClient(trx: Knex.Transaction, tenant: string, clientId: string): Promise<void> {
  const client = await tenantDb(trx, tenant).table('clients')
    .select('client_id')
    .where({ client_id: clientId })
    .forUpdate()
    .first();

  if (!client) {
    throw new Error('Client not found');
  }
}

async function findNextActiveLocation(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  excludedLocationId: string
): Promise<IClientLocation | undefined> {
  return tenantDb(trx, tenant).table<IClientLocation>('client_locations')
    .where({ client_id: clientId, is_active: true })
    .whereNot('location_id', excludedLocationId)
    .orderBy('created_at', 'asc')
    .orderBy('location_id', 'asc')
    .first();
}

async function clearDefaults(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  excludedLocationId?: string
): Promise<void> {
  const query = tenantDb(trx, tenant).table<IClientLocation>('client_locations')
    .where({ client_id: clientId, is_default: true });

  if (excludedLocationId) {
    query.whereNot('location_id', excludedLocationId);
  }

  await query.update({ is_default: false, updated_at: trx.fn.now() });
}

async function promoteLocation(
  trx: Knex.Transaction,
  tenant: string,
  locationId: string
): Promise<void> {
  await tenantDb(trx, tenant).table<IClientLocation>('client_locations')
    .where({ location_id: locationId, is_active: true })
    .update({ is_default: true, updated_at: trx.fn.now() });
}

export async function createLocation(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  data: CreateClientLocationInput
): Promise<IClientLocation> {
  await lockClient(trx, tenant, clientId);
  const db = tenantDb(trx, tenant);
  const isActive = data.is_active ?? true;

  if (data.is_default && !isActive) {
    throw new Error('A default location must be active');
  }

  const existingDefault = await db.table<IClientLocation>('client_locations')
    .where({ client_id: clientId, is_default: true })
    .first();
  const shouldBeDefault = isActive && (data.is_default === true || !existingDefault);

  if (shouldBeDefault) {
    await clearDefaults(trx, tenant, clientId);
  }

  const [location] = await db.table<IClientLocation>('client_locations')
    .insert({
      ...data,
      location_id: trx.raw('gen_random_uuid()'),
      tenant,
      client_id: clientId,
      is_active: isActive,
      is_default: shouldBeDefault,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .returning('*');

  return location;
}

export async function updateLocation(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  locationId: string,
  data: UpdateClientLocationInput
): Promise<IClientLocation> {
  await lockClient(trx, tenant, clientId);
  const db = tenantDb(trx, tenant);
  const existing = await db.table<IClientLocation>('client_locations')
    .where({ client_id: clientId, location_id: locationId })
    .forUpdate()
    .first();

  if (!existing) {
    throw new Error('Location not found');
  }

  const updateData = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as UpdateClientLocationInput;
  const willBeActive = updateData.is_active ?? existing.is_active ?? true;

  if (updateData.is_default === true && !willBeActive) {
    throw new Error('A default location must be active');
  }

  const removesCurrentDefault = Boolean(existing.is_default) && (
    updateData.is_default === false || updateData.is_active === false
  );

  if (updateData.is_default === true) {
    await clearDefaults(trx, tenant, clientId, locationId);
  } else if (removesCurrentDefault) {
    const nextDefault = await findNextActiveLocation(trx, tenant, clientId, locationId);
    if (!nextDefault && willBeActive) {
      throw new Error('Cannot unset default: no other active location available');
    }

    await db.table<IClientLocation>('client_locations')
      .where({ location_id: locationId })
      .update({ is_default: false, updated_at: trx.fn.now() });
    if (nextDefault) {
      await promoteLocation(trx, tenant, nextDefault.location_id);
    }
    delete updateData.is_default;
  } else if (willBeActive && !existing.is_default) {
    const currentDefault = await db.table<IClientLocation>('client_locations')
      .where({ client_id: clientId, is_default: true })
      .first();
    if (!currentDefault) {
      updateData.is_default = true;
    }
  }

  const [location] = await db.table<IClientLocation>('client_locations')
    .where({ client_id: clientId, location_id: locationId })
    .update({ ...updateData, updated_at: trx.fn.now() })
    .returning('*');

  if (!location) {
    throw new Error('Location not found');
  }
  return location;
}

export async function deleteLocation(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  locationId: string
): Promise<void> {
  await lockClient(trx, tenant, clientId);
  const db = tenantDb(trx, tenant);
  const location = await db.table<IClientLocation>('client_locations')
    .where({ client_id: clientId, location_id: locationId })
    .forUpdate()
    .first();

  if (!location) {
    throw new Error('Location not found');
  }

  const dependencies: string[] = [];
  const [ticketCount, taxRateCount] = await Promise.all([
    db.table('tickets').where({ location_id: locationId }).count('ticket_id as count').first(),
    db.table('client_tax_rates').where({ location_id: locationId }).count('tax_rate_id as count').first(),
  ]);
  if (ticketCount && Number(ticketCount.count) > 0) {
    dependencies.push(`${ticketCount.count} ticket(s)`);
  }
  if (taxRateCount && Number(taxRateCount.count) > 0) {
    dependencies.push(`${taxRateCount.count} tax rate(s)`);
  }
  if (dependencies.length > 0) {
    throw new Error(`Cannot delete location: it has associated ${dependencies.join(' and ')}`);
  }

  if (location.is_default) {
    const nextDefault = await findNextActiveLocation(trx, tenant, clientId, locationId);
    await db.table<IClientLocation>('client_locations')
      .where({ location_id: locationId })
      .update({ is_default: false, updated_at: trx.fn.now() });
    if (nextDefault) {
      await promoteLocation(trx, tenant, nextDefault.location_id);
    }
  }

  await db.table<IClientLocation>('client_locations')
    .where({ client_id: clientId, location_id: locationId })
    .delete();
}
