import { createTenantKnex } from '../db';
import { IServiceRateTier, ICreateServiceRateTier, IUpdateServiceRateTier } from '../../interfaces/serviceTier.interfaces';
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

// Schema for validating service rate tiers
export const serviceRateTierSchema = z.object({
  tier_id: z.string(),
  service_id: z.string(),
  min_quantity: z.number().int().positive(),
  max_quantity: z.number().int().positive().nullable(),
  rate: z.number().nonnegative(),
  tenant: z.string().min(1, 'Tenant is required'),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});

export const createServiceRateTierSchema = serviceRateTierSchema.omit({ 
  tier_id: true,
  tenant: true,
  created_at: true,
  updated_at: true
});

const ServiceRateTier = {
  /**
   * Get all rate tiers for a specific service
   */
  getByServiceId: async (serviceId: string): Promise<IServiceRateTier[]> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      const error = new Error('Tenant context is required for fetching service rate tiers');
      log.error(`[ServiceRateTier.getByServiceId] ${error.message}`);
      throw error;
    }

    log.info(`[ServiceRateTier.getByServiceId] Fetching rate tiers for service: ${serviceId} in tenant: ${tenant}`);

    try {
      const tiers = await db<IServiceRateTier>('service_rate_tiers')
        .where({ 
          service_id: serviceId,
          tenant 
        })
        .orderBy('min_quantity', 'asc')
        .select(
          'tier_id',
          'service_id',
          'min_quantity',
          'max_quantity',
          db.raw('CAST(rate AS FLOAT) as rate'),
          'tenant',
          'created_at',
          'updated_at'
        );
      
      log.info(`[ServiceRateTier.getByServiceId] Found ${tiers.length} rate tiers`);
      
      const validatedTiers = tiers.map((tier): IServiceRateTier =>
        validateData(serviceRateTierSchema, tier)
      );
      
      return validatedTiers;
    } catch (error) {
      log.error(`[ServiceRateTier.getByServiceId] Error fetching rate tiers for service ${serviceId}:`, error);
      throw error;
    }
  },

  /**
   * Get a specific rate tier by ID
   */
  getById: async (tierId: string): Promise<IServiceRateTier | null> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      const error = new Error('Tenant context is required for fetching service rate tier');
      log.error(`[ServiceRateTier.getById] ${error.message}`);
      throw error;
    }

    log.info(`[ServiceRateTier.getById] Fetching rate tier with ID: ${tierId} for tenant: ${tenant}`);

    try {
      const [tier] = await db<IServiceRateTier>('service_rate_tiers')
        .where({
          tier_id: tierId,
          tenant
        })
        .select(
          'tier_id',
          'service_id',
          'min_quantity',
          'max_quantity',
          db.raw('CAST(rate AS FLOAT) as rate'),
          'tenant',
          'created_at',
          'updated_at'
        );

      if (!tier) {
        log.info(`[ServiceRateTier.getById] No rate tier found with ID: ${tierId} for tenant: ${tenant}`);
        return null;
      }

      log.info(`[ServiceRateTier.getById] Found rate tier for service: ${tier.service_id}`);
      return validateData(serviceRateTierSchema, tier);
    } catch (error) {
      log.error(`[ServiceRateTier.getById] Error fetching rate tier ${tierId}:`, error);
      throw error;
    }
  },

  /**
   * Create a new rate tier
   */
  create: async (tierData: ICreateServiceRateTier): Promise<IServiceRateTier> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      const error = new Error('Tenant context is required for creating service rate tier');
      log.error(`[ServiceRateTier.create] ${error.message}`);
      throw error;
    }

    // Validate the input data
    validateData(createServiceRateTierSchema, tierData);
    
    // Check for overlapping tiers
    await ServiceRateTier.validateNoOverlappingTiers(
      tierData.service_id,
      tierData.min_quantity,
      tierData.max_quantity,
      null // No tier ID to exclude
    );
    
    const newTier = {
      tier_id: uuidv4(),
      tenant,
      ...tierData
    };

    log.info('[ServiceRateTier.create] Creating new rate tier:', newTier);

    try {
      const [createdTier] = await db('service_rate_tiers')
        .insert(newTier)
        .returning('*');

      log.info('[ServiceRateTier.create] Successfully created rate tier:', createdTier);
      return createdTier;
    } catch (error) {
      log.error('[ServiceRateTier.create] Database error:', error);
      throw error;
    }
  },

  /**
   * Update an existing rate tier
   */
  update: async (tierId: string, tierData: IUpdateServiceRateTier): Promise<IServiceRateTier | null> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      const error = new Error('Tenant context is required for updating service rate tier');
      log.error(`[ServiceRateTier.update] ${error.message}`);
      throw error;
    }

    try {
      // Get the current tier to check service_id
      const currentTier = await ServiceRateTier.getById(tierId);
      if (!currentTier) {
        log.error(`[ServiceRateTier.update] Tier not found: ${tierId}`);
        return null;
      }
      
      // Check for overlapping tiers if min_quantity or max_quantity is being updated
      if (tierData.min_quantity !== undefined || tierData.max_quantity !== undefined) {
        await ServiceRateTier.validateNoOverlappingTiers(
          currentTier.service_id,
          tierData.min_quantity ?? currentTier.min_quantity,
          tierData.max_quantity ?? currentTier.max_quantity,
          tierId // Exclude this tier from the overlap check
        );
      }

      const [updatedTier] = await db<IServiceRateTier>('service_rate_tiers')
        .where({
          tier_id: tierId,
          tenant
        })
        .update({
          ...tierData,
          updated_at: new Date().toISOString()
        })
        .returning([
          'tier_id',
          'service_id',
          'min_quantity',
          'max_quantity',
          db.raw('CAST(rate AS FLOAT) as rate'),
          'tenant',
          'created_at',
          'updated_at'
        ]);

      if (!updatedTier) {
        log.info(`[ServiceRateTier.update] No rate tier found with ID: ${tierId} for tenant: ${tenant}`);
        return null;
      }

      return validateData(serviceRateTierSchema, updatedTier);
    } catch (error) {
      log.error(`[ServiceRateTier.update] Error updating rate tier ${tierId}:`, error);
      throw error;
    }
  },

  /**
   * Delete a rate tier
   */
  delete: async (tierId: string): Promise<boolean> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      const error = new Error('Tenant context is required for deleting service rate tier');
      log.error(`[ServiceRateTier.delete] ${error.message}`);
      throw error;
    }

    try {
      const deletedCount = await db<IServiceRateTier>('service_rate_tiers')
        .where({
          tier_id: tierId,
          tenant
        })
        .del();

      log.info(`[ServiceRateTier.delete] Deleted rate tier ${tierId} for tenant ${tenant}. Affected rows: ${deletedCount}`);
      return deletedCount > 0;
    } catch (error) {
      log.error(`[ServiceRateTier.delete] Error deleting rate tier ${tierId}:`, error);
      throw error;
    }
  },

  /**
   * Delete all rate tiers for a service
   */
  deleteByServiceId: async (serviceId: string): Promise<number> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      const error = new Error('Tenant context is required for deleting service rate tiers');
      log.error(`[ServiceRateTier.deleteByServiceId] ${error.message}`);
      throw error;
    }

    try {
      const deletedCount = await db<IServiceRateTier>('service_rate_tiers')
        .where({
          service_id: serviceId,
          tenant
        })
        .del();

      log.info(`[ServiceRateTier.deleteByServiceId] Deleted ${deletedCount} rate tiers for service ${serviceId} in tenant ${tenant}`);
      return deletedCount;
    } catch (error) {
      log.error(`[ServiceRateTier.deleteByServiceId] Error deleting rate tiers for service ${serviceId}:`, error);
      throw error;
    }
  },

  /**
   * Validate that there are no overlapping tiers for the same service
   */
  validateNoOverlappingTiers: async (
    serviceId: string,
    minQuantity: number,
    maxQuantity: number | null,
    excludeTierId: string | null = null
  ): Promise<void> => {
    const {knex: db, tenant} = await createTenantKnex();
    
    if (!tenant) {
      const error = new Error('Tenant context is required for validating service rate tiers');
      log.error(`[ServiceRateTier.validateNoOverlappingTiers] ${error.message}`);
      throw error;
    }

    try {
      // Build a query to find overlapping tiers
      const query = db<IServiceRateTier>('service_rate_tiers')
        .where({
          service_id: serviceId,
          tenant
        })
        .where(function() {
          // Case 1: New tier's min is within an existing tier's range
          this.where(function() {
            this.where('min_quantity', '<=', minQuantity)
              .where(function() {
                this.whereNull('max_quantity')
                  .orWhere('max_quantity', '>=', minQuantity);
              });
          })
          // Case 2: New tier's max is within an existing tier's range
          .orWhere(function() {
            if (maxQuantity !== null) {
              this.where('min_quantity', '<=', maxQuantity)
                .where(function() {
                  this.whereNull('max_quantity')
                    .orWhere('max_quantity', '>=', maxQuantity);
                });
            }
          })
          // Case 3: New tier completely contains an existing tier
          .orWhere(function() {
            this.where('min_quantity', '>=', minQuantity)
              .where(function() {
                if (maxQuantity !== null) {
                  this.where('min_quantity', '<=', maxQuantity);
                } else {
                  this.whereRaw('1=1'); // Always true if new tier has no max
                }
              });
          });
        });

      // Exclude the current tier if updating
      if (excludeTierId) {
        query.whereNot('tier_id', excludeTierId);
      }

      const overlappingTiers = await query;

      if (overlappingTiers.length > 0) {
        const error = new Error(`Overlapping tier ranges detected for service ${serviceId}`);
        log.error(`[ServiceRateTier.validateNoOverlappingTiers] ${error.message}`, overlappingTiers);
        throw error;
      }
    } catch (error) {
      log.error(`[ServiceRateTier.validateNoOverlappingTiers] Error validating tiers for service ${serviceId}:`, error);
      throw error;
    }
  }
};

export default ServiceRateTier;