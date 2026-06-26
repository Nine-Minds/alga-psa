import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const serviceCatalogSource = readFileSync(resolve(__dirname, 'serviceCatalogActions.ts'), 'utf8');
const materialCatalogSource = readFileSync(resolve(__dirname, 'materialCatalogActions.ts'), 'utf8');

describe('project catalog and material tenant-scoped query contract', () => {
  it('uses structural tenant scoping for service catalog roots', () => {
    expect(serviceCatalogSource).toContain("tenantScopedTable(trx, 'service_catalog as sc', tenant)");
    expect(serviceCatalogSource).not.toContain("'sc.tenant': tenant");
  });

  it('uses structural tenant scoping for material catalog roots', () => {
    expect(materialCatalogSource).toContain("tenantScopedTable(trx, 'service_catalog as sc', tenant)");
    expect(materialCatalogSource).toContain("tenantScopedTable(trx, 'service_prices', tenant)");
    expect(materialCatalogSource).toContain("tenantScopedTable(trx, 'project_materials as pm', tenant)");
    expect(materialCatalogSource).toContain("tenantScopedTable(trx, 'project_materials', tenant)");
    expect(materialCatalogSource).toContain("tenantDb(trx, tenant).tenantJoin(rowsQuery, 'service_catalog as sc'");
    expect(materialCatalogSource).not.toContain(".andOn('pm.tenant', '=', 'sc.tenant')");
    expect(materialCatalogSource).not.toContain("'sc.tenant': tenant");
    expect(materialCatalogSource).not.toContain("'pm.tenant': tenant");
    expect(materialCatalogSource).not.toContain('.where({ tenant, service_id: serviceId })');
    expect(materialCatalogSource).not.toContain('.where({ tenant, project_material_id: projectMaterialId })');
  });
});
