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
      { folderPath: '/Clients', sortOrder: 0, isClientVisible: false },
      { folderPath: '/Clients/Logos', sortOrder: 1, isClientVisible: false },
      { folderPath: '/Clients/Contracts', sortOrder: 2, isClientVisible: true },
      { folderPath: '/Clients/Contracts/SLAs', sortOrder: 3, isClientVisible: true },
      { folderPath: '/Clients/Invoices', sortOrder: 4, isClientVisible: true },
      { folderPath: '/Clients/Onboarding', sortOrder: 5, isClientVisible: true },
      { folderPath: '/Clients/Technical', sortOrder: 6, isClientVisible: false },
      { folderPath: '/Clients/Technical/Runbooks', sortOrder: 7, isClientVisible: false },
      { folderPath: '/Clients/Meeting Notes', sortOrder: 8, isClientVisible: true },
    ],
  },
  {
    entityType: 'contact',
    items: [
      { folderPath: '/Contacts', sortOrder: 0, isClientVisible: false },
      { folderPath: '/Contacts/Avatars', sortOrder: 1, isClientVisible: false },
      { folderPath: '/Contacts/Correspondence', sortOrder: 2, isClientVisible: false },
      { folderPath: '/Contacts/Agreements', sortOrder: 3, isClientVisible: false },
      { folderPath: '/Contacts/Notes', sortOrder: 4, isClientVisible: false },
    ],
  },
  {
    entityType: 'ticket',
    items: [
      { folderPath: '/Tickets', sortOrder: 0, isClientVisible: false },
      { folderPath: '/Tickets/Attachments', sortOrder: 1, isClientVisible: false },
      { folderPath: '/Tickets/Screenshots', sortOrder: 2, isClientVisible: false },
    ],
  },
  {
    entityType: 'project_task',
    items: [
      { folderPath: '/Tasks', sortOrder: 0, isClientVisible: false },
      { folderPath: '/Tasks/Deliverables', sortOrder: 1, isClientVisible: false },
      { folderPath: '/Tasks/Specifications', sortOrder: 2, isClientVisible: false },
      { folderPath: '/Tasks/Reference', sortOrder: 3, isClientVisible: false },
    ],
  },
  {
    entityType: 'contract',
    items: [
      { folderPath: '/Contracts', sortOrder: 0, isClientVisible: false },
      { folderPath: '/Contracts/Agreement', sortOrder: 1, isClientVisible: false },
      { folderPath: '/Contracts/Amendments', sortOrder: 2, isClientVisible: false },
      { folderPath: '/Contracts/Terms', sortOrder: 3, isClientVisible: false },
    ],
  },
  {
    entityType: 'asset',
    items: [
      { folderPath: '/Assets', sortOrder: 0, isClientVisible: false },
      { folderPath: '/Assets/Manuals', sortOrder: 1, isClientVisible: false },
      { folderPath: '/Assets/Configuration', sortOrder: 2, isClientVisible: false },
      { folderPath: '/Assets/Licenses', sortOrder: 3, isClientVisible: false },
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
