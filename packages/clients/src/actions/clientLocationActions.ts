'use server';

import { createTenantKnex } from 'server/src/lib/db';
import type { IClientLocation } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { revalidatePath } from 'next/cache';

export async function getClientLocations(clientId: string): Promise<IClientLocation[]> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const locations = await trx('client_locations')
      .where({
        client_id: clientId,
        tenant: tenant,
        is_active: true
      })
      .orderBy('is_default', 'desc')
      .orderBy('location_name', 'asc');

    return locations;
  });
}

export async function getClientLocation(locationId: string): Promise<IClientLocation | null> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const location = await trx('client_locations')
      .where({
        location_id: locationId,
        tenant: tenant
      })
      .first();

    return location || null;
  });
}

export async function createClientLocation(
  clientId: string,
  locationData: Omit<IClientLocation, 'location_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<IClientLocation> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  const locationId = uuidv4();

  const newLocation = await withTransaction(knex, async (trx: Knex.Transaction) => {
    // If this is set as default, clear any existing active defaults first
    // Only clear active locations to preserve historical audit data on inactive rows
    if (locationData.is_default) {
      await trx('client_locations')
        .where({
          client_id: clientId,
          tenant: tenant,
          is_default: true,
          is_active: true
        })
        .update({
          is_default: false,
          updated_at: trx.fn.now()
        });
    } else {
      // If not setting as default, check if we need to auto-set as default
      const existingDefault = await trx('client_locations')
        .where({
          client_id: clientId,
          tenant: tenant,
          is_default: true,
          is_active: true
        })
        .first();

      // If no active default location exists, make this one default
      if (!existingDefault) {
        locationData.is_default = true;
      }
    }

    const [location] = await trx('client_locations')
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

  revalidatePath(`/msp/clients/${clientId}`);
  revalidatePath('/client-portal/client-settings');

  return newLocation;
}

export async function updateClientLocation(
  locationId: string,
  locationData: Partial<Omit<IClientLocation, 'location_id' | 'tenant' | 'client_id' | 'created_at'>>
): Promise<IClientLocation> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  const updatedLocation = await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Get the existing location first to check current state
    // Filter by is_active for consistency (we filter by is_active everywhere)
    const existingLocation = await trx('client_locations')
      .where({
        location_id: locationId,
        tenant: tenant,
        is_active: true
      })
      .first();

    if (!existingLocation) {
      throw new Error('Active location not found');
    }

    // If setting is_default to true, first clear other defaults for this client
    if (locationData.is_default === true) {
      // Clear is_default from all other active locations for this client
      // Only clear active locations to preserve historical audit data on inactive rows
      await trx('client_locations')
        .where({
          client_id: existingLocation.client_id,
          tenant: tenant,
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
      const nextDefault = await trx('client_locations')
        .where({
          client_id: existingLocation.client_id,
          tenant: tenant,
          is_active: true
        })
        .whereNot('location_id', locationId)
        .first();

      if (!nextDefault) {
        throw new Error('Cannot unset default: no other active location available');
      }

      // Clear current default first, then promote next (avoids unique constraint violation)
      await trx('client_locations')
        .where({
          location_id: locationId,
          tenant: tenant
        })
        .update({
          is_default: false,
          updated_at: trx.fn.now()
        });

      await trx('client_locations')
        .where({
          location_id: nextDefault.location_id,
          tenant: tenant
        })
        .update({
          is_default: true,
          updated_at: trx.fn.now()
        });

      // Remove is_default from locationData since we already handled it
      delete locationData.is_default;
    }

    // Filter by is_active for consistency (we filter by is_active everywhere)
    const [location] = await trx('client_locations')
      .where({
        location_id: locationId,
        tenant: tenant,
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

  revalidatePath(`/msp/clients/${updatedLocation.client_id}`);
  revalidatePath('/client-portal/client-settings');

  return updatedLocation;
}

export async function deleteClientLocation(locationId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  const clientId = await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check if this is the default location
    const location = await trx('client_locations')
      .where({
        location_id: locationId,
        tenant: tenant
      })
      .first();

    if (!location) {
      throw new Error('Location not found');
    }

    // Check for dependencies before deletion
    const dependencies: string[] = [];

    // Check for tickets referencing this location
    const ticketCount = await trx('tickets')
      .where({ location_id: locationId, tenant })
      .count('ticket_id as count')
      .first();

    if (ticketCount && Number(ticketCount.count) > 0) {
      dependencies.push(`${ticketCount.count} ticket(s)`);
    }

    // Check for client tax rates referencing this location
    const taxRateCount = await trx('client_tax_rates')
      .where({ location_id: locationId, tenant })
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
      const nextDefault = await trx('client_locations')
        .where({
          client_id: location.client_id,
          tenant: tenant,
          is_active: true
        })
        .whereNot('location_id', locationId)
        .first();

      if (nextDefault) {
        await trx('client_locations')
          .where({
            location_id: nextDefault.location_id,
            tenant: tenant
          })
          .update({
            is_default: true,
            updated_at: trx.fn.now()
          });
      }
    }

    // Hard delete the location
    await trx('client_locations')
      .where({
        location_id: locationId,
        tenant: tenant
      })
      .delete();

    return location.client_id;
  });

  revalidatePath(`/msp/clients/${clientId}`);
  revalidatePath('/client-portal/client-settings');
}

export async function setDefaultClientLocation(locationId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  const clientId = await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Get the location to find its client_id
    // Only active locations can be set as default
    const location = await trx('client_locations')
      .where({
        location_id: locationId,
        tenant: tenant,
        is_active: true
      })
      .first();

    if (!location) {
      throw new Error('Active location not found');
    }

    // Remove default from all other active locations for this client
    // Only clear active locations to preserve historical audit data on inactive rows
    await trx('client_locations')
      .where({
        client_id: location.client_id,
        tenant: tenant,
        is_default: true,
        is_active: true
      })
      .whereNot('location_id', locationId)
      .update({
        is_default: false,
        updated_at: trx.fn.now()
      });

    // Set this location as default
    await trx('client_locations')
      .where({
        location_id: locationId,
        tenant: tenant
      })
      .update({
        is_default: true,
        updated_at: trx.fn.now()
      });

    return location.client_id;
  });

  revalidatePath(`/msp/clients/${clientId}`);
  revalidatePath('/client-portal/client-settings');
}

export async function getDefaultClientLocation(clientId: string): Promise<IClientLocation | null> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const location = await trx('client_locations')
      .where({
        client_id: clientId,
        tenant: tenant,
        is_default: true,
        is_active: true
      })
      .first();

    return location || null;
  });
}
