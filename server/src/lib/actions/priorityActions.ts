'use server'

import { IPriority } from 'server/src/interfaces';
import Priority from 'server/src/lib/models/priority';
import { withTransaction } from '@shared/db';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';

export async function getAllPriorities(itemType?: 'ticket' | 'project_task') {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const priorities = await Priority.getAll(trx, itemType);
      return priorities;
    } catch (error) {
      console.error(`Error fetching priorities for tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch priorities for tenant ${tenant}`);
    }
  });
}

export async function getAllPrioritiesWithStandard(itemType?: 'ticket' | 'project_task') {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const priorities = await Priority.getAllWithStandard(trx, itemType);
      return priorities;
    } catch (error) {
      console.error(`Error fetching priorities with standard for tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch priorities for tenant ${tenant}`);
    }
  });
}

export async function findPriorityById(id: string) {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // First try to find in tenant priorities
      const priority = await Priority.get(trx, id);
      if (priority) {
        return priority;
      }
      
      // If not found, check standard priorities
      const [standardPriority] = await trx('standard_priorities')
        .where({ priority_id: id })
        .select('*');
      
      if (!standardPriority) {
        throw new Error(`Priority ${id} not found`);
      }
      
      return standardPriority;
    } catch (error) {
      console.error(`Error finding priority for tenant ${tenant}:`, error);
      throw new Error(`Failed to find priority for tenant ${tenant}`);
    }
  });
}

export async function createPriority(priorityData: Omit<IPriority, 'priority_id' | 'tenant'>): Promise<IPriority> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const newPriority = await Priority.insert(trx, priorityData);
      return newPriority;
    } catch (error) {
      console.error(`Error creating priority for tenant ${tenant}:`, error);
      throw new Error(`Failed to create priority for tenant ${tenant}`);
    }
  });
}


export async function deletePriority(priorityId: string) {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      await Priority.delete(trx, priorityId);
      return true;
    } catch (error) {
      console.error(`Error deleting priority ${priorityId} for tenant ${tenant}:`, error);
      throw new Error(`Failed to delete priority for tenant ${tenant}`);
    }
  });
}

export async function updatePriority(priorityId: string, priorityData: Partial<IPriority>): Promise<IPriority> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const updatedPriority = await Priority.update(trx, priorityId, priorityData);
      if (!updatedPriority) {
        throw new Error(`Priority ${priorityId} not found for tenant ${tenant}`);
      }
      return updatedPriority;
    } catch (error) {
      console.error(`Error updating priority ${priorityId} for tenant ${tenant}:`, error);
      throw new Error(`Failed to update priority for tenant ${tenant}`);
    }
  });
}

export interface FindPriorityByNameOutput {
  id: string;
  name: string;
  priority_level: number;
  color?: string;
}

/**
 * Find priority by name
 * This action searches for existing priorities by name
 */
export async function findPriorityByName(name: string): Promise<FindPriorityByNameOutput | null> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const priority = await trx('priorities')
        .select('priority_id as id', 'priority_name as name', 'priority_level', 'color')
        .where('tenant', tenant)
        .whereRaw('LOWER(priority_name) = LOWER(?)', [name])
        .first();

      return priority || null;
    } catch (error) {
      console.error(`Error finding priority by name for tenant ${tenant}:`, error);
      return null;
    }
  });
}
