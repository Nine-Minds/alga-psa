import { IPriority } from '../../interfaces/ticket.interfaces';
import { createTenantKnex } from '../db';

class Priority {
  static async getAll(): Promise<IPriority[]> {
    const {knex: db, tenant} = await createTenantKnex();
    return db('priorities').select('*').where({ tenant });
  }

  static async get(id: string): Promise<IPriority | null> {
    const {knex: db, tenant} = await createTenantKnex();
    const [priority] = await db('priorities').where({ priority_id: id, tenant });
    return priority || null;
  }

  static async insert(priority: Omit<IPriority, 'priority_id' | 'tenant'>): Promise<IPriority> {
    const {knex: db, tenant} = await createTenantKnex();
    const [insertedPriority] = await db('priorities').insert({...priority, tenant}).returning('*');
    return insertedPriority;
  }

  static async delete(id: string): Promise<void> {
    const {knex: db, tenant} = await createTenantKnex();
    await db('priorities').where({ priority_id: id, tenant }).del();
  }
  
  static async update(id: string, priority: Partial<IPriority>): Promise<IPriority | null> {
    const {knex: db, tenant} = await createTenantKnex();
    const [updatedPriority] = await db('priorities')
      .where({ priority_id: id, tenant })
      .update(priority)
      .returning('*');
    return updatedPriority || null;
  }
}

export default Priority;
