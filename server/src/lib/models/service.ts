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

export const serviceSchema = z.object({
  service_id: z.string(),
  tenant: z.string().min(1, 'Tenant is required'),
  service_name: z.string(),
  service_type_id: z.string(), // Changed from service_type
  service_type_name: z.string().nullable().optional(), // Allow null or undefined
  service_type_billing_method: z.enum(['fixed', 'per_unit']).nullable().optional(), // Billing method from the standard type
  billing_method: z.enum(['fixed', 'per_unit']), // Billing method specific to this service instance
  default_rate: z.number(),
  unit_of_measure: z.string(),
  category_id: z.string().nullable()
    .transform(val => val === undefined ? null : val),
  is_taxable: z.boolean().optional().default(false)
    .transform(val => val === undefined ? false : val),
  tax_region: z.string().nullable().optional()
    .transform(val => val === undefined ? null : val)
});

export const createServiceSchema = serviceSchema.omit({ service_id: true });

const Service = {
  getAll: async (): Promise<IService[]> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      const error = new Error('Tenant context is required for fetching services');
      log.error(`[Service.getAll] ${error.message}`);
      throw error;
    }

    log.info(`[Service.getAll] Fetching all services for tenant: ${tenant}`);

    
        try {
          const services = await db('service_catalog as sc') // Alias service_catalog as sc
            .leftJoin('standard_service_types as sst', 'sc.service_type_id', 'sst.id') // Join standard types
            .leftJoin('service_types as tst', function() { // Join tenant-specific types
              this.on('sc.service_type_id', '=', 'tst.id')
                  .andOn('sc.tenant', '=', 'tst.tenant_id'); // Corrected column name
            })
            .where({ 'sc.tenant': tenant }) // Use alias for where clause
            .select(
              'sc.service_id',
              'sc.service_name',
              'sc.service_type_id',
              db.raw('COALESCE(sst.name, tst.name) as service_type_name'), // Use COALESCE for name
              'sst.billing_method as service_type_billing_method', // Keep billing method from standard for now
              'sc.billing_method', // Keep the service's specific billing method too
              db.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
              'sc.unit_of_measure',
              'sc.category_id',
              'sc.is_taxable',
              'sc.tax_region',
              'sc.tenant'
            );
          log.info(`[Service.getAll] Found ${services.length} services`);
          
          // Adjust the type hint for the map function if necessary, though validateData should handle it
          const validatedServices = services.map((service): IService & { service_type_name?: string } =>
            validateData(serviceSchema, service) as IService & { service_type_name?: string } // Cast result of validation
          );
          log.info(`[Service.getAll] Services data validated successfully`);
      return validatedServices;
    } catch (error) {
      log.error(`[Service.getAll] Error fetching services:`, error);
      throw error;
    }
  },

  getById: async (service_id: string): Promise<IService | null> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      const error = new Error('Tenant context is required for fetching service');
      log.error(`[Service.getById] ${error.message}`);
      throw error;
    }

    log.info(`[Service.getById] Fetching service with ID: ${service_id} for tenant: ${tenant}`);

    try {
      const [service] = await db('service_catalog as sc') // Alias service_catalog as sc
        .leftJoin('standard_service_types as sst', 'sc.service_type_id', 'sst.id') // Join standard types
        .leftJoin('service_types as tst', function() { // Join tenant-specific types
          this.on('sc.service_type_id', '=', 'tst.id')
              .andOn('sc.tenant', '=', 'tst.tenant_id'); // Corrected column name
        })
        .where({
          'sc.service_id': service_id, // Use alias
          'sc.tenant': tenant // Use alias
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.service_type_id',
          db.raw('COALESCE(sst.name, tst.name) as service_type_name'), // Use COALESCE for name
          'sst.billing_method as service_type_billing_method', // Keep billing method from standard for now
          'sc.billing_method', // Keep the service's specific billing method too
          db.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.is_taxable',
          'sc.tax_region',
          'sc.tenant'
        );

      if (!service) {
        log.info(`[Service.getById] No service found with ID: ${service_id} for tenant: ${tenant}`);
        return null;
      }

      log.info(`[Service.getById] Found service: ${service.service_name}`);
      const validatedService = validateData(serviceSchema, service);
      log.info(`[Service.getById] Service data validated successfully`);
      
      return validatedService;
    } catch (error) {
      log.error(`[Service.getById] Error fetching service ${service_id}:`, error);
      throw error;
    }
  },

  create: async (serviceData: Omit<IService, 'service_id' | 'tenant'>): Promise<IService> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    // Validate the input data using creation schema
    validateData(createServiceSchema, serviceData);
    
    const newService = {
      service_id: uuidv4(),
      tenant: tenant!,
      service_name: serviceData.service_name,
      service_type_id: serviceData.service_type_id, // Changed from service_type
      default_rate: serviceData.default_rate,
      unit_of_measure: serviceData.unit_of_measure,
      category_id: serviceData.category_id || null,
      // Optional fields
      is_taxable: serviceData.is_taxable || false,
      tax_region: serviceData.tax_region || null,
      billing_method: serviceData.billing_method // Added billing_method
    };

    log.info('[Service.create] Constructed newService object:', newService);
    log.info('[Service.create] About to execute insert with service_type_id:', newService.service_type_id); // Changed from service_type

    try {
      const [createdService] = await db('service_catalog')
        .insert(newService)
        .returning('*');

      log.info('[Service.create] Successfully created service:', createdService);
      return createdService;
    } catch (error) {
      log.error('[Service.create] Database error:', error);
      throw error;
    }
  },

  update: async (service_id: string, serviceData: Partial<IService>): Promise<IService | null> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      const error = new Error('Tenant context is required for updating service');
      log.error(`[Service.update] ${error.message}`);
      throw error;
    }

    try {
      // Remove tenant from update data to prevent modification
      const { tenant: _, ...updateData } = serviceData;

      const [updatedService] = await db<IService>('service_catalog')
        .where({
          service_id,
          tenant
        })
        .update(updateData)
        .returning([
          'service_id',
          'service_name',
          'service_type_id', // Changed from service_type
          'billing_method', // Added billing_method
          db.raw('CAST(default_rate AS FLOAT) as default_rate'),
          'unit_of_measure',
          'category_id',
          'is_taxable',
          'tax_region',
          'tenant'
        ]);

      if (!updatedService) {
        log.info(`[Service.update] No service found with ID: ${service_id} for tenant: ${tenant}`);
        return null;
      }

      return validateData(serviceSchema, updatedService);
    } catch (error) {
      log.error(`[Service.update] Error updating service ${service_id}:`, error);
      throw error;
    }
  },

  delete: async (service_id: string): Promise<boolean> => {
    const {knex: db, tenant} = await createTenantKnex();
    
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
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      const error = new Error('Tenant context is required for fetching services by category');
      log.error(`[Service.getByCategoryId] ${error.message}`);
      throw error;
    }

    try {
      const services = await db('service_catalog as sc') // Alias service_catalog as sc
        .leftJoin('standard_service_types as sst', 'sc.service_type_id', 'sst.id') // Join standard types
        .leftJoin('service_types as tst', function() { // Join tenant-specific types
          this.on('sc.service_type_id', '=', 'tst.id')
              .andOn('sc.tenant', '=', 'tst.tenant_id'); // Corrected column name
        })
        .where({
          'sc.category_id': category_id, // Use alias
          'sc.tenant': tenant // Use alias
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.service_type_id',
          db.raw('COALESCE(sst.name, tst.name) as service_type_name'), // Use COALESCE for name
          'sst.billing_method as service_type_billing_method', // Keep billing method from standard for now
          'sc.billing_method', // Keep the service's specific billing method too
          db.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.is_taxable',
          'sc.tax_region',
          'sc.tenant'
        );

      log.info(`[Service.getByCategoryId] Found ${services.length} services for category ${category_id}`);
      return services.map(service => validateData(serviceSchema, service));
    } catch (error) {
      log.error(`[Service.getByCategoryId] Error fetching services for category ${category_id}:`, error);
      throw error;
    }
  },
};

export default Service;
