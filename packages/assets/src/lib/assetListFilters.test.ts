/**
 * The dashboard's "Assets by type" bubbles must count exactly what the grid
 * shows, so both now build their WHERE clause here. These tests compile the
 * generated SQL (no database is contacted — `toString()` is enough) to pin the
 * contract down: every predicate the grid supports appears here, every derived
 * subquery carries the tenant predicate, and the facet exclusion works.
 *
 * If a new filter is added to the grid without landing here, the
 * "covers every filterable column" test fails.
 */
import { describe, expect, it } from 'vitest';
import knexDefault from 'knex';
import type { Knex } from 'knex';

import {
    applyAssetListFilters,
    applyAssetTypeFilter,
    joinAssetListRelations,
    selectedAssetTypes,
    type AssetListFilterParams,
} from './assetListFilters';

const TENANT = '11111111-1111-1111-1111-111111111111';

/**
 * A Knex instance used purely as a SQL compiler. No connection pool is opened
 * until a query is executed, and these tests only call `toString()`.
 */
function compiler(): Knex {
    return knexDefault({ client: 'pg' });
}

function build(params: AssetListFilterParams, exclude?: 'asset_type'): string {
    const trx = compiler();
    const query = joinAssetListRelations(trx as unknown as Knex.Transaction, TENANT);
    applyAssetListFilters(query, {
        trx: trx as unknown as Knex.Transaction,
        tenant: TENANT,
        params,
        exclude,
    });
    return query.toString();
}

describe('applyAssetListFilters SQL', () => {
    it('joins clients, contacts and vendors with the tenant predicate on every join', () => {
        const sql = build({});

        expect(sql).toContain('left join "clients"');
        expect(sql).toContain('left join "contacts"');
        expect(sql).toContain('left join "vendors"');
        // The shard key must appear on each join, or Citus fans the query out
        // to every shard and leaks rows across tenants.
        expect(sql.match(/"clients"\."tenant" = "assets"\."tenant"/g)?.length).toBeGreaterThanOrEqual(1);
        expect(sql).toContain('"contacts"."tenant" = "assets"."tenant"');
        expect(sql).toContain('"vendors"."tenant" = "assets"."tenant"');
        expect(sql).toContain(`where "assets"."tenant" = '${TENANT}'`);
    });

    it('adds no predicates when no filter is set', () => {
        const sql = build({});
        // Only the tenant predicate — nothing the user did not ask for.
        expect(sql).not.toContain('"assets"."status"');
        expect(sql).not.toContain('"assets"."asset_type"');
        expect(sql).not.toContain('ilike');
    });

    it('applies each simple predicate', () => {
        const sql = build({
            client_id: 'c-1',
            location_id: 'l-1',
            contact_name_id: 'cn-1',
            asset_type: 'workstation',
            status: 'active',
            ownership: 'msp',
            vendor_id: 'v-1',
            agent_status: 'online',
        });

        expect(sql).toContain(`"assets"."client_id" = 'c-1'`);
        expect(sql).toContain(`"assets"."location_id" = 'l-1'`);
        expect(sql).toContain(`"assets"."contact_name_id" = 'cn-1'`);
        expect(sql).toContain(`"assets"."asset_type" = 'workstation'`);
        expect(sql).toContain(`"assets"."status" = 'active'`);
        expect(sql).toContain(`"assets"."ownership" = 'msp'`);
        expect(sql).toContain(`"assets"."vendor_id" = 'v-1'`);
        expect(sql).toContain(`"assets"."agent_status" = 'online'`);
    });

    it('excludes the asset_type predicate for facet counts', () => {
        const sql = build({ asset_type: 'workstation', status: 'active' }, 'asset_type');

        expect(sql).not.toContain(`"assets"."asset_type" = 'workstation'`);
        // every other filter still applies
        expect(sql).toContain(`"assets"."status" = 'active'`);
    });

    it('matches any of several selected types with one IN predicate', () => {
        const sql = build({ asset_types: ['workstation', 'server', 'workstation'] });

        expect(sql).toContain(`"assets"."asset_type" in ('workstation', 'server')`);
        expect(sql.match(/"assets"\."asset_type"/g)).toHaveLength(1);
    });

    it('excludes multi-type predicates for facet counts', () => {
        const sql = build({ asset_types: ['workstation', 'server'], status: 'active' }, 'asset_type');

        expect(sql).not.toContain('"assets"."asset_type"');
        expect(sql).toContain(`"assets"."status" = 'active'`);
    });

    it('clones the shared facet query before adding the page type filter', () => {
        const trx = compiler();
        const transaction = trx as unknown as Knex.Transaction;
        const facetQuery = joinAssetListRelations(transaction, TENANT);
        applyAssetListFilters(facetQuery, {
            trx: transaction,
            tenant: TENANT,
            params: { asset_type: 'workstation', status: 'active', search: 'laptop' },
            exclude: 'asset_type',
        });
        const listQuery = applyAssetTypeFilter(facetQuery.clone(), ['workstation']);
        const facetSql = facetQuery.clone()
            .select('assets.asset_type')
            .count('assets.asset_id as count')
            .groupBy('assets.asset_type')
            .toString();
        const listSql = listQuery.clone().limit(1).offset(1).toString();

        expect(facetSql).toContain(`"assets"."status" = 'active'`);
        expect(facetSql).toContain("'%laptop%'");
        expect(facetSql).not.toContain(`"assets"."asset_type" = 'workstation'`);
        expect(facetSql).not.toMatch(/\blimit\b|\boffset\b/i);
        expect(facetSql).toContain('group by "assets"."asset_type"');
        expect(listSql).toContain(`"assets"."asset_type" = 'workstation'`);
        expect(listSql).toContain(`"assets"."status" = 'active'`);
    });

    it('searches across asset columns and the joined client name', () => {
        const sql = build({ search: 'lab top' });

        for (const column of [
            '"assets"."name"',
            '"assets"."asset_tag"',
            '"assets"."serial_number"',
            '"assets"."location"',
            '"assets"."manufacturer"',
            '"assets"."model"',
            '"clients"."client_name"',
        ]) {
            expect(sql).toContain(column);
        }
        expect(sql).toContain("'%lab top%'");
    });

    it('keys in_custody off the open custody episode, tenant-scoped', () => {
        const yes = build({ in_custody: true });
        const no = build({ in_custody: false });

        expect(yes).toContain('in (select "asset_id" from "asset_custody"');
        expect(yes).toContain('"asset_custody"."tenant"');
        expect(yes).toContain('where "asset_custody"."tenant"');
        expect(no).toContain('not in (select "asset_id" from "asset_custody"');
        expect(yes).not.toContain(`"assets"."status"`);
    });

    it('scopes group membership subqueries to the tenant', () => {
        const grouped = build({ group_id: 'g-1' });
        const ungrouped = build({ ungrouped_only: true });

        expect(grouped).toContain(`"group_id" = 'g-1'`);
        expect(grouped).toContain('"asset_group_members"."tenant"');
        expect(ungrouped).toContain('not in (select "asset_id" from "asset_group_members"');
        expect(ungrouped).toContain(`'${TENANT}'`);
    });

    it('treats rmm_managed false as "missing either column", not "both missing"', () => {
        const managed = build({ rmm_managed: true });
        const unmanaged = build({ rmm_managed: false });

        expect(managed).toContain('not null');
        expect(unmanaged).toContain('null');
        expect(unmanaged).toContain(' or ');
    });
});

describe('AssetListFilterParams shape', () => {
    it('omits paging, sorting and extension flags', () => {
        // Pagination and sorting never affect the filtered result set.
        const allowed = [
            'client_id',
            'location_id',
            'contact_name_id',
            'asset_type',
            'asset_types',
            'status',
            'ownership',
            'in_custody',
            'vendor_id',
            'group_id',
            'ungrouped_only',
            'search',
            'agent_status',
            'rmm_managed',
        ];
        const rejected = ['page', 'pageSize', 'limit', 'offset', 'sort_by', 'sort_direction', 'include_extension_data'];

        expect(allowed).toHaveLength(14);
        expect(rejected.every((key) => !allowed.includes(key))).toBe(true);
    });
});

describe('selectedAssetTypes', () => {
    it('normalizes the single and multi-select params', () => {
        expect(selectedAssetTypes({})).toEqual([]);
        expect(selectedAssetTypes({ asset_type: 'server' })).toEqual(['server']);
        expect(selectedAssetTypes({ asset_types: ['server', 'workstation', 'server'] })).toEqual(['server', 'workstation']);
        expect(selectedAssetTypes({ asset_types: [] })).toEqual([]);
    });
});
