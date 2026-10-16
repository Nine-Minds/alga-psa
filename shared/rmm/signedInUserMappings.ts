import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  setAssetAssignee,
  getOpenAssetAssignment,
  isAssetAssigneeError,
  isMissingAssetGroupTable,
} from '../models/assetAssignmentModel';
import {
  matchContactForRmmUser,
  normalizeRmmUsername,
  rmmUserMappingIntegrationType,
  type RmmContactMatchMethod,
} from './userMatching';

/**
 * FR-D5 / FR-D6 / FR-D7 core.
 *
 * Plain functions over a knex/transaction so the asset details page (assets
 * package) and the RMM settings panel (integrations package) can each wrap them
 * in their own `withAuth` action without one package importing the other's
 * barrel.
 */

export interface RmmSignedInUserSuggestion {
  rawUser: string;
  key: string;
  contactId: string | null;
  contactName: string | null;
  method: RmmContactMatchMethod | null;
  /** Carried so the UI can save an explicit mapping without a second lookup. */
  integrationId: string;
  provider: string;
}

export interface RmmSignedInUserRow {
  rawUser: string;
  key: string;
  contactId: string | null;
  contactName: string | null;
  method: RmmContactMatchMethod | null;
  deviceCount: number;
  samples: string[];
}

function table(conn: Knex | Knex.Transaction, tenant: string, name: string): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table(name) as Knex.QueryBuilder<any, any>;
}

/** `current_user` lives only on the workstation and server extension tables. */
async function signedInUsersForAssets(
  conn: Knex | Knex.Transaction,
  tenant: string,
  assetIds: string[]
): Promise<Map<string, string>> {
  const byAsset = new Map<string, string>();
  if (assetIds.length === 0) return byAsset;

  for (const extensionTable of ['workstation_assets', 'server_assets']) {
    const rows = await table(conn, tenant, extensionTable)
      .whereIn('asset_id', assetIds)
      .whereNotNull('current_user')
      .select<Array<{ asset_id: string; current_user: string }>>('asset_id', 'current_user');
    for (const row of rows) {
      const value = String(row.current_user ?? '').trim();
      if (value) byAsset.set(String(row.asset_id), value);
    }
  }

  return byAsset;
}

/** The raw signed-in user reported for one asset, from either extension table. */
export async function getAssetSignedInUser(
  conn: Knex | Knex.Transaction,
  tenant: string,
  assetId: string
): Promise<string | null> {
  const byAsset = await signedInUsersForAssets(conn, tenant, [assetId]);
  return byAsset.get(assetId) ?? null;
}

/**
 * FR-D5: the suggestion the details page shows. Returns null when the mapping
 * mode is `off`, when the asset reports no signed-in user, or when the asset is
 * a shared-workspace member (its people are the group's users).
 */
export async function suggestContactForAsset(
  conn: Knex | Knex.Transaction,
  tenant: string,
  assetId: string
): Promise<RmmSignedInUserSuggestion | null> {
  const asset = await table(conn, tenant, 'assets')
    .where({ asset_id: assetId })
    .first<{ client_id: string; rmm_provider?: string | null; rmm_organization_id?: string | null }>(
      'client_id',
      'rmm_provider',
      'rmm_organization_id'
    );
  if (!asset?.rmm_provider || !asset.rmm_organization_id || !asset.client_id) return null;

  /**
   * The mapping that owns this device, found through its organization rather
   * than by provider alone: a tenant with two integrations of the same provider
   * would otherwise take whichever `rmm_integrations` row came back first, and
   * read the other one's mode and explicit user mappings.
   */
  const candidates = await table(conn, tenant, 'rmm_organization_mappings')
    .where({
      external_organization_id: asset.rmm_organization_id,
      client_id: asset.client_id,
    })
    .select<Array<{ integration_id: string; contact_assignment_mode?: string | null }>>(
      'integration_id',
      'contact_assignment_mode'
    );
  if (candidates.length === 0) return null;

  const integrations = await table(conn, tenant, 'rmm_integrations')
    .whereIn('integration_id', candidates.map((candidate) => candidate.integration_id))
    .select<Array<{ integration_id: string; provider: string }>>('integration_id', 'provider');
  const providerById = new Map(
    integrations.map((row) => [String(row.integration_id), String(row.provider)])
  );

  const mapping = candidates.find(
    (candidate) => providerById.get(String(candidate.integration_id)) === asset.rmm_provider
  );
  if (!mapping) return null;
  if ((mapping.contact_assignment_mode ?? 'suggest') === 'off') return null;

  try {
    const workspace = await table(conn, tenant, 'asset_group_members as m')
      .join('asset_groups as g', function joinGroups(this: Knex.JoinClause) {
        this.on('g.tenant', '=', 'm.tenant').andOn('g.group_id', '=', 'm.group_id');
      })
      .where({ 'm.asset_id': assetId, 'g.kind': 'shared_workspace' })
      .first<{ group_id: string }>('g.group_id');
    if (workspace) return null;
  } catch (error) {
    // Only the pre-groups schema is absorbed; any other failure is the
    // caller's, and hiding it here would offer a suggestion for an asset whose
    // people are the workspace's.
    if (!isMissingAssetGroupTable(error)) throw error;
  }

  const rawUser = await getAssetSignedInUser(conn, tenant, assetId);
  const normalized = normalizeRmmUsername(rawUser);
  if (!normalized || !rawUser) return null;

  const match = await matchContactForRmmUser(
    conn,
    tenant,
    asset.client_id,
    mapping.integration_id,
    asset.rmm_provider,
    normalized
  );

  const contactName = match
    ? (await table(conn, tenant, 'contacts')
        .where({ contact_name_id: match.contactId })
        .first<{ full_name?: string | null }>('full_name'))?.full_name ?? null
    : null;

  return {
    rawUser,
    key: normalized.key,
    contactId: match?.contactId ?? null,
    contactName,
    method: match?.method ?? null,
    integrationId: mapping.integration_id,
    provider: asset.rmm_provider,
  };
}

/**
 * FR-D6: saves (or removes, with `contactId = null`) the explicit mapping for a
 * signed-in user name, and optionally assigns the asset the operator was
 * looking at. In `auto` mode the organization's other devices reporting the
 * same user and carrying no manual assignment follow along.
 *
 * Removing a mapping never unassigns anything: the operator said "this name is
 * not that person", not "take the laptop away".
 */
export async function mapSignedInUserToContact(
  trx: Knex.Transaction,
  tenant: string,
  args: {
    integrationId: string;
    provider: string;
    rawUser: string;
    contactId: string | null;
    assignAssetId?: string | null;
    actorUserId?: string | null;
  }
): Promise<{ key: string; assignedAssetIds: string[] }> {
  const normalized = normalizeRmmUsername(args.rawUser);
  if (!normalized) throw new Error('Signed-in user name is empty');

  const integrationType = rmmUserMappingIntegrationType(args.provider);
  const mappings = table(trx, tenant, 'tenant_external_entity_mappings');

  if (args.contactId) {
    const existing = await table(trx, tenant, 'tenant_external_entity_mappings')
      .where({
        integration_type: integrationType,
        alga_entity_type: 'contact',
        external_realm_id: args.integrationId,
        external_entity_id: normalized.key,
      })
      .first<{ id: string }>('id');

    if (existing?.id) {
      await table(trx, tenant, 'tenant_external_entity_mappings')
        .where({ id: existing.id })
        .update({ alga_entity_id: args.contactId, sync_status: 'synced', updated_at: trx.fn.now() });
    } else {
      await mappings.insert({
        tenant,
        integration_type: integrationType,
        alga_entity_type: 'contact',
        alga_entity_id: args.contactId,
        external_entity_id: normalized.key,
        external_realm_id: args.integrationId,
        sync_status: 'synced',
        metadata: { rawUser: args.rawUser },
      });
    }
  } else {
    await mappings
      .where({
        integration_type: integrationType,
        alga_entity_type: 'contact',
        external_realm_id: args.integrationId,
        external_entity_id: normalized.key,
      })
      .delete();
    return { key: normalized.key, assignedAssetIds: [] };
  }

  const assigned: string[] = [];

  if (args.assignAssetId) {
    await setAssetAssignee(trx, tenant, args.assignAssetId, args.contactId, {
      actorUserId: args.actorUserId ?? null,
      source: 'manual',
      note: args.rawUser,
    });
    assigned.push(args.assignAssetId);
  }

  // In `auto` mode the rest of the organization follows; in `suggest` the
  // operator stays in control of each device.
  //
  // Only organizations mapped to the contact's own client follow along. An
  // integration covering several clients will happily report the same
  // `CORP\jdoe` on another client's device, and assigning our contact there is
  // both wrong and fatal: the assignment helper rejects a contact from another
  // client, and the throw rolled back this whole transaction — losing the
  // explicit mapping and the assignment the operator actually clicked.
  const contactClient = await table(trx, tenant, 'contacts')
    .where({ contact_name_id: args.contactId })
    .first<{ client_id: string | null }>('client_id');

  const organizations = contactClient?.client_id
    ? await table(trx, tenant, 'rmm_organization_mappings')
        .where({
          integration_id: args.integrationId,
          contact_assignment_mode: 'auto',
          client_id: contactClient.client_id,
        })
        .select<Array<{ external_organization_id: string; client_id: string | null }>>(
          'external_organization_id',
          'client_id'
        )
    : [];

  for (const organization of organizations) {
    if (!organization.client_id) continue;
    const assets = await table(trx, tenant, 'assets')
      .where({
        rmm_provider: args.provider,
        rmm_organization_id: organization.external_organization_id,
        client_id: organization.client_id,
      })
      .select<Array<{ asset_id: string }>>('asset_id');

    const candidateIds = assets.map((asset) => String(asset.asset_id)).filter((id) => !assigned.includes(id));
    const signedIn = await signedInUsersForAssets(trx, tenant, candidateIds);

    for (const assetId of candidateIds) {
      const reported = normalizeRmmUsername(signedIn.get(assetId));
      if (!reported || reported.key !== normalized.key) continue;

      const open = await getOpenAssetAssignment(trx, tenant, assetId);
      if (open && open.source !== 'rmm') continue;
      if (open && open.contact_name_id === args.contactId) continue;

      try {
        await setAssetAssignee(trx, tenant, assetId, args.contactId, {
          actorUserId: args.actorUserId ?? null,
          source: 'rmm',
          provider: args.provider,
          note: signedIn.get(assetId) ?? args.rawUser,
        });
      } catch (error) {
        // One device the follow-along cannot take (a workspace member, say) is
        // not a reason to lose the mapping and every other assignment.
        if (isAssetAssigneeError(error)) continue;
        throw error;
      }
      assigned.push(assetId);
    }
  }

  return { key: normalized.key, assignedAssetIds: assigned };
}

/**
 * FR-D7: the distinct signed-in user names an organization's devices report,
 * with device counts and the contact each one resolves to.
 */
export async function listSignedInUsersForOrganization(
  conn: Knex | Knex.Transaction,
  tenant: string,
  args: { integrationId: string; externalOrganizationId: string }
): Promise<RmmSignedInUserRow[]> {
  const mapping = await table(conn, tenant, 'rmm_organization_mappings')
    .where({
      integration_id: args.integrationId,
      external_organization_id: args.externalOrganizationId,
    })
    .first<{ client_id?: string | null }>('client_id');
  if (!mapping?.client_id) return [];

  const integration = await table(conn, tenant, 'rmm_integrations')
    .where({ integration_id: args.integrationId })
    .first<{ provider: string }>('provider');
  if (!integration?.provider) return [];

  const assets = await table(conn, tenant, 'assets')
    .where({
      rmm_provider: integration.provider,
      rmm_organization_id: args.externalOrganizationId,
    })
    .select<Array<{ asset_id: string }>>('asset_id');

  const signedIn = await signedInUsersForAssets(conn, tenant, assets.map((asset) => String(asset.asset_id)));

  // `CORP\jdoe` and `jdoe@acme.com` are different keys on purpose: they are
  // different identifiers and an MSP may want to map them separately.
  const grouped = new Map<string, { samples: Set<string>; deviceCount: number }>();
  for (const raw of signedIn.values()) {
    const normalized = normalizeRmmUsername(raw);
    if (!normalized) continue;
    const bucket = grouped.get(normalized.key) ?? { samples: new Set<string>(), deviceCount: 0 };
    bucket.samples.add(raw);
    bucket.deviceCount += 1;
    grouped.set(normalized.key, bucket);
  }

  const rows: RmmSignedInUserRow[] = [];
  for (const [key, bucket] of grouped) {
    const sample = [...bucket.samples][0];
    const normalized = normalizeRmmUsername(sample)!;
    const match = await matchContactForRmmUser(
      conn,
      tenant,
      mapping.client_id,
      args.integrationId,
      integration.provider,
      normalized
    );
    const contactName = match
      ? (await table(conn, tenant, 'contacts')
          .where({ contact_name_id: match.contactId })
          .first<{ full_name?: string | null }>('full_name'))?.full_name ?? null
      : null;

    rows.push({
      rawUser: sample,
      key,
      samples: [...bucket.samples],
      deviceCount: bucket.deviceCount,
      contactId: match?.contactId ?? null,
      contactName,
      method: match?.method ?? null,
    });
  }

  return rows.sort((a, b) => b.deviceCount - a.deviceCount || a.key.localeCompare(b.key));
}
