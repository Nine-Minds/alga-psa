import { createTenantKnex } from '../db';
import { IService } from '../../interfaces/billing.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { validateData } from '../utils/validation';

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
  standard_service_type_id: z.string().uuid().nullable(), // Matches DB FK (nullable)
  custom_service_type_id: z.string().uuid().nullable(),   // Matches DB FK (nullable)
  billing_method: z.enum(['fixed', 'per_unit']),
  default_rate: z.union([z.string(), z.number()]).transform(val =>
    typeof val === 'string' ? parseFloat(val) || 0 : val
  ),
  unit_of_measure: z.string(),
  category_id: z.string().uuid().nullable(), // Matches DB FK (nullable) - IService allows string | null
  is_taxable: z.boolean().optional().default(false), // Optional in interface, default false
  region_code: z.string().nullable(), // New field replacing tax_region, matches DB (nullable)
  description: z.string().nullable(), // Added: Description field from the database
  service_type_name: z.string().optional(), // Add service_type_name to the schema
});

// Refine check for exactly one FK ID being non-null
// Export this schema as it's needed for validation before transformation
export const refinedServiceSchema = baseServiceSchema.refine(
  (data) => (data.standard_service_type_id != null) !== (data.custom_service_type_id != null), {
  message: "Exactly one of standard_service_type_id or custom_service_type_id must be provided",
  path: ["standard_service_type_id", "custom_service_type_id"], // Specify path for clarity
}
);

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
    region_code: inputData.region_code, // Keep null if present
    description: inputData.description,
    // Map null to undefined for fields that are optional (T | undefined) in IService
    standard_service_type_id: inputData.standard_service_type_id ?? undefined,
    custom_service_type_id: inputData.custom_service_type_id ?? undefined,
  };
});

// Infer the final type matching IService structure
export type ServiceSchemaType = z.infer<typeof serviceSchema>;

// Create schema: Omit service_id and tenant from the *base* schema first
// We omit tenant because it will be added by the server-side code after validation
const baseCreateServiceSchema = baseServiceSchema.omit({ service_id: true, tenant: true });

// Apply the refine check to the base create schema
const refinedCreateServiceSchema = baseCreateServiceSchema.refine(
  (data) => (data.standard_service_type_id != null) !== (data.custom_service_type_id != null), {
  message: "Exactly one of standard_service_type_id or custom_service_type_id must be provided",
  path: ["standard_service_type_id", "custom_service_type_id"],
}
);

// Apply the same transformation logic to the create schema
export const createServiceSchema = refinedCreateServiceSchema.transform((data) => {
  // Explicitly type the input 'data'
  const inputData = data as z.infer<typeof refinedCreateServiceSchema>;
  return {
    ...inputData,
    category_id: inputData.category_id,
    region_code: inputData.region_code, // Keep null if present
    description: inputData.description,
    standard_service_type_id: inputData.standard_service_type_id ?? undefined,
    custom_service_type_id: inputData.custom_service_type_id ?? undefined,
  };
});

// Infer the creation type
export type CreateServiceSchemaType = z.infer<typeof createServiceSchema>;

const Service = {
  getAll: async (): Promise<IService[]> => {
    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      const error = new Error('Tenant context is required for fetching services');
      log.error(`[Service.getAll] ${error.message}`);
      throw error;
    }

    log.info(`[Service.getAll] Fetching all services for tenant: ${tenant}`);


    try {
      // Fetch services, joining with both standard and custom service types to get type names
      const servicesData = await db('service_catalog as sc')
        .where({ 'sc.tenant': tenant })
        .leftJoin('standard_service_types as sst', 'sc.standard_service_type_id', 'sst.id')
        .leftJoin('service_types as ct', function() {
          this.on('sc.custom_service_type_id', '=', 'ct.id')
              .andOn('ct.tenant_id', '=', db.raw('?', [tenant]));
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.standard_service_type_id',
          'sc.custom_service_type_id',
          'sc.billing_method',
          db.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.is_taxable',
          'sc.region_code',
          'sc.description',
          'sc.tenant',
          // Select the service type name from either standard or custom type
          db.raw('COALESCE(sst.name, ct.name) as service_type_name')
        );
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

  getById: async (service_id: string): Promise<IService | null> => {
    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      const error = new Error('Tenant context is required for fetching service');
      log.error(`[Service.getById] ${error.message}`);
      throw error;
    }

    log.info(`[Service.getById] Fetching service with ID: ${service_id} for tenant: ${tenant}`);

    try {
      // Fetch service by ID, joining with both standard and custom service types
      const serviceData = await db('service_catalog as sc')
        .where({
          'sc.service_id': service_id,
          'sc.tenant': tenant
        })
        .leftJoin('standard_service_types as sst', 'sc.standard_service_type_id', 'sst.id')
        .leftJoin('service_types as ct', function() {
          this.on('sc.custom_service_type_id', '=', 'ct.id')
              .andOn('ct.tenant_id', '=', db.raw('?', [tenant]));
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.standard_service_type_id',
          'sc.custom_service_type_id',
          'sc.billing_method',
          db.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.is_taxable',
          'sc.region_code',
          'sc.description',
          'sc.tenant',
          // Select the service type name from either standard or custom type
          db.raw('COALESCE(sst.name, ct.name) as service_type_name')
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
  create: async (serviceData: Omit<IService, 'service_id'> & { tenant?: string }): Promise<IService> => {
    const { knex: db, tenant: dbTenant } = await createTenantKnex();

    // Use the tenant from the serviceData if provided, otherwise use the one from createTenantKnex
    const effectiveTenant = serviceData.tenant || dbTenant;

    if (!effectiveTenant) {
      throw new Error('Tenant context is required for creating a service');
    }

    // Remove service_type_name from the input data as it's a virtual field
    const { service_type_name, ...dataWithoutTypeName } = serviceData;

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
      ...dataWithoutTypeName,
      default_rate: typeof dataWithoutTypeName.default_rate === 'string'
        ? parseFloat(dataWithoutTypeName.default_rate) || 0
        : dataWithoutTypeName.default_rate,
    };

    const validatedData = createServiceSchema.parse(dataToValidate);

    const newService = {
      service_id: uuidv4(),
      tenant: effectiveTenant,
      service_name: validatedData.service_name,
      // Use validatedData fields. Nullish coalescing handles undefined -> null for DB.
      standard_service_type_id: validatedData.standard_service_type_id ?? null,
      custom_service_type_id: validatedData.custom_service_type_id ?? null,
      billing_method: validatedData.billing_method,
      default_rate: validatedData.default_rate,
      unit_of_measure: validatedData.unit_of_measure,
      category_id: validatedData.category_id ?? null, // category_id is string | null in IService
      is_taxable: validatedData.is_taxable ?? false, // Use ?? false for boolean
      region_code: validatedData.region_code ?? null,
      description: validatedData.description ?? '', // Add description field with default empty string
    };

    log.info('[Service.create] Constructed newService object:', newService);

    try {
      // Insert into service_catalog (assuming this is the correct table name)
      const [createdService] = await db('service_catalog')
        .insert(newService)
        .returning('*'); // Return all columns to match IService

      log.info('[Service.create] Successfully created service:', createdService);
      
      // After creation, fetch the complete service with type name by joining with type tables
      const completeService = await db('service_catalog as sc')
        .where({
          'sc.service_id': createdService.service_id,
          'sc.tenant': effectiveTenant
        })
        .leftJoin('standard_service_types as sst', 'sc.standard_service_type_id', 'sst.id')
        .leftJoin('service_types as ct', function() {
          this.on('sc.custom_service_type_id', '=', 'ct.id')
              .andOn('ct.tenant_id', '=', db.raw('?', [effectiveTenant]));
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.standard_service_type_id',
          'sc.custom_service_type_id',
          'sc.billing_method',
          db.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.is_taxable',
          'sc.region_code',
          'sc.description',
          'sc.tenant',
          // Select the service type name from either standard or custom type
          db.raw('COALESCE(sst.name, ct.name) as service_type_name')
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

  update: async (service_id: string, serviceData: Partial<IService>): Promise<IService | null> => {
    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      const error = new Error('Tenant context is required for updating service');
      log.error(`[Service.update] ${error.message}`);
      throw error;
    }

    try {
      // Remove tenant and service_type_name from update data to prevent modification
      // service_type_name is a virtual field from JOIN and doesn't exist in the table
      const { tenant: _, service_type_name, ...updateData } = serviceData;

      // Handle service type ID changes to ensure exactly one type ID is set
      let finalUpdateData = { ...updateData };
      
      // If custom_service_type_id is being set, ensure standard_service_type_id is null
      if ('custom_service_type_id' in updateData && updateData.custom_service_type_id) {
        finalUpdateData.standard_service_type_id = null;
        log.info(`[Service.update] Setting custom_service_type_id and clearing standard_service_type_id`);
      }
      
      // If standard_service_type_id is being set, ensure custom_service_type_id is null
      if ('standard_service_type_id' in updateData && updateData.standard_service_type_id) {
        finalUpdateData.custom_service_type_id = null;
        log.info(`[Service.update] Setting standard_service_type_id and clearing custom_service_type_id`);
      }

      // Ensure updateData conforms to Partial<IService> based on the *new* interface
      // Zod validation could be added here too if needed for partial updates.
      const [updatedServiceData] = await db<IService>('service_catalog')
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
      const completeService = await db('service_catalog as sc')
        .where({
          'sc.service_id': service_id,
          'sc.tenant': tenant
        })
        .leftJoin('standard_service_types as sst', 'sc.standard_service_type_id', 'sst.id')
        .leftJoin('service_types as ct', function() {
          this.on('sc.custom_service_type_id', '=', 'ct.id')
              .andOn('ct.tenant_id', '=', db.raw('?', [tenant]));
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.standard_service_type_id',
          'sc.custom_service_type_id',
          'sc.billing_method',
          db.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.is_taxable',
          'sc.region_code',
          'sc.description',
          'sc.tenant',
          // Select the service type name from either standard or custom type
          db.raw('COALESCE(sst.name, ct.name) as service_type_name')
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

  delete: async (service_id: string): Promise<boolean> => {
    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      const error = new Error('Tenant context is required for deleting service');
      log.error(`[Service.delete] ${error.message}`);
      throw error;
    }

    try {
      const deletedCount = await db<IService>('service_catalog')
        .where({
          service_id,
          tenant
        })
        .del();

      log.info(`[Service.delete] Deleted service ${service_id} for tenant ${tenant}. Affected rows: ${deletedCount}`);
      return deletedCount > 0;
    } catch (error) {
      log.error(`[Service.delete] Error deleting service ${service_id}:`, error);
      throw error;
    }
  },

  getByCategoryId: async (category_id: string): Promise<IService[]> => {
    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      const error = new Error('Tenant context is required for fetching services by category');
      log.error(`[Service.getByCategoryId] ${error.message}`);
      throw error;
    }

    try {
      // Fetch services by category ID, joining with both standard and custom service types
      const servicesData = await db('service_catalog as sc')
        .where({
          'sc.category_id': category_id,
          'sc.tenant': tenant
        })
        .leftJoin('standard_service_types as sst', 'sc.standard_service_type_id', 'sst.id')
        .leftJoin('service_types as ct', function() {
          this.on('sc.custom_service_type_id', '=', 'ct.id')
              .andOn('ct.tenant_id', '=', db.raw('?', [tenant]));
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.standard_service_type_id',
          'sc.custom_service_type_id',
          'sc.billing_method',
          db.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.is_taxable',
          'sc.region_code',
          'sc.description',
          'sc.tenant',
          // Select the service type name from either standard or custom type
          db.raw('COALESCE(sst.name, ct.name) as service_type_name')
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
