'use server';

import { randomUUID } from 'crypto';
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

export interface ICreateFolderTemplateItemInput {
  folderName?: string;
  folderPath: string;
  sortOrder?: number;
  isClientVisible?: boolean;
}

export interface ICreateFolderTemplateInput {
  name: string;
  entityType: string;
  isDefault?: boolean;
  items?: ICreateFolderTemplateItemInput[];
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

function normalizePath(path: string): string {
  const trimmedPath = path.trim();

  if (!trimmedPath.startsWith('/')) {
    throw new Error('Template item folderPath must start with /');
  }

  const segments = trimmedPath
    .split('/')
    .filter(Boolean);

  if (segments.length === 0) {
    throw new Error('Template item folderPath is invalid');
  }

  return `/${segments.join('/')}`;
}

function getFolderNameFromPath(path: string): string {
  const normalizedPath = normalizePath(path);
  const segments = normalizedPath.split('/').filter(Boolean);
  return segments[segments.length - 1];
}

function getParentPath(path: string): string | null {
  const normalizedPath = normalizePath(path);
  const segments = normalizedPath.split('/').filter(Boolean);

  if (segments.length <= 1) {
    return null;
  }

  return `/${segments.slice(0, -1).join('/')}`;
}

function normalizeTemplateName(name: string): string {
  const templateName = name.trim();
  if (!templateName) {
    throw new Error('Template name is required');
  }

  return templateName;
}

function normalizeEntityType(entityType: string): string {
  const normalized = entityType.trim().toLowerCase();
  if (!normalized) {
    throw new Error('entityType is required');
  }

  return normalized;
}

function normalizeTemplateItems(items: ICreateFolderTemplateItemInput[]): Array<{
  folder_name: string;
  folder_path: string;
  sort_order: number;
  is_client_visible: boolean;
  parent_path: string | null;
}> {
  const normalizedItems = items.map((item, index) => {
    const normalizedPath = normalizePath(item.folderPath);
    const folderName = item.folderName?.trim() || getFolderNameFromPath(normalizedPath);

    return {
      folder_name: folderName,
      folder_path: normalizedPath,
      sort_order: typeof item.sortOrder === 'number' ? item.sortOrder : index,
      is_client_visible: Boolean(item.isClientVisible),
      parent_path: getParentPath(normalizedPath),
    };
  });

  const seenPaths = new Set<string>();
  for (const item of normalizedItems) {
    if (seenPaths.has(item.folder_path)) {
      throw new Error(`Duplicate template item folderPath: ${item.folder_path}`);
    }
    seenPaths.add(item.folder_path);
  }

  for (const item of normalizedItems) {
    if (item.parent_path && !seenPaths.has(item.parent_path)) {
      throw new Error(`Template item parent path not found: ${item.parent_path}`);
    }
  }

  return normalizedItems;
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

/**
 * Creates a document folder template and its item tree.
 */
export const createFolderTemplate = withAuth(async (
  user,
  { tenant },
  data: ICreateFolderTemplateInput
): Promise<IDocumentFolderTemplateWithItems | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'create'))) {
    return permissionError('Permission denied');
  }

  if (!data) {
    throw new Error('Template data is required');
  }

  const { knex } = await createTenantKnex();

  const templateName = normalizeTemplateName(data.name);
  const entityType = normalizeEntityType(data.entityType);
  const normalizedItems = normalizeTemplateItems(data.items ?? []);
  const isDefault = Boolean(data.isDefault);
  const now = new Date();

  return knex.transaction(async (trx) => {
    if (isDefault) {
      await trx('document_folder_templates')
        .where('tenant', tenant)
        .andWhere('entity_type', entityType)
        .update({
          is_default: false,
          updated_at: now,
          updated_by: user.user_id,
        });
    }

    const insertedTemplates = await trx('document_folder_templates')
      .insert({
        tenant,
        name: templateName,
        entity_type: entityType,
        is_default: isDefault,
        created_by: user.user_id,
        updated_by: user.user_id,
      })
      .returning([...TEMPLATE_SELECT_COLUMNS]);

    const template = insertedTemplates[0] as IDocumentFolderTemplate | undefined;
    if (!template) {
      throw new Error('Failed to create folder template');
    }

    if (normalizedItems.length === 0) {
      return {
        ...template,
        items: [],
      };
    }

    const sortedItems = [...normalizedItems].sort((left, right) => {
      const leftDepth = left.folder_path.split('/').filter(Boolean).length;
      const rightDepth = right.folder_path.split('/').filter(Boolean).length;

      if (leftDepth !== rightDepth) {
        return leftDepth - rightDepth;
      }

      if (left.sort_order !== right.sort_order) {
        return left.sort_order - right.sort_order;
      }

      return left.folder_path.localeCompare(right.folder_path);
    });

    const pathToItemId = new Map<string, string>();
    const itemRows = sortedItems.map((item) => {
      const templateItemId = randomUUID();
      pathToItemId.set(item.folder_path, templateItemId);

      return {
        tenant,
        template_item_id: templateItemId,
        template_id: template.template_id,
        parent_template_item_id: item.parent_path ? pathToItemId.get(item.parent_path) ?? null : null,
        folder_name: item.folder_name,
        folder_path: item.folder_path,
        sort_order: item.sort_order,
        is_client_visible: item.is_client_visible,
        created_at: now,
        updated_at: now,
        created_by: user.user_id,
        updated_by: user.user_id,
      };
    });

    await trx('document_folder_template_items').insert(itemRows);

    const insertedItems = await trx('document_folder_template_items')
      .where('tenant', tenant)
      .andWhere('template_id', template.template_id)
      .select(...TEMPLATE_ITEM_SELECT_COLUMNS)
      .orderBy([
        { column: 'sort_order', order: 'asc' },
        { column: 'folder_path', order: 'asc' },
      ]);

    return {
      ...template,
      items: insertedItems as IDocumentFolderTemplateItem[],
    };
  });
});
