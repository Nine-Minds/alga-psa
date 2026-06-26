// src/lib/actions/interactionTypeActions.ts

'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { IInteractionType, ISystemInteractionType, DeletionValidationResult } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
import { assertMspPermission } from '../lib/authHelpers';

type InteractionTypeRow = IInteractionType & {
  created_by?: string;
};

export const getAllInteractionTypes = withAuth(async (user, { tenant }): Promise<IInteractionType[]> => {
  await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interaction types');

  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get only tenant-specific interaction types
      const tenantTypes = await tenantDb(trx, tenant).table<InteractionTypeRow>('interaction_types')
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

export const getSystemInteractionTypes = withAuth(async (user, { tenant }): Promise<ISystemInteractionType[]> => {
  await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interaction types');

  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table<ISystemInteractionType>('system_interaction_types')
        .select('*')
        .orderBy('type_name');
    });
  } catch (error) {
    console.error('Error fetching system interaction types:', error);
    throw new Error('Failed to fetch system interaction types');
  }
});

export const getSystemInteractionTypeById = withAuth(async (
  user,
  { tenant },
  typeId: string
): Promise<ISystemInteractionType | null> => {
  await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interaction types');

  try {
    const { knex: db } = await createTenantKnex();

    const type = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table<ISystemInteractionType>('system_interaction_types')
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
  await assertMspPermission(user, 'settings', 'update', 'Permission denied: Cannot manage interaction type settings');

  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Extract only the allowed fields from interactionType
      const { type_name, icon, display_order } = interactionType;

      // If no display_order provided, get the next available order
      let finalDisplayOrder = display_order;
      if (finalDisplayOrder === undefined || finalDisplayOrder === null) {
        const maxOrder = await tenantDb(trx, tenant).table<any>('interaction_types')
          .max('display_order as max')
          .first();
        finalDisplayOrder = (maxOrder?.max || 0) + 1;
      }

      const [newType] = await tenantDb(trx, tenant).table<InteractionTypeRow>('interaction_types')
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
  user,
  { tenant },
  typeId: string,
  data: Partial<Omit<IInteractionType, 'type_id' | 'tenant'>>
): Promise<IInteractionType> => {
  await assertMspPermission(user, 'settings', 'update', 'Permission denied: Cannot manage interaction type settings');

  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check if the type exists
      const existingType = await tenantDb(trx, tenant).table<InteractionTypeRow>('interaction_types')
        .where({ type_id: typeId })
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

      const [updatedType] = await tenantDb(trx, tenant).table<InteractionTypeRow>('interaction_types')
        .where({ type_id: typeId })
        .update(updateData)
        .returning('*');

      return updatedType;
    });
  } catch (error) {
    console.error('Error updating interaction type:', error);
    throw new Error('Failed to update interaction type');
  }
});

export const deleteInteractionType = withAuth(async (
  user,
  { tenant },
  typeId: string
): Promise<DeletionValidationResult & { deleted?: boolean }> => {
  await assertMspPermission(user, 'settings', 'update', 'Permission denied: Cannot manage interaction type settings');

  try {
    const { knex } = await createTenantKnex();
    return await deleteEntityWithValidation('interaction_type', typeId, knex, tenant, async (trx, tenantId) => {
      const deletedCount = await tenantDb(trx, tenantId).table<InteractionTypeRow>('interaction_types')
        .where({ type_id: typeId })
        .delete();

      if (deletedCount === 0) {
        throw new Error('Interaction type not found or not authorized');
      }
    });
  } catch (error) {
    console.error('Error deleting interaction type:', error);
    throw error;
  }
});

export const getInteractionTypeById = withAuth(async (
  user,
  { tenant },
  typeId: string
): Promise<IInteractionType | null> => {
  await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interaction types');

  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const type = await tenantDb(trx, tenant).table<InteractionTypeRow>('interaction_types')
        .where({ type_id: typeId })
        .first();

      if (!type) {
        // If not found in tenant types, check system types
        const systemType = await getSystemInteractionTypeById(typeId);
        return systemType as IInteractionType | null;
      }

      return type;
    });
  } catch (error) {
    console.error('Error fetching interaction type:', error);
    throw new Error('Failed to fetch interaction type');
  }
});
