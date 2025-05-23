'use server'

import { IPriority } from 'server/src/interfaces';
import Priority from 'server/src/lib/models/priority';

import { withTransaction } from '@shared/db';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';

export async function getAllPriorities() {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const priorities = await Priority.getAll();
      return priorities;
    } catch (error) {
      console.error(`Error fetching priorities for tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch priorities for tenant ${tenant}`);
    }
  });
}

export async function findPriorityById(id: string) {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const priority = await Priority.get(id);
      if (!priority) {
        throw new Error(`Priority ${id} not found for tenant ${tenant}`);
      }
      return priority;
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
      const newPriority = await Priority.insert(priorityData);
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
      await Priority.delete(priorityId);
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
      const updatedPriority = await Priority.update(priorityId, priorityData);
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