import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { IContractLineFixedConfig } from 'server/src/interfaces/billing.interfaces';

export default class ContractLineFixedConfig {
  private knex: Knex;
  private tenant: string;
  private tableName = 'contract_line_fixed_config';

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
   * Get a fixed contract line configuration by contract line ID
   */
  async getByContractLineId(contractLineId: string): Promise<IContractLineFixedConfig | null> {
    await this.initKnex();
    
    const config = await this.knex(this.tableName)
      .where({
        contract_line_id: contractLineId,
        tenant: this.tenant
      })
      .first();
    
    return config || null;
  }

  /**
   * Create a new fixed contract line configuration
   */
  async create(data: Omit<IContractLineFixedConfig, 'created_at' | 'updated_at'>): Promise<boolean> {
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
   * Update an existing fixed contract line configuration by contract line ID
   */
  async update(contractLineId: string, data: Partial<Omit<IContractLineFixedConfig, 'contract_line_id' | 'tenant' | 'created_at'>>): Promise<boolean> {
    await this.initKnex();
    
    const updateData = {
      ...data,
      updated_at: new Date()
    };
    
    const result = await this.knex(this.tableName)
      .where({
        contract_line_id: contractLineId,
        tenant: this.tenant
      })
      .update(updateData);
    
    return result > 0;
  }

  /**
   * Upsert a fixed contract line configuration (create if not exists, update if exists)
   */
  async upsert(data: Omit<IContractLineFixedConfig, 'created_at' | 'updated_at'>): Promise<boolean> {
    await this.initKnex();

    const existing = await this.getByContractLineId(data.contract_line_id);

    if (existing) {
      // Update existing record
      const { contract_line_id, tenant, ...updateData } = data; // Exclude keys used in where clause
      return this.update(data.contract_line_id, updateData);
    } else {
      // Create new record
      return this.create(data);
    }
  }

  /**
   * Delete a fixed contract line configuration by contract line ID
   */
  async delete(contractLineId: string): Promise<boolean> {
    await this.initKnex();
    
    const result = await this.knex(this.tableName)
      .where({
        contract_line_id: contractLineId,
        tenant: this.tenant
      })
      .delete();
    
    return result > 0;
  }
}