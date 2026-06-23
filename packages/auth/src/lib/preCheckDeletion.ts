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
  if (entityType === 'schedule_entry') return 'user_schedule';
  if (entityType === 'survey_template') return 'settings';
  if (entityType === 'status') return 'settings';
  if (entityType === 'role') return 'security_settings';
  if (entityType === 'invoice_template') return 'invoice';
  if (entityType === 'tax_rate') return 'billing';
  if (entityType === 'priority') return 'ticket_settings';
  if (entityType === 'category') return 'ticket_settings';
  if (entityType === 'board') return 'ticket_settings';
  if (entityType === 'contract_line') return 'billing';
  if (entityType === 'team') return 'settings';
  // Interaction types are managed as portal settings; deleteInteractionType gates
  // on settings:update. Without this mapping the check falls through to a
  // non-existent 'interaction_type' resource and denies everyone (incl. Admin).
  if (entityType === 'interaction_type') return 'settings';
  // Quote deletion is a billing operation (deleteQuote requires billing:delete).
  if (entityType === 'quote') return 'billing';
  // The permission resource is 'timeentry' (no underscore); the deletion-config
  // key is 'time_entry'. Map it so the check resolves to the real resource.
  if (entityType === 'time_entry') return 'timeentry';
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

  return withTransaction(knex, async (trx) => {
    let permission = {
      resource: permissionEntityFor(entityType),
      action: permissionActionFor(entityType)
    };

    if (entityType === 'status') {
      const status = await trx('statuses')
        .select('status_type')
        .where({
          tenant,
          status_id: entityId
        })
        .first<{ status_type?: string }>();

      if (status?.status_type === 'project' || status?.status_type === 'project_task') {
        permission = { resource: 'project', action: 'update' };
      }
    }

    const canDelete = await hasPermission(user, permission.resource, permission.action, trx);
    if (!canDelete) {
      return buildPermissionDenied(`You don't have permission to delete ${entityType} records.`);
    }

    return validateDeletion(trx, config, entityId, tenant);
  });
}
