import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const serviceCatalogSource = readFileSync(resolve(__dirname, 'serviceCatalogActions.ts'), 'utf8');
const materialCatalogSource = readFileSync(resolve(__dirname, 'materialCatalogActions.ts'), 'utf8');
const inventoryMaterialsSource = readFileSync(
  resolve(__dirname, '../../../inventory/src/lib/materials.ts'),
  'utf8'
);

describe('project catalog and material tenant-scoped query contract', () => {
  it('uses structural tenant scoping for service catalog roots', () => {
    expect(serviceCatalogSource).toContain("tenantScopedTable(trx, 'service_catalog as sc', tenant)");
    expect(serviceCatalogSource).not.toContain("'sc.tenant': tenant");
  });

  it('uses structural tenant scoping for material catalog roots', () => {
    // The project actions delegate to the shared materials service and must pass
    // the authenticated tenant through every catalog/material operation.
    expect(materialCatalogSource).toContain('queryCatalogPickerItems(trx, tenant, options)');
    expect(materialCatalogSource).toContain('queryServicePrices(trx, tenant, serviceId)');
    expect(materialCatalogSource).toContain("listMaterials(db, tenant, 'project', projectId)");
    expect(materialCatalogSource).toMatch(/addMaterial\(\s*db,\s*tenant,/);
    expect(materialCatalogSource).toContain("deleteMaterial(db, tenant, 'project', projectMaterialId");

    // Pin the extracted implementation too: its dynamic project-material roots,
    // catalog reads, price reads, and joins all retain explicit tenant scoping.
    expect(inventoryMaterialsSource).toContain(".where({ 'm.tenant': tenant, [`m.${cfg.parentCol}`]: parentId })");
    expect(inventoryMaterialsSource).toContain(".andOn('m.tenant', '=', 'sc.tenant')");
    expect(inventoryMaterialsSource).toContain(".where({ tenant, [cfg.pk]: materialId })");
    expect(inventoryMaterialsSource).toContain("await trx(cfg.table).where({ tenant, [cfg.pk]: materialId }).delete()");
    expect(inventoryMaterialsSource).toContain("const base = trx('service_catalog as sc').where({ 'sc.tenant': tenant })");
    expect(inventoryMaterialsSource).toContain("const rows = await trx('service_prices')\n    .where({ tenant, service_id: serviceId })");
  });
});
