'use server'

import { IPriority } from '@/interfaces';
import Priority from '@/lib/models/priority';

import { createTenantKnex } from '@/lib/db';

export async function getAllPriorities() {
  const { tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    const priorities = await Priority.getAll();
    return priorities;
  } catch (error) {
    console.error(`Error fetching priorities for tenant ${tenant}:`, error);
    throw new Error(`Failed to fetch priorities for tenant ${tenant}`);
  }
}

export async function findPriorityById(id: string) {
  const { tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('No tenant found');
  }

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
}

export async function createPriority(priorityData: Omit<IPriority, 'priority_id' | 'tenant'>): Promise<IPriority> {
  const { tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    const newPriority = await Priority.insert(priorityData);
    return newPriority;
  } catch (error) {
    console.error(`Error creating priority for tenant ${tenant}:`, error);
    throw new Error(`Failed to create priority for tenant ${tenant}`);
  }
}


export async function deletePriority(priorityId: string) {
  const { tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    await Priority.delete(priorityId);
    return true;
  } catch (error) {
    console.error(`Error deleting priority ${priorityId} for tenant ${tenant}:`, error);
    throw new Error(`Failed to delete priority for tenant ${tenant}`);
  }
}

export async function updatePriority(priorityId: string, priorityData: Partial<IPriority>): Promise<IPriority> {
  const { tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('No tenant found');
  }

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
}