// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { LineItem, resolveLineItemAmount, type EditableItem } from './LineItem';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) => {
      const template = (options?.defaultValue as string | undefined) ?? _key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? ''));
    },
  }),
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

it('resolves a quantity-derived credit as quantity × rate', () => {
  expect(resolveLineItemAmount({
    is_discount: true,
    discount_type: 'fixed',
    is_manual_credit: true,
    quantity: 3,
    rate: -10000,
  })).toBe(-30000);
});

it('resolves an authored fixed discount as quantity-independent', () => {
  expect(resolveLineItemAmount({
    is_discount: true,
    discount_type: 'fixed',
    is_manual_credit: false,
    quantity: 3,
    rate: -10000,
  })).toBe(-10000);
  // A missing flag (legacy rows before the column existed) is authored-shaped.
  expect(resolveLineItemAmount({
    is_discount: true,
    discount_type: 'fixed',
    quantity: 3,
    rate: -10000,
  })).toBe(-10000);
});

it('shows a quantity-derived credit row at quantity × rate', () => {
  renderLineItem({
    ...baseItem,
    is_discount: true,
    discount_type: 'fixed',
    is_manual_credit: true,
    quantity: 3,
    rate: -10000,
  });

  expect(screen.getByText('Amount: -$300.00')).toBeTruthy();
});

it('shows an authored fixed discount row as quantity-independent', () => {
  renderLineItem({
    ...baseItem,
    is_discount: true,
    discount_type: 'fixed',
    is_manual_credit: false,
    quantity: 3,
    rate: -10000,
  });

  expect(screen.getByText('Amount: -$100.00')).toBeTruthy();
});

it('reports the operator tax-treatment choice when the row is committed', () => {
  const onChange = vi.fn();
  render(
    <LineItem
      item={baseItem}
      index={0}
      isExpanded
      serviceOptions={serviceOptions}
      onRemove={vi.fn()}
      onChange={onChange}
      onToggleExpand={vi.fn()}
      currencyCode="USD"
      taxRateOptions={[
        { value: 'rate-ny', label: 'NY Sales (8.875%)' },
        { value: 'rate-ca', label: 'CA Sales (7.25%)' },
      ]}
    />,
  );

  const select = document.getElementById('line-item-tax-treatment-select') as HTMLSelectElement;
  expect(select).toBeTruthy();
  fireEvent.change(select, { target: { value: 'rate-ny' } });
  fireEvent.click(document.getElementById('collapse-line-item-button')!);

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ tax_rate_id: 'rate-ny' }),
  );
});

it('omits the tax-treatment control when no rates are supplied', () => {
  renderLineItem(baseItem);

  expect(document.getElementById('line-item-tax-treatment-select')).toBeNull();
});

it('reflects the effective tax treatment on the collapsed row', () => {
  const collapsed = (taxRateId: string | null) => (
    <LineItem
      item={{ ...baseItem, tax_rate_id: taxRateId }}
      index={0}
      isExpanded={false}
      serviceOptions={serviceOptions}
      onRemove={vi.fn()}
      onChange={vi.fn()}
      onToggleExpand={vi.fn()}
      currencyCode="USD"
      taxRateOptions={[{ value: 'rate-ny', label: 'NY Sales (8.875%)' }]}
    />
  );

  const taxable = render(collapsed('rate-ny'));
  expect(screen.getByText('(Taxable)')).toBeTruthy();
  taxable.unmount();

  render(collapsed(null));
  expect(screen.getByText('(Non-Taxable)')).toBeTruthy();
});
