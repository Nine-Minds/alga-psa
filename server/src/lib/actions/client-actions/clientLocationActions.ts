'use server';

import { createTenantKnex } from '../../db';
import { IClientLocation } from '../../../interfaces/client.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser } from '../user-actions/userActions';
import { withTransaction } from '@shared/db';
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
    // If this is set as default, check if it's the first location
    if (locationData.is_default) {
      const existingLocations = await trx('client_locations')
        .where({
          client_id: clientId,
          tenant: tenant,
          is_active: true
        })
        .count('* as count');

      // If there are no existing locations, this should be default
      if (existingLocations[0].count === 0) {
        locationData.is_default = true;
      }
    } else {
      // Check if there are any existing locations
      const existingDefaultCount = await trx('client_locations')
        .where({
          client_id: clientId,
          tenant: tenant,
          is_default: true,
          is_active: true
        })
        .count('* as count');

      // If no default location exists, make this one default
      if (existingDefaultCount[0].count === 0) {
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
    const [location] = await trx('client_locations')
      .where({
        location_id: locationId,
        tenant: tenant
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
    const location = await trx('client_locations')
      .where({
        location_id: locationId,
        tenant: tenant,
        is_active: true
      })
      .first();

    if (!location) {
      throw new Error('Location not found');
    }

    // Remove default from all other locations for this client
    await trx('client_locations')
      .where({
        client_id: location.client_id,
        tenant: tenant,
        is_default: true
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