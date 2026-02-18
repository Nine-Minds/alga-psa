'use server';

import type { DeletionValidationResult } from '@alga-psa/types';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { getDeletionConfig, validateDeletion } from '@alga-psa/core';
import { getCurrentUser } from './getCurrentUser';
import { hasPermission } from './rbac';

function buildPermissionDenied(message: string): DeletionValidationResult {
  return {
    canDelete: false,
    code: 'PERMISSION_DENIED' as const,
    message,
    dependencies: [],
    alternatives: []
  };
}

function permissionEntityFor(entityType: string): string {
  if (entityType === 'client') return 'company';
  if (entityType === 'schedule_entry') return 'user_schedule';
  if (entityType === 'survey_template') return 'settings';
  if (entityType === 'role') return 'security_settings';
  return entityType;
}

function permissionActionFor(entityType: string): string {
  if (entityType === 'workflow') return 'manage';
  return 'delete';
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
    return {
      canDelete: false,
      code: 'UNKNOWN_ENTITY' as const,
      message: `Unknown entity type: ${entityType}`,
      dependencies: [],
      alternatives: []
    };
  }

  const canDelete = await hasPermission(user, permissionEntityFor(entityType), permissionActionFor(entityType));
  if (!canDelete) {
    return buildPermissionDenied(`You don't have permission to delete ${entityType} records.`);
  }

  const { knex, tenant } = await createTenantKnex(user.tenant);
  if (!tenant) {
    return {
      canDelete: false,
      code: 'VALIDATION_FAILED' as const,
      message: 'Tenant context is missing for deletion validation.',
      dependencies: [],
      alternatives: []
    };
  }

  return withTransaction(knex, async (trx) => validateDeletion(trx, config, entityId, tenant));
}
