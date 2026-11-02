import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'assetActions.ts'), 'utf8');
// Subject / record resolution for asset read authorization was extracted from assetActions.ts
// (alga-2026-0002683 C2) so the label code paths share it. It is tenant-scoped structurally through
// tenantDb(trx, tenant).table(...), which is the same guarantee tenantScopedTable gives the actions.
// The implementation now lives in @alga-psa/authorization so document authorization can share it;
// packages/assets/src/lib/assetReadAuthorization.ts re-exports it.
const readAuthSource = readFileSync(resolve(__dirname, '../../../authorization/src/assetReadAuthorization.ts'), 'utf8');

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

        expect(source).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db'");
        expect(source).toContain('function tenantScopedTable(');
        expect(source).not.toContain('createTenantScopedQuery');
        expect(helperSection).toContain("tenantScopedTable(trx, 'client_locations', tenant)");
        // The authorization helper tables no longer live in assetActions.ts; they must not creep back.
        for (const table of ['user_roles', 'team_members', 'users', 'asset_associations']) {
            expect(helperSection).not.toContain(`'${table}'`);
        }
        expect(helperSection).toContain('resolveSharedAuthorizationSubject(trx, tenant, user)');
        expect(helperSection).toContain('resolveSharedAssetAuthorizationRecords(trx, tenant, assets)');
        expect(helperSection).toContain("tenantScopedTable(trx, 'assets', tenant)");
        expect(helperSection).toContain("tenantScopedTable(knex, 'workstation_assets', tenant)");
        expect(helperSection).toContain("tenantScopedTable(knex, table, tenant)");
        expect(helperSection).not.toContain('await knex(table).insert');
        expect(helperSection).not.toContain('.where({ tenant, user_id: user.user_id');
        expect(helperSection).not.toContain('.where({ tenant, reports_to: user.user_id');
        expect(helperSection).not.toContain('.where({ tenant })');
        expect(helperSection).not.toContain('.where({ tenant, asset_id');
        expect(helperSection).not.toContain('.where({ tenant, client_id');
    });

    it('keeps the extracted asset read authorization helpers structurally tenant-scoped', () => {
        expect(readAuthSource).toContain("import { tenantDb } from '@alga-psa/db'");
        expect(readAuthSource).toContain('const db = tenantDb(trx, tenant);');
        expect(readAuthSource).toContain("db.table('user_roles')");
        expect(readAuthSource).toContain("db.table('team_members')");
        expect(readAuthSource).toContain("db.table('users')");
        expect(readAuthSource).toContain("tenantDb(trx, tenant)\n    .table('asset_associations')");
        // No raw knex(table) root and no hand-written tenant predicates.
        expect(readAuthSource).not.toMatch(/\b(trx|knex)\(\s*['"`a-z_]/);
        expect(readAuthSource).not.toContain('.where({ tenant');
    });
});
