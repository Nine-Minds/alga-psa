import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AuthorizationRecord } from '@alga-psa/authorization/kernel';
import type { Asset } from '@alga-psa/types';

/**
 * Builds the record-level authorization context for assets (assignees, teams,
 * owning client). Shared by asset server actions and the inventory scan lookup
 * so both evaluate the asset authorization kernel against identical records.
 */
export async function resolveAssetAuthorizationRecords(
    trx: Knex | Knex.Transaction,
    tenant: string,
    assets: Array<Pick<Asset, 'asset_id' | 'client_id'>>
): Promise<Map<string, AuthorizationRecord>> {
    const assetIds = assets.map((asset) => asset.asset_id);
    if (assetIds.length === 0) {
        return new Map();
    }

    const associationRows = await tenantDb(trx, tenant)
        .table('asset_associations')
        .whereIn('asset_id', assetIds)
        .select<Array<{ asset_id: string; entity_type: string; entity_id: string }>>('asset_id', 'entity_type', 'entity_id');

    const associationsByAsset = new Map<string, Array<{ entity_type: string; entity_id: string }>>();
    for (const row of associationRows) {
        const existing = associationsByAsset.get(row.asset_id) ?? [];
        existing.push({ entity_type: row.entity_type, entity_id: row.entity_id });
        associationsByAsset.set(row.asset_id, existing);
    }

    const records = new Map<string, AuthorizationRecord>();
    for (const asset of assets) {
        const associations = associationsByAsset.get(asset.asset_id) ?? [];
        const assignedUserIds = associations
            .filter((association) => association.entity_type === 'user')
            .map((association) => association.entity_id);
        const teamIds = associations
            .filter((association) => association.entity_type === 'team')
            .map((association) => association.entity_id);

        records.set(asset.asset_id, {
            id: asset.asset_id,
            ownerUserId: assignedUserIds[0] ?? null,
            assignedUserIds,
            clientId: asset.client_id ?? null,
            teamIds,
        });
    }

    return records;
}
