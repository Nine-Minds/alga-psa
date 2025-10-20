import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { IContractLineServiceBucketConfig } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';

export default class ContractLineServiceBucketConfig {
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
   * Get a bucket configuration by config ID
   */
  async getByConfigId(configId: string): Promise<IContractLineServiceBucketConfig | null> {
    await this.initKnex();
    
    const config = await this.knex('contract_line_service_bucket_config')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .first();
    
    return config || null;
  }

  /**
   * Create a new bucket configuration
   */
  async create(data: Omit<IContractLineServiceBucketConfig, 'created_at' | 'updated_at'>): Promise<boolean> {
    await this.initKnex();
    
    const now = new Date();
    
    await this.knex('contract_line_service_bucket_config').insert({
      config_id: data.config_id,
      total_minutes: data.total_minutes,
      billing_period: data.billing_period,
      overage_rate: data.overage_rate,
      allow_rollover: data.allow_rollover,
      tenant: this.tenant,
      created_at: now,
      updated_at: now
    });
    
    return true;
  }

  /**
   * Update an existing bucket configuration
   */
  async update(configId: string, data: Partial<IContractLineServiceBucketConfig>): Promise<boolean> {
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
    
    const result = await this.knex('contract_line_service_bucket_config')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Delete a bucket configuration
   */
  async delete(configId: string): Promise<boolean> {
    await this.initKnex();
    
    const result = await this.knex('contract_line_service_bucket_config')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .delete();
    
    return result > 0;
  }
}
