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

describe('asset delete tenant-scoped query contract', () => {
    it('uses structural tenant scoping for asset delete cleanup roots', () => {
        const deleteSection = sourceBetween(
            'export const deleteAsset',
            'export const bulkDeleteAssets',
        );

        expect(deleteSection).toContain("tenantScopedTable(trx as Knex.Transaction, 'assets', tenantId)");
        expect(deleteSection).toContain("tenantScopedTable(trx as Knex.Transaction, subtypeTable, tenantId)");
        expect(deleteSection).toContain("tenantScopedTable(trx as Knex.Transaction, 'asset_history', tenantId)");
        expect(deleteSection).toContain("tenantScopedTable(trx as Knex.Transaction, 'asset_relationships', tenantId)");
        expect(deleteSection).toContain("tenantScopedTable(trx as Knex.Transaction, 'document_associations', tenantId)");
        expect(deleteSection).toContain("tenantScopedTable(trx as Knex.Transaction, 'ticket_entity_links', tenantId)");
        expect(deleteSection).toContain("tenantScopedTable(trx as Knex.Transaction, 'tenant_external_entity_mappings', tenantId)");
        expect(deleteSection).toContain("tenantScopedTable(trx as Knex.Transaction, 'external_entity_mappings', tenantId)");
        expect(deleteSection).toContain("tenantScopedTable(trx as Knex.Transaction, 'import_job_items', tenantId)");
        expect(deleteSection).not.toContain('.where({ tenant: tenantId, asset_id');
        expect(deleteSection).not.toContain('.where({ tenant: tenantId, parent_asset_id: asset_id })');
        expect(deleteSection).not.toContain('.orWhere({ tenant: tenantId, child_asset_id: asset_id })');
        expect(deleteSection).not.toContain(".where({ tenant: tenantId, entity_type: 'asset', entity_id: asset_id })");
    });
});
