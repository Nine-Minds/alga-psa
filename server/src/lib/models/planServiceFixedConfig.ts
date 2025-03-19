import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { IPlanServiceFixedConfig } from 'server/src/interfaces/planServiceConfiguration.interfaces';

export default class PlanServiceFixedConfig {
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
   * Get a fixed price configuration by config ID
   */
  async getByConfigId(configId: string): Promise<IPlanServiceFixedConfig | null> {
    await this.initKnex();
    
    const config = await this.knex('plan_service_fixed_config')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .first();
    
    return config || null;
  }

  /**
   * Create a new fixed price configuration
   */
  async create(data: Omit<IPlanServiceFixedConfig, 'created_at' | 'updated_at'>): Promise<boolean> {
    await this.initKnex();
    
    const now = new Date();
    
    await this.knex('plan_service_fixed_config').insert({
      config_id: data.config_id,
      enable_proration: data.enable_proration,
      billing_cycle_alignment: data.billing_cycle_alignment,
      tenant: this.tenant,
      created_at: now,
      updated_at: now
    });
    
    return true;
  }

  /**
   * Update an existing fixed price configuration
   */
  async update(configId: string, data: Partial<IPlanServiceFixedConfig>): Promise<boolean> {
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
    
    const result = await this.knex('plan_service_fixed_config')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Delete a fixed price configuration
   */
  async delete(configId: string): Promise<boolean> {
    await this.initKnex();
    
    const result = await this.knex('plan_service_fixed_config')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .delete();
    
    return result > 0;
  }
}