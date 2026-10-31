import { tenantDb } from '@alga-psa/db';
import type { IClientLocation } from '@alga-psa/types';
import type { Knex } from 'knex';
import {
  queueClientLocationCreated,
  queueClientLocationDeleted,
  queueClientLocationUpdated,
  type ClientLocationEventOptions,
} from '../lib/clientLocationEvents';

// Optional text columns that are nullable in the database. '' / whitespace is
// stored as NULL (see normalizeOptionalFields); null clears the value.
const NULLABLE_OPTIONAL_FIELDS = [
  'location_name',
  'address_line2',
  'address_line3',
  'state_province',
  'postal_code',
  'region_code',
  'notes',
] as const;

type NullableOptionalField = (typeof NULLABLE_OPTIONAL_FIELDS)[number];
type WithNullableOptionals<T> = Omit<T, NullableOptionalField> & {
  [K in NullableOptionalField]?: string | null;
};

export type CreateClientLocationInput = WithNullableOptionals<Omit<
  IClientLocation,
  'location_id' | 'tenant' | 'client_id' | 'created_at' | 'updated_at'
>>;

export type UpdateClientLocationInput = Partial<WithNullableOptionals<Omit<
  IClientLocation,
  'location_id' | 'tenant' | 'client_id' | 'created_at' | 'updated_at' | 'email'
>>> & {
  // null clears the stored email; undefined leaves it untouched.
  email?: string | null;
};

/** '' / whitespace-only optional fields become NULL; undefined is left untouched. */
function normalizeOptionalFields<T extends Partial<Record<NullableOptionalField, string | null>>>(data: T): T {
  const normalized = { ...data };
  for (const field of NULLABLE_OPTIONAL_FIELDS) {
    const value = normalized[field];
    if (typeof value === 'string' && value.trim() === '') {
      (normalized as Record<string, unknown>)[field] = null;
    }
  }
  return normalized;
}

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

/**
 * Implicit default changes are real field changes on other rows (is_default), so each demoted or
 * promoted location emits client_location.updated like an explicit edit would.
 */
async function clearDefaults(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  excludedLocationId?: string,
  eventOptions: ClientLocationEventOptions = {}
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const scope = () => {
    const query = db.table<IClientLocation>('client_locations').where({ client_id: clientId, is_default: true });
    if (excludedLocationId) {
      query.whereNot('location_id', excludedLocationId);
    }
    return query;
  };
  const before = await scope();
  if (before.length === 0) return;

  const after = await scope().update({ is_default: false, updated_at: trx.fn.now() }).returning('*');
  const afterById = new Map(after.map((row) => [row.location_id, row]));
  for (const row of before) {
    const updated = afterById.get(row.location_id);
    if (updated) queueClientLocationUpdated(trx, tenant, row, updated, eventOptions);
  }
}

async function promoteLocation(
  trx: Knex.Transaction,
  tenant: string,
  locationId: string,
  eventOptions: ClientLocationEventOptions = {}
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const before = await db.table<IClientLocation>('client_locations')
    .where({ location_id: locationId, is_active: true })
    .first();
  if (!before) return;
  const [after] = await db.table<IClientLocation>('client_locations')
    .where({ location_id: locationId, is_active: true })
    .update({ is_default: true, updated_at: trx.fn.now() })
    .returning('*');
  if (after) queueClientLocationUpdated(trx, tenant, before, after, eventOptions);
}

export async function createLocation(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  rawData: CreateClientLocationInput,
  eventOptions: ClientLocationEventOptions = {}
): Promise<IClientLocation> {
  const data = normalizeOptionalFields(rawData);
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
    await clearDefaults(trx, tenant, clientId, undefined, eventOptions);
  }

  const [location] = await db.table<IClientLocation>('client_locations')
    .insert({
      // The optional text columns are nullable in the database even though the row type says string.
      ...(data as unknown as Partial<IClientLocation>),
      location_id: trx.raw('gen_random_uuid()'),
      tenant,
      client_id: clientId,
      is_active: isActive,
      is_default: shouldBeDefault,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .returning('*');

  queueClientLocationCreated(trx, tenant, location, eventOptions);
  return location;
}

export async function updateLocation(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  locationId: string,
  rawData: UpdateClientLocationInput,
  eventOptions: ClientLocationEventOptions = {}
): Promise<IClientLocation> {
  const data = normalizeOptionalFields(rawData);
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
    await clearDefaults(trx, tenant, clientId, locationId, eventOptions);
  } else if (removesCurrentDefault) {
    const nextDefault = await findNextActiveLocation(trx, tenant, clientId, locationId);
    if (!nextDefault && willBeActive) {
      throw new Error('Cannot unset default: no other active location available');
    }

    await db.table<IClientLocation>('client_locations')
      .where({ location_id: locationId })
      .update({ is_default: false, updated_at: trx.fn.now() });
    if (nextDefault) {
      await promoteLocation(trx, tenant, nextDefault.location_id, eventOptions);
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

  const { email, ...rest } = updateData;
  const [location] = await db.table<IClientLocation>('client_locations')
    .where({ client_id: clientId, location_id: locationId })
    .update({
      ...(rest as unknown as Partial<IClientLocation>),
      // The email column is nullable in the database even though the row type says string.
      ...(email !== undefined ? { email: email as string | undefined } : {}),
      updated_at: trx.fn.now(),
    })
    .returning('*');

  if (!location) {
    throw new Error('Location not found');
  }
  queueClientLocationUpdated(trx, tenant, existing, location, eventOptions);
  return location;
}

export async function deleteLocation(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  locationId: string,
  eventOptions: ClientLocationEventOptions = {}
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
      await promoteLocation(trx, tenant, nextDefault.location_id, eventOptions);
    }
  }

  await db.table<IClientLocation>('client_locations')
    .where({ client_id: clientId, location_id: locationId })
    .delete();

  queueClientLocationDeleted(trx, tenant, location, eventOptions);
}
