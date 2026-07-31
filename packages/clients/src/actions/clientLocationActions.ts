'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { IClientLocation } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { revalidatePath } from 'next/cache';
import { assertMspOrClientPortalOwnClientPermission } from '../lib/authHelpers';
import {
  createLocation,
  deleteLocation,
  updateLocation,
} from '../models/clientLocation';
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
    if (error.message === 'A default location must be active') {
      return actionError(error.message);
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

      return createLocation(trx, tenant, clientId, locationData);
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
      const db = tenantDb(trx, tenant);

      const existingLocation = await db.table<IClientLocation>('client_locations')
        .select('client_id')
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

      return updateLocation(
        trx,
        tenant,
        existingLocation.client_id,
        locationId,
        locationData
      );
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
      const db = tenantDb(trx, tenant);

      const location = await db.table<IClientLocation>('client_locations')
        .select('client_id')
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

      await deleteLocation(trx, tenant, location.client_id, locationId);

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

      await updateLocation(trx, tenant, location.client_id, locationId, { is_default: true });

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
