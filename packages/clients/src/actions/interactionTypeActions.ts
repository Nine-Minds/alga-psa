// src/lib/actions/interactionTypeActions.ts

'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { IInteractionType, ISystemInteractionType, DeletionValidationResult } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
import { assertMspPermission } from '../lib/authHelpers';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type InteractionTypeRow = IInteractionType & {
  created_by?: string;
};

type InteractionTypeActionError = ActionMessageError | ActionPermissionError;

function interactionTypeActionErrorFrom(error: unknown): InteractionTypeActionError | null {
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes('Permission denied:')) {
      return permissionError(message);
    }
    if (message === 'Interaction type not found or not authorized') {
      return actionError('Interaction type not found or you do not have access to it.');
    }
    if (message === 'Interaction type name is required') {
      return actionError(message);
    }
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '23502') {
    return actionError(`Missing required interaction type field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('Referenced interaction type data is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('An interaction type with these details already exists.');
  }
  if (dbError?.code === '23514') {
    return actionError('Invalid interaction type data provided. Please check the name, icon, and display order.');
  }

  return null;
}

export const getAllInteractionTypes = withAuth(async (user, { tenant }): Promise<IInteractionType[] | InteractionTypeActionError> => {

  try {
    await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interaction types');

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
    const expected = interactionTypeActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching interaction types:', error);
    throw error;
  }
});

export const getSystemInteractionTypes = withAuth(async (user, { tenant }): Promise<ISystemInteractionType[] | InteractionTypeActionError> => {

  try {
    await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interaction types');

    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table<ISystemInteractionType>('system_interaction_types')
        .select('*')
        .orderBy('type_name');
    });
  } catch (error) {
    const expected = interactionTypeActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching system interaction types:', error);
    throw error;
  }
});

export const getSystemInteractionTypeById = withAuth(async (
  user,
  { tenant },
  typeId: string
): Promise<ISystemInteractionType | null | InteractionTypeActionError> => {

  try {
    await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interaction types');

    const { knex: db } = await createTenantKnex();

    const type = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table<ISystemInteractionType>('system_interaction_types')
        .where({ type_id: typeId })
        .first();
    });
    return type || null;
  } catch (error) {
    const expected = interactionTypeActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching system interaction type:', error);
    throw error;
  }
});

export const createInteractionType = withAuth(async (
  user,
  { tenant },
  interactionType: Omit<IInteractionType, 'type_id' | 'tenant'>
): Promise<IInteractionType | InteractionTypeActionError> => {

  try {
    await assertMspPermission(user, 'settings', 'update', 'Permission denied: Cannot manage interaction type settings');

    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Extract only the allowed fields from interactionType
      const { icon, display_order } = interactionType;
      const type_name = interactionType.type_name?.trim();
      if (!type_name) {
        throw new Error('Interaction type name is required');
      }

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
    const expected = interactionTypeActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error creating interaction type:', error);
    throw error;
  }
});

export const updateInteractionType = withAuth(async (
  user,
  { tenant },
  typeId: string,
  data: Partial<Omit<IInteractionType, 'type_id' | 'tenant'>>
): Promise<IInteractionType | InteractionTypeActionError> => {

  try {
    await assertMspPermission(user, 'settings', 'update', 'Permission denied: Cannot manage interaction type settings');

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

      if (type_name !== undefined) {
        const trimmedTypeName = type_name.trim();
        if (!trimmedTypeName) {
          throw new Error('Interaction type name is required');
        }
        updateData.type_name = trimmedTypeName;
      }
      if (icon !== undefined) updateData.icon = icon;
      if (display_order !== undefined) updateData.display_order = display_order;

      const [updatedType] = await tenantDb(trx, tenant).table<InteractionTypeRow>('interaction_types')
        .where({ type_id: typeId })
        .update(updateData)
        .returning('*');

      return updatedType;
    });
  } catch (error) {
    const expected = interactionTypeActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error updating interaction type:', error);
    throw error;
  }
});

export const deleteInteractionType = withAuth(async (
  user,
  { tenant },
  typeId: string
): Promise<(DeletionValidationResult & { deleted?: boolean }) | InteractionTypeActionError> => {

  try {
    await assertMspPermission(user, 'settings', 'update', 'Permission denied: Cannot manage interaction type settings');

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
    const expected = interactionTypeActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error deleting interaction type:', error);
    throw error;
  }
});

export const getInteractionTypeById = withAuth(async (
  user,
  { tenant },
  typeId: string
): Promise<IInteractionType | null | InteractionTypeActionError> => {

  try {
    await assertMspPermission(user, 'interaction', 'read', 'Permission denied: Cannot read interaction types');

    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const type = await tenantDb(trx, tenant).table<InteractionTypeRow>('interaction_types')
        .where({ type_id: typeId })
        .first();

      if (!type) {
        // If not found in tenant types, check system types
        const systemType = await tenantDb(trx, tenant).table<ISystemInteractionType>('system_interaction_types')
          .where({ type_id: typeId })
          .first();
        return systemType as IInteractionType | null;
      }

      return type;
    });
  } catch (error) {
    const expected = interactionTypeActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching interaction type:', error);
    throw error;
  }
});
