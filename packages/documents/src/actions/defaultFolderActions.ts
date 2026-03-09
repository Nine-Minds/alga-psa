'use server';

import { randomUUID } from 'crypto';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

// ── Types ────────────────────────────────────────────────────────────

export interface IDefaultFolder {
  default_folder_id: string;
  tenant: string;
  entity_type: string;
  folder_path: string;
  folder_name: string;
  is_client_visible: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

export interface IDefaultFolderInput {
  folderPath: string;
  isClientVisible?: boolean;
  sortOrder?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function normalizePath(path: string): string {
  const segments = path.trim().split('/').filter(Boolean);
  if (segments.length === 0 || !path.trim().startsWith('/')) {
    throw new Error(`Invalid folder path: "${path}" (must start with / and have at least one segment)`);
  }
  return `/${segments.join('/')}`;
}

function folderNameFromPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1];
}

// ── Actions ──────────────────────────────────────────────────────────

/**
 * Get default folders, optionally filtered by entity type.
 */
export const getDefaultFolders = withAuth(async (
  user,
  { tenant },
  entityType?: string | null
): Promise<IDefaultFolder[] | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'read'))) {
    return permissionError('Permission denied');
  }

  const { knex } = await createTenantKnex();
  const query = knex('document_default_folders').where('tenant', tenant);

  if (entityType) {
    query.andWhere('entity_type', entityType);
  }

  return await query.select('*').orderBy([
    { column: 'entity_type', order: 'asc' },
    { column: 'sort_order', order: 'asc' },
    { column: 'folder_path', order: 'asc' },
  ]) as IDefaultFolder[];
});

/**
 * Save default folders for an entity type (replaces all existing).
 */
export const saveDefaultFolders = withAuth(async (
  user,
  { tenant },
  entityType: string,
  items: IDefaultFolderInput[]
): Promise<IDefaultFolder[] | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'create'))) {
    return permissionError('Permission denied');
  }

  const type = entityType.trim().toLowerCase();
  if (!type) throw new Error('Entity type is required');

  const now = new Date();
  const { knex } = await createTenantKnex();

  // Validate and normalize paths
  const seenPaths = new Set<string>();
  const rows = items.map((item, index) => {
    const path = normalizePath(item.folderPath);
    if (seenPaths.has(path)) throw new Error(`Duplicate folder path: ${path}`);
    seenPaths.add(path);

    return {
      tenant,
      default_folder_id: randomUUID(),
      entity_type: type,
      folder_path: path,
      folder_name: folderNameFromPath(path),
      is_client_visible: Boolean(item.isClientVisible),
      sort_order: typeof item.sortOrder === 'number' ? item.sortOrder : index,
      created_at: now,
      updated_at: now,
      created_by: user.user_id,
      updated_by: user.user_id,
    };
  });

  return withTransaction(knex, async (trx) => {
    await trx('document_default_folders').where({ tenant, entity_type: type }).del();

    if (rows.length > 0) {
      await trx('document_default_folders').insert(rows);
    }

    return await trx('document_default_folders')
      .where({ tenant, entity_type: type })
      .orderBy('sort_order', 'asc')
      .orderBy('folder_path', 'asc') as IDefaultFolder[];
  });
});

/**
 * Remove all default folders for an entity type.
 */
export const removeDefaultFolders = withAuth(async (
  user,
  { tenant },
  entityType: string
): Promise<number | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'delete'))) {
    return permissionError('Permission denied');
  }

  const { knex } = await createTenantKnex();
  return await knex('document_default_folders')
    .where({ tenant, entity_type: entityType.trim().toLowerCase() })
    .del();
});

// ── Suggested defaults ───────────────────────────────────────────────

interface ISuggestedDefault {
  entityType: string;
  items: IDefaultFolderInput[];
}

const SUGGESTED_DEFAULTS: ISuggestedDefault[] = [
  {
    entityType: 'client',
    items: [
      { folderPath: '/Logos', sortOrder: 0, isClientVisible: false },
      { folderPath: '/Contracts', sortOrder: 1, isClientVisible: true },
      { folderPath: '/Contracts/SLAs', sortOrder: 2, isClientVisible: true },
      { folderPath: '/Invoices', sortOrder: 3, isClientVisible: true },
      { folderPath: '/Onboarding', sortOrder: 4, isClientVisible: true },
      { folderPath: '/Technical', sortOrder: 5, isClientVisible: false },
      { folderPath: '/Technical/Runbooks', sortOrder: 6, isClientVisible: false },
      { folderPath: '/Meeting Notes', sortOrder: 7, isClientVisible: true },
    ],
  },
  {
    entityType: 'ticket',
    items: [
      { folderPath: '/Attachments', sortOrder: 0, isClientVisible: false },
      { folderPath: '/Screenshots', sortOrder: 1, isClientVisible: false },
    ],
  },
  {
    entityType: 'project_task',
    items: [
      { folderPath: '/Deliverables', sortOrder: 0, isClientVisible: false },
      { folderPath: '/Specifications', sortOrder: 1, isClientVisible: false },
      { folderPath: '/Reference', sortOrder: 2, isClientVisible: false },
    ],
  },
  {
    entityType: 'contract',
    items: [
      { folderPath: '/Agreement', sortOrder: 0, isClientVisible: false },
      { folderPath: '/Amendments', sortOrder: 1, isClientVisible: false },
      { folderPath: '/Terms', sortOrder: 2, isClientVisible: false },
    ],
  },
  {
    entityType: 'asset',
    items: [
      { folderPath: '/Manuals', sortOrder: 0, isClientVisible: false },
      { folderPath: '/Configuration', sortOrder: 1, isClientVisible: false },
      { folderPath: '/Licenses', sortOrder: 2, isClientVisible: false },
    ],
  },
  {
    entityType: 'contact',
    items: [
      { folderPath: '/Avatars', sortOrder: 0, isClientVisible: false },
    ],
  },
];

/**
 * Load suggested defaults for entity types that don't have any yet.
 */
export const loadSuggestedDefaults = withAuth(async (
  user,
  { tenant }
): Promise<number | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'create'))) {
    return permissionError('Permission denied');
  }

  const { knex } = await createTenantKnex();

  const existing = await knex('document_default_folders')
    .where('tenant', tenant)
    .select('entity_type')
    .groupBy('entity_type');

  const existingTypes = new Set(existing.map((r: { entity_type: string }) => r.entity_type));
  const toCreate = SUGGESTED_DEFAULTS.filter(d => !existingTypes.has(d.entityType));

  if (toCreate.length === 0) return 0;

  const now = new Date();

  return withTransaction(knex, async (trx) => {
    for (const def of toCreate) {
      const seenPaths = new Set<string>();
      const rows = def.items.map((item, index) => {
        const path = normalizePath(item.folderPath);
        if (seenPaths.has(path)) throw new Error(`Duplicate folder path: ${path}`);
        seenPaths.add(path);

        return {
          tenant,
          default_folder_id: randomUUID(),
          entity_type: def.entityType,
          folder_path: path,
          folder_name: folderNameFromPath(path),
          is_client_visible: Boolean(item.isClientVisible),
          sort_order: typeof item.sortOrder === 'number' ? item.sortOrder : index,
          created_at: now,
          updated_at: now,
          created_by: user.user_id,
          updated_by: user.user_id,
        };
      });

      if (rows.length > 0) {
        await trx('document_default_folders').insert(rows);
      }
    }

    return toCreate.length;
  });
});
