import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'assetActions.ts'), 'utf8');

function sourceBetween(start: string): string {
    const startIndex = source.indexOf(start);

    expect(startIndex).toBeGreaterThanOrEqual(0);

    return source.slice(startIndex);
}

describe('asset lower helper and association tenant-scoped query contract', () => {
    it('uses structural tenant scoping for lower helper, association, summary, and security roots', () => {
        const section = sourceBetween('async function fetchAssetHistory');

        expect(section).toContain("tenantScopedTable(db, 'asset_history as ah', tenant)");
        expect(section).toContain("tenantScopedTable(db, 'asset_associations as aa', tenant)");
        expect(section).toContain("tenantScopedTable(db, 'documents', tenant)");
        expect(section).toContain("tenantScopedTable(db, 'assets', tenant)");
        expect(section).toContain("tenantScopedTable(db, 'clients', tenant)");
        expect(section).toContain("tenantScopedTable(db, 'asset_maintenance_schedules', tenant)");
        expect(section).toContain("tenantScopedTable(db, 'asset_maintenance_history', tenant)");
        expect(section).toContain("tenantScopedTable(trx, 'asset_associations', tenant)");
        expect(section).toContain("tenantScopedTable(trx, 'assets', tenant)");
        expect(section).toContain("tenantScopedTable(knex, 'workstation_assets', tenant)");
        expect(section).toContain("tenantScopedTable(knex, 'server_assets', tenant)");
        expect(section).not.toContain(".where({ 'ah.tenant': tenant, 'ah.asset_id': asset_id })");
        expect(section).not.toContain(".where('documents.tenant', tenant)");
        expect(section).not.toContain(".where({ tenant, client_id })");
        expect(section).not.toContain(".where({ 'assets.tenant': tenant");
        expect(section).not.toContain(".where({ 'asset_maintenance_schedules.tenant': tenant })");
        expect(section).not.toContain('.where({ tenant })');
        expect(section).not.toContain('.where({ tenant, asset_id');
        expect(section).not.toContain(".where('asset_associations.tenant', tenant)");
    });
});
