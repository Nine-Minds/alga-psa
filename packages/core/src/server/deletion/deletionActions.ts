'use server';

import type { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { getCurrentUser, hasPermission } from '@alga-psa/auth';
import { deleteEntityTags } from '@alga-psa/tags/lib/tagCleanup';
import type { DeletionValidationResult, DeletionBlockCode } from '@alga-psa/types';
import type { TaggedEntityType } from '@alga-psa/types';
import { getDeletionConfig } from '../../config/deletion';
import { validateDeletion } from './deletionValidation';

function buildPermissionDenied(message: string): DeletionValidationResult {
  return {
    canDelete: false,
    code: 'PERMISSION_DENIED',
    message,
    dependencies: [],
    alternatives: []
  };
}

function buildUnknownEntity(entityType: string): DeletionValidationResult {
  return {
    canDelete: false,
    code: 'UNKNOWN_ENTITY',
    message: `Unknown entity type: ${entityType}`,
    dependencies: [],
    alternatives: []
  };
}

function permissionEntityFor(entityType: string): string {
  return entityType === 'client' ? 'company' : entityType;
}

export async function preCheckDeletion(
  entityType: string,
  entityId: string
): Promise<DeletionValidationResult> {
  const user = await getCurrentUser();

  if (!user) {
    return buildPermissionDenied('You must be logged in to perform this action.');
  }

  const config = getDeletionConfig(entityType);
  if (!config) {
    return buildUnknownEntity(entityType);
  }

  const canDelete = await hasPermission(user, permissionEntityFor(entityType), 'delete');
  if (!canDelete) {
    return buildPermissionDenied(`You don't have permission to delete ${entityType} records.`);
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return {
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: 'Tenant context is missing for deletion validation.',
      dependencies: [],
      alternatives: []
    };
  }

  return withTransaction(knex, async (trx) => validateDeletion(trx, config, entityId, tenant));
}

export async function deleteEntityWithValidation(
  entityType: string,
  entityId: string,
  performDelete: (trx: Knex.Transaction, tenant: string) => Promise<void>
): Promise<DeletionValidationResult & { deleted?: boolean }> {
  const user = await getCurrentUser();

  if (!user) {
    return buildPermissionDenied('You must be logged in to perform this action.');
  }

  const config = getDeletionConfig(entityType);
  if (!config) {
    return buildUnknownEntity(entityType);
  }

  const canDelete = await hasPermission(user, permissionEntityFor(entityType), 'delete');
  if (!canDelete) {
    return buildPermissionDenied(`You don't have permission to delete ${entityType} records.`);
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return {
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: 'Tenant context is missing for deletion validation.',
      dependencies: [],
      alternatives: []
    };
  }

  return withTransaction(knex, async (trx) => {
    const validation = await validateDeletion(trx, config, entityId, tenant);

    if (!validation.canDelete) {
      return validation;
    }

    if (config.tagEntityType) {
      await deleteEntityTags(trx, entityId, config.tagEntityType as TaggedEntityType);
    }

    await performDelete(trx, tenant);

    return { ...validation, deleted: true };
  });
}

export async function validateBulkDeletion(
  entityType: string,
  entityIds: string[]
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

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return {
      canDeleteAll: false,
      canDelete: [],
      cannotDelete: [],
      code: 'VALIDATION_FAILED',
      message: 'Tenant context is missing for deletion validation.'
    };
  }

  const results = await withTransaction(knex, async (trx) => {
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
