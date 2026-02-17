import type { Knex } from 'knex';
import type { DeletionValidationResult, DeletionBlockCode } from '@alga-psa/types';
import { getDeletionConfig } from '../../config/deletion';
import { validateDeletion } from './deletionValidation';

function buildUnknownEntity(entityType: string): DeletionValidationResult {
  return {
    canDelete: false,
    code: 'UNKNOWN_ENTITY',
    message: `Unknown entity type: ${entityType}`,
    dependencies: [],
    alternatives: []
  };
}

export async function deleteEntityWithValidation(
  entityType: string,
  entityId: string,
  knex: Knex,
  tenant: string,
  performDelete: (trx: Knex.Transaction, tenant: string) => Promise<void>
): Promise<DeletionValidationResult & { deleted?: boolean }> {
  const config = getDeletionConfig(entityType);
  if (!config) {
    return buildUnknownEntity(entityType);
  }

  return knex.transaction(async (trx) => {
    const validation = await validateDeletion(trx, config, entityId, tenant);

    if (!validation.canDelete) {
      return validation;
    }

    await performDelete(trx, tenant);

    return { ...validation, deleted: true };
  });
}

export async function validateBulkDeletion(
  entityType: string,
  entityIds: string[],
  knex: Knex,
  tenant: string
): Promise<{
  canDeleteAll: boolean;
  canDelete: Array<{ entityId: string; validation: DeletionValidationResult }>;
  cannotDelete: Array<{ entityId: string; validation: DeletionValidationResult }>;
  code?: DeletionBlockCode;
  message?: string;
}> {
  const config = getDeletionConfig(entityType);
  if (!config) {
    return {
      canDeleteAll: false,
      canDelete: [],
      cannotDelete: [],
      code: 'UNKNOWN_ENTITY',
      message: `Unknown entity type: ${entityType}`
    };
  }

  const results = await knex.transaction(async (trx) => {
    const canDelete: Array<{ entityId: string; validation: DeletionValidationResult }> = [];
    const cannotDelete: Array<{ entityId: string; validation: DeletionValidationResult }> = [];

    for (const entityId of entityIds) {
      const validation = await validateDeletion(trx, config, entityId, tenant);
      if (validation.canDelete) {
        canDelete.push({ entityId, validation });
      } else {
        cannotDelete.push({ entityId, validation });
      }
    }

    return { canDelete, cannotDelete };
  });

  return {
    canDeleteAll: results.cannotDelete.length === 0,
    canDelete: results.canDelete,
    cannotDelete: results.cannotDelete
  };
}
