import { IPriority, IStandardPriority } from '../../interfaces/ticket.interfaces';
import { createTenantKnex } from '../db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';

class Priority {
  static async getAll(itemType?: 'ticket' | 'project_task', trx?: Knex.Transaction): Promise<IPriority[]> {
    const {knex: db, tenant} = await createTenantKnex();
    const dbOrTrx = trx || db;
    const query = dbOrTrx('priorities').select('*').where({ tenant });
    if (itemType) {
      query.where({ item_type: itemType });
    }
    return query;
  }

  static async getAllWithStandard(itemType?: 'ticket' | 'project_task', trx?: Knex.Transaction): Promise<(IPriority | IStandardPriority)[]> {
    const {knex: db, tenant} = await createTenantKnex();
    const dbOrTrx = trx || db;
    
    // Get standard priorities
    const standardQuery = dbOrTrx('standard_priorities').select('*');
    if (itemType) {
      standardQuery.where({ item_type: itemType });
    }
    const standardPriorities = await standardQuery;
    
    // Get tenant-specific priorities
    const tenantQuery = dbOrTrx('priorities').select('*').where({ tenant });
    if (itemType) {
      tenantQuery.where({ item_type: itemType });
    }
    const tenantPriorities = await tenantQuery;
    
    // Combine both, standard first
    return [...standardPriorities, ...tenantPriorities];
  }

  static async get(id: string, trx?: Knex.Transaction): Promise<IPriority | null> {
    const {knex: db, tenant} = await createTenantKnex();
    const dbOrTrx = trx || db;
    const [priority] = await dbOrTrx('priorities').where({ priority_id: id, tenant });
    return priority || null;
  }

  static async insert(priority: Omit<IPriority, 'priority_id' | 'tenant'>, trx?: Knex.Transaction): Promise<IPriority> {
    const {knex: db, tenant} = await createTenantKnex();
    const dbOrTrx = trx || db;
    const [insertedPriority] = await dbOrTrx('priorities').insert({...priority, tenant}).returning('*');
    return insertedPriority;
  }

  static async delete(id: string, trx?: Knex.Transaction): Promise<void> {
    const {knex: db, tenant} = await createTenantKnex();
    const dbOrTrx = trx || db;
    await dbOrTrx('priorities').where({ priority_id: id, tenant }).del();
  }
  
  static async update(id: string, priority: Partial<IPriority>, trx?: Knex.Transaction): Promise<IPriority | null> {
    const {knex: db, tenant} = await createTenantKnex();
    const dbOrTrx = trx || db;
    const [updatedPriority] = await dbOrTrx('priorities')
      .where({ priority_id: id, tenant })
      .update(priority)
      .returning('*');
    return updatedPriority || null;
  }
}

export default Priority;
