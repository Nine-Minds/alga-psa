'use server';

import type { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import logger from '@alga-psa/core/logger';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type {
  CreateListViewInput,
  IUser,
  ListViewCollection,
  ListViewSettings,
  ListViewSummary,
  ListViewVisibility,
  UpdateListViewInput,
} from '@alga-psa/types';
import {
  getListViewDefinition,
  migrateListViewSettings,
  type ListViewDefinition,
} from '../lib/registry';
import { normalizeListViewName } from '../lib/settingsSchema';
import { ListViewModel, type ListViewRowWithOwner } from '../models/listViewModel';

/**
 * Server actions for named list views.
 *
 * Rules (PRD §API):
 *  - Reading a list's views needs that list's read permission, MSP users only.
 *  - A private view is visible to its owner alone, and to everyone else it is
 *    indistinguishable from a view that does not exist — same error, same
 *    message, whether through a link, the picker or a direct action call.
 *  - Publishing (creating shared, or switching to shared) needs `list_view:share`.
 *  - Owners may always edit or delete their own views; editing or deleting
 *    someone else's *shared* view needs `list_view:manage`.
 *  - The personal default is always the session user's; no action takes a
 *    user id.
 */

type ListViewActionError = ActionMessageError | ActionPermissionError;

const NOT_FOUND_MESSAGE = 'This view is private or no longer exists.';

function notFound(): ListViewActionError {
  return actionError(NOT_FOUND_MESSAGE, 'common:listViews.errors.notFound');
}

function unknownList(): ListViewActionError {
  return actionError('Unknown list.', 'common:listViews.errors.unknownList');
}

function invalidName(): ListViewActionError {
  return actionError(
    'A view name must be between 1 and 100 characters.',
    'common:listViews.errors.invalidName',
  );
}

function duplicateName(name: string): ListViewActionError {
  return actionError(
    `You already have a view named "${name}" on this list.`,
    'common:listViews.errors.duplicateName',
    { name },
  );
}

function invalidSettings(detail: string): ListViewActionError {
  return actionError(
    `The view could not be saved: ${detail}`,
    'common:listViews.errors.invalidSettings',
    { detail },
  );
}

function invalidVisibility(): ListViewActionError {
  return actionError('Visibility must be private or shared.', 'common:listViews.errors.invalidVisibility');
}

function cannotShare(): ListViewActionError {
  return permissionError(
    'Permission denied: you cannot share views.',
    'common:listViews.errors.cannotShare',
  );
}

function cannotEdit(): ListViewActionError {
  return permissionError(
    'Permission denied: you cannot change this view.',
    'common:listViews.errors.cannotEdit',
  );
}

function cannotReadList(): ListViewActionError {
  return permissionError(
    'Permission denied: you cannot view this list.',
    'common:listViews.errors.cannotReadList',
  );
}

function isVisibility(value: unknown): value is ListViewVisibility {
  return value === 'private' || value === 'shared';
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function ownerName(row: ListViewRowWithOwner): string {
  return [row.owner_first_name, row.owner_last_name].filter(Boolean).join(' ').trim();
}

interface Capabilities {
  canShare: boolean;
  canManage: boolean;
}

async function loadCapabilities(user: IUser, trx: Knex.Transaction): Promise<Capabilities> {
  const [canShare, canManage] = await Promise.all([
    hasPermission(user, 'list_view', 'share', trx),
    hasPermission(user, 'list_view', 'manage', trx),
  ]);
  return { canShare, canManage };
}

function canEditRow(row: ListViewRowWithOwner, user: IUser, caps: Capabilities): boolean {
  if (row.owner_user_id === user.user_id) return true;
  return row.visibility === 'shared' && caps.canManage;
}

/** Only MSP users with the list's own read permission reach its views. */
async function canReadList(user: IUser, definition: ListViewDefinition, trx: Knex.Transaction): Promise<boolean> {
  if (user.user_type !== 'internal') return false;
  return hasPermission(user, definition.readPermission.resource, definition.readPermission.action, trx);
}

function toSummary(
  row: ListViewRowWithOwner,
  definition: ListViewDefinition,
  user: IUser,
  caps: Capabilities,
  defaultViewId: string | null,
): ListViewSummary {
  return {
    view_id: row.view_id,
    list_key: row.list_key,
    name: row.name,
    visibility: row.visibility,
    owner_user_id: row.owner_user_id,
    owner_name: ownerName(row),
    settings: migrateListViewSettings(definition, row.settings ?? {}, row.schema_version),
    schema_version: row.schema_version,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    isOwner: row.owner_user_id === user.user_id,
    canEdit: canEditRow(row, user, caps),
    isMyDefault: defaultViewId === row.view_id,
  };
}

// Callers narrow with `ok === false`, not `!ok`: the EE typecheck runs with
// strict off, where truthiness does not narrow a discriminated union.
function validateSettings(
  definition: ListViewDefinition,
  settings: unknown,
): { ok: true; settings: ListViewSettings } | { ok: false; error: ListViewActionError } {
  const parsed = definition.settingsSchema.safeParse(settings);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { ok: false, error: invalidSettings(detail) };
  }
  return { ok: true, settings: parsed.data as ListViewSettings };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export const listListViews = withAuth(async (
  user,
  { tenant },
  listKey: string,
): Promise<ListViewCollection | ListViewActionError> => {
  const definition = getListViewDefinition(listKey);
  if (!definition) return unknownList();

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    if (!(await canReadList(user, definition, trx))) return cannotReadList();

    const caps = await loadCapabilities(user, trx);
    const rows = await ListViewModel.listVisible(trx, tenant, definition.listKey, user.user_id);
    const storedDefault = await ListViewModel.getDefaultViewId(trx, tenant, user.user_id, definition.listKey);
    // A default that has since become invisible (deleted, or made private by
    // someone else) simply stops being a default.
    const defaultViewId = storedDefault && rows.some((row) => row.view_id === storedDefault) ? storedDefault : null;

    return {
      views: rows.map((row) => toSummary(row, definition, user, caps, defaultViewId)),
      defaultViewId,
      canShare: caps.canShare,
    };
  });
});

export const getListView = withAuth(async (
  user,
  { tenant },
  viewId: string,
): Promise<ListViewSummary | ListViewActionError> => {
  if (typeof viewId !== 'string' || viewId.length === 0) return notFound();

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const row = await findVisibleSafely(trx, tenant, viewId, user.user_id);
    if (!row) return notFound();

    const definition = getListViewDefinition(row.list_key);
    // A view on a list the caller cannot read is, for them, a view that does not exist.
    if (!definition || !(await canReadList(user, definition, trx))) return notFound();

    const caps = await loadCapabilities(user, trx);
    const defaultViewId = await ListViewModel.getDefaultViewId(trx, tenant, user.user_id, definition.listKey);
    return toSummary(row, definition, user, caps, defaultViewId);
  });
});

export const createListView = withAuth(async (
  user,
  { tenant },
  listKey: string,
  input: CreateListViewInput,
): Promise<ListViewSummary | ListViewActionError> => {
  const definition = getListViewDefinition(listKey);
  if (!definition) return unknownList();

  const name = normalizeListViewName(input?.name);
  if (!name) return invalidName();
  if (!isVisibility(input?.visibility)) return invalidVisibility();
  const validated = validateSettings(definition, input?.settings ?? {});
  if (validated.ok === false) return validated.error;

  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx) => {
      if (!(await canReadList(user, definition, trx))) return cannotReadList();
      const caps = await loadCapabilities(user, trx);
      if (input.visibility === 'shared' && !caps.canShare) return cannotShare();

      if (await ListViewModel.nameTaken(trx, tenant, {
        listKey: definition.listKey,
        ownerUserId: user.user_id,
        name,
      })) {
        return duplicateName(name);
      }

      const viewId = await ListViewModel.insert(trx, tenant, {
        list_key: definition.listKey,
        name,
        owner_user_id: user.user_id,
        visibility: input.visibility,
        settings: validated.settings,
        schema_version: definition.schemaVersion,
      });

      const row = await ListViewModel.findVisible(trx, tenant, viewId, user.user_id);
      if (!row) {
        throw new Error(`List view ${viewId} was not readable immediately after insert`);
      }
      const defaultViewId = await ListViewModel.getDefaultViewId(trx, tenant, user.user_id, definition.listKey);
      return toSummary(row, definition, user, caps, defaultViewId);
    });
  } catch (error) {
    // Two concurrent saves of the same name: the unique index is the arbiter.
    if (isUniqueViolation(error)) return duplicateName(name);
    throw error;
  }
});

export const updateListView = withAuth(async (
  user,
  { tenant },
  viewId: string,
  patch: UpdateListViewInput,
): Promise<ListViewSummary | ListViewActionError> => {
  if (typeof viewId !== 'string' || viewId.length === 0) return notFound();

  let name: string | undefined;
  if (patch?.name !== undefined) {
    const normalized = normalizeListViewName(patch.name);
    if (!normalized) return invalidName();
    name = normalized;
  }
  if (patch?.visibility !== undefined && !isVisibility(patch.visibility)) return invalidVisibility();

  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx) => {
      const row = await findVisibleSafely(trx, tenant, viewId, user.user_id);
      if (!row) return notFound();
      const definition = getListViewDefinition(row.list_key);
      if (!definition || !(await canReadList(user, definition, trx))) return notFound();

      const caps = await loadCapabilities(user, trx);
      if (!canEditRow(row, user, caps)) return cannotEdit();
      if (patch.visibility === 'shared' && row.visibility !== 'shared' && !caps.canShare) return cannotShare();

      let settings: ListViewSettings | undefined;
      if (patch.settings !== undefined) {
        const validated = validateSettings(definition, patch.settings);
        if (validated.ok === false) return validated.error;
        settings = validated.settings;
      }

      if (name !== undefined && await ListViewModel.nameTaken(trx, tenant, {
        listKey: definition.listKey,
        ownerUserId: row.owner_user_id,
        name,
        excludeViewId: row.view_id,
      })) {
        return duplicateName(name);
      }

      await ListViewModel.update(trx, tenant, row.view_id, {
        name,
        visibility: patch.visibility,
        settings,
        schema_version: settings ? definition.schemaVersion : undefined,
      });

      // Made private by someone other than the owner (an admin with manage):
      // every other user's default pointing at it stops resolving, so clear them.
      if (patch.visibility === 'private' && row.visibility === 'shared') {
        await ListViewModel.clearDefaultsPointingAt(trx, tenant, definition.listKey, row.view_id);
      }

      const updated = await ListViewModel.findVisible(trx, tenant, row.view_id, user.user_id);
      const defaultViewId = await ListViewModel.getDefaultViewId(trx, tenant, user.user_id, definition.listKey);
      if (!updated) {
        // An admin made someone else's view private: it has left the caller's reach.
        return notFound();
      }
      return toSummary(updated, definition, user, caps, defaultViewId);
    });
  } catch (error) {
    if (isUniqueViolation(error) && name !== undefined) return duplicateName(name);
    throw error;
  }
});

export const deleteListView = withAuth(async (
  user,
  { tenant },
  viewId: string,
): Promise<{ deleted: true } | ListViewActionError> => {
  if (typeof viewId !== 'string' || viewId.length === 0) return notFound();

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const row = await findVisibleSafely(trx, tenant, viewId, user.user_id);
    if (!row) return notFound();
    const definition = getListViewDefinition(row.list_key);
    if (!definition || !(await canReadList(user, definition, trx))) return notFound();

    const caps = await loadCapabilities(user, trx);
    if (!canEditRow(row, user, caps)) return cannotEdit();

    await ListViewModel.clearDefaultsPointingAt(trx, tenant, definition.listKey, row.view_id);
    await ListViewModel.delete(trx, tenant, row.view_id);
    logger.info('[listViews] deleted view', { tenant, viewId: row.view_id, listKey: row.list_key, by: user.user_id });
    return { deleted: true as const };
  });
});

export const setMyDefaultListView = withAuth(async (
  user,
  { tenant },
  listKey: string,
  viewId: string | null,
): Promise<{ defaultViewId: string | null } | ListViewActionError> => {
  const definition = getListViewDefinition(listKey);
  if (!definition) return unknownList();

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    if (!(await canReadList(user, definition, trx))) return cannotReadList();

    if (viewId !== null) {
      const row = await findVisibleSafely(trx, tenant, viewId, user.user_id);
      if (!row || row.list_key !== definition.listKey) return notFound();
    }

    await ListViewModel.setDefaultViewId(trx, tenant, user.user_id, definition.listKey, viewId);
    return { defaultViewId: viewId };
  });
});

/** A malformed id is a view that does not exist, not a database error. */
async function findVisibleSafely(
  trx: Knex.Transaction,
  tenant: string,
  viewId: string,
  userId: string,
): Promise<ListViewRowWithOwner | undefined> {
  if (!UUID_PATTERN.test(viewId)) return undefined;
  return ListViewModel.findVisible(trx, tenant, viewId, userId);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
