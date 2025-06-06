import { IPriority } from '../../interfaces/ticket.interfaces';
import { getCurrentTenantId } from '../db';
import { Knex } from 'knex';

class Priority {
  static async getAll(knexOrTrx: Knex | Knex.Transaction): Promise<IPriority[]> {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }
    return knexOrTrx('priorities').select('*').where({ tenant });
  }

  static async get(knexOrTrx: Knex | Knex.Transaction, id: string): Promise<IPriority | null> {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }
    const [priority] = await knexOrTrx('priorities').where({ priority_id: id, tenant });
    return priority || null;
  }

  static async insert(knexOrTrx: Knex | Knex.Transaction, priority: Omit<IPriority, 'priority_id' | 'tenant'>): Promise<IPriority> {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }
    const [insertedPriority] = await knexOrTrx('priorities').insert({...priority, tenant}).returning('*');
    return insertedPriority;
  }

  static async delete(knexOrTrx: Knex | Knex.Transaction, id: string): Promise<void> {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }
    await knexOrTrx('priorities').where({ priority_id: id, tenant }).del();
  }
  
  static async update(knexOrTrx: Knex | Knex.Transaction, id: string, priority: Partial<IPriority>): Promise<IPriority | null> {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }
    const [updatedPriority] = await knexOrTrx('priorities')
      .where({ priority_id: id, tenant })
      .update(priority)
      .returning('*');
    return updatedPriority || null;
  }
}

export default Priority;
