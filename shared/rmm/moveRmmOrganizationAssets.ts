import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isMissingAssetGroupTable, setAssetAssignee } from '../models/assetAssignmentModel';

/**
 * FR-G4: re-point an RMM organization's assets when its mapped client changes.
 *
 * Before this, Level.io and Tanium re-stamped `client_id` on every sync (which
 * reverted manual moves) while NinjaOne never did, so re-pointing an
 * organization moved its devices late or not at all. The move now happens in
 * the same transaction as the mapping update, for every provider:
 *
 *  - `client_id` is re-pointed;
 *  - the assignee is cleared through the assignment helper (source `system`),
 *    because the contact belongs to the previous client;
 *  - `billing_profile_id` and `location_id` are cleared for the same reason;
 *  - group membership is removed (FR-E5), because the group is the old
 *    client's;
 *  - `asset_history` records the move on each asset.
 *
 * Assets are found by `rmm_provider + rmm_organization_id`, plus any asset
 * whose `tenant_external_entity_mappings` row points at this organization —
 * an older row may predate `rmm_organization_id` being written.
 */
export interface MoveRmmOrganizationAssetsArgs {
  integrationId: string;
  provider: string;
  externalOrganizationId: string;
  newClientId: string;
  actorUserId?: string | null;
}

function table(trx: Knex | Knex.Transaction, tenant: string, name: string): Knex.QueryBuilder<any, any> {
  return tenantDb(trx, tenant).table(name) as Knex.QueryBuilder<any, any>;
}

/** The asset ids an RMM organization owns, by either identification route. */
export async function findRmmOrganizationAssetIds(
  conn: Knex | Knex.Transaction,
  tenant: string,
  args: Pick<MoveRmmOrganizationAssetsArgs, 'provider' | 'externalOrganizationId'>
): Promise<string[]> {
  const byColumn: string[] = await table(conn, tenant, 'assets')
    .where({ rmm_provider: args.provider, rmm_organization_id: args.externalOrganizationId })
    .pluck('asset_id');

  const byMapping: string[] = await table(conn, tenant, 'tenant_external_entity_mappings')
    .where({
      integration_type: args.provider,
      alga_entity_type: 'asset',
      external_realm_id: args.externalOrganizationId,
    })
    .pluck('alga_entity_id');

  return Array.from(new Set([...byColumn, ...byMapping].map(String).filter(Boolean)));
}

export async function countRmmOrganizationAssets(
  conn: Knex | Knex.Transaction,
  tenant: string,
  args: Pick<MoveRmmOrganizationAssetsArgs, 'provider' | 'externalOrganizationId'>
): Promise<number> {
  return (await findRmmOrganizationAssetIds(conn, tenant, args)).length;
}

export async function moveRmmOrganizationAssets(
  trx: Knex.Transaction,
  tenant: string,
  args: MoveRmmOrganizationAssetsArgs
): Promise<{ moved: number; assetIds: string[] }> {
  const assetIds = await findRmmOrganizationAssetIds(trx, tenant, args);
  const moved: string[] = [];

  for (const assetId of assetIds) {
    const asset = await table(trx, tenant, 'assets')
      .where({ asset_id: assetId })
      .first<{ client_id: string; contact_name_id: string | null }>('client_id', 'contact_name_id');
    if (!asset || asset.client_id === args.newClientId) continue;

    // The assignee goes first and through the helper, so the open assignment
    // row is closed and the history records why.
    if (asset.contact_name_id) {
      await setAssetAssignee(trx, tenant, assetId, null, {
        actorUserId: args.actorUserId ?? null,
        source: 'system',
        note: 'RMM organization moved to another client',
        allowWorkspaceMember: true,
      });
    }

    // FR-E5/F068: leaving the group is its own event, so the asset's timeline
    // says "removed from <group>" rather than only "client changed". Inlined
    // rather than calling the assets package: this runs on the workflow worker,
    // which sits below `packages/` in the dependency graph.
    let removedGroup: { group_id: string; name: string; kind: string } | null = null;
    try {
      const member = await table(trx, tenant, 'asset_group_members')
        .where({ asset_id: assetId })
        .first<{ group_id: string }>('group_id');
      if (member?.group_id) {
        removedGroup = await table(trx, tenant, 'asset_groups')
          .where({ group_id: member.group_id })
          .first<{ group_id: string; name: string; kind: string }>('group_id', 'name', 'kind');
        await table(trx, tenant, 'asset_group_members').where({ asset_id: assetId }).delete();
      }
    } catch (error) {
      // The group tables arrive in a later migration; anything else aborts
      // the move rather than moving the asset half way.
      if (!isMissingAssetGroupTable(error)) throw error;
    }

    // `asset_history.changed_by` is nullable since 20261009125200, so a move
    // triggered without a session still shows on the asset's timeline.
    if (removedGroup) {
      await table(trx, tenant, 'asset_history').insert({
        tenant,
        asset_id: assetId,
        changed_by: args.actorUserId ?? null,
        change_type: 'group_removed',
        changes: {
          group_id: removedGroup.group_id,
          group_name: removedGroup.name,
          group_kind: removedGroup.kind,
          source: 'rmm_organization_move',
        },
        changed_at: new Date().toISOString(),
      });
    }

    await table(trx, tenant, 'assets')
      .where({ asset_id: assetId })
      .update({
        client_id: args.newClientId,
        // A profile and a location belong to one client.
        billing_profile_id: null,
        location_id: null,
        location: '',
        updated_at: new Date().toISOString(),
      });

    await table(trx, tenant, 'asset_history').insert({
      tenant,
      asset_id: assetId,
      changed_by: args.actorUserId ?? null,
      change_type: 'updated',
      changes: {
        source: 'rmm_organization_move',
        previous_client_id: asset.client_id,
        client_id: args.newClientId,
        external_organization_id: args.externalOrganizationId,
      },
      changed_at: new Date().toISOString(),
    });

    moved.push(assetId);
  }

  return { moved: moved.length, assetIds: moved };
}
