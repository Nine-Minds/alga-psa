import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { ListViewKey, ListViewSettings, ListViewVisibility } from '@alga-psa/types';
import { LIST_VIEW_NAME_MAX_LENGTH } from '../lib/settingsSchema';
import { listViewDefaultPreferenceKey } from '../lib/registry';

/**
 * Data access for `list_views`.
 *
 * Every read that can reach a user goes through `visibleTo`: a view is visible
 * when it is shared, or when the caller owns it. There is deliberately no
 * "load any view by id" helper — a private view that is not yours must be
 * indistinguishable from one that does not exist, and the only reliable way to
 * keep that true is to never fetch it.
 */

export interface ListViewRow {
  tenant: string;
  view_id: string;
  list_key: ListViewKey;
  name: string;
  owner_user_id: string;
  visibility: ListViewVisibility;
  settings: ListViewSettings;
  schema_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ListViewRowWithOwner extends ListViewRow {
  owner_first_name: string | null;
  owner_last_name: string | null;
}

function views(trx: Knex | Knex.Transaction, tenant: string) {
  return tenantDb(trx, tenant).table<ListViewRow>('list_views');
}

function selectWithOwner(trx: Knex | Knex.Transaction, tenant: string) {
  return tenantDb(trx, tenant)
    .table('list_views as lv')
    .leftJoin('users as u', function joinOwner() {
      this.on('u.tenant', '=', 'lv.tenant').andOn('u.user_id', '=', 'lv.owner_user_id');
    })
    .select(
      'lv.*',
      'u.first_name as owner_first_name',
      'u.last_name as owner_last_name',
    );
}

function visibleTo(query: Knex.QueryBuilder, userId: string): Knex.QueryBuilder {
  return query.where(function sharedOrOwned() {
    this.where('lv.visibility', 'shared').orWhere('lv.owner_user_id', userId);
  });
}

export const ListViewModel = {
  /** The caller's private views plus every shared view for one list, by name. */
  async listVisible(
    trx: Knex | Knex.Transaction,
    tenant: string,
    listKey: ListViewKey,
    userId: string,
  ): Promise<ListViewRowWithOwner[]> {
    const query = selectWithOwner(trx, tenant).where('lv.list_key', listKey);
    return visibleTo(query, userId).orderByRaw('lower(lv.name) asc');
  },

  /** One view, only if it is shared or owned by `userId`. */
  async findVisible(
    trx: Knex | Knex.Transaction,
    tenant: string,
    viewId: string,
    userId: string,
  ): Promise<ListViewRowWithOwner | undefined> {
    const query = selectWithOwner(trx, tenant).where('lv.view_id', viewId);
    return visibleTo(query, userId).first();
  },

  async nameTaken(
    trx: Knex | Knex.Transaction,
    tenant: string,
    params: { listKey: ListViewKey; ownerUserId: string; name: string; excludeViewId?: string },
  ): Promise<boolean> {
    const query = views(trx, tenant)
      .where({ list_key: params.listKey, owner_user_id: params.ownerUserId })
      .whereRaw('lower(name) = lower(?)', [params.name]);
    if (params.excludeViewId) {
      query.whereNot('view_id', params.excludeViewId);
    }
    return Boolean(await query.first('view_id'));
  },

  async insert(
    trx: Knex | Knex.Transaction,
    tenant: string,
    row: Pick<ListViewRow, 'list_key' | 'name' | 'owner_user_id' | 'visibility' | 'settings' | 'schema_version'>,
  ): Promise<string> {
    const [inserted] = await views(trx, tenant)
      .insert({
        tenant,
        list_key: row.list_key,
        name: row.name,
        owner_user_id: row.owner_user_id,
        visibility: row.visibility,
        settings: JSON.stringify(row.settings) as unknown as ListViewSettings,
        schema_version: row.schema_version,
      })
      .returning('view_id');
    return typeof inserted === 'string' ? inserted : (inserted as { view_id: string }).view_id;
  },

  async update(
    trx: Knex | Knex.Transaction,
    tenant: string,
    viewId: string,
    patch: Partial<Pick<ListViewRow, 'name' | 'visibility' | 'settings' | 'schema_version'>>,
  ): Promise<void> {
    const update: Record<string, unknown> = { updated_at: trx.fn.now() };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.visibility !== undefined) update.visibility = patch.visibility;
    if (patch.settings !== undefined) update.settings = JSON.stringify(patch.settings);
    if (patch.schema_version !== undefined) update.schema_version = patch.schema_version;
    await views(trx, tenant).where({ view_id: viewId }).update(update);
  },

  async delete(trx: Knex | Knex.Transaction, tenant: string, viewId: string): Promise<void> {
    await views(trx, tenant).where({ view_id: viewId }).del();
  },

  /** The user's default view id for a list, as stored (it may since have become invisible). */
  async getDefaultViewId(
    trx: Knex | Knex.Transaction,
    tenant: string,
    userId: string,
    listKey: ListViewKey,
  ): Promise<string | null> {
    const row = await tenantDb(trx, tenant)
      .table('user_preferences')
      .where({ user_id: userId, setting_name: listViewDefaultPreferenceKey(listKey) })
      .first('setting_value');
    return decodePreferenceString(row?.setting_value);
  },

  async setDefaultViewId(
    trx: Knex | Knex.Transaction,
    tenant: string,
    userId: string,
    listKey: ListViewKey,
    viewId: string | null,
  ): Promise<void> {
    const settingName = listViewDefaultPreferenceKey(listKey);
    const preferences = tenantDb(trx, tenant).table('user_preferences');
    if (viewId === null) {
      await preferences.where({ user_id: userId, setting_name: settingName }).del();
      return;
    }
    // Same encoding as the generic preference writer, so the row reads the same
    // way through either path.
    await preferences
      .insert({
        tenant,
        user_id: userId,
        setting_name: settingName,
        setting_value: JSON.stringify(viewId),
        updated_at: trx.fn.now(),
      })
      .onConflict(['tenant', 'user_id', 'setting_name'])
      .merge(['setting_value', 'updated_at']);
  },

  /** Removes every user's default that points at a view (the view is going away). */
  async clearDefaultsPointingAt(
    trx: Knex | Knex.Transaction,
    tenant: string,
    listKey: ListViewKey,
    viewId: string,
  ): Promise<void> {
    await tenantDb(trx, tenant)
      .table('user_preferences')
      .where({ setting_name: listViewDefaultPreferenceKey(listKey) })
      .whereRaw(`setting_value #>> '{}' = ?`, [viewId])
      .del();
  },

  /**
   * A user is being hard-deleted: their private views go with them, and their
   * shared views pass to the admin performing the deletion so the team keeps
   * them. A reassigned view whose name collides with one the admin already owns
   * gets a numeric suffix rather than failing the whole deletion.
   */
  async handOverForDeletedUser(
    trx: Knex | Knex.Transaction,
    tenant: string,
    deletedUserId: string,
    actingUserId: string,
  ): Promise<void> {
    await views(trx, tenant).where({ owner_user_id: deletedUserId, visibility: 'private' }).del();

    const shared = await views(trx, tenant)
      .where({ owner_user_id: deletedUserId, visibility: 'shared' })
      .select('view_id', 'list_key', 'name');

    for (const view of shared) {
      let name = view.name;
      for (let attempt = 2; await ListViewModel.nameTaken(trx, tenant, {
        listKey: view.list_key,
        ownerUserId: actingUserId,
        name,
      }); attempt += 1) {
        const suffix = ` (${attempt})`;
        name = `${view.name.slice(0, LIST_VIEW_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
      }
      await views(trx, tenant)
        .where({ view_id: view.view_id })
        .update({ owner_user_id: actingUserId, name, updated_at: trx.fn.now() });
    }
  },
};

/** Preference values are stored JSON-encoded; a string preference may arrive once or twice encoded. */
function decodePreferenceString(value: unknown): string | null {
  let current: unknown = value;
  for (let i = 0; i < 2 && typeof current === 'string'; i += 1) {
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
  }
  return typeof current === 'string' && current.length > 0 ? current : null;
}
