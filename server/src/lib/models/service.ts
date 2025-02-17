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
  service_type: z.enum(['Fixed', 'Time', 'Usage']),
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
      const services = await db<IService>('service_catalog')
        .where({ tenant })
        .select(
          'service_id',
          'service_name',
          'service_type',
          db.raw('CAST(default_rate AS FLOAT) as default_rate'),
          'unit_of_measure',
          'category_id',
          'is_taxable',
          'tax_region',
          'tenant'
        );
      log.info(`[Service.getAll] Found ${services.length} services`);
      
      const validatedServices = services.map((service): IService =>
        validateData(serviceSchema, service)
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
      const [service] = await db<IService>('service_catalog')
        .where({
          service_id,
          tenant
        })
        .select(
          'service_id',
          'service_name',
          'service_type',
          db.raw('CAST(default_rate AS FLOAT) as default_rate'),
          'unit_of_measure',
          'category_id',
          'is_taxable',
          'tax_region',
          'tenant'
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
      service_type: serviceData.service_type, // Required field
      default_rate: serviceData.default_rate,
      unit_of_measure: serviceData.unit_of_measure,
      category_id: serviceData.category_id || null,
      // Optional fields
      is_taxable: serviceData.is_taxable || false,
      tax_region: serviceData.tax_region || null
    };

    log.info('[Service.create] Constructed newService object:', newService);
    log.info('[Service.create] About to execute insert with service_type:', newService.service_type);

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
          'service_type',
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
      const services = await db<IService>('service_catalog')
        .where({
          category_id,
          tenant
        })
        .select(
          'service_id',
          'service_name',
          'service_type',
          db.raw('CAST(default_rate AS FLOAT) as default_rate'),
          'unit_of_measure',
          'category_id',
          'is_taxable',
          'tax_region',
          'tenant'
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
