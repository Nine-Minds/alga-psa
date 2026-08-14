import { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { IHourBlock, IHourBlockAllocation, IHourBlockAuditEntry, IHourBlockServiceScope } from '@alga-psa/types';

/**
 * Thin knex model for the ad-hoc prepaid hour-block ledger
 * (hour_blocks / hour_block_service_scopes / hour_block_time_allocations /
 * hour_block_audit). Business logic lives in the hour-block actions and the
 * shared burn engine; this model only wraps basic row access following
 * contractLineServiceBucketConfig conventions.
 */
export default class HourBlock {
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
        throw new Error("tenant context not found");
      }
      this.knex = knex;
      this.tenant = tenant;
    }
  }

  private table(table: string): Knex.QueryBuilder {
    return tenantDb(this.knex, this.tenant).table(table);
  }

  async getByBlockId(blockId: string): Promise<IHourBlock | null> {
    await this.initKnex();
    const block = await this.table('hour_blocks')
      .where({ block_id: blockId, tenant: this.tenant })
      .first();
    return (block as IHourBlock) || null;
  }

  async listByClient(clientId: string): Promise<IHourBlock[]> {
    await this.initKnex();
    const rows = await this.table('hour_blocks')
      .where({ client_id: clientId, tenant: this.tenant })
      .orderBy('purchased_at', 'asc')
      .orderBy('created_at', 'asc');
    return rows as IHourBlock[];
  }

  async listAllocationsForBlock(blockId: string): Promise<IHourBlockAllocation[]> {
    await this.initKnex();
    const rows = await this.table('hour_block_time_allocations')
      .where({ block_id: blockId, tenant: this.tenant })
      .orderBy('created_at', 'asc');
    return rows as IHourBlockAllocation[];
  }

  async listAuditForBlock(blockId: string): Promise<IHourBlockAuditEntry[]> {
    await this.initKnex();
    const rows = await this.table('hour_block_audit')
      .where({ block_id: blockId, tenant: this.tenant })
      .orderBy('created_at', 'desc');
    return rows as IHourBlockAuditEntry[];
  }

  async listScopesForBlock(blockId: string): Promise<IHourBlockServiceScope[]> {
    await this.initKnex();
    const rows = await this.table('hour_block_service_scopes')
      .where({ block_id: blockId, tenant: this.tenant });
    return rows as IHourBlockServiceScope[];
  }
}
