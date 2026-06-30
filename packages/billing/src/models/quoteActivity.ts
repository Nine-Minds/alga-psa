import type { Knex } from 'knex';
import type { IQuoteActivity } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table('quote_activities');
}

const QuoteActivity = {
  async create(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    activity: Omit<IQuoteActivity, 'activity_id' | 'tenant' | 'created_at'>
  ): Promise<IQuoteActivity> {
    if (!tenant) {
      throw new Error('Tenant context is required for creating quote activity');
    }

    const [createdActivity] = await tenantScopedTable(knexOrTrx, tenant)
      .insert({ tenant, ...activity, metadata: activity.metadata ?? {} })
      .returning('*');

    return createdActivity;
  },

  async listByQuoteId(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteId: string
  ): Promise<IQuoteActivity[]> {
    if (!tenant) {
      throw new Error('Tenant context is required for listing quote activities');
    }

    return tenantScopedTable(knexOrTrx, tenant)
      .where({ quote_id: quoteId })
      .orderBy('created_at', 'asc');
  }
};

export default QuoteActivity;
