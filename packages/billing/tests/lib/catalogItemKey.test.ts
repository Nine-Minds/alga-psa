import { describe, expect, it } from 'vitest';
import {
  buildCatalogIndex,
  catalogPriceRowKey,
  resolveCatalogItemKey,
  type CatalogItem,
} from '../../src/lib/catalog/catalogItemKey';

const item = (over: Partial<CatalogItem> & Pick<CatalogItem, 'serviceId' | 'name'>): CatalogItem => ({
  itemKind: 'service',
  sku: null,
  serviceTypeId: null,
  serviceTypeName: null,
  billingMethod: 'fixed',
  isActive: true,
  ...over,
});

const REF_A = '11111111-1111-4111-8111-111111111111';
const REF_B = '22222222-2222-4222-8222-222222222222';
const REF_C = '33333333-3333-4333-8333-333333333333';

const index = buildCatalogIndex([
  item({ serviceId: REF_A, name: 'Router', itemKind: 'product', sku: 'RT-1' }),
  item({ serviceId: REF_B, name: 'Managed Backup', sku: 'MB-1', serviceTypeName: 'Managed' }),
  item({ serviceId: REF_C, name: ' managed backup ', serviceTypeName: 'Hourly' }),
  item({ serviceId: '44444444-4444-4444-8444-444444444444', name: 'Help Desk', serviceTypeName: 'Managed' }),
]);
const create = { allowCreate: true };

describe('resolveCatalogItemKey precedence', () => {
  it('matches item_ref first', () => {
    expect(resolveCatalogItemKey({ itemRef: REF_A }, index, create)).toMatchObject({ outcome: 'matched', by: 'item_ref' });
  });

  it('an unknown or malformed item_ref is unmatched, never a create', () => {
    for (const itemRef of ['99999999-9999-4999-8999-999999999999', 'not-a-uuid']) {
      expect(resolveCatalogItemKey({ itemRef, name: 'Brand New' }, index, create)).toMatchObject({ outcome: 'unmatched' });
    }
  });

  it('matches a product by SKU, trimmed', () => {
    const resolved = resolveCatalogItemKey({ sku: '  RT-1 ' }, index, create);
    expect(resolved).toMatchObject({ outcome: 'matched', by: 'product_sku' });
  });

  it('a new SKU creates a product; a service with that SKU only adds a warning', () => {
    expect(resolveCatalogItemKey({ sku: 'NEW-1', name: 'Widget' }, index, create)).toMatchObject({ outcome: 'create', kind: 'product' });
    const clash = resolveCatalogItemKey({ sku: 'MB-1', name: 'Other', itemKind: 'product' }, index, create);
    expect(clash).toMatchObject({ outcome: 'create', kind: 'product' });
    expect((clash as { warnings: string[] }).warnings[0]).toMatch(/service with SKU MB-1 exists/);
  });

  it('matches a service by SKU, then by normalised name', () => {
    expect(resolveCatalogItemKey({ itemKind: 'service', sku: 'MB-1' }, index, create)).toMatchObject({ outcome: 'matched', by: 'service_sku' });
    expect(resolveCatalogItemKey({ name: 'HELP DESK' }, index, create)).toMatchObject({ outcome: 'matched', by: 'service_name' });
  });

  it('two services with the same name are ambiguous and every candidate is listed', () => {
    const resolved = resolveCatalogItemKey({ name: 'Managed Backup' }, index, create);
    expect(resolved.outcome).toBe('ambiguous');
    expect((resolved as { candidates: CatalogItem[] }).candidates.map((c) => c.serviceId).sort()).toEqual([REF_B, REF_C].sort());
  });

  it('a service type narrows an otherwise ambiguous name', () => {
    expect(resolveCatalogItemKey({ name: 'Managed Backup', serviceTypeName: 'hourly' }, index, create))
      .toMatchObject({ outcome: 'matched', item: { serviceId: REF_C } });
    expect(resolveCatalogItemKey({ name: 'Managed Backup', serviceTypeName: 'Nope' }, index, create).outcome).toBe('create');
  });

  it('item_ref pointing at A while the SKU belongs to B is a conflict naming both', () => {
    const resolved = resolveCatalogItemKey({ itemRef: REF_B, itemKind: 'service', sku: 'MB-1' }, index, create);
    expect(resolved.outcome).toBe('matched'); // agreeing keys
    const mixed = resolveCatalogItemKey({ itemRef: REF_A, sku: 'MB-1' }, index, create);
    // MB-1 is a service SKU, REF_A is a product whose SKU lookup is product-only: no second item, so the ref wins.
    expect(mixed.outcome).toBe('matched');
    const wrongProduct = buildCatalogIndex([
      item({ serviceId: REF_A, name: 'A', itemKind: 'product', sku: 'A-1' }),
      item({ serviceId: REF_B, name: 'B', itemKind: 'product', sku: 'B-1' }),
    ]);
    const conflict = resolveCatalogItemKey({ itemRef: REF_A, sku: 'B-1' }, wrongProduct, create);
    expect(conflict).toMatchObject({ outcome: 'conflict' });
    expect((conflict as { items: CatalogItem[] }).items.map((i) => i.serviceId)).toEqual([REF_A, REF_B]);
  });

  it('a declared kind that disagrees with the ref is a conflict', () => {
    expect(resolveCatalogItemKey({ itemRef: REF_A, itemKind: 'service' }, index, create).outcome).toBe('conflict');
  });

  it('with creation off, an unmatched key is unmatched rather than create', () => {
    expect(resolveCatalogItemKey({ name: 'Brand New' }, index, { allowCreate: false }).outcome).toBe('unmatched');
    expect(resolveCatalogItemKey({ sku: 'NEW-9', name: 'X' }, index, { allowCreate: false }).outcome).toBe('unmatched');
  });

  it('a row with no key is unmatched', () => {
    expect(resolveCatalogItemKey({}, index, create).outcome).toBe('unmatched');
  });
});

describe('catalogPriceRowKey', () => {
  it('keys matched rows by item and currency, new rows by what they would create', () => {
    const a = resolveCatalogItemKey({ sku: 'RT-1' }, index, create);
    expect(catalogPriceRowKey(a, 'USD')).toBe(`item:${REF_A}|USD`);
    const n1 = resolveCatalogItemKey({ name: 'Brand New' }, index, create);
    const n2 = resolveCatalogItemKey({ name: ' brand new ' }, index, create);
    expect(catalogPriceRowKey(n1, 'CAD')).toBe(catalogPriceRowKey(n2, 'CAD'));
    expect(catalogPriceRowKey(resolveCatalogItemKey({ name: 'Managed Backup' }, index, create), 'USD')).toBeNull();
  });
});
