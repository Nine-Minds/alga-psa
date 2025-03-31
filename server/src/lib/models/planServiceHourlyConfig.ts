import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { IPlanServiceHourlyConfig, IUserTypeRate } from 'server/src/interfaces/planServiceConfiguration.interfaces';
import { v4 as uuidv4 } from 'uuid';

export default class PlanServiceHourlyConfig {
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
   * Get an hourly configuration by config ID
   */
  async getByConfigId(configId: string): Promise<IPlanServiceHourlyConfig | null> {
    await this.initKnex();
    
    const config = await this.knex('plan_service_hourly_configs') // Corrected table name (plural)
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .first();
    
    return config || null;
  }

  /**
   * Create a new hourly configuration
   */
  async create(data: Omit<IPlanServiceHourlyConfig, 'created_at' | 'updated_at'>): Promise<boolean> {
    await this.initKnex();
    
    const now = new Date();
    
    await this.knex('plan_service_hourly_configs').insert({ // Corrected table name (plural)
      config_id: data.config_id,
      hourly_rate: data.hourly_rate, // Add hourly_rate back
      minimum_billable_time: data.minimum_billable_time,
      round_up_to_nearest: data.round_up_to_nearest,
      // Removed plan-wide fields that are now in billing_plans table:
      // enable_overtime: data.enable_overtime,
      // overtime_rate: data.overtime_rate,
      // overtime_threshold: data.overtime_threshold,
      // enable_after_hours_rate: data.enable_after_hours_rate,
      // after_hours_multiplier: data.after_hours_multiplier,
      tenant: this.tenant,
      created_at: now,
      updated_at: now
    });
    
    return true;
  }

  /**
   * Update an existing hourly configuration
   */
  async update(configId: string, data: Partial<IPlanServiceHourlyConfig>): Promise<boolean> {
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
    
    const result = await this.knex('plan_service_hourly_configs') // Corrected table name (plural)
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Delete an hourly configuration
   */
  async delete(configId: string): Promise<boolean> {
    await this.initKnex();
    
    const result = await this.knex('plan_service_hourly_configs') // Corrected table name (plural)
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .delete();
    
    return result > 0;
  }

  /**
   * Get user type rates for an hourly configuration
   */
  async getUserTypeRates(configId: string): Promise<IUserTypeRate[]> {
    await this.initKnex();
    
    const rates = await this.knex('user_type_rates')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .select('*');
    
    return rates;
  }

  /**
   * Add a user type rate to an hourly configuration
   */
  async addUserTypeRate(data: Omit<IUserTypeRate, 'rate_id' | 'created_at' | 'updated_at'>): Promise<string> {
    await this.initKnex();
    
    const rateId = uuidv4();
    const now = new Date();
    
    await this.knex('user_type_rates').insert({
      rate_id: rateId,
      config_id: data.config_id,
      user_type: data.user_type,
      rate: data.rate,
      tenant: this.tenant,
      created_at: now,
      updated_at: now
    });
    
    return rateId;
  }

  /**
   * Update a user type rate
   */
  async updateUserTypeRate(rateId: string, data: Partial<IUserTypeRate>): Promise<boolean> {
    await this.initKnex();
    
    const updateData = {
      ...data,
      updated_at: new Date()
    };
    
    // Remove rate_id from update data if present
    if ('rate_id' in updateData) {
      delete updateData.rate_id;
    }
    
    // Remove tenant from update data if present
    if ('tenant' in updateData) {
      delete updateData.tenant;
    }
    
    const result = await this.knex('user_type_rates')
      .where({
        rate_id: rateId,
        tenant: this.tenant
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Delete all user type rates for a specific hourly configuration ID
   */
  async deleteUserTypeRatesByConfigId(configId: string): Promise<number> {
    await this.initKnex();

    const result = await this.knex('user_type_rates')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .delete();

    return result; // Return the number of deleted rows
  }

  /**
   * Add multiple user type rates to an hourly configuration
   */
  async addUserTypeRates(rates: Omit<IUserTypeRate, 'rate_id' | 'created_at' | 'updated_at'>[]): Promise<string[]> {
    await this.initKnex();

    if (!rates || rates.length === 0) {
      return [];
    }

    const now = new Date();
    const ratesToInsert = rates.map(rate => ({
      rate_id: uuidv4(), // Generate UUID for each rate
      config_id: rate.config_id,
      user_type: rate.user_type,
      rate: rate.rate,
      tenant: this.tenant, // Ensure tenant is set from the model instance
      created_at: now,
      updated_at: now
    }));

    const inserted = await this.knex('user_type_rates')
      .insert(ratesToInsert)
      .returning('rate_id'); // Return the generated rate_ids

    // Ensure the returned value matches the expected string[] type
    return inserted.map(item => item.rate_id);
  }

  /**
   * Delete a user type rate
   */
  async deleteUserTypeRate(rateId: string): Promise<boolean> {
    await this.initKnex();
    
    const result = await this.knex('user_type_rates')
      .where({
        rate_id: rateId,
        tenant: this.tenant
      })
      .delete();
    
    return result > 0;
  }
}