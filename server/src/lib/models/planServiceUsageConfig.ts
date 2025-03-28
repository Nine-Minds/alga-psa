import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { IPlanServiceUsageConfig, IPlanServiceRateTier } from 'server/src/interfaces/planServiceConfiguration.interfaces';
import { v4 as uuidv4 } from 'uuid';

export default class PlanServiceUsageConfig {
  private knex: Knex;
  private tenant: string;

  constructor(knex?: Knex, tenant?: string) {
    this.knex = knex as Knex;
    this.tenant = tenant as string;
  }

  /**
   * Initialize knex connection if not provided in constructor
   */
  private async initKnex() {
    if (!this.knex) {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error("tenant context not found");
      }
      this.knex = knex;
      this.tenant = tenant;
    }
  }

  /**
   * Get a usage configuration by config ID
   */
  async getByConfigId(configId: string): Promise<IPlanServiceUsageConfig | null> {
    await this.initKnex();
    
    const config = await this.knex('plan_service_usage_config')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .first();
    
    return config || null;
  }

  /**
   * Create a new usage configuration
   */
  async create(data: Omit<IPlanServiceUsageConfig, 'created_at' | 'updated_at'>): Promise<boolean> {
    await this.initKnex();
    
    const now = new Date();
    
    await this.knex('plan_service_usage_config').insert({
      config_id: data.config_id,
      unit_of_measure: data.unit_of_measure,
      enable_tiered_pricing: data.enable_tiered_pricing,
      minimum_usage: data.minimum_usage,
      tenant: this.tenant,
      created_at: now,
      updated_at: now
    });
    
    return true;
  }

  /**
   * Update an existing usage configuration
   */
  async update(configId: string, data: Partial<IPlanServiceUsageConfig>): Promise<boolean> {
    await this.initKnex();
    
    const updateData = {
      ...data,
      updated_at: new Date()
    };
    
    // Remove config_id from update data if present
    if ('config_id' in updateData) {
      delete updateData.config_id;
    }
    
    // Remove tenant from update data if present
    if ('tenant' in updateData) {
      delete updateData.tenant;
    }
    
    const result = await this.knex('plan_service_usage_config')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Delete a usage configuration
   */
  async delete(configId: string): Promise<boolean> {
    await this.initKnex();
    
    const result = await this.knex('plan_service_usage_config')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .delete();
    
    return result > 0;
  }

  /**
   * Get rate tiers for a usage configuration
   */
  async getRateTiers(configId: string): Promise<IPlanServiceRateTier[]> {
    await this.initKnex();
    
    const tiers = await this.knex('plan_service_rate_tiers')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .orderBy('min_quantity', 'asc')
      .select('*');
    
    return tiers;
  }

  /**
   * Add a rate tier to a usage configuration
   */
  async addRateTier(data: Omit<IPlanServiceRateTier, 'tier_id' | 'created_at' | 'updated_at'>): Promise<string> {
    await this.initKnex();
    
    const tierId = uuidv4();
    const now = new Date();
    
    await this.knex('plan_service_rate_tiers').insert({
      tier_id: tierId,
      config_id: data.config_id,
      min_quantity: data.min_quantity,
      max_quantity: data.max_quantity,
      rate: data.rate,
      tenant: this.tenant,
      created_at: now,
      updated_at: now
    });
    
    return tierId;
  }

  /**
   * Update a rate tier
   */
  async updateRateTier(tierId: string, data: Partial<IPlanServiceRateTier>): Promise<boolean> {
    await this.initKnex();
    
    const updateData = {
      ...data,
      updated_at: new Date()
    };
    
    // Remove tier_id from update data if present
    if ('tier_id' in updateData) {
      delete updateData.tier_id;
    }
    
    // Remove tenant from update data if present
    if ('tenant' in updateData) {
      delete updateData.tenant;
    }
    
    const result = await this.knex('plan_service_rate_tiers')
      .where({
        tier_id: tierId,
        tenant: this.tenant
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Delete a rate tier
   */
  async deleteRateTier(tierId: string): Promise<boolean> {
    await this.initKnex();
    
    const result = await this.knex('plan_service_rate_tiers')
      .where({
        tier_id: tierId,
        tenant: this.tenant
      })
      .delete();
    
    return result > 0;
  }

  /**
   * Delete all rate tiers for a specific configuration ID
   */
  async deleteRateTiersByConfigId(configId: string): Promise<boolean> {
    await this.initKnex();
    
    const result = await this.knex('plan_service_rate_tiers')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .delete();
    
    // Return true if any rows were deleted, false otherwise.
    // Note: delete() returns the number of affected rows.
    return result >= 0; // Return true even if 0 rows were deleted (idempotency)
  }
}