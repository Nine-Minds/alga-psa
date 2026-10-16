import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AssetAssignment, AssetAssignmentSource } from '@alga-psa/types';

/**
 * The one place `assets.contact_name_id` changes (FR-C2).
 *
 * Every writer — the edit form, bulk update, the REST service, RMM sync, bundle
 * propagation, the migration importer, client merge — goes through here so the
 * open/closed `asset_assignments` row, the column and the `assignee_changed`
 * history entry can never disagree.
 */

export const ASSET_ASSIGNEE_CONTACT_UNAVAILABLE = 'Selected contact is not available for this client';
/** FR-E4: a shared-workspace member has users, not one assignee. */
export const ASSET_ASSIGNEE_WORKSPACE_MEMBER = 'This asset belongs to a shared workspace and cannot have a single assignee';

export class AssetAssigneeError extends Error {
  readonly code: 'contact_unavailable' | 'workspace_member';

  constructor(code: 'contact_unavailable' | 'workspace_member', message: string) {
    super(message);
    this.name = 'AssetAssigneeError';
    this.code = code;
  }
}

export function isAssetAssigneeError(error: unknown): error is AssetAssigneeError {
  return error instanceof AssetAssigneeError
    || (error instanceof Error && error.name === 'AssetAssigneeError');
}

export interface SetAssetAssigneeOptions {
  actorUserId?: string | null;
  source: AssetAssignmentSource;
  note?: string | null;
  /** The RMM provider behind a `rmm` assignment, so the timeline can name it. */
  provider?: string | null;
  /**
   * Skip the shared-workspace guard. Only the group model itself passes this,
   * when it is the one doing the unassigning.
   */
  allowWorkspaceMember?: boolean;
}

export interface SetAssetAssigneeResult {
  changed: boolean;
  previousContactId: string | null;
  contactId: string | null;
}

type AssetRow = { asset_id: string; client_id: string; contact_name_id: string | null };

function table(trx: Knex | Knex.Transaction, tenant: string, name: string): Knex.QueryBuilder<any, any> {
  return tenantDb(trx, tenant).table(name) as Knex.QueryBuilder<any, any>;
}

/**
 * The group tables arrive in a later migration than this helper, so a lookup
 * against them can legitimately fail with `undefined_table`. Anything else is
 * a real failure — swallowing it inside a transaction only hides an abort.
 */
export function isMissingAssetGroupTable(error: unknown): boolean {
  const dbError = error as { code?: string; table?: string; message?: string } | null;
  if (dbError?.code !== '42P01') return false;
  const named = dbError.table ?? dbError.message ?? '';
  return named === '' || /asset_group/.test(named);
}

/**
 * Whether the asset is a member of a shared workspace. Tolerates the group
 * tables not existing yet so this helper lands before the groups migration.
 */
async function sharedWorkspaceGroupId(
  trx: Knex | Knex.Transaction,
  tenant: string,
  assetId: string
): Promise<string | null> {
  try {
    const row = await table(trx, tenant, 'asset_group_members as m')
      .join('asset_groups as g', function joinGroups(this: Knex.JoinClause) {
        this.on('g.tenant', '=', 'm.tenant').andOn('g.group_id', '=', 'm.group_id');
      })
      .where({ 'm.asset_id': assetId, 'g.kind': 'shared_workspace' })
      .first<{ group_id: string }>('g.group_id');
    return row?.group_id ?? null;
  } catch (error) {
    // Before the groups migration nothing is a workspace member; any other
    // error belongs to the caller.
    if (isMissingAssetGroupTable(error)) return null;
    throw error;
  }
}

async function contactDisplayName(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contactId: string
): Promise<string | null> {
  const row = await table(trx, tenant, 'contacts')
    .where({ contact_name_id: contactId })
    .first<{ full_name?: string | null }>('full_name');
  return row?.full_name ?? null;
}

/**
 * Assigns (or clears, with `null`) the asset's contact.
 *
 * - Validates the contact exists in the tenant, belongs to the asset's client
 *   and is a real person rather than a shared mailbox.
 * - No-op when the assignee is unchanged: no new row, no history.
 * - Closes the open assignment, opens a new one when `contactId` is set,
 *   updates `assets.contact_name_id` and writes an `assignee_changed`
 *   `asset_history` row.
 */
export async function setAssetAssignee(
  trx: Knex | Knex.Transaction,
  tenant: string,
  assetId: string,
  contactId: string | null,
  options: SetAssetAssigneeOptions
): Promise<SetAssetAssigneeResult> {
  const asset = await table(trx, tenant, 'assets')
    .where({ asset_id: assetId })
    .first<AssetRow>('asset_id', 'client_id', 'contact_name_id');

  if (!asset) {
    throw new Error('Asset not found');
  }

  const previousContactId = asset.contact_name_id ?? null;
  if ((previousContactId ?? null) === (contactId ?? null)) {
    return { changed: false, previousContactId, contactId: contactId ?? null };
  }

  if (contactId) {
    if (!options.allowWorkspaceMember && await sharedWorkspaceGroupId(trx, tenant, assetId)) {
      throw new AssetAssigneeError('workspace_member', ASSET_ASSIGNEE_WORKSPACE_MEMBER);
    }

    const contact = await table(trx, tenant, 'contacts')
      .where({ contact_name_id: contactId, client_id: asset.client_id })
      .whereNot({ contact_kind: 'shared_mailbox' })
      .first<{ contact_name_id: string }>('contact_name_id');

    if (!contact) {
      throw new AssetAssigneeError('contact_unavailable', ASSET_ASSIGNEE_CONTACT_UNAVAILABLE);
    }
  }

  const now = new Date().toISOString();

  await table(trx, tenant, 'asset_assignments')
    .where({ asset_id: assetId })
    .whereNull('unassigned_at')
    .update({
      unassigned_at: now,
      unassigned_by_user_id: options.actorUserId ?? null,
    });

  if (contactId) {
    await table(trx, tenant, 'asset_assignments').insert({
      tenant,
      asset_id: assetId,
      contact_name_id: contactId,
      assigned_at: now,
      assigned_by_user_id: options.actorUserId ?? null,
      source: options.source,
      note: options.note ?? null,
    });
  }

  await table(trx, tenant, 'assets')
    .where({ asset_id: assetId })
    .update({ contact_name_id: contactId, updated_at: now });

  // The names travel with the history entry so the timeline can render
  // "Assigned to Jane Doe" without a second lookup per row — and still read
  // correctly after the contact is renamed or deleted.
  //
  // `changed_by` is nullable since 20261009125200: RMM sync has no session,
  // and skipping the row left every auto-assignment invisible on the timeline
  // of the device it had just reassigned.
  const [contactName, previousContactName] = await Promise.all([
    contactId ? contactDisplayName(trx, tenant, contactId) : Promise.resolve(null),
    previousContactId ? contactDisplayName(trx, tenant, previousContactId) : Promise.resolve(null),
  ]);

  await table(trx, tenant, 'asset_history').insert({
    tenant,
    asset_id: assetId,
    changed_by: options.actorUserId ?? null,
    change_type: 'assignee_changed',
    changes: {
      source: options.source,
      previous_contact_name_id: previousContactId,
      previous_contact_name: previousContactName,
      contact_name_id: contactId,
      contact_name: contactName,
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.note ? { note: options.note } : {}),
    },
    changed_at: now,
  });

  return { changed: true, previousContactId, contactId };
}

/** The asset's current assignment, if it has one. */
export async function getOpenAssetAssignment(
  trx: Knex | Knex.Transaction,
  tenant: string,
  assetId: string
): Promise<AssetAssignment | null> {
  const row = await table(trx, tenant, 'asset_assignments')
    .where({ asset_id: assetId })
    .whereNull('unassigned_at')
    .orderBy('assigned_at', 'desc')
    .first();
  return (row ?? null) as AssetAssignment | null;
}

/**
 * FR-C5: closes every open assignment held by a contact that is about to be
 * deleted. The caller nulls `assets.contact_name_id` in the same transaction.
 */
export async function closeOpenAssignmentsForContact(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contactId: string,
  options?: { actorUserId?: string | null }
): Promise<number> {
  return table(trx, tenant, 'asset_assignments')
    .where({ contact_name_id: contactId })
    .whereNull('unassigned_at')
    .update({
      unassigned_at: new Date().toISOString(),
      unassigned_by_user_id: options?.actorUserId ?? null,
    });
}
