'use server'

import { revalidatePath } from 'next/cache'
import Service, { serviceSchema, refinedServiceSchema } from 'server/src/lib/models/service'; // Import both schemas
import { IService, IServiceType } from '../../interfaces/billing.interfaces';
import { withTransaction } from '@shared/db';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';

// Interface for paginated service response
export interface PaginatedServicesResponse {
  services: IService[];
  totalCount: number;
  page: number;
  pageSize: number;
}
import { validateArray } from 'server/src/lib/utils/validation';
import { ServiceTypeModel } from '../models/serviceType'; // Import ServiceTypeModel

export async function getServices(page: number = 1, pageSize: number = 999): Promise<PaginatedServicesResponse> {
    try {
        const { knex: db, tenant } = await createTenantKnex();
        return withTransaction(db, async (trx: Knex.Transaction) => {

        // Calculate pagination offset
        const offset = (page - 1) * pageSize;
        
        // Get total count for pagination
        const countResult = await trx('service_catalog as sc')
            .where({ 'sc.tenant': tenant })
            .count('sc.service_id as count')
            .first();
            
        const totalCount = parseInt(countResult?.count as string) || 0;
        
        // Fetch services with service type names by joining with custom service type table
        const servicesData = await trx('service_catalog as sc')
            .where({ 'sc.tenant': tenant })
            .leftJoin('service_types as st', function() {
                this.on('sc.custom_service_type_id', '=', 'st.id')
                    .andOn('sc.tenant', '=', 'st.tenant');
            })
            .select(
                'sc.service_id',
                'sc.service_name',
                'sc.custom_service_type_id',
                'sc.billing_method',
                trx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
                'sc.unit_of_measure',
                'sc.category_id',
                'sc.tenant',
                'sc.description',
                'sc.tax_rate_id', // Corrected: Use tax_rate_id based on schema
                'st.name as service_type_name' // Add service type name
            )
            .orderBy('sc.service_name', 'asc') // Sort by service name alphabetically
            .limit(pageSize)
            .offset(offset);

        // Validate and transform the data
        const validatedServices = servicesData.map(service => {
            return serviceSchema.parse(service);
        });

            // Return paginated response
            return {
                services: validatedServices,
                totalCount,
                page,
                pageSize
            };
        });
    } catch (error) {
        console.error('Error fetching services:', error)
        throw new Error('Failed to fetch services')
    }
}

export async function getServiceById(serviceId: string): Promise<IService | null> {
    const { knex: db } = await createTenantKnex();
    try {
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            const service = await Service.getById(trx, serviceId)
            return service
        });
    } catch (error) {
        console.error(`Error fetching service with id ${serviceId}:`, error)
        throw new Error('Failed to fetch service')
    }
}

// Define a type for the input data
export type CreateServiceInput = Omit<IService, 'service_id' | 'tenant'>;


export async function createService(
    serviceData: CreateServiceInput
): Promise<IService> {
    try {
        console.log('[serviceActions] createService called with data:', serviceData);
        const { custom_service_type_id } = serviceData;

        if (!custom_service_type_id) {
            throw new Error('custom_service_type_id is required to create a service.');
        }

        const { knex: db, tenant } = await createTenantKnex();
        return withTransaction(db, async (trx: Knex.Transaction) => {

        // 1. Verify the custom service type exists and get billing method
        const customServiceType = await trx<IServiceType>('service_types')
            .where('id', custom_service_type_id)
            .andWhere('tenant', tenant) // Match tenant
            .first();
        if (!customServiceType) {
            throw new Error(`ServiceType ID '${custom_service_type_id}' not found for tenant '${tenant}'.`);
        }
        const derivedBillingMethod = customServiceType.billing_method;
        console.log(`[serviceActions] Billing method '${derivedBillingMethod}' derived from custom type: ${custom_service_type_id} for tenant ${tenant}`);

        // 2. Ensure a billing method was determined (as it's required on IService)
        if (!derivedBillingMethod) {
            throw new Error(`Could not determine billing method for ServiceType ID '${custom_service_type_id}'. The source type might lack a billing method.`);
        }

        // 3. Prepare final data
        const finalServiceData = {
            ...serviceData,
            tenant: tenant, // Explicitly add tenant to the data
            billing_method: derivedBillingMethod, // Use the derived billing method
            custom_service_type_id: custom_service_type_id,
            // Ensure default_rate is a number
            default_rate: typeof serviceData.default_rate === 'string'
                ? parseFloat(serviceData.default_rate) || 0
                : serviceData.default_rate,
            // Explicitly handle tax_rate_id to ensure it's null rather than undefined
            tax_rate_id: serviceData.tax_rate_id || null,
        };

            // 4. Create the service using the model
            const service = await Service.create(trx, finalServiceData as Omit<IService, 'service_id'>);
            console.log('[serviceActions] Service created successfully:', service);
            revalidatePath('/msp/billing'); // Revalidate the billing page
            return service; // Assuming Service.create returns the full IService object
        });
    } catch (error) {
        console.error('[serviceActions] Error creating service:', error);
        throw error; // Re-throw the error
    }
}

export async function updateService(
    serviceId: string,
    serviceData: Partial<IService>
): Promise<IService> {
    const { knex: db } = await createTenantKnex();
    try {
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            const updatedService = await Service.update(trx, serviceId, serviceData);
            revalidatePath('/msp/billing'); // Revalidate the billing page

            if (updatedService === null) {
                throw new Error(`Service with id ${serviceId} not found or couldn't be updated`);
            }

            return updatedService as IService;
        });
    } catch (error) {
        console.error(`Error updating service with id ${serviceId}:`, error);
        throw error; // Re-throw the error to be handled by the caller
    }
}

export async function deleteService(serviceId: string): Promise<void> {
    const { knex: db } = await createTenantKnex();
    try {
        await withTransaction(db, async (trx: Knex.Transaction) => {
            await Service.delete(trx, serviceId)
            revalidatePath('/msp/billing') // Revalidate the billing page
        });
    } catch (error) {
        console.error(`Error deleting service with id ${serviceId}:`, error)
        throw new Error('Failed to delete service')
    }
}

export async function getServicesByCategory(categoryId: string): Promise<IService[]> {
    const { knex: db } = await createTenantKnex();
    try {
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            const services = await Service.getByCategoryId(trx, categoryId)
            return services
        });
    } catch (error) {
        console.error(`Error fetching services for category ${categoryId}:`, error)
        throw new Error('Failed to fetch services by category')
    }
}

// New action to get combined service types for UI selection
export async function getServiceTypesForSelection(): Promise<{ id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[]> {
   try {
       // Assuming ServiceTypeModel is imported or available
       // Need to import ServiceTypeModel from '../models/serviceType'
       const { ServiceTypeModel } = await import('../models/serviceType');
       const { knex: db } = await createTenantKnex();
       const serviceTypes = await withTransaction(db, async (trx: Knex.Transaction) => {
           return await ServiceTypeModel.findAllIncludingStandard(trx);
       });
       // No validation needed here as it's directly from the model method designed for this
       return serviceTypes;
   } catch (error) {
       console.error('Error fetching service types for selection:', error);
       throw new Error('Failed to fetch service types');
   }
}

// --- CRUD Actions for Tenant-Specific Service Types ---

export async function createServiceType(
  data: Omit<IServiceType, 'id' | 'created_at' | 'updated_at' | 'tenant'>
): Promise<IServiceType> {
  try {
      // Assuming ServiceTypeModel is imported or available
      const { ServiceTypeModel } = await import('../models/serviceType');
      // Tenant context is handled within the model method
      const { knex: db } = await createTenantKnex();
      const newServiceType = await withTransaction(db, async (trx: Knex.Transaction) => {
          return await ServiceTypeModel.create(trx, data);
      });
      // Optionally revalidate paths if there's a UI for managing these
      // revalidatePath('/path/to/service/type/management');
      return newServiceType;
  } catch (error) {
      console.error('Error creating service type:', error);
      throw new Error('Failed to create service type');
  }
}

export async function updateServiceType(
  id: string,
  data: Partial<Omit<IServiceType, 'id' | 'tenant' | 'created_at' | 'updated_at'>>
): Promise<IServiceType> {
  try {
      // Assuming ServiceTypeModel is imported or available
      const { ServiceTypeModel } = await import('../models/serviceType');
      // Tenant context is handled within the model method
      const { knex: db } = await createTenantKnex();
      const updatedServiceType = await withTransaction(db, async (trx: Knex.Transaction) => {
          return await ServiceTypeModel.update(trx, id, data);
      });
      if (!updatedServiceType) {
          throw new Error(`Service type with id ${id} not found or could not be updated.`);
      }
      // Optionally revalidate paths
      // revalidatePath('/path/to/service/type/management');
      return updatedServiceType;
  } catch (error) {
      console.error(`Error updating service type ${id}:`, error);
      throw new Error('Failed to update service type');
  }
}

export async function getAllServiceTypes(): Promise<IServiceType[]> {
  try {
    const { ServiceTypeModel } = await import('../models/serviceType');
    const { knex: db } = await createTenantKnex();
    const serviceTypes = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await ServiceTypeModel.findAll(trx);
    });
    return serviceTypes;
  } catch (error) {
    console.error('Error fetching all service types:', error);
    throw new Error('Failed to fetch service types');
  }
}

export async function deleteServiceType(id: string): Promise<void> {
  try {
      // Assuming ServiceTypeModel is imported or available
      const { ServiceTypeModel } = await import('../models/serviceType');
      
      // First check if the service type is in use by any services
      const { knex: db, tenant } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) => {
      
      // Check if any services are using this service type
      const servicesUsingType = await trx('service_catalog')
          .where({ custom_service_type_id: id, tenant })
          .count('service_id as count')
          .first();
      
      if (servicesUsingType && parseInt(String(servicesUsingType.count)) > 0) {
          throw new Error(`Cannot delete service type because it is currently in use by ${servicesUsingType.count} service(s).`);
      }
      
      // Tenant context is handled within the model method
      const deleted = await ServiceTypeModel.delete(trx, id);
      if (!deleted) {
          // Handle the case where the type wasn't found
          throw new Error(`Service type with ID ${id} not found.`);
      }
      
          // Revalidate paths for the service type management page
          revalidatePath('/msp/settings/billing');
      });
  } catch (error: any) {
      console.error(`Error deleting service type ${id}:`, error);
      
      // Check for PostgreSQL foreign key constraint violation
      if (error.code === '23503' || (error.message && error.message.includes('foreign key constraint'))) {
          throw new Error('Cannot delete service type because it is currently in use by one or more services.');
      }
      
      // If we already have a specific error message, use it
      if (error instanceof Error) {
          throw error;
      }
      
      // Fallback to generic error
      throw new Error('Failed to delete service type');
  }
}
