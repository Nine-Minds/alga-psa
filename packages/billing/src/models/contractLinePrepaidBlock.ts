import { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { IContractLinePrepaidBlock, IPrepaidBlockConfigFields } from '@alga-psa/types';

export type UpsertContractLinePrepaidBlockInput = IPrepaidBlockConfigFields & {
  sold_as_service_id: string | null;
};

/**
 * Thin knex model for contract_line_prepaid_blocks (the Prepaid Block config
 * overlay on an Hourly line). Validation and business rules live in the
 * prepaid block actions; this only wraps row access.
 */
export default class ContractLinePrepaidBlock {
  private knex: Knex;
  private tenant: string;

  constructor(knex?: Knex, tenant?: string) {
    this.knex = knex as Knex;
    this.tenant = tenant as string;
  }

  private async initKnex() {
    if (!this.knex) {
      const currentUser = await import('@alga-psa/auth/getCurrentUser').then((m) => m.getCurrentUser());
      if (!currentUser) {
        throw new Error('User not authenticated');
      }
      const { knex, tenant } = await createTenantKnex(currentUser.tenant);
      if (!tenant) {
        throw new Error('tenant context not found');
      }
      this.knex = knex;
      this.tenant = tenant;
    }
  }

  private table(): Knex.QueryBuilder {
    return tenantDb(this.knex, this.tenant).table('contract_line_prepaid_blocks');
  }

  async getByLineId(contractLineId: string): Promise<IContractLinePrepaidBlock | null> {
    await this.initKnex();
    const row = await this.table().where({ contract_line_id: contractLineId, tenant: this.tenant }).first();
    return (row as IContractLinePrepaidBlock) || null;
  }

  async listByLineIds(contractLineIds: string[]): Promise<IContractLinePrepaidBlock[]> {
    await this.initKnex();
    if (contractLineIds.length === 0) return [];
    const rows = await this.table()
      .where({ tenant: this.tenant })
      .whereIn('contract_line_id', contractLineIds);
    return rows as IContractLinePrepaidBlock[];
  }

  async upsert(contractLineId: string, input: UpsertContractLinePrepaidBlockInput): Promise<IContractLinePrepaidBlock> {
    await this.initKnex();
    const now = this.knex.fn.now();
    const [row] = await this.table()
      .insert({ ...input, tenant: this.tenant, contract_line_id: contractLineId, created_at: now, updated_at: now })
      .onConflict(['tenant', 'contract_line_id'])
      .merge({ ...input, updated_at: now })
      .returning('*');
    return row as IContractLinePrepaidBlock;
  }

  async remove(contractLineId: string): Promise<boolean> {
    await this.initKnex();
    const deleted = await this.table().where({ contract_line_id: contractLineId, tenant: this.tenant }).del();
    return deleted > 0;
  }
}
