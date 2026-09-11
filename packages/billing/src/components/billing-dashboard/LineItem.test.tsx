// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { LineItem, type EditableItem } from './LineItem';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, options, value, onValueChange }: any) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">Select Service</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _variant, size: _size, ...rest }: any) => <button {...rest}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));
vi.mock('@alga-psa/core', () => ({
  formatCurrency: (value: number) => `$${value.toFixed(2)}`,
  getCurrencySymbol: () => '$',
}));
vi.mock('@alga-psa/types', () => ({}));

afterEach(cleanup);

const baseItem: EditableItem = {
  item_id: 'item-1',
  service_id: '',
  quantity: 1,
  description: '',
  rate: 0,
  is_discount: false,
  isRemoved: false,
};

const serviceOptions = [
  { value: 'svc-1', label: 'Support', rate: 1250, tax_rate_id: null },
  { value: 'svc-2', label: 'Managed', rate: 900, tax_rate_id: null },
];

const renderLineItem = (item: EditableItem, onChange = vi.fn()) => {
  const props = {
    index: 0,
    isExpanded: true,
    serviceOptions,
    onRemove: vi.fn(),
    onChange,
    onToggleExpand: vi.fn(),
    currencyCode: 'USD',
  };
  const view = render(<LineItem {...props} item={item} />);
  return { view, props, onChange };
};

const editItem = () => {
  fireEvent.change(document.getElementById('service-select')!, { target: { value: 'svc-1' } });
  fireEvent.change(document.getElementById('quantity-input')!, { target: { value: '3' } });
  fireEvent.change(document.getElementById('rate-input')!, { target: { value: '12.5' } });
};

it('keeps in-progress edits when an unrelated parent re-render passes an identical item', () => {
  const { view, props, onChange } = renderLineItem(baseItem);

  editItem();

  // The parent maps items into a fresh object on every render. Simulate an
  // unrelated re-render (same item data) and assert the edits are not discarded.
  view.rerender(<LineItem {...props} item={{ ...baseItem }} />);

  expect((document.getElementById('quantity-input') as HTMLInputElement).value).toBe('3');
  expect((document.getElementById('rate-input') as HTMLInputElement).value).toBe('12.5');

  fireEvent.click(document.getElementById('collapse-line-item-button')!);

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ service_id: 'svc-1', quantity: 3, rate: 1250 }),
  );
});

it('re-syncs the editor when the item data genuinely changes', () => {
  const { view, props } = renderLineItem(baseItem);

  view.rerender(<LineItem {...props} item={{ ...baseItem, service_id: 'svc-2', quantity: 5, rate: 900 }} />);

  expect((document.getElementById('service-select') as HTMLSelectElement).value).toBe('svc-2');
  expect((document.getElementById('quantity-input') as HTMLInputElement).value).toBe('5');
  expect((document.getElementById('rate-input') as HTMLInputElement).value).toBe('9');
});
