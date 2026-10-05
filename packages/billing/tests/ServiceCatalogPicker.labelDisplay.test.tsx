/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ServiceCatalogPicker } from '../src/components/billing-dashboard/contracts/ServiceCatalogPicker';

const searchServiceCatalogForPicker = vi.fn();

vi.mock('../src/actions/serviceActions', () => ({
  searchServiceCatalogForPicker: (...args: unknown[]) => searchServiceCatalogForPicker(...args),
  getServiceById: vi.fn(async () => null),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

describe('ServiceCatalogPicker Label display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchServiceCatalogForPicker.mockResolvedValue({
      items: [
        {
          service_id: 'product-1',
          service_name: 'Grandstream IP Phone',
          sku: 'RTR-1',
          item_kind: 'product',
          product_category: 'Grandstream GRP2614',
          billing_method: 'usage',
          unit_of_measure: 'each',
          default_rate: 100,
          description: null,
        },
      ],
      totalCount: 1,
    });
  });

  it('shows the product Label as secondary text in the option row', async () => {
    render(
      <ServiceCatalogPicker
        value=""
        onSelect={vi.fn()}
        itemKinds={['product']}
        debounceMs={0}
      />,
    );

    fireEvent.click(screen.getByRole('combobox'));

    expect(await screen.findByText('Grandstream IP Phone (RTR-1)')).toBeTruthy();
    expect(screen.getByText('Grandstream GRP2614')).toBeTruthy();
  });
});
