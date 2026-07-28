/* eslint-disable custom-rules/no-feature-to-feature-imports -- tests resolve QBO Items (integrations) against the billing catalog */
import { describe, expect, it } from 'vitest';
import type { QboItem } from '@alga-psa/integrations/lib/qbo/types';
import {
  resolveQboItems,
  QBO_AUTHORITATIVE_FIELDS,
  ALGA_AUTHORITATIVE_FIELDS,
  type ExistingItemMappingRow,
  type ExistingServiceRow
} from './qboItemResolver';

function qboItem(overrides: Partial<QboItem> & { Id: string; Name: string }): QboItem {
  return { Type: 'Service', ...overrides } as QboItem;
}

function serviceRow(overrides: Partial<ExistingServiceRow> & { service_id: string; service_name: string }): ExistingServiceRow {
  return {
    item_kind: 'service',
    sku: null,
    description: null,
    default_rate: 0,
    cost: null,
    is_active: true,
    ...overrides
  };
}

const noMappings: ExistingItemMappingRow[] = [];
const noTax = new Map<string, string>();

describe('qboItemResolver', () => {
  it('creates new services and products with converted minor units', () => {
    const items = [
      qboItem({ Id: '1', Name: 'Consulting', UnitPrice: 150, Description: 'Hourly consulting' }),
      qboItem({ Id: '2', Name: 'Widget', Type: 'NonInventory', Sku: 'W-1', UnitPrice: 19.99, PurchaseCost: 7.5 }),
      qboItem({ Id: '3', Name: 'Gadget', Type: 'Inventory', Sku: 'G-1' })
    ];

    const [consulting, widget, gadget] = resolveQboItems(items, [], noMappings, noTax);

    expect(consulting.action).toBe('create');
    expect(consulting.fields).toMatchObject({
      service_name: 'Consulting',
      item_kind: 'service',
      default_rate: 15000,
      description: 'Hourly consulting',
      cost: null
    });

    expect(widget.fields).toMatchObject({ item_kind: 'product', sku: 'W-1', default_rate: 1999, cost: 750 });
    expect(gadget.fields).toMatchObject({ item_kind: 'product', default_rate: 0 });
  });

  it('skips Category items with a reason', () => {
    const [resolution] = resolveQboItems(
      [qboItem({ Id: '9', Name: 'Design', Type: 'Category' })],
      [], noMappings, noTax
    );
    expect(resolution.action).toBe('skip');
    expect(resolution.flags).toContain('category_skipped');
    expect(resolution.reason).toBeTruthy();
  });

  it('uses the leaf Name, keeping FullyQualifiedName out of the catalog name', () => {
    const [resolution] = resolveQboItems(
      [qboItem({ Id: '4', Name: 'Child', FullyQualifiedName: 'Parent:Child', SubItem: true })],
      [], noMappings, noTax
    );
    expect(resolution.fields?.service_name).toBe('Child');
  });

  it('prefers ledger mapping over SKU and name matches', () => {
    const services = [
      serviceRow({ service_id: 's-mapped', service_name: 'Old Name' }),
      serviceRow({ service_id: 's-name', service_name: 'Consulting' })
    ];
    const mappings = [{ id: 'm1', alga_entity_id: 's-mapped', external_entity_id: 'q1' }];

    const [resolution] = resolveQboItems(
      [qboItem({ Id: 'q1', Name: 'Consulting' })],
      services, mappings, noTax
    );

    expect(resolution.matchedServiceId).toBe('s-mapped');
    expect(resolution.action).toBe('update');
    expect(resolution.fieldChanges).toEqual([
      { field: 'service_name', from: 'Old Name', to: 'Consulting' }
    ]);
  });

  it('matches products by exact SKU before name', () => {
    const services = [
      serviceRow({ service_id: 's-sku', service_name: 'Different Name', item_kind: 'product', sku: 'ABC' }),
      serviceRow({ service_id: 's-name', service_name: 'Widget', item_kind: 'product' })
    ];

    const [resolution] = resolveQboItems(
      [qboItem({ Id: 'q1', Name: 'Widget', Type: 'NonInventory', Sku: 'abc' })],
      services, noMappings, noTax
    );

    expect(resolution.matchedServiceId).toBe('s-sku');
  });

  it('links (no update) when all QBO-authoritative fields already agree', () => {
    const services = [
      serviceRow({ service_id: 's1', service_name: 'Consulting', default_rate: 15000, description: 'x', is_active: true })
    ];
    const [resolution] = resolveQboItems(
      [qboItem({ Id: 'q1', Name: 'Consulting', UnitPrice: 150, Description: 'x' })],
      services, noMappings, noTax
    );
    expect(resolution.action).toBe('link');
    expect(resolution.matchedServiceId).toBe('s1');
  });

  it('skips on SKU conflict when the catalog row is mapped to a different QBO item', () => {
    const services = [serviceRow({ service_id: 's1', service_name: 'Widget', item_kind: 'product', sku: 'ABC' })];
    const mappings = [{ id: 'm1', alga_entity_id: 's1', external_entity_id: 'other-qbo-item' }];

    const [resolution] = resolveQboItems(
      [qboItem({ Id: 'q1', Name: 'Widget 2', Type: 'NonInventory', Sku: 'ABC' })],
      services, mappings, noTax
    );

    expect(resolution.action).toBe('skip');
    expect(resolution.flags).toContain('sku_conflict');
  });

  it('skips on name collision when the name-matched row is mapped to a different QBO item', () => {
    const services = [serviceRow({ service_id: 's1', service_name: 'Consulting' })];
    const mappings = [{ id: 'm1', alga_entity_id: 's1', external_entity_id: 'other-qbo-item' }];

    const [resolution] = resolveQboItems(
      [qboItem({ Id: 'q1', Name: 'Consulting' })],
      services, mappings, noTax
    );

    expect(resolution.action).toBe('skip');
    expect(resolution.flags).toContain('name_collision');
  });

  it('skips the second QBO item claiming the same SKU within one import', () => {
    const items = [
      qboItem({ Id: 'q1', Name: 'Widget A', Type: 'NonInventory', Sku: 'DUP' }),
      qboItem({ Id: 'q2', Name: 'Widget B', Type: 'NonInventory', Sku: 'DUP' })
    ];
    const [first, second] = resolveQboItems(items, [], noMappings, noTax);
    expect(first.action).toBe('create');
    expect(second.action).toBe('skip');
    expect(second.flags).toContain('sku_conflict');
  });

  it('flags inactive items and imports them as is_active=false', () => {
    const [resolution] = resolveQboItems(
      [qboItem({ Id: 'q1', Name: 'Retired', Active: false })],
      [], noMappings, noTax
    );
    expect(resolution.action).toBe('create');
    expect(resolution.fields?.is_active).toBe(false);
    expect(resolution.flags).toContain('inactive');
  });

  it('resolves mapped tax codes and flags unmapped ones (NON is not a gap)', () => {
    const taxMap = new Map([['tc-1', 'rate-1']]);
    const items = [
      qboItem({ Id: 'q1', Name: 'Taxed', SalesTaxCodeRef: { value: 'tc-1' } }),
      qboItem({ Id: 'q2', Name: 'Unknown Tax', SalesTaxCodeRef: { value: 'tc-2' } }),
      qboItem({ Id: 'q3', Name: 'Non Taxable', SalesTaxCodeRef: { value: 'NON' } })
    ];

    const [taxed, unknown, nonTaxable] = resolveQboItems(items, [], noMappings, taxMap);

    expect(taxed.fields?.tax_rate_id).toBe('rate-1');
    expect(taxed.flags).not.toContain('unmapped_tax');
    expect(unknown.fields?.tax_rate_id).toBeNull();
    expect(unknown.flags).toContain('unmapped_tax');
    expect(nonTaxable.fields?.tax_rate_id).toBeNull();
    expect(nonTaxable.flags).not.toContain('unmapped_tax');
  });

  it('recreates when a mapping points at a deleted catalog row', () => {
    const mappings = [{ id: 'm1', alga_entity_id: 'gone', external_entity_id: 'q1' }];
    const [resolution] = resolveQboItems(
      [qboItem({ Id: 'q1', Name: 'Ghost' })],
      [], mappings, noTax
    );
    expect(resolution.action).toBe('create');
    expect(resolution.existingMappingId).toBe('m1');
  });

  it('only ever diffs QBO-authoritative fields', () => {
    const services = [
      serviceRow({ service_id: 's1', service_name: 'Consulting', default_rate: 1000, description: 'old', is_active: true })
    ];
    const [resolution] = resolveQboItems(
      [qboItem({ Id: 'q1', Name: 'Consulting', UnitPrice: 20, Description: 'new' })],
      services, noMappings, noTax
    );

    for (const change of resolution.fieldChanges ?? []) {
      expect(QBO_AUTHORITATIVE_FIELDS).toContain(change.field);
      expect(ALGA_AUTHORITATIVE_FIELDS).not.toContain(change.field as never);
    }
    expect(resolution.fieldChanges?.map((c) => c.field).sort()).toEqual(['default_rate', 'description']);
  });
});
