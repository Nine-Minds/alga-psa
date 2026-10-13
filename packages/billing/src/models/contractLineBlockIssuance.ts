import { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type {
  ContractLineBlockIssuanceStatus,
  IContractLineBlockIssuance,
} from '@alga-psa/types';

/**
 * Thin knex model for contract_line_block_issuances ("a block is due on date X
 * for line L"). Scheduling, locking and invoicing rules live in the issuance
 * services; callers that mutate must hold the issuance/config lock BEFORE any
 * hour_blocks lock (plan D5 / Risk 6). This only wraps row access.
 */
export default class ContractLineBlockIssuance {
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
    return tenantDb(this.knex, this.tenant).table('contract_line_block_issuances');
  }

  async getById(issuanceId: string): Promise<IContractLineBlockIssuance | null> {
    await this.initKnex();
    const row = await this.table().where({ issuance_id: issuanceId, tenant: this.tenant }).first();
    return (row as IContractLineBlockIssuance) || null;
  }

  /** The line's single open (scheduled) issuance, if any. */
  async getScheduledForLine(contractLineId: string): Promise<IContractLineBlockIssuance | null> {
    await this.initKnex();
    const row = await this.table()
      .where({ contract_line_id: contractLineId, tenant: this.tenant, status: 'scheduled' })
      .first();
    return (row as IContractLineBlockIssuance) || null;
  }

  async listByLine(contractLineId: string): Promise<IContractLineBlockIssuance[]> {
    await this.initKnex();
    const rows = await this.table()
      .where({ contract_line_id: contractLineId, tenant: this.tenant })
      .orderBy('due_date', 'desc')
      .orderBy('created_at', 'desc');
    return rows as IContractLineBlockIssuance[];
  }

  async listByClientAndStatus(
    clientId: string,
    statuses: ContractLineBlockIssuanceStatus[],
  ): Promise<IContractLineBlockIssuance[]> {
    await this.initKnex();
    const rows = await this.table()
      .where({ client_id: clientId, tenant: this.tenant })
      .whereIn('status', statuses)
      .orderBy('due_date', 'asc');
    return rows as IContractLineBlockIssuance[];
  }
}
