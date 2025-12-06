'use server'

import { revalidatePath } from 'next/cache'
import Service, { serviceSchema, refinedServiceSchema } from 'server/src/lib/models/service'; // Import both schemas
import { IService, IServiceType } from '../../interfaces/billing.interfaces';
import { withTransaction } from '@alga-psa/shared/db';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';
import { validateArray } from 'server/src/lib/utils/validation';
import { ServiceTypeModel } from '../models/serviceType'; // Import ServiceTypeModel

// Interface for paginated service response
export interface PaginatedServicesResponse {
  services: IService[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface ServiceListOptions {
  search?: string;
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit';
  category_id?: string | null;
  custom_service_type_id?: string;
  sort?: 'service_name' | 'billing_method' | 'default_rate';
  order?: 'asc' | 'desc';
}

export async function getServices(
  page: number = 1,
  pageSize: number = 999,
  options: ServiceListOptions = {}
): Promise<PaginatedServicesResponse> {
    try {
        const { knex: db, tenant } = await createTenantKnex();
        return withTransaction(db, async (trx: Knex.Transaction) => {

        // Calculate pagination offset
        const offset = (page - 1) * pageSize;

        type SortField = NonNullable<ServiceListOptions['sort']>;
        const sortFields: SortField[] = ['service_name', 'billing_method', 'default_rate'];
        const sortField: SortField = sortFields.includes(options.sort as SortField)
          ? (options.sort as SortField)
          : 'service_name';

        const defaultOrderForSort: Record<SortField, 'asc' | 'desc'> = {
          service_name: 'asc',
          billing_method: 'asc',
          default_rate: 'asc'
        };

        const sortOrder: 'asc' | 'desc' =
          options.order === 'asc' || options.order === 'desc'
            ? options.order
            : defaultOrderForSort[sortField];

        const sanitizedOptions: ServiceListOptions & { sort: SortField; order: 'asc' | 'desc' } = {
          search: options.search?.trim() ? options.search.trim() : undefined,
          billing_method: options.billing_method,
          category_id: options.category_id,
          custom_service_type_id: options.custom_service_type_id,
          sort: sortField,
          order: sortOrder
        };

        const applyFilters = (query: Knex.QueryBuilder) => {
          if (sanitizedOptions.billing_method) {
            query.where('sc.billing_method', sanitizedOptions.billing_method);
          }

          if (sanitizedOptions.custom_service_type_id) {
            query.where('sc.custom_service_type_id', sanitizedOptions.custom_service_type_id);
          }

          if (sanitizedOptions.category_id !== undefined) {
            if (sanitizedOptions.category_id === null) {
              query.whereNull('sc.category_id');
            } else {
              query.where('sc.category_id', sanitizedOptions.category_id);
            }
          }

          if (sanitizedOptions.search) {
            const term = `%${sanitizedOptions.search}%`;
            query.andWhere((builder) => {
              builder
                .whereILike('sc.service_name', term)
                .orWhereILike('sc.description', term);
            });
          }

          return query;
        };

        const sortColumnMap: Record<SortField, string> = {
          service_name: 'sc.service_name',
          billing_method: 'sc.billing_method',
          default_rate: 'sc.default_rate'
        };

        const baseQuery = trx('service_catalog as sc').where({ 'sc.tenant': tenant });

        // Get total count for pagination
        const countQuery = applyFilters(baseQuery.clone());
        const countResult = await countQuery
          .count('sc.service_id as count')
          .first();

        const totalCount = parseInt(countResult?.count as string) || 0;

        // Fetch services with service type names by joining with custom service type table
        const servicesQuery = applyFilters(
          baseQuery
            .clone()
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
              'sc.currency_code',
              'sc.unit_of_measure',
              'sc.category_id',
              'sc.tenant',
              'sc.description',
              'sc.tax_rate_id', // Corrected: Use tax_rate_id based on schema
              'st.name as service_type_name' // Add service type name
            )
        )
          .orderBy(sortColumnMap[sanitizedOptions.sort], sanitizedOptions.order)
          .modify((queryBuilder) => {
            if (sanitizedOptions.sort !== 'service_name') {
              queryBuilder.orderBy('sc.service_name', 'asc');
            }
          })
          .limit(pageSize)
          .offset(offset);

        const servicesData = await servicesQuery;

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


function safeRevalidate(path: string): void {
    try {
        revalidatePath(path)
    } catch (error) {
        console.warn(`[serviceActions] Failed to revalidate path "${path}":`, error instanceof Error ? error.message : error)
    }
}

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

        // 1. Verify the custom service type exists
        const customServiceType = await trx<IServiceType>('service_types')
            .where('id', custom_service_type_id)
            .andWhere('tenant', tenant) // Match tenant
            .first();
        if (!customServiceType) {
            throw new Error(`ServiceType ID '${custom_service_type_id}' not found for tenant '${tenant}'.`);
        }

        // 2. Ensure a billing method was provided (use the one from serviceData, not from service type)
        if (!serviceData.billing_method) {
            throw new Error('billing_method is required to create a service.');
        }
        console.log(`[serviceActions] Creating service with billing method: ${serviceData.billing_method}`);

        // 3. Prepare final data
        const finalServiceData = {
            ...serviceData,
            tenant: tenant, // Explicitly add tenant to the data
            billing_method: serviceData.billing_method, // Use the billing method from the form
            custom_service_type_id: custom_service_type_id,
            // Ensure default_rate is a number
            default_rate: typeof serviceData.default_rate === 'string'
                ? parseFloat(serviceData.default_rate) || 0
                : serviceData.default_rate,
            // Use provided currency_code or default to USD
            currency_code: serviceData.currency_code || 'USD',
            // Explicitly handle tax_rate_id to ensure it's null rather than undefined
            tax_rate_id: serviceData.tax_rate_id || null,
        };

            // 4. Create the service using the model
            const service = await Service.create(trx, finalServiceData as Omit<IService, 'service_id'>);
            console.log('[serviceActions] Service created successfully:', service);
            safeRevalidate('/msp/billing'); // Revalidate the billing page
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
            safeRevalidate('/msp/billing'); // Revalidate the billing page

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
            safeRevalidate('/msp/billing') // Revalidate the billing page
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
export async function getServiceTypesForSelection(): Promise<{ id: string; name: string; billing_method: 'fixed' | 'hourly' | 'usage'; is_standard: boolean }[]> {
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
          safeRevalidate('/msp/settings/billing');
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

// --- Inline Service Type Management Actions (for editable dropdown) ---

/**
 * Create a new service type with just a name (inline creation)
 * Automatically assigns billing_method as 'usage' and generates next order number
 */
export async function createServiceTypeInline(name: string): Promise<IServiceType> {
  try {
    const { ServiceTypeModel } = await import('../models/serviceType');
    const { knex: db } = await createTenantKnex();

    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Get the highest order number to calculate next order
      const maxOrderResult = await trx('service_types')
        .max('order_number as max_order')
        .first();

      const nextOrder = (maxOrderResult?.max_order || 0) + 1;

      // Create service type with default billing method and next order
      const newServiceType = await ServiceTypeModel.create(trx, {
        name: name.trim(),
        billing_method: 'usage', // Default to usage for inline creation
        description: null,
        is_active: true,
        order_number: nextOrder,
      });

      safeRevalidate('/msp/settings/billing');
      return newServiceType;
    });
  } catch (error) {
    console.error('Error creating service type inline:', error);
    throw new Error('Failed to create service type');
  }
}

/**
 * Update a service type name (inline editing)
 */
export async function updateServiceTypeInline(id: string, name: string): Promise<IServiceType> {
  try {
    const { ServiceTypeModel } = await import('../models/serviceType');
    const { knex: db } = await createTenantKnex();

    const updatedServiceType = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await ServiceTypeModel.update(trx, id, { name: name.trim() });
    });

    if (!updatedServiceType) {
      throw new Error(`Service type with id ${id} not found or could not be updated.`);
    }

      safeRevalidate('/msp/settings/billing');
    return updatedServiceType;
  } catch (error) {
    console.error(`Error updating service type ${id}:`, error);
    throw new Error('Failed to update service type');
  }
}

/**
 * Delete a service type (inline deletion with usage check)
 */
export async function deleteServiceTypeInline(id: string): Promise<void> {
  // This is the same as deleteServiceType but renamed for clarity
  return deleteServiceType(id);
}
