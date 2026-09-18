import { describe, expect, it } from 'vitest';
import {
  createCustomDraftQuoteItem,
  createDraftDiscountQuoteItem,
  createDraftQuoteItemFromQuoteItem,
  createDraftQuoteItemFromService,
} from './quoteLineItemDraft';
import type { CatalogPickerItem } from '../../../actions/serviceActions';

const pickerItem = (overrides: Partial<CatalogPickerItem> = {}): CatalogPickerItem => ({
  service_id: '11111111-1111-1111-1111-111111111111',
  service_name: 'Managed Firewall Service',
  billing_method: 'fixed',
  unit_of_measure: 'site',
  item_kind: 'service',
  sku: null,
  default_rate: 25000,
  description: 'Central management, rule review, and firmware patching for the managed firewall fleet.',
  ...overrides,
});

const persistedItem = (overrides: Record<string, unknown> = {}) => ({
  quote_item_id: 'qi-1',
  quote_id: 'q-1',
  tenant: 't-1',
  service_id: '11111111-1111-1111-1111-111111111111',
  service_item_kind: 'service',
  service_name: 'Managed Firewall Service',
  service_sku: null,
  billing_method: 'fixed',
  description: 'Managed Firewall Service',
  catalog_description: 'Central management, rule review, and firmware patching for the managed firewall fleet.',
  quantity: 1,
  unit_price: 25000,
  total_price: 25000,
  tax_amount: 0,
  net_amount: 25000,
  unit_of_measure: 'site',
  display_order: 0,
  is_optional: false,
  is_selected: true,
  is_recurring: true,
  billing_frequency: 'monthly',
  is_discount: false,
  is_taxable: true,
  ...overrides,
});

describe('quote line item draft catalog-description snapshots', () => {
  it('keeps the editable line description default and captures the catalog description separately (cached/full picker item)', () => {
    const draft = createDraftQuoteItemFromService(pickerItem());

    expect(draft.service_name).toBe('Managed Firewall Service');
    // The editable line description keeps its current default (the name) — it is
    // never replaced by the catalog description.
    expect(draft.description).toBe('Managed Firewall Service');
    expect(draft.catalog_description).toBe(
      'Central management, rule review, and firmware patching for the managed firewall fleet.',
    );
  });

  it('normalizes empty catalog descriptions to null in the immediate draft', () => {
    const empty = createDraftQuoteItemFromService(pickerItem({ description: '   ' }));
    expect(empty.catalog_description).toBeNull();

    const missing = createDraftQuoteItemFromService(pickerItem({ description: null }));
    expect(missing.catalog_description).toBeNull();
  });

  it('carries the persisted snapshot verbatim when reopening a quote item', () => {
    const draft = createDraftQuoteItemFromQuoteItem(persistedItem() as never);
    expect(draft.catalog_description).toBe(
      'Central management, rule review, and firmware patching for the managed firewall fleet.',
    );
    expect(draft.description).toBe('Managed Firewall Service');

    const legacy = createDraftQuoteItemFromQuoteItem(
      persistedItem({ catalog_description: null }) as never,
    );
    expect(legacy.catalog_description).toBeNull();
  });

  it('keeps custom and discount line snapshots cleanly null', () => {
    const custom = createCustomDraftQuoteItem({ description: 'Project kickoff' });
    expect(custom.service_id).toBeNull();
    expect(custom.service_name).toBeNull();
    expect(custom.catalog_description).toBeNull();
    expect(custom.description).toBe('Project kickoff');

    const discount = createDraftDiscountQuoteItem({
      description: 'Discount (10%)',
      discount_type: 'percentage',
      discount_percentage: 10,
    });
    expect(discount.catalog_description).toBeNull();
    expect(discount.is_discount).toBe(true);
  });
});
