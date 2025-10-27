import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { IContractLineServiceConfiguration } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import { v4 as uuidv4 } from 'uuid';

export default class ContractLineServiceConfiguration {
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
   * Get a contract line service configuration by ID
   */
  async getById(configId: string): Promise<IContractLineServiceConfiguration | null> {
    await this.initKnex();
    
    const config = await this.knex('contract_line_service_configuration')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .first();
    
    return config || null;
  }

  /**
   * Get all configurations for a contract line
   */
  async getByContractLineId(contractLineId: string): Promise<IContractLineServiceConfiguration[]> {
    await this.initKnex();

    const configs = await this.knex('contract_line_service_configuration')
      .where({
        contract_line_id: contractLineId,
        tenant: this.tenant
      })
      .select('*');

    return configs;
  }

  /**
   * Get configuration for a specific service within a contract line
   */
  async getByContractLineIdAndServiceId(contractLineId: string, serviceId: string): Promise<IContractLineServiceConfiguration | null> {
    await this.initKnex();

    const config = await this.knex('contract_line_service_configuration')
      .where({
        contract_line_id: contractLineId,
        service_id: serviceId,
        tenant: this.tenant
      })
      .first();

    return config || null;
  }

  /**
   * Create a new contract line service configuration
   */
  async create(data: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'>): Promise<string> {
    await this.initKnex();
    
    const configId = uuidv4();
    const now = new Date();
    
    await this.knex('contract_line_service_configuration').insert({
      config_id: configId,
      contract_line_id: data.contract_line_id,
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
   * Update an existing contract line service configuration
   */
  async update(configId: string, data: Partial<IContractLineServiceConfiguration>): Promise<boolean> {
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
    
    const result = await this.knex('contract_line_service_configuration')
      .where({
        config_id: configId,
        tenant: this.tenant
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Delete a contract line service configuration
   */
  async delete(configId: string): Promise<boolean> {
    await this.initKnex();
    
    // Use a transaction to ensure both operations succeed or fail together
    return await this.knex.transaction(async (trx) => {
      const updatedDetails = await trx('invoice_charge_details')
        .where({
          config_id: configId,
          tenant: this.tenant
        })
        .update({
          config_id: null
        });
      
      // Then delete the configuration
      const result = await trx('contract_line_service_configuration')
        .where({
          config_id: configId,
          tenant: this.tenant
        })
        .delete();
      
      return result > 0;
    });
  }
}
