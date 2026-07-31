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

describe('asset update/detail tenant-scoped query contract', () => {
    it('uses structural tenant scoping for update asset and detail relationship roots', () => {
        const updateSection = sourceBetween(
            'export async function updateAssetRecord',
            'export const updateAsset',
        );
        const detailSection = sourceBetween(
            'async function getAssetWithExtensions',
            'export const createAssetRelationship',
        );

        expect(updateSection).toContain("tenantScopedTable(trx, 'assets', tenant)");
        expect(updateSection).not.toContain('.where({ tenant, asset_id })');
        expect(detailSection).toContain("tenantScopedTable(knex, 'assets', tenant)");
        expect(detailSection).toContain("tenantScopedTable(knex, 'asset_relationships as ar', tenant)");
        expect(detailSection).toContain("tenantScopedTable(trx, 'asset_relationships as ar', tenant)");
        expect(detailSection).not.toContain(".where({ 'assets.tenant': tenant, 'assets.asset_id': asset_id })");
        expect(detailSection).not.toContain(".where('ar.tenant', tenant)");
    });
});
