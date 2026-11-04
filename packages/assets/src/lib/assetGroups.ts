import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  AssetGroup,
  AssetGroupContact,
  AssetGroupContactRole,
  AssetGroupKind,
  AssetGroupMember,
  AssetGroupSummary,
} from '@alga-psa/types';
import { setAssetAssignee } from './assetAssignment';
import { formatClientLocation, type ClientLocationLike } from './formatClientLocation';

/**
 * Bundles and shared workspaces (FR-E1 to FR-E10).
 *
 * The invariants the database cannot express live here, in one place, because
 * every one of them is a statement about what the two kinds *mean*:
 *
 *  - a member asset and a contact must belong to the group's client;
 *  - a bundle has at most one `owner` and no `user`;
 *  - a shared workspace has no `owner`;
 *  - a shared-workspace member carries no single assignee.
 *
 * Bundle propagation (owner → every member, location → every member) is the
 * reason a bundle exists: "assign the front desk to the receptionist" has to be
 * one action, not five.
 */

export const ASSET_GROUP_KINDS: readonly AssetGroupKind[] = ['bundle', 'shared_workspace'];

export type AssetGroupErrorCode =
  | 'not_found'
  | 'invalid_kind'
  | 'invalid_name'
  | 'client_mismatch'
  | 'already_grouped'
  | 'users_on_bundle'
  | 'owner_on_workspace'
  | 'users_present'
  | 'invalid_location';

export class AssetGroupError extends Error {
  readonly code: AssetGroupErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AssetGroupErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AssetGroupError';
    this.code = code;
    this.details = details;
  }
}

export function isAssetGroupError(error: unknown): error is AssetGroupError {
  return error instanceof AssetGroupError || (error instanceof Error && error.name === 'AssetGroupError');
}

function table(trx: Knex | Knex.Transaction, tenant: string, name: string): Knex.QueryBuilder<any, any> {
  return tenantDb(trx, tenant).table(name) as Knex.QueryBuilder<any, any>;
}

function toIso(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

async function requireGroup(
  trx: Knex | Knex.Transaction,
  tenant: string,
  groupId: string
): Promise<AssetGroup> {
  const row = await table(trx, tenant, 'asset_groups').where({ group_id: groupId }).first();
  if (!row) throw new AssetGroupError('not_found', 'Asset group not found');
  return { ...row, created_at: toIso(row.created_at), updated_at: toIso(row.updated_at) } as AssetGroup;
}

async function groupHistory(
  trx: Knex | Knex.Transaction,
  tenant: string,
  args: {
    assetId: string;
    actorUserId?: string | null;
    changeType: 'group_added' | 'group_removed' | 'group_location_changed';
    group: Pick<AssetGroup, 'group_id' | 'name' | 'kind'>;
    extra?: Record<string, unknown>;
  }
): Promise<void> {
  // `changed_by` is nullable since 20261009125200, so a sessionless caller
  // (sync, a job) still leaves the group change on the timeline.
  await table(trx, tenant, 'asset_history').insert({
    tenant,
    asset_id: args.assetId,
    changed_by: args.actorUserId ?? null,
    change_type: args.changeType,
    changes: {
      group_id: args.group.group_id,
      group_name: args.group.name,
      group_kind: args.group.kind,
      ...(args.extra ?? {}),
    },
    changed_at: new Date().toISOString(),
  });
}

/** The group's single `owner` contact, for a bundle. */
export async function getGroupOwnerId(
  trx: Knex | Knex.Transaction,
  tenant: string,
  groupId: string
): Promise<string | null> {
  const row = await table(trx, tenant, 'asset_group_contacts')
    .where({ group_id: groupId, role: 'owner' })
    .first<{ contact_name_id: string }>('contact_name_id');
  return row?.contact_name_id ?? null;
}

export async function listGroupMemberIds(
  trx: Knex | Knex.Transaction,
  tenant: string,
  groupId: string
): Promise<string[]> {
  return table(trx, tenant, 'asset_group_members').where({ group_id: groupId }).pluck('asset_id');
}

/** The group an asset belongs to, or null. Used by every "is this grouped" check. */
export async function getAssetGroupRow(
  trx: Knex | Knex.Transaction,
  tenant: string,
  assetId: string
): Promise<AssetGroup | null> {
  const member = await table(trx, tenant, 'asset_group_members')
    .where({ asset_id: assetId })
    .first<{ group_id: string }>('group_id');
  if (!member?.group_id) return null;
  return requireGroup(trx, tenant, member.group_id);
}

async function assertContactOfClient(
  trx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  contactId: string
): Promise<void> {
  const contact = await table(trx, tenant, 'contacts')
    .where({ contact_name_id: contactId, client_id: clientId })
    .whereNot({ contact_kind: 'shared_mailbox' })
    .first<{ contact_name_id: string }>('contact_name_id');
  if (!contact) {
    throw new AssetGroupError('client_mismatch', 'Selected contact is not available for this client', { contactId });
  }
}

async function assertLocationOfClient(
  trx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  locationId: string
): Promise<void> {
  const location = await table(trx, tenant, 'client_locations')
    .where({ location_id: locationId, client_id: clientId, is_active: true })
    .first<{ location_id: string }>('location_id');
  if (!location) {
    throw new AssetGroupError('invalid_location', 'Selected location is not available for this client', { locationId });
  }
}

/**
 * `assets.location` is a denormalized label that every read surface (the Bento
 * Identity tile, the asset list, the drawer) renders in preference to the id, so
 * propagating a group's location has to write both columns or the member keeps
 * showing its previous address. Mirrors `resolveValidatedAssetLocation`.
 */
async function groupLocationPatch(
  trx: Knex | Knex.Transaction,
  tenant: string,
  locationId: string | null
): Promise<{ location_id: string | null; location: string }> {
  if (!locationId) return { location_id: null, location: '' };

  const location = await table(trx, tenant, 'client_locations')
    .where({ location_id: locationId })
    .first<ClientLocationLike & { location_id: string }>();

  return {
    location_id: locationId,
    location: location ? formatClientLocation(location) : '',
  };
}

export async function createGroup(
  trx: Knex.Transaction,
  tenant: string,
  input: {
    clientId: string;
    name: string;
    kind: AssetGroupKind;
    locationId?: string | null;
    description?: string | null;
    actorUserId?: string | null;
  }
): Promise<AssetGroup> {
  const name = String(input.name ?? '').trim();
  if (!name) throw new AssetGroupError('invalid_name', 'Group name is required');
  if (!ASSET_GROUP_KINDS.includes(input.kind)) {
    throw new AssetGroupError('invalid_kind', `Unknown group kind "${input.kind}"`);
  }
  if (input.locationId) await assertLocationOfClient(trx, tenant, input.clientId, input.locationId);

  const [row] = await table(trx, tenant, 'asset_groups')
    .insert({
      tenant,
      client_id: input.clientId,
      name,
      kind: input.kind,
      location_id: input.locationId ?? null,
      description: input.description ?? null,
      created_by: input.actorUserId ?? null,
    })
    .returning('*');

  return { ...row, created_at: toIso(row.created_at), updated_at: toIso(row.updated_at) } as AssetGroup;
}

/**
 * FR-E3: adding a member to a bundle assigns it to the owner and moves it to
 * the group's location; adding one to a shared workspace unassigns it, because
 * a workspace's people are its users.
 */
export async function addAssetsToGroupRows(
  trx: Knex.Transaction,
  tenant: string,
  groupId: string,
  assetIds: string[],
  options?: { actorUserId?: string | null }
): Promise<{ added: string[] }> {
  const group = await requireGroup(trx, tenant, groupId);
  const added: string[] = [];

  for (const assetId of assetIds) {
    const asset = await table(trx, tenant, 'assets')
      .where({ asset_id: assetId })
      .first<{ asset_id: string; client_id: string; name: string; contact_name_id: string | null }>(
        'asset_id',
        'client_id',
        'name',
        'contact_name_id'
      );
    if (!asset) throw new AssetGroupError('not_found', 'Asset not found', { assetId });
    if (asset.client_id !== group.client_id) {
      throw new AssetGroupError('client_mismatch', `"${asset.name}" belongs to another client`, { assetId });
    }

    const existing = await table(trx, tenant, 'asset_group_members')
      .where({ asset_id: assetId })
      .first<{ group_id: string }>('group_id');
    if (existing?.group_id === groupId) continue;
    if (existing?.group_id) {
      throw new AssetGroupError('already_grouped', `"${asset.name}" is already in another group`, { assetId });
    }

    await table(trx, tenant, 'asset_group_members').insert({
      tenant,
      group_id: groupId,
      asset_id: assetId,
      added_by: options?.actorUserId ?? null,
    });

    if (group.kind === 'bundle') {
      const ownerId = await getGroupOwnerId(trx, tenant, groupId);
      if (ownerId) {
        await setAssetAssignee(trx, tenant, assetId, ownerId, {
          actorUserId: options?.actorUserId,
          source: 'bundle',
          note: group.name,
        });
      }
      if (group.location_id) {
        await table(trx, tenant, 'assets')
          .where({ asset_id: assetId })
          .update({
            ...(await groupLocationPatch(trx, tenant, group.location_id)),
            updated_at: new Date().toISOString(),
          });
      }
    } else if (asset.contact_name_id) {
      // FR-E4: a workspace member has users, not an assignee.
      await setAssetAssignee(trx, tenant, assetId, null, {
        actorUserId: options?.actorUserId,
        source: 'bundle',
        note: group.name,
        allowWorkspaceMember: true,
      });
    }

    await groupHistory(trx, tenant, {
      assetId,
      actorUserId: options?.actorUserId,
      changeType: 'group_added',
      group,
    });
    added.push(assetId);
  }

  return { added };
}

/** FR-E3: removing a member leaves its assignee and location exactly as they are. */
export async function removeAssetFromGroupRow(
  trx: Knex.Transaction,
  tenant: string,
  groupId: string,
  assetId: string,
  options?: { actorUserId?: string | null }
): Promise<void> {
  const group = await requireGroup(trx, tenant, groupId);
  const removed = await table(trx, tenant, 'asset_group_members')
    .where({ group_id: groupId, asset_id: assetId })
    .delete();
  if (!removed) return;

  await groupHistory(trx, tenant, {
    assetId,
    actorUserId: options?.actorUserId,
    changeType: 'group_removed',
    group,
  });
}

/**
 * FR-E5: moving an asset to another client (or an RMM organization move) takes
 * it out of its group — the group belongs to the old client.
 */
export async function removeAssetFromAnyGroup(
  trx: Knex.Transaction,
  tenant: string,
  assetId: string,
  options?: { actorUserId?: string | null }
): Promise<void> {
  const group = await getAssetGroupRow(trx, tenant, assetId);
  if (!group) return;
  await removeAssetFromGroupRow(trx, tenant, group.group_id, assetId, options);
}

/** FR-E3 / FR-E2: the bundle owner, propagated to every member. */
export async function setGroupOwner(
  trx: Knex.Transaction,
  tenant: string,
  groupId: string,
  contactId: string | null,
  options?: { actorUserId?: string | null }
): Promise<void> {
  const group = await requireGroup(trx, tenant, groupId);
  if (group.kind !== 'bundle') {
    throw new AssetGroupError('owner_on_workspace', 'A shared workspace has users, not an owner');
  }
  if (contactId) await assertContactOfClient(trx, tenant, group.client_id, contactId);

  await table(trx, tenant, 'asset_group_contacts').where({ group_id: groupId, role: 'owner' }).delete();
  if (contactId) {
    await table(trx, tenant, 'asset_group_contacts').insert({
      tenant,
      group_id: groupId,
      contact_name_id: contactId,
      role: 'owner',
    });
  }

  for (const assetId of await listGroupMemberIds(trx, tenant, groupId)) {
    await setAssetAssignee(trx, tenant, assetId, contactId, {
      actorUserId: options?.actorUserId,
      source: 'bundle',
      note: group.name,
      allowWorkspaceMember: true,
    });
  }
}

/** FR-E2 / FR-E4: the people who use a shared workspace. */
export async function addGroupUser(
  trx: Knex.Transaction,
  tenant: string,
  groupId: string,
  contactId: string
): Promise<void> {
  const group = await requireGroup(trx, tenant, groupId);
  if (group.kind !== 'bundle') {
    await assertContactOfClient(trx, tenant, group.client_id, contactId);
    await table(trx, tenant, 'asset_group_contacts')
      .insert({ tenant, group_id: groupId, contact_name_id: contactId, role: 'user' })
      .onConflict(['tenant', 'group_id', 'contact_name_id'])
      .merge({ role: 'user' });
    return;
  }
  throw new AssetGroupError('users_on_bundle', 'A bundle has one owner, not a list of users');
}

export async function removeGroupUser(
  trx: Knex.Transaction,
  tenant: string,
  groupId: string,
  contactId: string
): Promise<void> {
  await table(trx, tenant, 'asset_group_contacts')
    .where({ group_id: groupId, contact_name_id: contactId, role: 'user' })
    .delete();
}

/**
 * FR-E2 / FR-E3: name, description, location and kind.
 *
 * A location change propagates to every member (that is what a group's location
 * means). A kind change from shared workspace to bundle is refused while users
 * exist; the reverse unassigns every member and drops the owner.
 */
export async function updateGroupRow(
  trx: Knex.Transaction,
  tenant: string,
  groupId: string,
  input: {
    name?: string;
    kind?: AssetGroupKind;
    locationId?: string | null;
    description?: string | null;
    actorUserId?: string | null;
  }
): Promise<AssetGroup> {
  const group = await requireGroup(trx, tenant, groupId);
  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new AssetGroupError('invalid_name', 'Group name is required');
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description ?? null;

  if (input.kind !== undefined && input.kind !== group.kind) {
    if (!ASSET_GROUP_KINDS.includes(input.kind)) {
      throw new AssetGroupError('invalid_kind', `Unknown group kind "${input.kind}"`);
    }
    if (input.kind === 'bundle') {
      const users = await table(trx, tenant, 'asset_group_contacts')
        .where({ group_id: groupId, role: 'user' })
        .count<{ count: string }>('contact_name_id as count')
        .first();
      if (Number(users?.count ?? 0) > 0) {
        throw new AssetGroupError('users_present', 'Remove the workspace users before turning this into a bundle');
      }
    } else {
      // bundle → shared workspace: the single assignee makes no sense any more.
      await table(trx, tenant, 'asset_group_contacts').where({ group_id: groupId, role: 'owner' }).delete();
      for (const assetId of await listGroupMemberIds(trx, tenant, groupId)) {
        await setAssetAssignee(trx, tenant, assetId, null, {
          actorUserId: input.actorUserId,
          source: 'bundle',
          note: group.name,
          allowWorkspaceMember: true,
        });
      }
    }
    patch.kind = input.kind;
  }

  const locationChanged = input.locationId !== undefined && (input.locationId ?? null) !== (group.location_id ?? null);
  if (input.locationId !== undefined) {
    if (input.locationId) await assertLocationOfClient(trx, tenant, group.client_id, input.locationId);
    patch.location_id = input.locationId ?? null;
  }

  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    await table(trx, tenant, 'asset_groups').where({ group_id: groupId }).update(patch);
  }

  if (locationChanged) {
    const nextGroup = await requireGroup(trx, tenant, groupId);
    const locationPatch = await groupLocationPatch(trx, tenant, input.locationId ?? null);
    for (const assetId of await listGroupMemberIds(trx, tenant, groupId)) {
      await table(trx, tenant, 'assets')
        .where({ asset_id: assetId })
        .update({ ...locationPatch, updated_at: new Date().toISOString() });
      await groupHistory(trx, tenant, {
        assetId,
        actorUserId: input.actorUserId,
        changeType: 'group_location_changed',
        group: nextGroup,
        extra: { location_id: input.locationId ?? null, location_name: locationPatch.location ?? null },
      });
    }
  }

  return requireGroup(trx, tenant, groupId);
}

/** FR-E3: deleting a group leaves its members' assignee and location alone. */
export async function deleteGroupRow(
  trx: Knex.Transaction,
  tenant: string,
  groupId: string,
  options?: { actorUserId?: string | null }
): Promise<void> {
  const group = await requireGroup(trx, tenant, groupId);
  const memberIds = await listGroupMemberIds(trx, tenant, groupId);

  await table(trx, tenant, 'asset_group_contacts').where({ group_id: groupId }).delete();
  await table(trx, tenant, 'asset_group_members').where({ group_id: groupId }).delete();
  await table(trx, tenant, 'asset_groups').where({ group_id: groupId }).delete();

  for (const assetId of memberIds) {
    await groupHistory(trx, tenant, {
      assetId,
      actorUserId: options?.actorUserId,
      changeType: 'group_removed',
      group,
    });
  }
}

/** FR-E6: contact deletion cleanup; the implementation is shared with contactModel. */
export { clearGroupContactLinksForContact as clearGroupContactLinks } from '@alga-psa/shared/models/assetGroupContactModel';

export async function listGroupsForClient(
  trx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<AssetGroup[]> {
  const db = tenantDb(trx, tenant);
  const query = table(trx, tenant, 'asset_groups as g')
    .where({ 'g.client_id': clientId })
    .select('g.*', 'client_locations.location_name as location_name');
  db.tenantJoin(query, 'client_locations', 'client_locations.location_id', 'g.location_id', { type: 'left' });

  const groups = await query.orderBy('g.name', 'asc');
  if (groups.length === 0) return [];

  const groupIds = groups.map((group: any) => group.group_id);
  const memberCounts = await table(trx, tenant, 'asset_group_members')
    .whereIn('group_id', groupIds)
    .select('group_id')
    .count<{ group_id: string; count: string }[]>('asset_id as count')
    .groupBy('group_id');
  const peopleCounts = await table(trx, tenant, 'asset_group_contacts')
    .whereIn('group_id', groupIds)
    .select('group_id')
    .count<{ group_id: string; count: string }[]>('contact_name_id as count')
    .groupBy('group_id');

  const members = new Map(memberCounts.map((row: any) => [row.group_id, Number(row.count)]));
  const people = new Map(peopleCounts.map((row: any) => [row.group_id, Number(row.count)]));

  return groups.map((group: any) => ({
    ...group,
    created_at: toIso(group.created_at),
    updated_at: toIso(group.updated_at),
    member_count: members.get(group.group_id) ?? 0,
    people_count: people.get(group.group_id) ?? 0,
  })) as AssetGroup[];
}

export async function getGroupWithDetails(
  trx: Knex | Knex.Transaction,
  tenant: string,
  groupId: string
): Promise<AssetGroup> {
  const group = await requireGroup(trx, tenant, groupId);
  const db = tenantDb(trx, tenant);

  const membersQuery = table(trx, tenant, 'asset_group_members as m')
    .where({ 'm.group_id': groupId })
    .select(
      'm.*',
      'assets.name as asset_name',
      'assets.asset_type as asset_type',
      'assets.asset_tag as asset_tag',
      'assets.status as asset_status',
    );
  db.tenantJoin(membersQuery, 'assets', 'assets.asset_id', 'm.asset_id');
  const members = await membersQuery.orderBy('assets.name', 'asc');

  const contactsQuery = table(trx, tenant, 'asset_group_contacts as gc')
    .where({ 'gc.group_id': groupId })
    .select('gc.*', 'contacts.full_name as contact_name', 'contacts.email as email');
  db.tenantJoin(contactsQuery, 'contacts', 'contacts.contact_name_id', 'gc.contact_name_id', { type: 'left' });
  const contacts = await contactsQuery.orderBy('contacts.full_name', 'asc');

  const location = group.location_id
    ? await table(trx, tenant, 'client_locations')
        .where({ location_id: group.location_id })
        .first<{ location_name?: string | null }>('location_name')
    : null;

  // The drawer header names the client; without this it rendered blank.
  const client = await table(trx, tenant, 'clients')
    .where({ client_id: group.client_id })
    .first<{ client_name?: string | null }>('client_name');

  return {
    ...group,
    client_name: client?.client_name ?? null,
    location_name: location?.location_name ?? null,
    member_count: members.length,
    people_count: contacts.length,
    members: members.map((row: any) => ({ ...row, added_at: toIso(row.added_at) })) as AssetGroupMember[],
    contacts: contacts.map((row: any) => ({ ...row, added_at: toIso(row.added_at) })) as AssetGroupContact[],
  };
}

/** FR-E9: the shared workspaces a contact uses, for the contact page. */
export async function listContactSharedWorkspaces(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contactId: string
): Promise<AssetGroup[]> {
  const db = tenantDb(trx, tenant);
  const query = table(trx, tenant, 'asset_group_contacts as gc')
    .where({ 'gc.contact_name_id': contactId, 'gc.role': 'user' })
    .select('g.*', 'client_locations.location_name as location_name');
  db.tenantJoin(query, 'asset_groups as g', 'g.group_id', 'gc.group_id');
  db.tenantJoin(query, 'client_locations', 'client_locations.location_id', 'g.location_id', { type: 'left' });

  const groups = await query.where({ 'g.kind': 'shared_workspace' }).orderBy('g.name', 'asc');
  if (groups.length === 0) return [];

  const counts = await table(trx, tenant, 'asset_group_members')
    .whereIn('group_id', groups.map((group: any) => group.group_id))
    .select('group_id')
    .count<{ group_id: string; count: string }[]>('asset_id as count')
    .groupBy('group_id');
  const members = new Map(counts.map((row: any) => [row.group_id, Number(row.count)]));

  return groups.map((group: any) => ({
    ...group,
    created_at: toIso(group.created_at),
    updated_at: toIso(group.updated_at),
    member_count: members.get(group.group_id) ?? 0,
  })) as AssetGroup[];
}

/** The group summary an asset read carries, with the right people count. */
export async function getAssetGroupSummary(
  trx: Knex | Knex.Transaction,
  tenant: string,
  assetId: string
): Promise<AssetGroupSummary | null> {
  const group = await getAssetGroupRow(trx, tenant, assetId);
  if (!group) return null;

  const [memberCount, userCount, location] = await Promise.all([
    table(trx, tenant, 'asset_group_members')
      .where({ group_id: group.group_id })
      .count<{ count: string }>('asset_id as count')
      .first(),
    table(trx, tenant, 'asset_group_contacts')
      .where({ group_id: group.group_id, role: 'user' })
      .count<{ count: string }>('contact_name_id as count')
      .first(),
    group.location_id
      ? table(trx, tenant, 'client_locations')
          .where({ location_id: group.location_id })
          .first<{ location_name?: string | null }>('location_name')
      : Promise.resolve(null),
  ]);

  return {
    group_id: group.group_id,
    name: group.name,
    kind: group.kind,
    location_id: group.location_id ?? null,
    location_name: location?.location_name ?? null,
    member_count: Number(memberCount?.count ?? 0),
    user_count: Number(userCount?.count ?? 0),
  };
}

/**
 * F075: group summaries for a whole page of assets in four queries instead of
 * four per row, so the list's Group column costs the same at 10 rows as at 100.
 */
export async function getAssetGroupSummariesForAssets(
  trx: Knex | Knex.Transaction,
  tenant: string,
  assetIds: string[]
): Promise<Map<string, AssetGroupSummary>> {
  const byAsset = new Map<string, AssetGroupSummary>();
  if (assetIds.length === 0) return byAsset;

  const members = await table(trx, tenant, 'asset_group_members')
    .whereIn('asset_id', assetIds)
    .select<{ asset_id: string; group_id: string }[]>('asset_id', 'group_id');
  if (members.length === 0) return byAsset;

  const groupIds = Array.from(new Set(members.map((row: any) => row.group_id)));
  const [groups, memberCounts, userCounts] = await Promise.all([
    table(trx, tenant, 'asset_groups').whereIn('group_id', groupIds).select('*'),
    table(trx, tenant, 'asset_group_members')
      .whereIn('group_id', groupIds)
      .select('group_id')
      .count<{ group_id: string; count: string }[]>('asset_id as count')
      .groupBy('group_id'),
    table(trx, tenant, 'asset_group_contacts')
      .whereIn('group_id', groupIds)
      .where({ role: 'user' })
      .select('group_id')
      .count<{ group_id: string; count: string }[]>('contact_name_id as count')
      .groupBy('group_id'),
  ]);

  const locationIds = Array.from(
    new Set(groups.map((group: any) => group.location_id).filter(Boolean))
  ) as string[];
  const locations = locationIds.length
    ? await table(trx, tenant, 'client_locations')
        .whereIn('location_id', locationIds)
        .select<{ location_id: string; location_name: string | null }[]>('location_id', 'location_name')
    : [];

  const locationNames = new Map(locations.map((row: any) => [row.location_id, row.location_name ?? null]));
  const memberCount = new Map(memberCounts.map((row: any) => [row.group_id, Number(row.count)]));
  const userCount = new Map(userCounts.map((row: any) => [row.group_id, Number(row.count)]));
  const summaries = new Map<string, AssetGroupSummary>(
    groups.map((group: any) => [
      group.group_id,
      {
        group_id: group.group_id,
        name: group.name,
        kind: group.kind,
        location_id: group.location_id ?? null,
        location_name: group.location_id ? locationNames.get(group.location_id) ?? null : null,
        member_count: memberCount.get(group.group_id) ?? 0,
        user_count: userCount.get(group.group_id) ?? 0,
      } as AssetGroupSummary,
    ])
  );

  for (const row of members as any[]) {
    const summary = summaries.get(row.group_id);
    if (summary) byAsset.set(row.asset_id, summary);
  }
  return byAsset;
}

export type { AssetGroupContactRole };
