import { getCurrentTenantId } from '../db';
import { IService, IServicePrice } from '../../interfaces/billing.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { validateData } from '../utils/validation';
import { Knex } from 'knex';

// Use a constant for environment check
const IS_DEVELOPMENT = typeof window !== 'undefined' &&
  globalThis.window.location.hostname === 'localhost';

const log = {
  info: (message: string, ...args: unknown[]) => {
    if (IS_DEVELOPMENT) {
      globalThis.console.log(message, ...args);
    }
  },
  error: (message: string, ...args: unknown[]) => {
    globalThis.console.error(message, ...args);
  }
};

// Schema for service prices
const servicePriceSchema = z.object({
  price_id: z.string().uuid(),
  tenant: z.string().min(1, 'Tenant is required'),
  service_id: z.string().uuid(),
  currency_code: z.string().length(3),
  rate: z.union([z.string(), z.number()]).transform(val =>
    typeof val === 'string' ? parseFloat(val) || 0 : val
  ),
  created_at: z.union([z.string(), z.date()]).transform(val =>
    val instanceof Date ? val.toISOString() : val
  ).optional(),
  updated_at: z.union([z.string(), z.date()]).transform(val =>
    val instanceof Date ? val.toISOString() : val
  ).optional()
});

// Base schema definition - aligns closely with DB nullability where appropriate
const baseServiceSchema = z.object({
  service_id: z.string().uuid(),
  tenant: z.string().min(1, 'Tenant is required'),
  service_name: z.string(),
  custom_service_type_id: z.string().uuid(),   // Now required, not nullable
  billing_method: z.enum(['fixed', 'hourly', 'usage', 'per_unit']),
  default_rate: z.union([z.string(), z.number()]).transform(val =>
    typeof val === 'string' ? parseFloat(val) || 0 : val
  ),
  unit_of_measure: z.string(),
  category_id: z.string().uuid().nullable(), // Matches DB FK (nullable) - IService allows string | null
  item_kind: z.enum(['service', 'product']).default('service'),
  is_active: z.union([z.boolean(), z.number()]).transform((val) => Boolean(val)).default(true),
  sku: z.string().nullable().optional(),
  cost: z.union([z.string(), z.number()]).transform(val =>
    typeof val === 'string' ? parseFloat(val) || 0 : val
  ).nullable().optional(),
  vendor: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  product_category: z.string().nullable().optional(),
  is_license: z.union([z.boolean(), z.number()]).transform((val) => Boolean(val)).default(false),
  license_term: z.string().nullable().optional(),
  license_billing_cadence: z.string().nullable().optional(),
  tax_rate_id: z.union([z.string().uuid(), z.null()]).optional(), // Accept string, null, or undefined
  description: z.string().nullable(), // Added: Description field from the database
  service_type_name: z.string().optional(), // Add service_type_name to the schema
  prices: z.array(servicePriceSchema).optional(), // Multi-currency prices
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});

// No need for refine check anymore since we only have custom_service_type_id
export const refinedServiceSchema = baseServiceSchema;

// Final schema for validation, transforming nulls to match IService interface
// IService uses string | null for category_id, tax_region
// IService uses string | undefined, number | undefined for others
export const serviceSchema = refinedServiceSchema.transform((data) => {
  // Explicitly type the input 'data' to the transform based on the refined schema
  const inputData = data as z.infer<typeof refinedServiceSchema>;
  return {
    ...inputData,
    // Keep null for fields that are string | null in IService
    category_id: inputData.category_id,
    description: inputData.description,
    tax_rate_id: inputData.tax_rate_id,   // Keep null for string | null
    custom_service_type_id: inputData.custom_service_type_id,
  };
});

// Infer the final type matching IService structure
export type ServiceSchemaType = z.infer<typeof serviceSchema>;

// Create schema: Omit service_id and tenant from the *base* schema first
// We omit tenant because it will be added by the server-side code after validation
const baseCreateServiceSchema = baseServiceSchema.omit({ service_id: true, tenant: true, created_at: true, updated_at: true });

// No need for refine check anymore
const refinedCreateServiceSchema = baseCreateServiceSchema;

// Apply the same transformation logic to the create schema
export const createServiceSchema = refinedCreateServiceSchema.transform((data) => {
  // Explicitly type the input 'data'
  const inputData = data as z.infer<typeof refinedCreateServiceSchema>;
  return {
    ...inputData,
    category_id: inputData.category_id,
    description: inputData.description,
    tax_rate_id: inputData.tax_rate_id,   // Keep null for string | null
    custom_service_type_id: inputData.custom_service_type_id,
  };
});

// Infer the creation type
export type CreateServiceSchemaType = z.infer<typeof createServiceSchema>;

const Service = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<IService[]> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      const error = new Error('Tenant context is required for fetching services');
      log.error(`[Service.getAll] ${error.message}`);
      throw error;
    }

    log.info(`[Service.getAll] Fetching all services for tenant: ${tenant}`);


    try {
      // Fetch services, joining with custom service types to get type names
      const servicesData = await knexOrTrx('service_catalog as sc')
        .where({ 'sc.tenant': tenant })
        .leftJoin('service_types as ct', function() {
          this.on('sc.custom_service_type_id', '=', 'ct.id')
              .andOn('ct.tenant', '=', knexOrTrx.raw('?', [tenant]));
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.custom_service_type_id',
          'sc.billing_method',
          knexOrTrx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.description',
          'sc.tax_rate_id',
          'sc.item_kind',
          'sc.is_active',
          'sc.sku',
          knexOrTrx.raw('CAST(sc.cost AS FLOAT) as cost'),
          'sc.vendor',
          'sc.manufacturer',
          'sc.product_category',
          'sc.is_license',
          'sc.license_term',
          'sc.license_billing_cadence',
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        )
        .orderBy('sc.service_name', 'asc');
      log.info(`[Service.getAll] Found ${servicesData.length} services`);

      // Fetch all prices for these services
      const serviceIds = servicesData.map(s => s.service_id);
      const allPrices = serviceIds.length > 0
        ? await knexOrTrx('service_prices')
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

      // Validate and transform using the final schema's parse method
      const validatedServices = servicesData.map((service) => {
        // .parse() validates against the refined schema AND applies the transform
        const validated = serviceSchema.parse({
          ...service,
          prices: pricesByService[service.service_id] || []
        });
        return validated;
      });

      log.info(`[Service.getAll] Services data validated successfully`);
      return validatedServices;
    } catch (error) {
      log.error(`[Service.getAll] Error fetching services:`, error);
      throw error;
    }
  },

  getById: async (knexOrTrx: Knex | Knex.Transaction, service_id: string): Promise<IService | null> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      const error = new Error('Tenant context is required for fetching service');
      log.error(`[Service.getById] ${error.message}`);
      throw error;
    }

    log.info(`[Service.getById] Fetching service with ID: ${service_id} for tenant: ${tenant}`);

    try {
      // Fetch service by ID, joining with custom service types
      const serviceData = await knexOrTrx('service_catalog as sc')
        .where({
          'sc.service_id': service_id,
          'sc.tenant': tenant
        })
        .leftJoin('service_types as ct', function() {
          this.on('sc.custom_service_type_id', '=', 'ct.id')
              .andOn('ct.tenant', '=', knexOrTrx.raw('?', [tenant]));
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.custom_service_type_id',
          'sc.billing_method',
          knexOrTrx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.description',
          'sc.tax_rate_id',
          'sc.item_kind',
          'sc.is_active',
          'sc.sku',
          knexOrTrx.raw('CAST(sc.cost AS FLOAT) as cost'),
          'sc.vendor',
          'sc.manufacturer',
          'sc.product_category',
          'sc.is_license',
          'sc.license_term',
          'sc.license_billing_cadence',
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        )
        .first(); // Use .first() as we expect only one

      if (!serviceData) {
        log.info(`[Service.getById] No service found with ID: ${service_id} for tenant: ${tenant}`);
        return null;
      }

      // Fetch prices for this service
      const prices = await knexOrTrx('service_prices')
        .where({ service_id, tenant })
        .select('*');

      log.info(`[Service.getById] Found service: ${serviceData.service_name} with ${prices.length} price(s)`);
      // Validate and transform using the final schema's parse method
      const validatedService = serviceSchema.parse({
        ...serviceData,
        prices
      });
      log.info(`[Service.getById] Service data validated successfully`);

      return validatedService;
    } catch (error) {
      log.error(`[Service.getById] Error fetching service ${service_id}:`, error);
      throw error;
    }
  },

  // Note: Input type validation (exactly one ID) is expected to be handled by the caller (e.g., serviceAction)
  // or potentially by refining createServiceSchema further if desired.
  create: async (knexOrTrx: Knex | Knex.Transaction, serviceData: Omit<IService, 'service_id'> & { tenant?: string }): Promise<IService> => {
    const dbTenant = await getCurrentTenantId();

    // Use the tenant from the serviceData if provided, otherwise use the one from getCurrentTenantId
    const effectiveTenant = serviceData.tenant || dbTenant;

    if (!effectiveTenant) {
      throw new Error('Tenant context is required for creating a service');
    }

    // Remove service_type_name from the input data as it's a virtual field
    const { service_type_name, ...dataWithoutTypeName } = serviceData;
    
    // Ensure all nullable fields are properly set to null instead of undefined
    const cleanedData = {
      ...dataWithoutTypeName,
      tax_rate_id: dataWithoutTypeName.tax_rate_id ?? null,
      category_id: dataWithoutTypeName.category_id ?? null,
      description: dataWithoutTypeName.description ?? null,
    };

    // Validate the input data using the updated creation schema
    // The refine check in the schema ensures one ID is present.
    // Explicitly type validatedData using the inferred type
    // Validate against the create schema expecting nulls
    // Note: We use the validated data *before* transformation to build the DB object
    // Validate against the refined create schema (expects nulls)
    // Validate and transform the input using the final create schema
    // The result 'validatedData' will match CreateServiceSchemaType
    // Ensure default_rate is a number before validation
    const dataToValidate = {
      ...cleanedData,
      default_rate: typeof cleanedData.default_rate === 'string'
        ? parseFloat(cleanedData.default_rate) || 0
        : cleanedData.default_rate,
    };

    const validatedData = createServiceSchema.parse(dataToValidate);

    const normalizedDefaultRate = Math.round(Number(validatedData.default_rate || 0));
    if (!Number.isFinite(normalizedDefaultRate) || normalizedDefaultRate < 0) {
      throw new Error('default_rate must be a non-negative number');
    }

    const normalizedCost =
      validatedData.cost === null || validatedData.cost === undefined
        ? null
        : Math.round(Number(validatedData.cost));
    if (normalizedCost !== null && (!Number.isFinite(normalizedCost) || normalizedCost < 0)) {
      throw new Error('cost must be a non-negative number');
    }

    const newService = {
      service_id: uuidv4(),
      tenant: effectiveTenant,
      service_name: validatedData.service_name,
      custom_service_type_id: validatedData.custom_service_type_id,
      billing_method: validatedData.billing_method,
      default_rate: normalizedDefaultRate,
      unit_of_measure: validatedData.unit_of_measure,
      category_id: validatedData.category_id ?? null, // category_id is string | null in IService
      tax_rate_id: validatedData.tax_rate_id ?? null, // Corrected: Use tax_rate_id
      description: validatedData.description ?? '', // Add description field with default empty string
      item_kind: validatedData.item_kind ?? 'service',
      is_active: validatedData.is_active ?? true,
      sku: validatedData.sku ?? null,
      cost: normalizedCost,
      vendor: validatedData.vendor ?? null,
      manufacturer: validatedData.manufacturer ?? null,
      product_category: validatedData.product_category ?? null,
      is_license: validatedData.is_license ?? false,
      license_term: validatedData.license_term ?? null,
      license_billing_cadence: validatedData.license_billing_cadence ?? null,
    };

    log.info('[Service.create] Constructed newService object:', newService);

    try {
      // Insert into service_catalog (assuming this is the correct table name)
      const [createdService] = await knexOrTrx('service_catalog')
        .insert(newService)
        .returning('*'); // Return all columns to match IService

      log.info('[Service.create] Successfully created service:', createdService);
      
      // After creation, fetch the complete service with type name by joining with type tables
      const completeService = await knexOrTrx('service_catalog as sc')
        .where({
          'sc.service_id': createdService.service_id,
          'sc.tenant': effectiveTenant
        })
        .leftJoin('service_types as ct', function() {
          this.on('sc.custom_service_type_id', '=', 'ct.id')
              .andOn('ct.tenant', '=', knexOrTrx.raw('?', [effectiveTenant]));
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.custom_service_type_id',
          'sc.billing_method',
          knexOrTrx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.description',
          'sc.tax_rate_id',
          'sc.item_kind',
          'sc.is_active',
          'sc.sku',
          knexOrTrx.raw('CAST(sc.cost AS FLOAT) as cost'),
          'sc.vendor',
          'sc.manufacturer',
          'sc.product_category',
          'sc.is_license',
          'sc.license_term',
          'sc.license_billing_cadence',
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        )
        .first();

      if (!completeService) {
        log.info(`[Service.create] Failed to fetch complete service after creation: ${createdService.service_id}`);
        return serviceSchema.parse({ ...createdService, prices: [] }); // Fall back to the original service data
      }

      // No prices exist yet for a newly created service
      // Validate and transform the DB result using the final schema's parse method
      return serviceSchema.parse({ ...completeService, prices: [] });
    } catch (error) {
      log.error('[Service.create] Database error:', error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, service_id: string, serviceData: Partial<IService>): Promise<IService | null> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      const error = new Error('Tenant context is required for updating service');
      log.error(`[Service.update] ${error.message}`);
      throw error;
    }

    try {
      // Remove tenant, service_type_name, and prices from update data to prevent modification
      // service_type_name is a virtual field from JOIN and doesn't exist in the table
      // prices is stored in a separate service_prices table
      const { tenant: _, service_type_name, prices: _prices, ...updateData } = serviceData;

      // No need to handle type ID changes anymore
      const finalUpdateData: Partial<IService> = { ...updateData };

      if (finalUpdateData.default_rate !== undefined) {
        const numericRate =
          typeof finalUpdateData.default_rate === 'string'
            ? parseFloat(finalUpdateData.default_rate)
            : finalUpdateData.default_rate;

        if (Number.isNaN(numericRate)) {
          delete finalUpdateData.default_rate;
        } else if (numericRate < 0) {
          throw new Error('default_rate must be a non-negative number');
        } else {
          finalUpdateData.default_rate = Math.round(numericRate);
        }
      }

      if (finalUpdateData.cost !== undefined && finalUpdateData.cost !== null) {
        const numericCost =
          typeof finalUpdateData.cost === 'string'
            ? parseFloat(finalUpdateData.cost)
            : finalUpdateData.cost;

        if (Number.isNaN(numericCost)) {
          delete finalUpdateData.cost;
        } else if (numericCost < 0) {
          throw new Error('cost must be a non-negative number');
        } else {
          finalUpdateData.cost = Math.round(numericCost);
        }
      }

      // Knex `update()` does not reliably ignore `undefined` values; strip them so we don't
      // generate invalid bindings (optional fields are allowed to be omitted entirely).
      const cleanedUpdateData = Object.fromEntries(
        Object.entries(finalUpdateData).filter(([, value]) => value !== undefined)
      ) as Partial<IService>;

      // Ensure updateData conforms to Partial<IService> based on the *new* interface
      // Zod validation could be added here too if needed for partial updates.
      const [updatedServiceData] = await knexOrTrx<IService>('service_catalog')
        .where({
          service_id,
          tenant
        })
        .update(cleanedUpdateData)
        .returning('*'); // Return all fields to validate against the schema

      if (!updatedServiceData) {
        log.info(`[Service.update] No service found with ID: ${service_id} or tenant mismatch`);
        return null;
      }

      // After update, fetch the complete service with type name by joining with type tables
      const completeService = await knexOrTrx('service_catalog as sc')
        .where({
          'sc.service_id': service_id,
          'sc.tenant': tenant
        })
        .leftJoin('service_types as ct', function() {
          this.on('sc.custom_service_type_id', '=', 'ct.id')
              .andOn('ct.tenant', '=', knexOrTrx.raw('?', [tenant]));
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.custom_service_type_id',
          'sc.billing_method',
          knexOrTrx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.description',
          'sc.tax_rate_id',
          'sc.item_kind',
          'sc.is_active',
          'sc.sku',
          knexOrTrx.raw('CAST(sc.cost AS FLOAT) as cost'),
          'sc.vendor',
          'sc.manufacturer',
          'sc.product_category',
          'sc.is_license',
          'sc.license_term',
          'sc.license_billing_cadence',
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        )
        .first();

      if (!completeService) {
        log.info(`[Service.update] Failed to fetch complete service after update: ${service_id}`);
        return null;
      }

      // Fetch prices for this service
      const prices = await knexOrTrx('service_prices')
        .where({ service_id, tenant })
        .select('*');

      // Validate and transform the DB result using the final schema's parse method
      return serviceSchema.parse({ ...completeService, prices });
    } catch (error) {
      log.error(`[Service.update] Error updating service ${service_id}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, service_id: string): Promise<boolean> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      const error = new Error('Tenant context is required for deleting service');
      log.error(`[Service.delete] ${error.message}`);
      throw error;
    }

    try {
      // If we're already in a transaction, use it directly
      if (knexOrTrx.isTransaction) {
        const updatedDetails = await knexOrTrx('invoice_charge_details')
          .where({
            service_id,
            tenant
          })
          .update({
            service_id: null
          });

        log.info(`[Service.delete] Updated ${updatedDetails} invoice_charge_details records for service ${service_id}`);

        // Clear service_id from project_tasks (replaces ON DELETE SET NULL)
        const updatedTasks = await knexOrTrx('project_tasks')
          .where({
            service_id,
            tenant
          })
          .update({
            service_id: null
          });

        log.info(`[Service.delete] Updated ${updatedTasks} project_tasks records for service ${service_id}`);

        // Clear service_id from project_template_tasks (replaces ON DELETE SET NULL)
        const updatedTemplateTasks = await knexOrTrx('project_template_tasks')
          .where({
            service_id,
            tenant
          })
          .update({
            service_id: null
          });

        log.info(`[Service.delete] Updated ${updatedTemplateTasks} project_template_tasks records for service ${service_id}`);

        // Then delete the service
        const deletedCount = await knexOrTrx('service_catalog')
          .where({
            service_id,
            tenant
          })
          .del();

        log.info(`[Service.delete] Deleted service ${service_id} for tenant ${tenant}. Affected rows: ${deletedCount}`);
        return deletedCount > 0;
      } else {
        // Otherwise create a transaction
        return await knexOrTrx.transaction(async (trx) => {
          const updatedDetails = await trx('invoice_charge_details')
            .where({
              service_id,
              tenant
            })
            .update({
              service_id: null
            });

          log.info(`[Service.delete] Updated ${updatedDetails} invoice_charge_details records for service ${service_id}`);

          // Clear service_id from project_tasks (replaces ON DELETE SET NULL)
          const updatedTasks = await trx('project_tasks')
            .where({
              service_id,
              tenant
            })
            .update({
              service_id: null
            });

          log.info(`[Service.delete] Updated ${updatedTasks} project_tasks records for service ${service_id}`);

          // Clear service_id from project_template_tasks (replaces ON DELETE SET NULL)
          const updatedTemplateTasks = await trx('project_template_tasks')
            .where({
              service_id,
              tenant
            })
            .update({
              service_id: null
            });

          log.info(`[Service.delete] Updated ${updatedTemplateTasks} project_template_tasks records for service ${service_id}`);

          // Then delete the service
          const deletedCount = await trx('service_catalog')
            .where({
              service_id,
              tenant
            })
            .del();

          log.info(`[Service.delete] Deleted service ${service_id} for tenant ${tenant}. Affected rows: ${deletedCount}`);
          return deletedCount > 0;
        });
      }
    } catch (error) {
      log.error(`[Service.delete] Error deleting service ${service_id}:`, error);
      throw error;
    }
  },

  getByCategoryId: async (knexOrTrx: Knex | Knex.Transaction, category_id: string): Promise<IService[]> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      const error = new Error('Tenant context is required for fetching services by category');
      log.error(`[Service.getByCategoryId] ${error.message}`);
      throw error;
    }

    try {
      // Fetch services by category ID, joining with custom service types
      const servicesData = await knexOrTrx('service_catalog as sc')
        .where({
          'sc.category_id': category_id,
          'sc.tenant': tenant
        })
        .leftJoin('service_types as ct', function() {
          this.on('sc.custom_service_type_id', '=', 'ct.id')
              .andOn('ct.tenant', '=', knexOrTrx.raw('?', [tenant]));
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.custom_service_type_id',
          'sc.billing_method',
          knexOrTrx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.description',
          'sc.tax_rate_id',
          'sc.item_kind',
          'sc.is_active',
          'sc.sku',
          knexOrTrx.raw('CAST(sc.cost AS FLOAT) as cost'),
          'sc.vendor',
          'sc.manufacturer',
          'sc.product_category',
          'sc.is_license',
          'sc.license_term',
          'sc.license_billing_cadence',
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        );

      log.info(`[Service.getByCategoryId] Found ${servicesData.length} services for category ${category_id}`);

      // Fetch all prices for these services
      const serviceIds = servicesData.map(s => s.service_id);
      const allPrices = serviceIds.length > 0
        ? await knexOrTrx('service_prices')
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

      // Validate and transform using the final schema's parse method
      return servicesData.map(service => {
        return serviceSchema.parse({
          ...service,
          prices: pricesByService[service.service_id] || []
        });
      });
    } catch (error) {
      log.error(`[Service.getByCategoryId] Error fetching services for category ${category_id}:`, error);
      throw error;
    }
  },

  // ========== Service Price CRUD Operations ==========

  /**
   * Get all prices for a service
   */
  getPrices: async (knexOrTrx: Knex | Knex.Transaction, service_id: string): Promise<IServicePrice[]> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      throw new Error('Tenant context is required for fetching service prices');
    }

    const prices = await knexOrTrx('service_prices')
      .where({ service_id, tenant })
      .select('*')
      .orderBy('currency_code', 'asc');

    return prices;
  },

  /**
   * Get a specific price for a service in a given currency
   */
  getPrice: async (
    knexOrTrx: Knex | Knex.Transaction,
    service_id: string,
    currency_code: string
  ): Promise<IServicePrice | null> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      throw new Error('Tenant context is required for fetching service price');
    }

    const price = await knexOrTrx('service_prices')
      .where({ service_id, currency_code, tenant })
      .first();

    return price || null;
  },

  /**
   * Set a price for a service in a given currency (upsert)
   */
  setPrice: async (
    knexOrTrx: Knex | Knex.Transaction,
    service_id: string,
    currency_code: string,
    rate: number
  ): Promise<IServicePrice> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      throw new Error('Tenant context is required for setting service price');
    }

    const normalizedRate = Math.round(Number(rate || 0));
    if (!Number.isFinite(normalizedRate) || normalizedRate < 0) {
      throw new Error('rate must be a non-negative number');
    }

    // Check if price already exists
    const existingPrice = await knexOrTrx('service_prices')
      .where({ service_id, currency_code, tenant })
      .first();

    if (existingPrice) {
      // Update existing price
      const [updatedPrice] = await knexOrTrx('service_prices')
        .where({ price_id: existingPrice.price_id, tenant })
        .update({
          rate: normalizedRate,
          updated_at: knexOrTrx.fn.now()
        })
        .returning('*');

      log.info(`[Service.setPrice] Updated price for service ${service_id} in ${currency_code}: ${normalizedRate}`);
      return updatedPrice;
    } else {
      // Insert new price
      const [newPrice] = await knexOrTrx('service_prices')
        .insert({
          price_id: uuidv4(),
          tenant,
          service_id,
          currency_code,
          rate: normalizedRate
        })
        .returning('*');

      log.info(`[Service.setPrice] Created price for service ${service_id} in ${currency_code}: ${normalizedRate}`);
      return newPrice;
    }
  },

  /**
   * Set multiple prices for a service at once (replaces all existing prices)
   */
  setPrices: async (
    knexOrTrx: Knex | Knex.Transaction,
    service_id: string,
    prices: Array<{ currency_code: string; rate: number }>
  ): Promise<IServicePrice[]> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      throw new Error('Tenant context is required for setting service prices');
    }

    // Delete existing prices
    await knexOrTrx('service_prices')
      .where({ service_id, tenant })
      .del();

    if (prices.length === 0) {
      return [];
    }

    // Insert new prices
    const pricesToInsert = prices.map(p => ({
      price_id: uuidv4(),
      tenant,
      service_id,
      currency_code: p.currency_code,
      rate: (() => {
        const normalizedRate = Math.round(Number(p.rate || 0));
        if (!Number.isFinite(normalizedRate) || normalizedRate < 0) {
          throw new Error('rate must be a non-negative number');
        }
        return normalizedRate;
      })()
    }));

    const insertedPrices = await knexOrTrx('service_prices')
      .insert(pricesToInsert)
      .returning('*');

    log.info(`[Service.setPrices] Set ${prices.length} price(s) for service ${service_id}`);
    return insertedPrices;
  },

  /**
   * Remove a specific price for a service
   */
  removePrice: async (
    knexOrTrx: Knex | Knex.Transaction,
    service_id: string,
    currency_code: string
  ): Promise<boolean> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      throw new Error('Tenant context is required for removing service price');
    }

    const deletedCount = await knexOrTrx('service_prices')
      .where({ service_id, currency_code, tenant })
      .del();

    log.info(`[Service.removePrice] Removed price for service ${service_id} in ${currency_code}. Affected: ${deletedCount}`);
    return deletedCount > 0;
  },

  /**
   * Check if services have prices in the required currency
   * Returns services that are missing the required currency price
   */
  validateCurrencyPrices: async (
    knexOrTrx: Knex | Knex.Transaction,
    service_ids: string[],
    required_currency: string
  ): Promise<{ valid: boolean; missingServices: Array<{ service_id: string; service_name: string }> }> => {
    const tenant = await getCurrentTenantId();

    if (!tenant) {
      throw new Error('Tenant context is required for validating service prices');
    }

    if (service_ids.length === 0) {
      return { valid: true, missingServices: [] };
    }

    // Get all services with their prices for the required currency
    const servicesWithPrices = await knexOrTrx('service_catalog as sc')
      .where({ 'sc.tenant': tenant })
      .whereIn('sc.service_id', service_ids)
      .leftJoin('service_prices as sp', function() {
        this.on('sc.service_id', '=', 'sp.service_id')
            .andOn('sp.currency_code', '=', knexOrTrx.raw('?', [required_currency]))
            .andOn('sp.tenant', '=', knexOrTrx.raw('?', [tenant]));
      })
      .select(
        'sc.service_id',
        'sc.service_name',
        'sp.price_id'
      );

    // Find services that don't have a price in the required currency
    const missingServices = servicesWithPrices
      .filter(s => !s.price_id)
      .map(s => ({ service_id: s.service_id, service_name: s.service_name }));

    return {
      valid: missingServices.length === 0,
      missingServices
    };
  },
};

export default Service;
