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

export interface IDocumentFolderTemplateItem {
  template_item_id: string;
  tenant: string;
  template_id: string;
  parent_template_item_id: string | null;
  folder_name: string;
  folder_path: string;
  sort_order: number;
  is_client_visible: boolean;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

export interface IDocumentFolderTemplateWithItems extends IDocumentFolderTemplate {
  items: IDocumentFolderTemplateItem[];
}

const TEMPLATE_SELECT_COLUMNS = [
  'template_id',
  'tenant',
  'name',
  'entity_type',
  'is_default',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
] as const;

const TEMPLATE_ITEM_SELECT_COLUMNS = [
  'template_item_id',
  'tenant',
  'template_id',
  'parent_template_item_id',
  'folder_name',
  'folder_path',
  'sort_order',
  'is_client_visible',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
] as const;

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
    .select(...TEMPLATE_SELECT_COLUMNS)
    .orderBy([
      { column: 'entity_type', order: 'asc' },
      { column: 'is_default', order: 'desc' },
      { column: 'name', order: 'asc' },
    ]);

  return templates as IDocumentFolderTemplate[];
});

/**
 * Returns a single document folder template with its template items.
 */
export const getFolderTemplate = withAuth(async (
  user,
  { tenant },
  templateId: string
): Promise<IDocumentFolderTemplateWithItems | null | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'read'))) {
    return permissionError('Permission denied');
  }

  if (!templateId) {
    throw new Error('templateId is required');
  }

  const { knex } = await createTenantKnex();

  const template = await knex('document_folder_templates')
    .where('tenant', tenant)
    .andWhere('template_id', templateId)
    .select(...TEMPLATE_SELECT_COLUMNS)
    .first();

  if (!template) {
    return null;
  }

  const items = await knex('document_folder_template_items')
    .where('tenant', tenant)
    .andWhere('template_id', templateId)
    .select(...TEMPLATE_ITEM_SELECT_COLUMNS)
    .orderBy([
      { column: 'sort_order', order: 'asc' },
      { column: 'folder_path', order: 'asc' },
    ]);

  return {
    ...(template as IDocumentFolderTemplate),
    items: items as IDocumentFolderTemplateItem[],
  };
});
