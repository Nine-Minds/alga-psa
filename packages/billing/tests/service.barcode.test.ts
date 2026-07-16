import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createServiceSchema, serviceSchema } from '../src/models/service';

const serviceRow = {
  service_id: '11111111-1111-4111-8111-111111111111',
  tenant: 'tenant-1',
  service_name: 'Managed Router',
  custom_service_type_id: '22222222-2222-4222-8222-222222222222',
  billing_method: 'usage' as const,
  default_rate: 10000,
  unit_of_measure: 'each',
  category_id: null,
  item_kind: 'product' as const,
  description: null,
  barcode: '0036000291452',
};

describe('service barcode contract', () => {
  it('preserves barcode in service read and create schemas', () => {
    expect(serviceSchema.parse(serviceRow).barcode).toBe('0036000291452');

    const { service_id: _serviceId, tenant: _tenant, ...createInput } = serviceRow;
    expect(createServiceSchema.parse(createInput).barcode).toBe('0036000291452');
  });

  it('normalizes barcode in both web service action write paths and maps duplicate barcodes', () => {
    const source = readFileSync(new URL('../src/actions/serviceActions.ts', import.meta.url), 'utf8');

    expect(source).toContain("import { normalizeGtin } from '@alga-psa/core'");
    expect(source.match(/normalizeGtin\(serviceData\.barcode \?\? ''\) \|\| null/g)).toHaveLength(2);
    expect(source).toContain('service_catalog_product_barcode_unique');
    expect(source).toContain('A product with this barcode already exists.');
  });
});
