// src/lib/actions/interactionTypeActions.ts

'use server'

import { IInteractionType, ISystemInteractionType } from 'server/src/interfaces/interaction.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';

export async function getAllInteractionTypes(): Promise<(IInteractionType | ISystemInteractionType)[]> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    
    // Get system interaction types
    const systemTypes = await db('system_interaction_types')
      .select('*')
      .orderBy('type_name');

    // Get tenant-specific interaction types
    const tenantTypes = await db('interaction_types')
      .where({ tenant: currentUser.tenant })
      .select('*')
      .orderBy('type_name');

    // Combine both types, with system types first
    return [...systemTypes, ...tenantTypes];
  } catch (error) {
    console.error('Error fetching interaction types:', error);
    throw new Error('Failed to fetch interaction types');
  }
}

export async function getSystemInteractionTypes(): Promise<ISystemInteractionType[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    return await db('system_interaction_types')
      .select('*')
      .orderBy('type_name');
  } catch (error) {
    console.error('Error fetching system interaction types:', error);
    throw new Error('Failed to fetch system interaction types');
  }
}

export async function getSystemInteractionTypeById(typeId: string): Promise<ISystemInteractionType | null> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required');
    }
    const type = await db('system_interaction_types')
      .where({ type_id: typeId })
      .first();
    return type || null;
  } catch (error) {
    console.error('Error fetching system interaction type:', error);
    throw new Error('Failed to fetch system interaction type');
  }
}

export async function createInteractionType(
  interactionType: Omit<IInteractionType, 'type_id' | 'tenant'> & { system_type_id?: string }
): Promise<IInteractionType> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const {knex: db} = await createTenantKnex();
    // If system_type_id is provided, verify it exists
    if (interactionType.system_type_id) {
      const systemType = await db('system_interaction_types')
        .where({ type_id: interactionType.system_type_id })
        .first();
      
      if (!systemType) {
        throw new Error('Invalid system interaction type');
      }
    }

    // Extract only the allowed fields from interactionType
    const { type_name, icon, system_type_id } = interactionType;
    
    const [newType] = await db('interaction_types')
      .insert({
        type_name,
        icon,
        system_type_id,
        tenant: currentUser.tenant
      })
      .returning('*');
    return newType;
  } catch (error) {
    console.error('Error creating interaction type:', error);
    throw new Error('Failed to create interaction type');
  }
}

export async function updateInteractionType(
  typeId: string, 
  data: Partial<Omit<IInteractionType, 'type_id' | 'tenant' | 'system_type_id'>>
): Promise<IInteractionType> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const {knex: db} = await createTenantKnex();
    // Check if this is a system-inherited type
    const existingType = await db('interaction_types')
      .where({ type_id: typeId, tenant: currentUser.tenant })
      .first();

    if (!existingType) {
      throw new Error('Interaction type not found or not authorized');
    }

    if (existingType.system_type_id) {
      throw new Error('Cannot modify a system-inherited interaction type');
    }

    const [updatedType] = await db('interaction_types')
      .where({ type_id: typeId, tenant: currentUser.tenant })
      .update(data)
      .returning('*');

    return updatedType;
  } catch (error) {
    console.error('Error updating interaction type:', error);
    throw new Error('Failed to update interaction type');
  }
}

export async function deleteInteractionType(typeId: string): Promise<void> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const {knex: db} = await createTenantKnex();

    // Check if this is a system-inherited type
    const typeToDelete = await db('interaction_types')
      .where({ type_id: typeId, tenant: currentUser.tenant })
      .first();

    if (!typeToDelete) {
      throw new Error('Interaction type not found or not authorized');
    }

    if (typeToDelete.system_type_id) {
      throw new Error('Cannot delete a system-inherited interaction type');
    }

    // Check for existing records
    const existingRecords = await db('interactions')
      .where({ 
        type_id: typeId,
        tenant: currentUser.tenant 
      })
      .first();

    if (existingRecords) {
      throw new Error('Cannot delete interaction type: records exist that use this type');
    }

    const deletedCount = await db('interaction_types')
      .where({ type_id: typeId, tenant: currentUser.tenant })
      .delete();

    if (deletedCount === 0) {
      throw new Error('Interaction type not found or not authorized');
    }
  } catch (error) {
    console.error('Error deleting interaction type:', error);
    throw error; // Throw the original error to preserve the message
  }
}

export async function getInteractionTypeById(typeId: string): Promise<IInteractionType | null> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const {knex: db} = await createTenantKnex();
    const type = await db('interaction_types')
      .where({ type_id: typeId, tenant: currentUser.tenant })
      .first();

    if (!type) {
      // If not found in tenant types, check system types
      const systemType = await getSystemInteractionTypeById(typeId);
      return systemType;
    }

    return type;
  } catch (error) {
    console.error('Error fetching interaction type:', error);
    throw new Error('Failed to fetch interaction type');
  }
}
