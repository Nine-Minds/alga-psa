'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { IClientLocation } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { withAuth } from '@alga-psa/auth';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { revalidatePath } from 'next/cache';
import { assertMspOrClientPortalOwnClientPermission } from '../lib/authHelpers';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type ClientLocationActionError = ActionMessageError | ActionPermissionError;

function clientLocationActionErrorFrom(error: unknown): ClientLocationActionError | null {
  if (error instanceof Error) {
    if (error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    if (error.message === 'Active location not found' || error.message === 'Location not found') {
      return actionError('Location not found or is no longer active.');
    }
    if (error.message === 'Cannot unset default: no other active location available') {
      return actionError('Add another active location or choose a different default before unsetting this location as the default.');
    }
    if (error.message.startsWith('Cannot delete location: it has associated ')) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '23502') {
    return actionError(`Missing required location field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected client, country, tax region, or related location data is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A conflicting location record already exists. Please refresh locations and try again.');
  }
  if (dbError?.code === '23514') {
    return actionError('Invalid location data provided. Please check the address and contact fields.');
  }

  return null;
}

export const getClientLocations = withAuth(async (user, { tenant }, clientId: string): Promise<IClientLocation[] | ClientLocationActionError> => {
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      await assertMspOrClientPortalOwnClientPermission(
        user,
        tenant,
        clientId,
        'client',
        'read',
        'Permission denied: Cannot read client locations',
        trx
      );

      const locations = await tenantDb(trx, tenant).table<IClientLocation>('client_locations')
        .where({
          client_id: clientId,
          is_active: true
        })
        .orderBy('is_default', 'desc')
        .orderBy('location_name', 'asc');

      return locations;
    });
  } catch (error) {
    const expected = clientLocationActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getClientLocation = withAuth(async (user, { tenant }, locationId: string): Promise<IClientLocation | null | ClientLocationActionError> => {
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);

      const locationScope = await db.table<IClientLocation>('client_locations')
        .select('client_id')
        .where({
          location_id: locationId,
        })
        .first();

      if (!locationScope) {
        return null;
      }

      await assertMspOrClientPortalOwnClientPermission(
        user,
        tenant,
        locationScope.client_id,
        'client',
        'read',
        'Permission denied: Cannot read client locations',
        trx
      );

      const location = await db.table<IClientLocation>('client_locations')
        .where({
          location_id: locationId,
        })
        .first();

      return location || null;
    });
  } catch (error) {
    const expected = clientLocationActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const createClientLocation = withAuth(async (
  user,
  { tenant },
  clientId: string,
  locationData: Omit<IClientLocation, 'location_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<IClientLocation | ClientLocationActionError> => {
  const { knex } = await createTenantKnex();

  let newLocation: IClientLocation;
  try {
    newLocation = await withTransaction(knex, async (trx: Knex.Transaction) => {
      await assertMspOrClientPortalOwnClientPermission(
        user,
        tenant,
        clientId,
        'client',
        'update',
        'Permission denied: Cannot update client locations',
        trx
      );

      const locationId = uuidv4();

      // If this is set as default, clear any existing active defaults first
      // Only clear active locations to preserve historical audit data on inactive rows
      if (locationData.is_default) {
        const db = tenantDb(trx, tenant);

        await db.table<IClientLocation>('client_locations')
          .where({
            client_id: clientId,
            is_default: true,
            is_active: true
          })
          .update({
            is_default: false,
            updated_at: trx.fn.now()
          });
      } else {
        // If not setting as default, check if we need to auto-set as default
        const db = tenantDb(trx, tenant);

        const existingDefault = await db.table<IClientLocation>('client_locations')
          .where({
            client_id: clientId,
            is_default: true,
            is_active: true
          })
          .first();

        // If no active default location exists, make this one default
        if (!existingDefault) {
          locationData.is_default = true;
        }
      }

      const [location] = await tenantDb(trx, tenant).table<IClientLocation>('client_locations')
        .insert({
          location_id: locationId,
          tenant: tenant,
          ...locationData,
          client_id: clientId,
          is_active: locationData.is_active ?? true,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        })
        .returning('*');

      return location;
    });
  } catch (error) {
    const expected = clientLocationActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }

  revalidatePath(`/msp/clients/${clientId}`);
  revalidatePath('/client-portal/client-settings');

  return newLocation;
});

export const updateClientLocation = withAuth(async (
  user,
  { tenant },
  locationId: string,
  locationData: Partial<Omit<IClientLocation, 'location_id' | 'tenant' | 'client_id' | 'created_at'>>
): Promise<IClientLocation | ClientLocationActionError> => {
  const { knex } = await createTenantKnex();

  let updatedLocation: IClientLocation;
  try {
    updatedLocation = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get the existing location first to check current state
      // Filter by is_active for consistency (we filter by is_active everywhere)
      const db = tenantDb(trx, tenant);

      const existingLocation = await db.table<IClientLocation>('client_locations')
        .select('client_id', 'is_default')
        .where({
          location_id: locationId,
          is_active: true
        })
        .first();

      if (!existingLocation) {
        throw new Error('Active location not found');
      }

      await assertMspOrClientPortalOwnClientPermission(
        user,
        tenant,
        existingLocation.client_id,
        'client',
        'update',
        'Permission denied: Cannot update client locations',
        trx
      );

      // If setting is_default to true, first clear other defaults for this client
      if (locationData.is_default === true) {
        // Clear is_default from all other active locations for this client
        // Only clear active locations to preserve historical audit data on inactive rows
        await db.table<IClientLocation>('client_locations')
          .where({
            client_id: existingLocation.client_id,
            is_default: true,
            is_active: true
          })
          .whereNot('location_id', locationId)
          .update({
            is_default: false,
            updated_at: trx.fn.now()
          });
      }

      // If unsetting is_default on the current default, reassign to another active location
      // (same logic as deleteClientLocation to ensure there's always one default)
      if (locationData.is_default === false && existingLocation.is_default) {
        const nextDefault = await db.table<IClientLocation>('client_locations')
          .where({
            client_id: existingLocation.client_id,
            is_active: true
          })
          .whereNot('location_id', locationId)
          .first();

        if (!nextDefault) {
          throw new Error('Cannot unset default: no other active location available');
        }

        // Clear current default first, then promote next (avoids unique constraint violation)
        await db.table<IClientLocation>('client_locations')
          .where({
            location_id: locationId,
          })
          .update({
            is_default: false,
            updated_at: trx.fn.now()
          });

        await db.table<IClientLocation>('client_locations')
          .where({
            location_id: nextDefault.location_id,
          })
          .update({
            is_default: true,
            updated_at: trx.fn.now()
          });

        // Remove is_default from locationData since we already handled it
        delete locationData.is_default;
      }

      // Filter by is_active for consistency (we filter by is_active everywhere)
      const [location] = await db.table<IClientLocation>('client_locations')
        .where({
          location_id: locationId,
          is_active: true
        })
        .update({
          ...locationData,
          updated_at: trx.fn.now()
        })
        .returning('*');

      if (!location) {
        throw new Error('Location not found');
      }

      return location;
    });
  } catch (error) {
    const expected = clientLocationActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }

  revalidatePath(`/msp/clients/${updatedLocation.client_id}`);
  revalidatePath('/client-portal/client-settings');

  return updatedLocation;
});

export const deleteClientLocation = withAuth(async (user, { tenant }, locationId: string): Promise<void | ClientLocationActionError> => {
  const { knex } = await createTenantKnex();

  let clientId: string;
  try {
    clientId = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Check if this is the default location
      const db = tenantDb(trx, tenant);

      const location = await db.table<IClientLocation>('client_locations')
        .select('client_id', 'is_default')
        .where({
          location_id: locationId,
        })
        .first();

      if (!location) {
        throw new Error('Location not found');
      }

      await assertMspOrClientPortalOwnClientPermission(
        user,
        tenant,
        location.client_id,
        'client',
        'update',
        'Permission denied: Cannot update client locations',
        trx
      );

      // Check for dependencies before deletion
      const dependencies: string[] = [];

      // Check for tickets referencing this location
      const ticketCount = await db.table('tickets')
        .where({ location_id: locationId })
        .count('ticket_id as count')
        .first();

      if (ticketCount && Number(ticketCount.count) > 0) {
        dependencies.push(`${ticketCount.count} ticket(s)`);
      }

      // Check for client tax rates referencing this location
      const taxRateCount = await db.table('client_tax_rates')
        .where({ location_id: locationId })
        .count('tax_rate_id as count')
        .first();

      if (taxRateCount && Number(taxRateCount.count) > 0) {
        dependencies.push(`${taxRateCount.count} tax rate(s)`);
      }

      // If there are dependencies, throw an error
      if (dependencies.length > 0) {
        throw new Error(`Cannot delete location: it has associated ${dependencies.join(' and ')}`);
      }

      // If this was the default location, assign default to another active location first
      if (location.is_default) {
        const nextDefault = await db.table<IClientLocation>('client_locations')
          .where({
            client_id: location.client_id,
            is_active: true
          })
          .whereNot('location_id', locationId)
          .first();

        if (nextDefault) {
          await db.table<IClientLocation>('client_locations')
            .where({
              location_id: nextDefault.location_id,
            })
            .update({
              is_default: true,
              updated_at: trx.fn.now()
            });
        }
      }

      // Hard delete the location
      await db.table<IClientLocation>('client_locations')
        .where({
          location_id: locationId,
        })
        .delete();

      return location.client_id;
    });
  } catch (error) {
    const expected = clientLocationActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }

  revalidatePath(`/msp/clients/${clientId}`);
  revalidatePath('/client-portal/client-settings');
});

export const setDefaultClientLocation = withAuth(async (user, { tenant }, locationId: string): Promise<void | ClientLocationActionError> => {
  const { knex } = await createTenantKnex();

  let clientId: string;
  try {
    clientId = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get the location to find its client_id
      // Only active locations can be set as default
      const db = tenantDb(trx, tenant);

      const location = await db.table<IClientLocation>('client_locations')
        .select('client_id')
        .where({
          location_id: locationId,
          is_active: true
        })
        .first();

      if (!location) {
        throw new Error('Active location not found');
      }

      await assertMspOrClientPortalOwnClientPermission(
        user,
        tenant,
        location.client_id,
        'client',
        'update',
        'Permission denied: Cannot update client locations',
        trx
      );

      // Remove default from all other active locations for this client
      // Only clear active locations to preserve historical audit data on inactive rows
      await db.table<IClientLocation>('client_locations')
        .where({
          client_id: location.client_id,
          is_default: true,
          is_active: true
        })
        .whereNot('location_id', locationId)
        .update({
          is_default: false,
          updated_at: trx.fn.now()
        });

      // Set this location as default
      await db.table<IClientLocation>('client_locations')
        .where({
          location_id: locationId,
        })
        .update({
          is_default: true,
          updated_at: trx.fn.now()
        });

      return location.client_id;
    });
  } catch (error) {
    const expected = clientLocationActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }

  revalidatePath(`/msp/clients/${clientId}`);
  revalidatePath('/client-portal/client-settings');
});

export const getDefaultClientLocation = withAuth(async (user, { tenant }, clientId: string): Promise<IClientLocation | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    await assertMspOrClientPortalOwnClientPermission(
      user,
      tenant,
      clientId,
      'client',
      'read',
      'Permission denied: Cannot read client locations',
      trx
    );

    const location = await tenantDb(trx, tenant).table<IClientLocation>('client_locations')
      .where({
        client_id: clientId,
        is_default: true,
        is_active: true
      })
      .first();

    return location || null;
  });
});
