'use server';

import { createTenantKnex } from '../../db';
import { ICompanyLocation } from '../../../interfaces/company.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser } from '../user-actions/userActions';

export async function getCompanyLocations(companyId: string): Promise<ICompanyLocation[]> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  try {
    const locations = await knex('company_locations')
      .where({ 
        company_id: companyId,
        tenant: tenant,
        is_active: true 
      })
      .orderBy('is_default', 'desc')
      .orderBy('location_name', 'asc');

    return locations;
  } finally {
    // await knex.destroy();
  }
}

export async function getCompanyLocation(locationId: string): Promise<ICompanyLocation | null> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  try {
    const location = await knex('company_locations')
      .where({ 
        location_id: locationId,
        tenant: tenant 
      })
      .first();

    return location || null;
  } finally {
    // await knex.destroy();
  }
}

export async function createCompanyLocation(
  companyId: string, 
  locationData: Omit<ICompanyLocation, 'location_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<ICompanyLocation> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  const locationId = uuidv4();

  try {
    // If this is set as default, check if it's the first location
    if (locationData.is_default) {
      const existingLocations = await knex('company_locations')
        .where({ 
          company_id: companyId,
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
      const existingDefaultCount = await knex('company_locations')
        .where({ 
          company_id: companyId,
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

    const [newLocation] = await knex('company_locations')
      .insert({
        location_id: locationId,
        tenant: tenant,
        ...locationData,
        company_id: companyId,
        is_active: locationData.is_active ?? true,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      })
      .returning('*');

    return newLocation;
  } finally {
    // await knex.destroy();
  }
}

export async function updateCompanyLocation(
  locationId: string,
  locationData: Partial<Omit<ICompanyLocation, 'location_id' | 'tenant' | 'company_id' | 'created_at'>>
): Promise<ICompanyLocation> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  try {
    const [updatedLocation] = await knex('company_locations')
      .where({ 
        location_id: locationId,
        tenant: tenant 
      })
      .update({
        ...locationData,
        updated_at: knex.fn.now()
      })
      .returning('*');

    if (!updatedLocation) {
      throw new Error('Location not found');
    }

    return updatedLocation;
  } finally {
    // await knex.destroy();
  }
}

export async function deleteCompanyLocation(locationId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  try {
    // Check if this is the default location
    const location = await knex('company_locations')
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
    const ticketCount = await knex('tickets')
      .where({ location_id: locationId, tenant })
      .count('ticket_id as count')
      .first();
    
    if (ticketCount && Number(ticketCount.count) > 0) {
      dependencies.push(`${ticketCount.count} ticket(s)`);
    }

    // Check for company tax rates referencing this location
    const taxRateCount = await knex('company_tax_rates')
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

    // If no dependencies, perform hard delete
    await knex.transaction(async (trx) => {
      // If this was the default location, assign default to another active location first
      if (location.is_default) {
        const nextDefault = await trx('company_locations')
          .where({ 
            company_id: location.company_id,
            tenant: tenant,
            is_active: true 
          })
          .whereNot('location_id', locationId)
          .first();

        if (nextDefault) {
          await trx('company_locations')
            .where({ 
              location_id: nextDefault.location_id,
              tenant: tenant 
            })
            .update({
              is_default: true,
              updated_at: knex.fn.now()
            });
        }
      }

      // Hard delete the location
      await trx('company_locations')
        .where({ 
          location_id: locationId,
          tenant: tenant 
        })
        .delete();
    });
  } finally {
    // await knex.destroy();
  }
}

export async function setDefaultCompanyLocation(locationId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  try {
    // Get the location to find its company_id
    const location = await knex('company_locations')
      .where({ 
        location_id: locationId,
        tenant: tenant,
        is_active: true 
      })
      .first();

    if (!location) {
      throw new Error('Location not found');
    }

    // Transaction to ensure atomicity
    await knex.transaction(async (trx) => {
      // Remove default from all other locations for this company
      await trx('company_locations')
        .where({ 
          company_id: location.company_id,
          tenant: tenant,
          is_default: true 
        })
        .whereNot('location_id', locationId)
        .update({
          is_default: false,
          updated_at: knex.fn.now()
        });

      // Set this location as default
      await trx('company_locations')
        .where({ 
          location_id: locationId,
          tenant: tenant 
        })
        .update({
          is_default: true,
          updated_at: knex.fn.now()
        });
    });
  } finally {
    // await knex.destroy();
  }
}

export async function getDefaultCompanyLocation(companyId: string): Promise<ICompanyLocation | null> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('User not authenticated');
  }

  try {
    const location = await knex('company_locations')
      .where({ 
        company_id: companyId,
        tenant: tenant,
        is_default: true,
        is_active: true 
      })
      .first();

    return location || null;
  } finally {
    // await knex.destroy();
  }
}