import type { Knex } from 'knex';
import type { IQuoteActivity } from '@alga-psa/types';

const QuoteActivity = {
  async create(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    activity: Omit<IQuoteActivity, 'activity_id' | 'tenant' | 'created_at'>
  ): Promise<IQuoteActivity> {
    if (!tenant) {
      throw new Error('Tenant context is required for creating quote activity');
    }

    const [createdActivity] = await knexOrTrx('quote_activities')
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

    return knexOrTrx('quote_activities')
      .where({ tenant, quote_id: quoteId })
      .orderBy('created_at', 'asc');
  }
};

export default QuoteActivity;
