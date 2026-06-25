import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'assetActions.ts'), 'utf8');

function sourceBetween(start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);

    return source.slice(startIndex, endIndex);
}

describe('asset action helper tenant-scoped query contract', () => {
    it('uses structural tenant scoping for authorization, location, and extension helper roots', () => {
        const helperSection = sourceBetween(
            'async function resolveValidatedAssetLocation',
            '// Export getAsset',
        );

        expect(source).toContain("import { createTenantKnex, createTenantScopedQuery } from '@alga-psa/db'");
        expect(source).toContain('function tenantScopedTable(');
        expect(helperSection).toContain("tenantScopedTable(trx, 'client_locations', tenant)");
        expect(helperSection).toContain("tenantScopedTable(trx, 'user_roles', tenant)");
        expect(helperSection).toContain("tenantScopedTable(trx, 'team_members', tenant)");
        expect(helperSection).toContain("tenantScopedTable(trx, 'users', tenant)");
        expect(helperSection).toContain("tenantScopedTable(trx, 'asset_associations', tenant)");
        expect(helperSection).toContain("tenantScopedTable(trx, 'assets', tenant)");
        expect(helperSection).toContain("tenantScopedTable(knex, 'workstation_assets', tenant)");
        expect(helperSection).toContain("tenantScopedTable(knex, table, tenant)");
        expect(helperSection).not.toContain('.where({ tenant, user_id: user.user_id');
        expect(helperSection).not.toContain('.where({ tenant, reports_to: user.user_id');
        expect(helperSection).not.toContain('.where({ tenant })');
        expect(helperSection).not.toContain('.where({ tenant, asset_id');
        expect(helperSection).not.toContain('.where({ tenant, client_id');
    });
});
