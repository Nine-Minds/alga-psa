import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import type { IContractLineFixedConfig } from '@alga-psa/types';

export default class ContractLineFixedConfig {
  private knex: Knex;
  private tenant: string;
  private tableName = 'contract_lines';

  constructor(knex?: Knex, tenant?: string) {
    this.knex = knex as Knex;
    this.tenant = tenant as string;
  }

  /**
   * Initialize knex connection if not provided in constructor
   */
  private async initKnex() {
    if (!this.knex) {
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        throw new Error('User not authenticated');
      }
      const { knex, tenant } = await createTenantKnex(currentUser.tenant);
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
  async getByPlanId(planId: string): Promise<IContractLineFixedConfig | null> {
    await this.initKnex();

    const row = await this.knex(this.tableName)
      .where({
        contract_line_id: planId,
        tenant: this.tenant
      })
      .first(['contract_line_id', 'custom_rate', 'enable_proration', 'billing_cycle_alignment', 'updated_at', 'created_at']);

    if (!row) {
      return null;
    }

    return {
      contract_line_id: row.contract_line_id,
      base_rate: row.custom_rate ?? null,
      enable_proration: row.enable_proration ?? false,
      billing_cycle_alignment: row.billing_cycle_alignment ?? 'start',
      tenant: this.tenant,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Create a new fixed plan configuration
   */
  async create(data: Omit<IContractLineFixedConfig, 'created_at' | 'updated_at'>): Promise<boolean> {
    return this.upsert(data);
  }

  /**
   * Update an existing fixed plan configuration by plan ID
   */
  async update(planId: string, data: Partial<Omit<IContractLineFixedConfig, 'contract_line_id' | 'tenant' | 'created_at'>>): Promise<boolean> {
    await this.initKnex();

    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (data.base_rate !== undefined) {
      updateData.custom_rate = data.base_rate;
    }
    if (data.enable_proration !== undefined) {
      updateData.enable_proration = data.enable_proration;
    }
    if (data.billing_cycle_alignment !== undefined) {
      updateData.billing_cycle_alignment = data.billing_cycle_alignment;
    }

    const result = await this.knex(this.tableName)
      .where({
        contract_line_id: planId,
        tenant: this.tenant,
      })
      .update(updateData);

    return result > 0;
  }

  /**
   * Upsert a fixed plan configuration (create if not exists, update if exists)
   */
  async upsert(data: Omit<IContractLineFixedConfig, 'created_at' | 'updated_at'>): Promise<boolean> {
    await this.initKnex();

    const { contract_line_id, base_rate, enable_proration, billing_cycle_alignment } = data;

    const result = await this.knex(this.tableName)
      .where({
        contract_line_id,
        tenant: this.tenant,
      })
      .update({
        custom_rate: base_rate ?? null,
        enable_proration: enable_proration ?? false,
        billing_cycle_alignment: billing_cycle_alignment ?? 'start',
        updated_at: new Date(),
      });

    return result > 0;
  }

  /**
   * Delete a fixed plan configuration by plan ID
   */
  async delete(planId: string): Promise<boolean> {
    await this.initKnex();

    const result = await this.knex(this.tableName)
      .where({
        contract_line_id: planId,
        tenant: this.tenant,
      })
      .update({
        custom_rate: null,
        enable_proration: false,
        billing_cycle_alignment: 'start',
        updated_at: new Date(),
      });

    return result > 0;
  }
}
