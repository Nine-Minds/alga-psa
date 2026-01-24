// src/lib/actions/interactionTypeActions.ts

'use server'

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { IInteractionType, ISystemInteractionType } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';

export const getAllInteractionTypes = withAuth(async (user, { tenant }): Promise<IInteractionType[]> => {
  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get only tenant-specific interaction types
      const tenantTypes = await trx('interaction_types')
        .where({ tenant: tenant })
        .select('*')
        .orderBy('display_order', 'asc')
        .orderBy('type_name', 'asc');

      return tenantTypes;
    });
  } catch (error) {
    console.error('Error fetching interaction types:', error);
    throw new Error('Failed to fetch interaction types');
  }
});

export const getSystemInteractionTypes = withAuth(async (_user, { tenant }): Promise<ISystemInteractionType[]> => {
  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('system_interaction_types')
        .select('*')
        .orderBy('type_name');
    });
  } catch (error) {
    console.error('Error fetching system interaction types:', error);
    throw new Error('Failed to fetch system interaction types');
  }
});

export const getSystemInteractionTypeById = withAuth(async (
  _user,
  { tenant },
  typeId: string
): Promise<ISystemInteractionType | null> => {
  try {
    const { knex: db } = await createTenantKnex();

    const type = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('system_interaction_types')
        .where({ type_id: typeId })
        .first();
    });
    return type || null;
  } catch (error) {
    console.error('Error fetching system interaction type:', error);
    throw new Error('Failed to fetch system interaction type');
  }
});

export const createInteractionType = withAuth(async (
  user,
  { tenant },
  interactionType: Omit<IInteractionType, 'type_id' | 'tenant'>
): Promise<IInteractionType> => {
  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Extract only the allowed fields from interactionType
      const { type_name, icon, display_order } = interactionType;

      // If no display_order provided, get the next available order
      let finalDisplayOrder = display_order;
      if (finalDisplayOrder === undefined || finalDisplayOrder === null) {
        const maxOrder = await trx('interaction_types')
          .where({ tenant: tenant })
          .max('display_order as max')
          .first();
        finalDisplayOrder = (maxOrder?.max || 0) + 1;
      }

      const [newType] = await trx('interaction_types')
        .insert({
          type_name,
          icon,
          display_order: finalDisplayOrder,
          tenant: tenant,
          created_by: user.user_id
        })
        .returning('*');
      return newType;
    });
  } catch (error) {
    console.error('Error creating interaction type:', error);
    throw new Error('Failed to create interaction type');
  }
});

export const updateInteractionType = withAuth(async (
  _user,
  { tenant },
  typeId: string,
  data: Partial<Omit<IInteractionType, 'type_id' | 'tenant'>>
): Promise<IInteractionType> => {
  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check if the type exists
      const existingType = await trx('interaction_types')
        .where({ type_id: typeId, tenant: tenant })
        .first();

      if (!existingType) {
        throw new Error('Interaction type not found or not authorized');
      }

      // Extract only allowed fields from data
      const { type_name, icon, display_order } = data;
      const updateData: any = {};

      if (type_name !== undefined) updateData.type_name = type_name;
      if (icon !== undefined) updateData.icon = icon;
      if (display_order !== undefined) updateData.display_order = display_order;

      const [updatedType] = await trx('interaction_types')
        .where({ type_id: typeId, tenant: tenant })
        .update(updateData)
        .returning('*');

      return updatedType;
    });
  } catch (error) {
    console.error('Error updating interaction type:', error);
    throw new Error('Failed to update interaction type');
  }
});

export const deleteInteractionType = withAuth(async (_user, { tenant }, typeId: string): Promise<void> => {
  try {
    const { knex: db } = await createTenantKnex();

    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check if the type exists
      const typeToDelete = await trx('interaction_types')
        .where({ type_id: typeId, tenant: tenant })
        .first();

      if (!typeToDelete) {
        throw new Error('Interaction type not found or not authorized');
      }

      // Check for existing records
      const existingRecords = await trx('interactions')
        .where({
          type_id: typeId,
          tenant: tenant
        })
        .first();

      if (existingRecords) {
        throw new Error('Cannot delete interaction type: records exist that use this type');
      }

      const deletedCount = await trx('interaction_types')
        .where({ type_id: typeId, tenant: tenant })
        .delete();

      if (deletedCount === 0) {
        throw new Error('Interaction type not found or not authorized');
      }
    });
  } catch (error) {
    console.error('Error deleting interaction type:', error);
    throw error; // Throw the original error to preserve the message
  }
});

export const getInteractionTypeById = withAuth(async (
  _user,
  { tenant },
  typeId: string
): Promise<IInteractionType | null> => {
  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const type = await trx('interaction_types')
        .where({ type_id: typeId, tenant: tenant })
        .first();

      if (!type) {
        // If not found in tenant types, check system types
        const systemType = await getSystemInteractionTypeById(typeId);
        return systemType;
      }

      return type;
    });
  } catch (error) {
    console.error('Error fetching interaction type:', error);
    throw new Error('Failed to fetch interaction type');
  }
});
