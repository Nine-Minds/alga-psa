import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const serviceCatalogSource = readFileSync(resolve(__dirname, 'serviceCatalogActions.ts'), 'utf8');

describe('project catalog and material tenant-scoped query contract', () => {
  it('uses structural tenant scoping for service catalog roots', () => {
    expect(serviceCatalogSource).toContain("tenantScopedTable(trx, 'service_catalog as sc', tenant)");
    expect(serviceCatalogSource).not.toContain("'sc.tenant': tenant");
  });
});
