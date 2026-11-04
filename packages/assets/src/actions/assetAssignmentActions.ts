'use server';

import type { Knex } from 'knex';
import type { AssetAssignment } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import {
  permissionError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { setAssetAssignee } from '../lib/assetAssignment';
import { publishAssetChanged } from '../lib/assetChangeEvents';
import { assetActionErrorFrom, type AssetActionError } from './assetActionErrors';

function table(conn: Knex | Knex.Transaction, tenant: string, name: string): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table(name) as Knex.QueryBuilder<any, any>;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function mapRow(row: any): AssetAssignment {
  return {
    tenant: row.tenant,
    assignment_id: row.assignment_id,
    asset_id: row.asset_id,
    contact_name_id: row.contact_name_id,
    assigned_at: toIso(row.assigned_at) ?? '',
    assigned_by_user_id: row.assigned_by_user_id ?? null,
    unassigned_at: toIso(row.unassigned_at),
    unassigned_by_user_id: row.unassigned_by_user_id ?? null,
    source: row.source,
    note: row.note ?? null,
    contact_name: row.contact_name ?? null,
    assigned_by_name: row.assigned_by_name ?? null,
    unassigned_by_name: row.unassigned_by_name ?? null,
    asset_name: row.asset_name ?? null,
    asset_tag: row.asset_tag ?? null,
    asset_type: row.asset_type ?? null,
    asset_status: row.asset_status ?? null,
  };
}

/**
 * FR-C8: the asset's assignment history, newest first, with the contact and
 * actor names the timeline renders.
 */
export const getAssetAssignments = withAuth(async (
  user,
  { tenant },
  assetId: string
): Promise<AssetAssignment[] | ActionPermissionError> => {
  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read assets', 'msp/assets:errors.permissions.readAssets');
  }

  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    // An asset of another tenant simply has no rows under this scope.
    const query = table(trx, tenant, 'asset_assignments as aa')
      .where({ 'aa.asset_id': assetId })
      .select(
        'aa.*',
        'contacts.full_name as contact_name',
        trx.raw(`concat_ws(' ', assigner.first_name, assigner.last_name) as assigned_by_name`),
        trx.raw(`concat_ws(' ', unassigner.first_name, unassigner.last_name) as unassigned_by_name`),
      );
    db.tenantJoin(query, 'contacts', 'contacts.contact_name_id', 'aa.contact_name_id', { type: 'left' });
    db.tenantJoin(query, 'users as assigner', 'assigner.user_id', 'aa.assigned_by_user_id', { type: 'left' });
    db.tenantJoin(query, 'users as unassigner', 'unassigner.user_id', 'aa.unassigned_by_user_id', { type: 'left' });

    const rows = await query.orderBy('aa.assigned_at', 'desc');
    return rows.map(mapRow);
  });
});

/**
 * FR-C8: the assets a contact currently holds — open assignments only, so the
 * contact page lists what they have, not what they once had.
 */
export const getContactAssignedAssets = withAuth(async (
  user,
  { tenant },
  contactId: string
): Promise<AssetAssignment[] | ActionPermissionError> => {
  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read assets', 'msp/assets:errors.permissions.readAssets');
  }

  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    const query = table(trx, tenant, 'asset_assignments as aa')
      .where({ 'aa.contact_name_id': contactId })
      .whereNull('aa.unassigned_at')
      .select(
        'aa.*',
        'contacts.full_name as contact_name',
        'assets.name as asset_name',
        'assets.asset_tag as asset_tag',
        'assets.asset_type as asset_type',
        'assets.status as asset_status',
      );
    db.tenantJoin(query, 'contacts', 'contacts.contact_name_id', 'aa.contact_name_id', { type: 'left' });
    db.tenantJoin(query, 'assets', 'assets.asset_id', 'aa.asset_id');

    const rows = await query.orderBy('assets.name', 'asc');
    return rows.map(mapRow);
  });
});

/**
 * FR-C7: the details page Assign popover and the list's bulk Assign action.
 * One round trip, source `manual`, and the typed shared-workspace / wrong-client
 * failures come back as action errors the UI can render inline.
 */
export const assignAssetContact = withAuth(async (
  user,
  { tenant },
  assetId: string,
  contactId: string | null
): Promise<{ contact_name_id: string | null; contact_name: string | null } | AssetActionError> => {
  if (!await hasPermission(user, 'asset', 'update')) {
    return permissionError('Permission denied: Cannot update assets', 'msp/assets:errors.permissions.updateAssets');
  }

  const { knex } = await createTenantKnex();

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const applied = await setAssetAssignee(trx, tenant, assetId, contactId, {
        actorUserId: user.user_id,
        source: 'manual',
      });

      const contact = contactId
        ? await table(trx, tenant, 'contacts')
            .where({ contact_name_id: contactId })
            .first<{ full_name?: string | null }>('full_name')
        : null;

      return {
        changed: applied.changed,
        previousContactId: applied.previousContactId,
        contact_name_id: contactId,
        contact_name: contact?.full_name ?? null,
      };
    });

    // The edit form publishes ASSET_UPDATED for the same column; an assignment
    // made from the Identity tile has to look the same to a workflow.
    if (result.changed) {
      await publishAssetChanged(tenant, [assetId], {
        before: { contact_name_id: result.previousContactId },
        after: { contact_name_id: contactId },
        updatedPaths: ['contact_name_id'],
        actorUserId: user.user_id,
      });
    }

    return { contact_name_id: result.contact_name_id, contact_name: result.contact_name };
  } catch (error) {
    const expected = assetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
