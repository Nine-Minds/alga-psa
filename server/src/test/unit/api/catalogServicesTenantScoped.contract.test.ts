// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

const catalogServices = [
  'server/src/lib/api/services/ProductCatalogService.ts',
  'server/src/lib/api/services/ServiceCatalogService.ts',
];

describe('catalog API services tenant-scoped query contract', () => {
  it('uses structural tenant scoping for catalog list roots and price lookups', () => {
    for (const relativePath of catalogServices) {
      const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

      expect(source).toContain('tenantDb(');
      expect(source).toContain(".table('service_catalog as sc')");      expect(source).toContain(".table('service_prices')");
      expect(source).not.toContain("knex('service_catalog as sc').where({ 'sc.tenant': tenant })");
      expect(source).not.toMatch(/knex\('service_prices'\)\s*\.where\(\{ tenant \}\)/);
      expect(source).not.toMatch(/knex\('service_catalog as sc'\)\s*\.leftJoin/);
      expect(source).not.toMatch(/knex\('service_catalog'\)\s*\.where\(\{ service_id: id, tenant \}\)/);
      expect(source).not.toMatch(/knex\('service_prices'\)\s*\.where\(\{ service_id: (id|serviceId), tenant \}\)/);
    }
  });
});
