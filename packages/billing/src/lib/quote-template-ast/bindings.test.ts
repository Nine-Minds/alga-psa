import { describe, expect, it } from 'vitest';

import {
  QUOTE_TEMPLATE_COLLECTION_BINDINGS,
  QUOTE_TEMPLATE_VALUE_BINDINGS,
  buildQuoteTemplateBindings,
} from './bindings';

describe('quote template bindings', () => {
  it('declares filtered collection bindings for recurring, one-time, service, and product items', () => {
    expect(QUOTE_TEMPLATE_COLLECTION_BINDINGS.recurringItems).toMatchObject({
      id: 'recurringItems',
      kind: 'collection',
      path: 'recurring_items',
    });
    expect(QUOTE_TEMPLATE_COLLECTION_BINDINGS.onetimeItems).toMatchObject({
      id: 'onetimeItems',
      kind: 'collection',
      path: 'onetime_items',
    });
    expect(QUOTE_TEMPLATE_COLLECTION_BINDINGS.serviceItems).toMatchObject({
      id: 'serviceItems',
      kind: 'collection',
      path: 'service_items',
    });
    expect(QUOTE_TEMPLATE_COLLECTION_BINDINGS.productItems).toMatchObject({
      id: 'productItems',
      kind: 'collection',
      path: 'product_items',
    });
  });

  it('declares recurring, one-time, service, and product aggregate value bindings', () => {
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.recurringSubtotal?.path).toBe('recurring_subtotal');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.recurringTax?.path).toBe('recurring_tax');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.recurringTotal?.path).toBe('recurring_total');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.onetimeSubtotal?.path).toBe('onetime_subtotal');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.onetimeTax?.path).toBe('onetime_tax');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.onetimeTotal?.path).toBe('onetime_total');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.serviceSubtotal?.path).toBe('service_subtotal');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.serviceTax?.path).toBe('service_tax');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.serviceTotal?.path).toBe('service_total');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.productSubtotal?.path).toBe('product_subtotal');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.productTax?.path).toBe('product_tax');
    expect(QUOTE_TEMPLATE_VALUE_BINDINGS.productTotal?.path).toBe('product_total');
  });

  it('includes the new quote bindings when building a full binding catalog', () => {
    const bindings = buildQuoteTemplateBindings();

    expect(bindings.collections?.recurringItems?.path).toBe('recurring_items');
    expect(bindings.collections?.productItems?.path).toBe('product_items');
    expect(bindings.values?.recurringTotal?.path).toBe('recurring_total');
    expect(bindings.values?.productTotal?.path).toBe('product_total');
  });
});
