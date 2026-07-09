import { describe, expect, it } from 'vitest';
import { parseServiceReadRows } from '../src/models/service';

const validServiceRow = {
  service_id: '11111111-1111-4111-8111-111111111111',
  tenant: 'tenant-1',
  service_name: 'Managed Support',
  custom_service_type_id: '22222222-2222-4222-8222-222222222222',
  billing_method: 'fixed',
  default_rate: 10000,
  unit_of_measure: 'each',
  category_id: null,
  item_kind: 'service',
  is_active: true,
  sku: null,
  cost: null,
  cost_currency: null,
  vendor: null,
  manufacturer: null,
  product_category: null,
  is_license: false,
  license_term: null,
  license_billing_cadence: null,
  tax_rate_id: null,
  description: null,
  service_type_name: 'Professional Services',
};

describe('parseServiceReadRows', () => {
  it('skips non-canonical catalog rows instead of failing the whole read', () => {
    const productRow = {
      ...validServiceRow,
      service_id: '33333333-3333-4333-8333-333333333333',
      service_name: 'Inventory Widget',
      billing_method: 'per_unit',
      item_kind: 'product',
    };

    const services = parseServiceReadRows([productRow, validServiceRow], {});

    expect(services).toHaveLength(1);
    expect(services[0]?.service_id).toBe(validServiceRow.service_id);
    expect(services[0]?.service_name).toBe('Managed Support');
  });
});
