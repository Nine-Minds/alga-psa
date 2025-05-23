'use server'
import { createTenantKnex } from 'server/src/lib/db';
import { IServiceCategory } from 'server/src/interfaces/billing.interfaces';
import { ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { withTransaction } from '../../../../shared/db';
import { Knex } from 'knex';

export async function getServiceCategories(): Promise<IServiceCategory[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const categories = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('service_categories')
        .where({ tenant })
        .select('category_id', 'category_name', 'description');
    });

    return categories;
  } catch (error) {
    console.error('Error fetching service categories:', error);
    throw new Error('Failed to fetch service categories');
  }
}

export async function getTicketCategoriesByChannel(channelId: string): Promise<ITicketCategory[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const categories = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('categories')
        .where({
          channel_id: channelId,
          tenant: tenant
        })
        .orderBy('category_name', 'asc');
    });

    return categories;
  } catch (error) {
    console.error('Error fetching ticket categories:', error);
    throw new Error('Failed to fetch ticket categories');
  }
}
