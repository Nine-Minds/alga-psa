import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AssetQueryParams } from '@alga-psa/types';

/**
 * The filterable subset of {@link AssetQueryParams}.
 *
 * Pagination, sort and extension-data flags are deliberately absent: they shape
 * the *page*, not the *result set*, so anything counting the result set (the
 * dashboard's by-type breakdown) must not be able to pass them by accident.
 *
 * `agent_status` widens to `string` because both callers pass the output of a
 * zod schema that validates it as a free string (the slug set is tenant-owned);
 * the DB comparison is identical either way.
 */
export type AssetListFilterParams =
  Pick<
    AssetQueryParams,
    | 'client_id'
    | 'location_id'
    | 'contact_name_id'
    | 'asset_type'
    | 'status'
    | 'ownership'
    | 'in_custody'
    | 'vendor_id'
    | 'group_id'
    | 'ungrouped_only'
    | 'search'
    | 'rmm_managed'
  > & { agent_status?: string };

function tenantScopedTable(
    conn: Knex | Knex.Transaction,
    table: string,
    tenant: string,
): Knex.QueryBuilder {
    return tenantDb(conn, tenant).table(table);
}

/**
 * Joins the relations the asset list reads and filters on.
 *
 * `clients` is required by the search predicate (`clients.client_name`);
 * `contacts`/`vendors` feed the list columns and stay joined so the same built
 * query serves both the count and the row fetch. Every join carries the tenant
 * predicate through `tenantDb.tenantJoin` — required under Citus, where a join
 * without the shard key fans out to every shard.
 */
export function joinAssetListRelations(
    trx: Knex.Transaction,
    tenant: string,
): Knex.QueryBuilder {
    const db = tenantDb(trx, tenant);
    const query = tenantScopedTable(trx, 'assets', tenant);
    db.tenantJoin(query, 'clients', 'clients.client_id', 'assets.client_id', { type: 'left' });
    db.tenantJoin(query, 'contacts', 'contacts.contact_name_id', 'assets.contact_name_id', { type: 'left' });
    db.tenantJoin(query, 'vendors', 'vendors.vendor_id', 'assets.vendor_id', { type: 'left' });
    return query;
}

export interface ApplyAssetListFiltersOptions {
    trx: Knex.Transaction;
    tenant: string;
    params: AssetListFilterParams;
    /**
     * Skip a predicate the caller filters elsewhere. The by-type breakdown sets
     * this to `'asset_type'` so each bubble reports how many assets of *that*
     * type match the other filters — facet semantics, where selecting a type
     * never zeroes out the remaining bubbles.
     */
    exclude?: 'asset_type';
}

/**
 * Shared asset-list predicates, applied in place to any query built by
 * {@link joinAssetListRelations}.
 *
 * `listAssets` and `getAssetCountsByType` must agree on what "matching the
 * current filters" means, or the dashboard's type bubbles drift from the grid
 * they filter. Extracting the block rather than duplicating it is what keeps
 * them honest.
 */
export function applyAssetListFilters(
    query: Knex.QueryBuilder,
    { trx, tenant, params, exclude }: ApplyAssetListFiltersOptions,
): Knex.QueryBuilder {
    if (params.client_id) {
        query.where('assets.client_id', params.client_id);
    }
    if (params.location_id) {
        query.where('assets.location_id', params.location_id);
    }
    if (params.contact_name_id) {
        query.where('assets.contact_name_id', params.contact_name_id);
    }
    if (params.asset_type && exclude !== 'asset_type') {
        query.where('assets.asset_type', params.asset_type);
    }
    if (params.status) {
        query.where('assets.status', params.status);
    }
    if (params.ownership) {
        query.where('assets.ownership', params.ownership);
    }
    if (params.in_custody !== undefined) {
        // Keyed off the open custody episode, never off assets.status.
        const openCustody = tenantScopedTable(trx, 'asset_custody', tenant)
            .whereNull('closed_at')
            .select('asset_id');
        if (params.in_custody) {
            query.whereIn('assets.asset_id', openCustody);
        } else {
            query.whereNotIn('assets.asset_id', openCustody);
        }
    }
    if (params.vendor_id) {
        query.where('assets.vendor_id', params.vendor_id);
    }
    if (params.group_id) {
        query.whereIn(
            'assets.asset_id',
            tenantScopedTable(trx, 'asset_group_members', tenant)
                .where({ group_id: params.group_id })
                .select('asset_id')
        );
    }
    if (params.ungrouped_only) {
        query.whereNotIn(
            'assets.asset_id',
            tenantScopedTable(trx, 'asset_group_members', tenant).select('asset_id')
        );
    }
    if (params.search) {
        const searchTerm = `%${params.search}%`;
        query.where(function () {
            this.whereILike('assets.name', searchTerm)
                .orWhereILike('assets.asset_tag', searchTerm)
                .orWhereILike('assets.serial_number', searchTerm)
                .orWhereILike('assets.location', searchTerm)
                .orWhereILike('assets.manufacturer', searchTerm)
                .orWhereILike('assets.model', searchTerm)
                .orWhereILike('clients.client_name', searchTerm);
        });
    }
    if (params.agent_status) {
        query.where('assets.agent_status', params.agent_status);
    }
    if (params.rmm_managed !== undefined) {
        if (params.rmm_managed) {
            query.whereNotNull('assets.rmm_provider').whereNotNull('assets.rmm_device_id');
        } else {
            query.where(function () {
                this.whereNull('assets.rmm_provider').orWhereNull('assets.rmm_device_id');
            });
        }
    }

    return query;
}
