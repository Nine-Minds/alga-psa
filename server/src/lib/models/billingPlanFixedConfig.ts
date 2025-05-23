import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { IBillingPlanFixedConfig } from 'server/src/interfaces/billing.interfaces';

export default class BillingPlanFixedConfig {
  private knex: Knex;
  private tenant: string;
  private tableName = 'billing_plan_fixed_config';

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
   * Get a fixed plan configuration by plan ID
   */
  async getByPlanId(planId: string): Promise<IBillingPlanFixedConfig | null> {
    await this.initKnex();
    
    const config = await this.knex(this.tableName)
      .where({
        plan_id: planId,
        tenant: this.tenant
      })
      .first();
    
    return config || null;
  }

  /**
   * Create a new fixed plan configuration
   */
  async create(data: Omit<IBillingPlanFixedConfig, 'created_at' | 'updated_at'>): Promise<boolean> {
    await this.initKnex();
    
    const now = new Date();
    
    // Ensure tenant is set correctly, overriding any provided tenant in data
    const insertData = {
      ...data,
      tenant: this.tenant,
      created_at: now,
      updated_at: now
    };

    await this.knex(this.tableName).insert(insertData);
    
    return true;
  }

  /**
   * Update an existing fixed plan configuration by plan ID
   */
  async update(planId: string, data: Partial<Omit<IBillingPlanFixedConfig, 'plan_id' | 'tenant' | 'created_at'>>): Promise<boolean> {
    await this.initKnex();
    
    const updateData = {
      ...data,
      updated_at: new Date()
    };
    
    const result = await this.knex(this.tableName)
      .where({
        plan_id: planId,
        tenant: this.tenant
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Upsert a fixed plan configuration (create if not exists, update if exists)
   */
  async upsert(data: Omit<IBillingPlanFixedConfig, 'created_at' | 'updated_at'>): Promise<boolean> {
    await this.initKnex();

    const existing = await this.getByPlanId(data.plan_id);

    if (existing) {
      // Update existing record
      const { plan_id, tenant, ...updateData } = data; // Exclude keys used in where clause
      return this.update(data.plan_id, updateData);
    } else {
      // Create new record
      return this.create(data);
    }
  }

  /**
   * Delete a fixed plan configuration by plan ID
   */
  async delete(planId: string): Promise<boolean> {
    await this.initKnex();
    
    const result = await this.knex(this.tableName)
      .where({
        plan_id: planId,
        tenant: this.tenant
      })
      .delete();
    
    return result > 0;
  }
}