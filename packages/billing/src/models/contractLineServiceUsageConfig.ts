import { Knex } from 'knex';
import { requireTenantId } from '@alga-psa/db';
import type { IContractLineServiceUsageConfig, IContractLineServiceRateTier } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';

export default class ContractLineServiceUsageConfig {
  private knex: Knex | Knex.Transaction;
  private tenant?: string;

  constructor(knex: Knex | Knex.Transaction) {
    this.knex = knex;
  }

  /**
   * Get tenant context
   */
  private async getTenant(): Promise<string> {
    if (!this.tenant) {
      this.tenant = await requireTenantId(this.knex);
    }
    return this.tenant;
  }

  /**
   * Get a usage configuration by config ID
   */
  async getByConfigId(configId: string): Promise<IContractLineServiceUsageConfig | null> {
    const tenant = await this.getTenant();
    
    const config = await this.knex('contract_line_service_usage_config')
      .where({
        config_id: configId,
        tenant
      })
      .first();
    
    return config || null;
  }

  /**
   * Create a new usage configuration
   */
  async create(data: Omit<IContractLineServiceUsageConfig, 'created_at' | 'updated_at' | 'tenant'>): Promise<boolean> {
    const tenant = await this.getTenant();
    
    const now = new Date();
    
    await this.knex('contract_line_service_usage_config').insert({
      config_id: data.config_id,
      unit_of_measure: data.unit_of_measure,
      enable_tiered_pricing: data.enable_tiered_pricing,
      minimum_usage: data.minimum_usage,
      base_rate: data.base_rate,
      tenant,
      created_at: now,
      updated_at: now
    });
    
    return true;
  }

  /**
   * Update an existing usage configuration
   */
  async update(configId: string, data: Partial<IContractLineServiceUsageConfig>): Promise<boolean> {
    const tenant = await this.getTenant();
    
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
    
    const result = await this.knex('contract_line_service_usage_config')
      .where({
        config_id: configId,
        tenant
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Delete a usage configuration
   */
  async delete(configId: string): Promise<boolean> {
    const tenant = await this.getTenant();
    
    const result = await this.knex('contract_line_service_usage_config')
      .where({
        config_id: configId,
        tenant
      })
      .delete();
    
    return result > 0;
  }

  /**
   * Get rate tiers for a usage configuration
   */
  async getRateTiers(configId: string): Promise<IContractLineServiceRateTier[]> {
    const tenant = await this.getTenant();
    
    const tiers = await this.knex('contract_line_service_rate_tiers')
      .where({
        config_id: configId,
        tenant
      })
      .orderBy('min_quantity', 'asc')
      .select('*');
    
    return tiers;
  }

  /**
   * Add a rate tier to a usage configuration
   */
  async addRateTier(data: Omit<IContractLineServiceRateTier, 'tier_id' | 'created_at' | 'updated_at' | 'tenant'>): Promise<string> {
    const tenant = await this.getTenant();
    
    const tierId = uuidv4();
    const now = new Date();
    
    await this.knex('contract_line_service_rate_tiers').insert({
      tier_id: tierId,
      config_id: data.config_id,
      min_quantity: data.min_quantity,
      max_quantity: data.max_quantity,
      rate: data.rate,
      tenant,
      created_at: now,
      updated_at: now
    });
    
    return tierId;
  }

  /**
   * Update a rate tier
   */
  async updateRateTier(tierId: string, data: Partial<IContractLineServiceRateTier>): Promise<boolean> {
    const tenant = await this.getTenant();
    
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
    
    const result = await this.knex('contract_line_service_rate_tiers')
      .where({
        tier_id: tierId,
        tenant
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Delete a rate tier
   */
  async deleteRateTier(tierId: string): Promise<boolean> {
    const tenant = await this.getTenant();
    
    const result = await this.knex('contract_line_service_rate_tiers')
      .where({
        tier_id: tierId,
        tenant
      })
      .delete();
    
    return result > 0;
  }

  /**
   * Delete all rate tiers for a specific configuration ID
   */
  async deleteRateTiersByConfigId(configId: string): Promise<boolean> {
    const tenant = await this.getTenant();
    
    const result = await this.knex('contract_line_service_rate_tiers')
      .where({
        config_id: configId,
        tenant
      })
      .delete();
    
    // Return true if any rows were deleted, false otherwise.
    // Note: delete() returns the number of affected rows.
    return result >= 0; // Return true even if 0 rows were deleted (idempotency)
  }
}
