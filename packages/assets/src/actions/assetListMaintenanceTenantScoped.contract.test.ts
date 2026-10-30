import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'assetActions.ts'), 'utf8');
// The list predicates (and the joins they depend on) were extracted into a
// shared builder so the grid and the dashboard's by-type counts cannot drift.
// The tenant-scoping contract for those predicates is asserted against that file.
const listFilterSource = readFileSync(
    resolve(__dirname, '..', 'lib', 'assetListFilters.ts'),
    'utf8',
);

function sourceBetween(start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);

    return source.slice(startIndex, endIndex);
}

describe('asset list and maintenance tenant-scoped query contract', () => {
    it('uses structural tenant scoping for list and maintenance roots', () => {
        const listSection = sourceBetween(
            'export const listAssets',
            '// Maintenance Schedule Management',
        );
        const maintenanceSection = sourceBetween(
            'export const updateMaintenanceSchedule',
            'async function fetchAssetHistory',
        );

        expect(listSection).toContain('joinAssetListRelations(trx, tenant)');
        expect(listSection).toContain('applyAssetListFilters(query, { trx, tenant, params: validatedParams })');
        expect(listSection).not.toContain(".where('assets.tenant', tenant)");
        // The list root and every join carry the tenant predicate structurally.
        expect(listFilterSource).toContain("tenantDb(conn, tenant).table(table)");
        expect(listFilterSource).toContain("db.tenantJoin(query, 'clients', 'clients.client_id', 'assets.client_id'");
        // Assigned-to filter and the tenant-scoped contact join that names the assignee.
        expect(listFilterSource).toContain("query.where('assets.contact_name_id', params.contact_name_id)");
        expect(listFilterSource).toContain("db.tenantJoin(query, 'contacts', 'contacts.contact_name_id', 'assets.contact_name_id'");
        expect(listFilterSource).not.toContain(".where('assets.tenant', tenant)");
        expect(maintenanceSection).toContain("tenantScopedTable(trx, 'asset_maintenance_schedules', tenant)");
        expect(maintenanceSection).toContain("tenantScopedTable(trx, 'asset_maintenance_notifications', tenant)");
        expect(maintenanceSection).toContain("tenantScopedTable(db, 'assets', tenant)");
        expect(maintenanceSection).toContain("tenantScopedTable(db, 'asset_maintenance_schedules', tenant)");
        expect(maintenanceSection).toContain("tenantScopedTable(db, 'asset_maintenance_history', tenant)");
        expect(maintenanceSection).toContain("tenantScopedTable(db, 'asset_maintenance_notifications', tenant)");
        expect(maintenanceSection).not.toContain('.where({ tenant, schedule_id');
        expect(maintenanceSection).not.toContain('.where({ tenant, asset_id');
        expect(maintenanceSection).not.toContain('tenant,\n                    schedule_id: validatedData.schedule_id');
    });
});
