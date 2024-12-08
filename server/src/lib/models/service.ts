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

const Service = {
  getAll: async (): Promise<IService[]> => {
    const {knex: db, tenant} = await createTenantKnex();
    log.info(`[Service.getAll] Fetching all services for tenant: ${tenant}`);

    try {
      const services = await db<IService>('service_catalog')
        .select(
          'service_id',
          'service_name',
          'service_type',
          db.raw('CAST(default_rate AS FLOAT) as default_rate'),
          'unit_of_measure',
          'category_id',
          'is_taxable',
          'tax_region'
        );
      log.info(`[Service.getAll] Found ${services.length} services`);
      
      const validatedServices = services.map((service): IService => 
        validateData(serviceSchema, service)
      );
      log.info(`[Service.getAll] Services data validated successfully`);

      log.info(`[Service.getAll] Returning ${validatedServices.length} services: ${validatedServices}`);
      
      return validatedServices;
    } catch (error) {
      log.error(`[Service.getAll] Error fetching services:`, error);
      throw error;
    }
  },

  getById: async (service_id: string): Promise<IService | null> => {
    const {knex: db, tenant} = await createTenantKnex();
    log.info(`[Service.getById] Fetching service with ID: ${service_id} for tenant: ${tenant}`);

    try {
      const [service] = await db<IService>('service_catalog')
        .where({ service_id })
        .select(
          'service_id',
          'service_name',
          'service_type',
          db.raw('CAST(default_rate AS FLOAT) as default_rate'),
          'unit_of_measure',
          'category_id',
          'is_taxable',
          'tax_region'
        );

      if (!service) {
        log.info(`[Service.getById] No service found with ID: ${service_id}`);
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
    
    // Validate the input data
    validateData(serviceSchema, serviceData);
    
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
    const {knex: db} = await createTenantKnex();
    const [updatedService] = await db<IService>('service_catalog')
      .where({ service_id })
      .update(serviceData)
      .returning('*');
    return updatedService || null;
  },

  delete: async (service_id: string): Promise<boolean> => {
    const {knex: db} = await createTenantKnex();
    const deletedCount = await db<IService>('service_catalog')
      .where({ service_id })
      .del();
    return deletedCount > 0;
  },

  getByCategoryId: async (category_id: string): Promise<IService[]> => {
    const {knex: db} = await createTenantKnex();
    return await db<IService>('service_catalog')
      .where({ category_id: category_id })
      .select('*');
  },
};

export default Service;
