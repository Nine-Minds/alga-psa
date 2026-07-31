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

        expect(listSection).toContain("tenantScopedTable(trx, 'assets', tenant)");
        expect(listSection).not.toContain(".where('assets.tenant', tenant)");
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
