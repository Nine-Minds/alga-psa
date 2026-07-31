import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function collectProductionSources(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        return collectProductionSources(path);
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.contract.test.ts')) {
        return [];
      }
      return [path];
    });
}

describe('asset package tenant-scoped support query contract', () => {
  it('keeps action and lib tenant table roots behind tenantDb', () => {
    const inventoryProvenanceFile = resolve(__dirname, 'assetInventoryActions.ts');
    const sourceFiles = [
      ...collectProductionSources(resolve(__dirname)),
      ...collectProductionSources(resolve(__dirname, '../lib')),
    ].filter((file) => file !== inventoryProvenanceFile);

    const directRootPattern = /\b(?:knex|trx|db)(?:<[^>]+>)?\(\s*['"`][a-zA-Z_][\w]*(?:\s+as\s+[\w]+)?['"`]\s*\)/;
    const directTenantObjectWherePattern = /\.(?:where|andWhere)\(\s*\{(?:(?!\}\s*\)).)*\btenant\s*:/s;
    const directTenantColumnWherePattern = /\.(?:where|andWhere)\(\s*['"`][^'"`]*tenant['"`]\s*,/;
    const directTenantJoinPattern = /\.andOn\(\s*['"`][^'"`]*tenant['"`][\s\S]{0,200}\)/;

    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8');

      expect(source, file).not.toMatch(directRootPattern);
      expect(source, file).not.toMatch(directTenantObjectWherePattern);
      expect(source, file).not.toMatch(directTenantColumnWherePattern);
      expect(source, file).not.toMatch(directTenantJoinPattern);
    }
  });

  it('keeps cycle-safe inventory provenance roots explicitly tenant-pinned', () => {
    const source = readFileSync(resolve(__dirname, 'assetInventoryActions.ts'), 'utf8');
    const directRootPattern = /\btrx\(\s*['"`]([a-zA-Z_][\w]*)['"`]\s*\)/g;
    const roots = [...source.matchAll(directRootPattern)];

    expect(roots.map((match) => match[1])).toEqual([
      'assets',
      'stock_units',
      'service_catalog',
      'stock_movements',
      'sales_orders',
      'rma_cases',
    ]);

    for (const root of roots) {
      const queryPrefix = source.slice(root.index, root.index! + 180);
      expect(queryPrefix, `tenant predicate for ${root[1]}`).toMatch(
        /\.where\(\s*\{\s*tenant(?:\s*[,}])/
      );
    }
  });

  it('registers asset support tables and views in tenant metadata', () => {
    const metadataSource = readFileSync(
      resolve(__dirname, '../../../db/src/lib/tenantTableMetadata.ts'),
      'utf8'
    );

    expect(metadataSource).toContain("asset_type_registry: { scope: 'tenant' }");
    expect(metadataSource).toContain("software_catalog: { scope: 'tenant' }");
    expect(metadataSource).toContain("v_asset_software_details: { scope: 'tenant' }");
    expect(metadataSource).toContain("asset_facts: { scope: 'tenant' }");
  });
});
