'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export interface IDocumentFolderTemplate {
  template_id: string;
  tenant: string;
  name: string;
  entity_type: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

/**
 * Returns document folder templates, optionally filtered by entity type.
 */
export const getFolderTemplates = withAuth(async (
  user,
  { tenant },
  entityType?: string | null
): Promise<IDocumentFolderTemplate[] | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'read'))) {
    return permissionError('Permission denied');
  }

  const { knex } = await createTenantKnex();

  const query = knex('document_folder_templates')
    .where('tenant', tenant);

  if (entityType) {
    query.andWhere('entity_type', entityType);
  }

  const templates = await query
    .select(
      'template_id',
      'tenant',
      'name',
      'entity_type',
      'is_default',
      'created_at',
      'updated_at',
      'created_by',
      'updated_by'
    )
    .orderBy([
      { column: 'entity_type', order: 'asc' },
      { column: 'is_default', order: 'desc' },
      { column: 'name', order: 'asc' },
    ]);

  return templates as IDocumentFolderTemplate[];
});

