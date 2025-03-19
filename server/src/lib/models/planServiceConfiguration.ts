import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { IPlanServiceConfiguration } from 'server/src/interfaces/planServiceConfiguration.interfaces';
import { v4 as uuidv4 } from 'uuid';

export default class PlanServiceConfiguration {
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
   * Get a plan service configuration by ID
   */
  async getById(configId: string): Promise<IPlanServiceConfiguration | null> {
    await this.initKnex();
    
    const config = await this.knex('plan_service_configuration')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .first();
    
    return config || null;
  }

  /**
   * Get all configurations for a plan
   */
  async getByPlanId(planId: string): Promise<IPlanServiceConfiguration[]> {
    await this.initKnex();
    
    const configs = await this.knex('plan_service_configuration')
      .where({
        plan_id: planId,
        tenant: this.tenant
      })
      .select('*');
    
    return configs;
  }

  /**
   * Get configuration for a specific service within a plan
   */
  async getByPlanAndServiceId(planId: string, serviceId: string): Promise<IPlanServiceConfiguration | null> {
    await this.initKnex();
    
    const config = await this.knex('plan_service_configuration')
      .where({
        plan_id: planId,
        service_id: serviceId,
        tenant: this.tenant
      })
      .first();
    
    return config || null;
  }

  /**
   * Create a new plan service configuration
   */
  async create(data: Omit<IPlanServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'>): Promise<string> {
    await this.initKnex();
    
    const configId = uuidv4();
    const now = new Date();
    
    await this.knex('plan_service_configuration').insert({
      config_id: configId,
      plan_id: data.plan_id,
      service_id: data.service_id,
      configuration_type: data.configuration_type,
      custom_rate: data.custom_rate,
      quantity: data.quantity,
      tenant: this.tenant,
      created_at: now,
      updated_at: now
    });
    
    return configId;
  }

  /**
   * Update an existing plan service configuration
   */
  async update(configId: string, data: Partial<IPlanServiceConfiguration>): Promise<boolean> {
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
    
    const result = await this.knex('plan_service_configuration')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Delete a plan service configuration
   */
  async delete(configId: string): Promise<boolean> {
    await this.initKnex();
    
    const result = await this.knex('plan_service_configuration')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .delete();
    
    return result > 0;
  }
}