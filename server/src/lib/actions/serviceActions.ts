'use server'

import { revalidatePath } from 'next/cache'
import Service, { serviceSchema, refinedServiceSchema } from 'server/src/lib/models/service'; // Import both schemas
import { IService, IServiceType, IServicePrice } from '../../interfaces/billing.interfaces';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';
import { validateArray } from 'server/src/lib/utils/validation';
import { ServiceTypeModel } from '../models/serviceType'; // Import ServiceTypeModel
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';

// Interface for paginated service response
export interface PaginatedServicesResponse {
  services: IService[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface ServiceListOptions {
  search?: string;
  /**
   * Catalog kind filter.
   * - Omit to preserve legacy behavior (services only).
   * - Use 'product' for product-only lists.
   * - Use 'any' to include both services and products.
   */
  item_kind?: 'service' | 'product' | 'any';
  is_active?: boolean;
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit';
  category_id?: string | null;
  custom_service_type_id?: string;
  sort?: 'service_name' | 'billing_method' | 'default_rate';
  order?: 'asc' | 'desc';
}

export interface CatalogPickerSearchOptions {
  search?: string;
  page?: number;
  limit?: number;
  is_active?: boolean;
  item_kinds?: Array<'service' | 'product'>;
  billing_methods?: Array<'fixed' | 'hourly' | 'usage' | 'per_unit'>;
}

export type CatalogPickerItem = Pick<
  IService,
  'service_id' | 'service_name' | 'billing_method' | 'unit_of_measure' | 'item_kind' | 'sku'
> & {
  default_rate: number;
};

export async function searchServiceCatalogForPicker(
  options: CatalogPickerSearchOptions = {}
): Promise<{ items: CatalogPickerItem[]; totalCount: number }> {
  const { knex: db, tenant } = await createTenantKnex();

  const page = options.page ?? 1;
  const limit = options.limit ?? 10;
  const offset = (page - 1) * limit;

  const searchTerm = options.search?.trim() ? `%${options.search.trim()}%` : null;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const base = trx('service_catalog as sc').where({ 'sc.tenant': tenant });

    if (options.is_active !== undefined) {
      base.andWhere('sc.is_active', options.is_active);
    }

    if (options.item_kinds?.length) {
      base.andWhere((qb) => qb.whereIn('sc.item_kind', options.item_kinds!));
    }

    if (options.billing_methods?.length) {
      base.andWhere((qb) => qb.whereIn('sc.billing_method', options.billing_methods!));
    }

    if (searchTerm) {
      base.andWhere((qb) => {
        qb.whereILike('sc.service_name', searchTerm)
          .orWhereILike('sc.description', searchTerm)
          .orWhereILike('sc.sku', searchTerm);
      });
    }

    const countResult = await base
      .clone()
      .count('sc.service_id as count')
      .first();

    const totalCount = parseInt(countResult?.count as string) || 0;

    const rows = await base
      .clone()
      .select(
        'sc.service_id',
        'sc.service_name',
        'sc.billing_method',
        'sc.unit_of_measure',
        'sc.item_kind',
        'sc.sku',
        trx.raw('CAST(sc.default_rate AS FLOAT) as default_rate')
      )
      .orderBy('sc.service_name', 'asc')
      .limit(limit)
      .offset(offset);

    return {
      items: rows as CatalogPickerItem[],
      totalCount,
    };
  });
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
          // Preserve legacy behavior: callers historically expect services only.
          item_kind: options.item_kind ?? 'service',
          is_active: options.is_active,
          billing_method: options.billing_method,
          category_id: options.category_id,
          custom_service_type_id: options.custom_service_type_id,
          sort: sortField,
          order: sortOrder
        };

        const applyFilters = (query: Knex.QueryBuilder) => {
          if (sanitizedOptions.item_kind && sanitizedOptions.item_kind !== 'any') {
            query.where('sc.item_kind', sanitizedOptions.item_kind);
          }

          if (sanitizedOptions.is_active !== undefined) {
            query.where('sc.is_active', sanitizedOptions.is_active);
          }

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
                .orWhereILike('sc.description', term)
                .orWhereILike('sc.sku', term);
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
              'sc.unit_of_measure',
              'sc.category_id',
              'sc.tenant',
              'sc.description',
              'sc.item_kind',
              'sc.is_active',
              'sc.sku',
              trx.raw('CAST(sc.cost AS FLOAT) as cost'),
              'sc.cost_currency',
              'sc.vendor',
              'sc.manufacturer',
              'sc.product_category',
              'sc.is_license',
              'sc.license_term',
              'sc.license_billing_cadence',
              'sc.tax_rate_id', // Corrected: Use tax_rate_id based on schema
              'st.name as service_type_name' // Add service type name
            )
        )
          .orderBy(sortColumnMap[sanitizedOptions.sort], sanitizedOptions.order)
          .modify((queryBuilder) => {
            if (sanitizedOptions.sort !== 'service_name') {
              queryBuilder.orderBy('sc.service_name', 'asc');
            }
            // Ensure stable pagination ordering for deterministic page boundaries.
            queryBuilder.orderBy('sc.service_id', 'asc');
          })
          .limit(pageSize)
          .offset(offset);

        const servicesData = await servicesQuery;

        // Fetch all prices for these services
        const serviceIds = servicesData.map((s: { service_id: string }) => s.service_id);
        const allPrices = serviceIds.length > 0
          ? await trx('service_prices')
              .where({ tenant })
              .whereIn('service_id', serviceIds)
              .select('*')
          : [];

        // Group prices by service_id
        const pricesByService = allPrices.reduce((acc: Record<string, IServicePrice[]>, price: IServicePrice) => {
          if (!acc[price.service_id]) {
            acc[price.service_id] = [];
          }
          acc[price.service_id].push(price);
          return acc;
        }, {} as Record<string, IServicePrice[]>);

        // Validate and transform the data
        const validatedServices = servicesData.map((service: { service_id: string }) => {
            return serviceSchema.parse({
              ...service,
              prices: pricesByService[service.service_id] || []
            });
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
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          throw new Error('Unauthorized');
        }
        const { custom_service_type_id } = serviceData;

        if (!custom_service_type_id) {
            throw new Error('custom_service_type_id is required to create a service.');
        }

        const { knex: db, tenant } = await createTenantKnex();
        return withTransaction(db, async (trx: Knex.Transaction) => {
        const canCreate = await hasPermission(currentUser, 'service', 'create', trx);
        if (!canCreate) {
          throw new Error('Permission denied: Cannot create services/products');
        }

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
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    const { knex: db } = await createTenantKnex();
    try {
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            const canUpdate = await hasPermission(currentUser, 'service', 'update', trx);
            if (!canUpdate) {
              throw new Error('Permission denied: Cannot update services/products');
            }
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
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    const { knex: db } = await createTenantKnex();
    try {
        await withTransaction(db, async (trx: Knex.Transaction) => {
            const canDelete = await hasPermission(currentUser, 'service', 'delete', trx);
            if (!canDelete) {
              throw new Error('Permission denied: Cannot delete services/products');
            }
            await Service.delete(trx, serviceId)
            safeRevalidate('/msp/billing') // Revalidate the billing page
        });
    } catch (error) {
        console.error(`Error deleting service with id ${serviceId}:`, error)
        throw new Error('Failed to delete service')
    }
}

export interface ProductAssociationCheck {
  canDelete: boolean;
  associations: {
    type: string;
    count: number;
    description: string;
  }[];
}

/**
 * Check if a product/service can be permanently deleted.
 * Returns information about any associations that would block deletion.
 */
export async function checkProductCanBeDeleted(serviceId: string): Promise<ProductAssociationCheck> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    const { knex: db, tenant } = await createTenantKnex();

    try {
        return await withTransaction(db, async (trx: Knex.Transaction) => {
            const associations: ProductAssociationCheck['associations'] = [];

            // Check invoice_items
            const invoiceItemsResult = await trx('invoice_items')
                .where({ service_id: serviceId, tenant })
                .count('* as count')
                .first();
            const invoiceItemsCount = parseInt(String(invoiceItemsResult?.count ?? 0));
            if (invoiceItemsCount > 0) {
                associations.push({
                    type: 'invoice_items',
                    count: invoiceItemsCount,
                    description: `Used in ${invoiceItemsCount} invoice line item(s)`
                });
            }

            // Check time_entries
            const timeEntriesResult = await trx('time_entries')
                .where({ service_id: serviceId, tenant })
                .count('* as count')
                .first();
            const timeEntriesCount = parseInt(String(timeEntriesResult?.count ?? 0));
            if (timeEntriesCount > 0) {
                associations.push({
                    type: 'time_entries',
                    count: timeEntriesCount,
                    description: `Associated with ${timeEntriesCount} time entr${timeEntriesCount === 1 ? 'y' : 'ies'}`
                });
            }

            // Check ticket_materials
            const ticketMaterialsResult = await trx('ticket_materials')
                .where({ service_id: serviceId, tenant })
                .count('* as count')
                .first();
            const ticketMaterialsCount = parseInt(String(ticketMaterialsResult?.count ?? 0));
            if (ticketMaterialsCount > 0) {
                associations.push({
                    type: 'ticket_materials',
                    count: ticketMaterialsCount,
                    description: `Used in ${ticketMaterialsCount} ticket material(s)`
                });
            }

            // Check project_materials
            const projectMaterialsResult = await trx('project_materials')
                .where({ service_id: serviceId, tenant })
                .count('* as count')
                .first();
            const projectMaterialsCount = parseInt(String(projectMaterialsResult?.count ?? 0));
            if (projectMaterialsCount > 0) {
                associations.push({
                    type: 'project_materials',
                    count: projectMaterialsCount,
                    description: `Used in ${projectMaterialsCount} project material(s)`
                });
            }

            // Check contract_line_services
            const contractLineServicesResult = await trx('contract_line_services')
                .where({ service_id: serviceId, tenant })
                .count('* as count')
                .first();
            const contractLineServicesCount = parseInt(String(contractLineServicesResult?.count ?? 0));
            if (contractLineServicesCount > 0) {
                associations.push({
                    type: 'contract_line_services',
                    count: contractLineServicesCount,
                    description: `Used in ${contractLineServicesCount} contract line(s)`
                });
            }

            // Check contract_line_service_configuration
            const contractLineServiceConfigResult = await trx('contract_line_service_configuration')
                .where({ service_id: serviceId, tenant })
                .count('* as count')
                .first();
            const contractLineServiceConfigCount = parseInt(String(contractLineServiceConfigResult?.count ?? 0));
            if (contractLineServiceConfigCount > 0) {
                associations.push({
                    type: 'contract_line_service_configuration',
                    count: contractLineServiceConfigCount,
                    description: `Configured in ${contractLineServiceConfigCount} contract line(s)`
                });
            }

            // Check bucket_usage
            const bucketUsageResult = await trx('bucket_usage')
                .where({ service_catalog_id: serviceId, tenant })
                .count('* as count')
                .first();
            const bucketUsageCount = parseInt(String(bucketUsageResult?.count ?? 0));
            if (bucketUsageCount > 0) {
                associations.push({
                    type: 'bucket_usage',
                    count: bucketUsageCount,
                    description: `Has ${bucketUsageCount} usage record(s)`
                });
            }

            return {
                canDelete: associations.length === 0,
                associations
            };
        });
    } catch (error) {
        console.error(`Error checking product associations for ${serviceId}:`, error);
        throw new Error('Failed to check product associations');
    }
}

/**
 * Permanently delete a product/service.
 * Will fail if the product has any associations (invoices, contracts, etc.)
 */
export async function deleteProductPermanently(serviceId: string): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    const { knex: db, tenant } = await createTenantKnex();

    try {
        await withTransaction(db, async (trx: Knex.Transaction) => {
            const canDelete = await hasPermission(currentUser, 'service', 'delete', trx);
            if (!canDelete) {
              throw new Error('Permission denied: Cannot delete services/products');
            }

            // Re-check associations within the transaction to prevent race conditions
            const check = await checkProductCanBeDeleted(serviceId);
            if (!check.canDelete) {
                const reasons = check.associations.map(a => a.description).join(', ');
                throw new Error(`Cannot delete product: ${reasons}`);
            }

            // Delete related records that are safe to remove (pricing, config records)
            // These have CASCADE on delete but we do it explicitly for clarity
            await trx('service_prices')
                .where({ service_id: serviceId, tenant })
                .del();

            await trx('service_rate_tiers')
                .where({ service_id: serviceId, tenant })
                .del();

            // Clear nullable references
            await trx('project_tasks')
                .where({ service_id: serviceId, tenant })
                .update({ service_id: null });

            await trx('project_template_tasks')
                .where({ service_id: serviceId, tenant })
                .update({ service_id: null });

            await trx('invoice_charge_details')
                .where({ service_id: serviceId, tenant })
                .update({ service_id: null });

            // Delete the product
            const deletedCount = await trx('service_catalog')
                .where({ service_id: serviceId, tenant })
                .del();

            if (deletedCount === 0) {
                throw new Error('Product not found');
            }

            safeRevalidate('/msp/billing');
            safeRevalidate('/msp/settings/billing');
        });
    } catch (error) {
        console.error(`Error permanently deleting product ${serviceId}:`, error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error('Failed to delete product');
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
export async function getServiceTypesForSelection(): Promise<{ id: string; name: string; billing_method: 'fixed' | 'hourly' | 'per_unit' | 'usage'; is_standard: boolean }[]> {
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
 * Creates with the provided billing_method and generates next order number
 */
export async function createServiceTypeInline(
  name: string,
  billing_method: 'fixed' | 'hourly' | 'per_unit' | 'usage' = 'usage'
): Promise<IServiceType> {
  try {
    const { knex: db } = await createTenantKnex();

    return withTransaction(db, async (trx: Knex.Transaction) => {
      const normalizedName = name.trim();
      if (!normalizedName) {
        throw new Error('Service type name is required');
      }

      // If it already exists for this tenant, return it (avoid 23505 on repeated clicks)
      const { getCurrentTenantId } = await import('../db');
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found for request');
      }

      const existing = await trx<IServiceType>('service_types').where({ tenant, name: normalizedName }).first();
      if (existing) {
        return existing;
      }

      // Get the highest order number to calculate next order
      const maxOrderResult = await trx('service_types')
        .where({ tenant })
        .max('order_number as max_order')
        .first();

      const nextOrder = (maxOrderResult?.max_order || 0) + 1;

      // Create service type with default billing method and next order.
      // Use ON CONFLICT DO NOTHING to make the action idempotent under concurrency.
      const inserted = await trx<IServiceType>('service_types')
        .insert({
          tenant,
          name: normalizedName,
          billing_method,
          description: null,
          is_active: true,
          order_number: nextOrder,
        })
        .onConflict(['tenant', 'name'])
        .ignore()
        .returning('*');

      if (inserted.length > 0) {
        safeRevalidate('/msp/settings/billing');
        return inserted[0];
      }

      // Insert was skipped due to conflict; fetch and return the existing row.
      const afterConflict = await trx<IServiceType>('service_types').where({ tenant, name: normalizedName }).first();
      if (!afterConflict) {
        throw new Error('Failed to create service type');
      }

      safeRevalidate('/msp/settings/billing');
      return afterConflict;
    });
  } catch (error) {
    console.error('Error creating service type inline:', error);

    // If we somehow still hit a unique constraint, surface a friendlier message
    if ((error as any)?.code === '23505') {
      throw new Error('Service type already exists');
    }

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

// ========== Service Price Actions ==========

/**
 * Get all prices for a service
 */
export async function getServicePrices(serviceId: string): Promise<IServicePrice[]> {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      return await Service.getPrices(trx, serviceId);
    });
  } catch (error) {
    console.error(`Error fetching prices for service ${serviceId}:`, error);
    throw new Error('Failed to fetch service prices');
  }
}

/**
 * Get a specific price for a service in a given currency
 */
export async function getServicePrice(serviceId: string, currencyCode: string): Promise<IServicePrice | null> {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      return await Service.getPrice(trx, serviceId, currencyCode);
    });
  } catch (error) {
    console.error(`Error fetching price for service ${serviceId} in ${currencyCode}:`, error);
    throw new Error('Failed to fetch service price');
  }
}

/**
 * Set a price for a service in a given currency (upsert)
 */
export async function setServicePrice(
  serviceId: string,
  currencyCode: string,
  rate: number
): Promise<IServicePrice> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const canUpdate = await hasPermission(currentUser, 'service', 'update', trx);
      if (!canUpdate) {
        throw new Error('Permission denied: Cannot update service pricing');
      }
      const result = await Service.setPrice(trx, serviceId, currencyCode, rate);
      safeRevalidate('/msp/billing');
      return result;
    });
  } catch (error) {
    console.error(`Error setting price for service ${serviceId} in ${currencyCode}:`, error);
    throw new Error('Failed to set service price');
  }
}

/**
 * Set multiple prices for a service at once (replaces all existing prices)
 */
export async function setServicePrices(
  serviceId: string,
  prices: Array<{ currency_code: string; rate: number }>
): Promise<IServicePrice[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const canUpdate = await hasPermission(currentUser, 'service', 'update', trx);
      if (!canUpdate) {
        throw new Error('Permission denied: Cannot update service pricing');
      }
      const result = await Service.setPrices(trx, serviceId, prices);
      safeRevalidate('/msp/billing');
      return result;
    });
  } catch (error) {
    console.error(`Error setting prices for service ${serviceId}:`, error);
    throw new Error('Failed to set service prices');
  }
}

/**
 * Remove a specific price for a service
 */
export async function removeServicePrice(serviceId: string, currencyCode: string): Promise<boolean> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const canUpdate = await hasPermission(currentUser, 'service', 'update', trx);
      if (!canUpdate) {
        throw new Error('Permission denied: Cannot update service pricing');
      }
      const result = await Service.removePrice(trx, serviceId, currencyCode);
      safeRevalidate('/msp/billing');
      return result;
    });
  } catch (error) {
    console.error(`Error removing price for service ${serviceId} in ${currencyCode}:`, error);
    throw new Error('Failed to remove service price');
  }
}

/**
 * Validate that services have prices in the required currency
 * Returns services that are missing the required currency price
 */
export async function validateServiceCurrencyPrices(
  serviceIds: string[],
  requiredCurrency: string
): Promise<{ valid: boolean; missingServices: Array<{ service_id: string; service_name: string }> }> {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      return await Service.validateCurrencyPrices(trx, serviceIds, requiredCurrency);
    });
  } catch (error) {
    console.error(`Error validating currency prices for services:`, error);
    throw new Error('Failed to validate service currency prices');
  }
}
