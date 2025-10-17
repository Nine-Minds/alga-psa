import { getCurrentTenantId } from '../db';
import { IService } from '../../interfaces/billing.interfaces';
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

// Base schema definition - aligns closely with DB nullability where appropriate
const baseServiceSchema = z.object({
  service_id: z.string().uuid(),
  tenant: z.string().min(1, 'Tenant is required'),
  service_name: z.string(),
  custom_service_type_id: z.string().uuid(),   // Now required, not nullable
  billing_method: z.enum(['fixed', 'hourly', 'usage']),
  default_rate: z.union([z.string(), z.number()]).transform(val =>
    typeof val === 'string' ? parseFloat(val) || 0 : val
  ),
  unit_of_measure: z.string(),
  category_id: z.string().uuid().nullable(), // Matches DB FK (nullable) - IService allows string | null
  tax_rate_id: z.union([z.string().uuid(), z.null()]).optional(), // Accept string, null, or undefined
  description: z.string().nullable(), // Added: Description field from the database
  service_type_name: z.string().optional(), // Add service_type_name to the schema
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
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        )
        .orderBy('sc.service_name', 'asc');
      log.info(`[Service.getAll] Found ${servicesData.length} services`);

      // Validate and transform using the final schema's parse method
      const validatedServices = servicesData.map((service) => {
        // .parse() validates against the refined schema AND applies the transform
        return serviceSchema.parse(service);
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
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        )
        .first(); // Use .first() as we expect only one

      if (!serviceData) {
        log.info(`[Service.getById] No service found with ID: ${service_id} for tenant: ${tenant}`);
        return null;
      }

      log.info(`[Service.getById] Found service: ${serviceData.service_name}`);
      // Validate the fetched data against the updated schema
      // Validate the fetched data (which now transforms to match IService)
      // Validate against the schema expecting nulls, then transform
      // Validate against the schema expecting nulls
      // Validate and transform using the final schema's parse method
      const validatedService = serviceSchema.parse(serviceData);
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

    const newService = {
      service_id: uuidv4(),
      tenant: effectiveTenant,
      service_name: validatedData.service_name,
      custom_service_type_id: validatedData.custom_service_type_id,
      billing_method: validatedData.billing_method,
      default_rate: validatedData.default_rate,
      unit_of_measure: validatedData.unit_of_measure,
      category_id: validatedData.category_id ?? null, // category_id is string | null in IService
      tax_rate_id: validatedData.tax_rate_id ?? null, // Corrected: Use tax_rate_id
      description: validatedData.description ?? '', // Add description field with default empty string
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
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        )
        .first();

      if (!completeService) {
        log.info(`[Service.create] Failed to fetch complete service after creation: ${createdService.service_id}`);
        return serviceSchema.parse(createdService); // Fall back to the original service data
      }

      // Validate the returned data against the main serviceSchema before returning
      // Validate the returned data against the schema (which transforms to match IService)
      // Validate and transform the DB result using the final schema's parse method
      return serviceSchema.parse(completeService);
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
      // Remove tenant and service_type_name from update data to prevent modification
      // service_type_name is a virtual field from JOIN and doesn't exist in the table
      const { tenant: _, service_type_name, ...updateData } = serviceData;

      // No need to handle type ID changes anymore
      const finalUpdateData: Partial<IService> = { ...updateData };

      if (finalUpdateData.default_rate !== undefined) {
        const numericRate =
          typeof finalUpdateData.default_rate === 'string'
            ? parseFloat(finalUpdateData.default_rate)
            : finalUpdateData.default_rate;

        if (Number.isNaN(numericRate)) {
          delete finalUpdateData.default_rate;
        } else {
          finalUpdateData.default_rate = Math.round(numericRate);
        }
      }

      // Ensure updateData conforms to Partial<IService> based on the *new* interface
      // Zod validation could be added here too if needed for partial updates.
      const [updatedServiceData] = await knexOrTrx<IService>('service_catalog')
        .where({
          service_id,
          tenant
        })
        .update(finalUpdateData) // Use finalUpdateData instead of updateData
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
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        )
        .first();

      if (!completeService) {
        log.info(`[Service.update] Failed to fetch complete service after update: ${service_id}`);
        return null;
      }

      // Validate the result against the updated schema
      // Validate the result against the schema (which transforms to match IService)
      // Validate and transform the DB result using the final schema's parse method
      return serviceSchema.parse(completeService);
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
        const updatedDetails = await knexOrTrx('invoice_item_details')
          .where({
            service_id,
            tenant
          })
          .update({
            service_id: null
          });

        log.info(`[Service.delete] Updated ${updatedDetails} invoice_item_details records for service ${service_id}`);

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
          const updatedDetails = await trx('invoice_item_details')
            .where({
              service_id,
              tenant
            })
            .update({
              service_id: null
            });

          log.info(`[Service.delete] Updated ${updatedDetails} invoice_item_details records for service ${service_id}`);

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
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        );

      log.info(`[Service.getByCategoryId] Found ${servicesData.length} services for category ${category_id}`);
      // Validate each service against the updated schema
      // Validate each service against the schema (which transforms to match IService)
      // Validate against the schema expecting nulls, then transform
      // Validate against the schema expecting nulls, then transform
      // Validate and transform using the final schema's parse method
      return servicesData.map(service => {
        return serviceSchema.parse(service);
      });
    } catch (error) {
      log.error(`[Service.getByCategoryId] Error fetching services for category ${category_id}:`, error);
      throw error;
    }
  },
};

export default Service;
