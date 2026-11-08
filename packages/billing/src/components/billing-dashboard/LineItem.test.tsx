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
vi.mock('./contracts/ServicePicker', () => ({
  ServicePicker: ({ id, options, value, onChange }: any) => (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
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
vi.mock('@alga-psa/core', () => {
  // The real exponents, read from Intl the way @alga-psa/core does, so a JPY line in
  // these tests scales exactly as it does in the app (USD 2, JPY 0, KWD 3).
  const fractionDigits = (currency: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;

  return {
    formatCurrency: (value: number) => `$${value.toFixed(2)}`,
    getCurrencySymbol: (currency = 'USD') => (currency === 'JPY' ? '¥' : '$'),
    currencyFractionDigits: (currency = 'USD') => fractionDigits(currency),
    toMinorUnits: (value: number, _locale: string | undefined, currency = 'USD') =>
      Math.round(value * 10 ** fractionDigits(currency)),
    fromMinorUnits: (value: number, _locale: string | undefined, currency = 'USD') =>
      value / 10 ** fractionDigits(currency),
  };
});
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
  fireEvent.change(document.getElementById('service-select-item-1')!, { target: { value: 'svc-1' } });
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

it('publishes the current expanded editor draft immediately without collapsing', () => {
  const onDraftChange = vi.fn();
  const onChange = vi.fn();
  render(
    <LineItem
      item={baseItem}
      index={0}
      isExpanded
      serviceOptions={serviceOptions}
      onRemove={vi.fn()}
      onChange={onChange}
      onDraftChange={onDraftChange}
      onToggleExpand={vi.fn()}
      currencyCode="USD"
    />,
  );

  fireEvent.change(document.getElementById('service-select-item-1')!, { target: { value: 'svc-1' } });
  fireEvent.change(document.getElementById('quantity-input')!, { target: { value: '3' } });
  fireEvent.change(document.getElementById('rate-input')!, { target: { value: '50' } });
  fireEvent.change(document.getElementById('description-input')!, { target: { value: 'Expanded manual charge' } });

  expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({
    service_id: 'svc-1', quantity: 3, rate: 5000, description: 'Expanded manual charge',
  }));
  expect(onChange).not.toHaveBeenCalled();
  expect(document.getElementById('collapse-line-item-button')).toBeTruthy();
});

// A rate of 50 on a zero-decimal currency is ¥50, not 5000 minor units: the fixed ×100
// banked ¥5,000 and the invoice (which scales by the currency's exponent) billed ¥5,000.
it('banks a yen rate as whole yen, not hundredths', () => {
  const onChange = vi.fn();
  const onDraftChange = vi.fn();
  render(
    <LineItem
      item={baseItem}
      index={0}
      isExpanded
      serviceOptions={serviceOptions}
      onRemove={vi.fn()}
      onChange={onChange}
      onDraftChange={onDraftChange}
      onToggleExpand={vi.fn()}
      currencyCode="JPY"
    />,
  );

  fireEvent.change(document.getElementById('service-select-item-1')!, { target: { value: 'svc-1' } });
  fireEvent.change(document.getElementById('quantity-input')!, { target: { value: '1' } });
  fireEvent.change(document.getElementById('rate-input')!, { target: { value: '50' } });

  expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ quantity: 1, rate: 50 }));
  // The editor's own subtotal has to read the same ¥50 the invoice total will show.
  expect(screen.getByText('Subtotal: ¥50')).toBeTruthy();

  fireEvent.click(document.getElementById('collapse-line-item-button')!);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rate: 50 }));
});

it('shows a stored yen rate without a dollars divisor', () => {
  render(
    <LineItem
      item={{ ...baseItem, service_id: 'svc-1', quantity: 2, rate: 50 }}
      index={0}
      isExpanded={false}
      serviceOptions={serviceOptions}
      onRemove={vi.fn()}
      onChange={vi.fn()}
      onToggleExpand={vi.fn()}
      currencyCode="JPY"
    />,
  );

  expect(screen.getByText('2 × ¥50')).toBeTruthy();
  expect(screen.getByText('¥100')).toBeTruthy();
});

it('banks a yen fixed discount as whole yen', () => {
  const onDraftChange = vi.fn();
  render(
    <LineItem
      item={{ ...baseItem, is_discount: true, discount_type: 'fixed' }}
      index={0}
      isExpanded
      serviceOptions={serviceOptions}
      onRemove={vi.fn()}
      onChange={vi.fn()}
      onDraftChange={onDraftChange}
      onToggleExpand={vi.fn()}
      currencyCode="JPY"
    />,
  );

  fireEvent.change(document.getElementById('discount-value-input')!, { target: { value: '50' } });

  expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ rate: -50 }));
  expect(screen.getByText('Amount: -¥50')).toBeTruthy();
});

it('re-syncs the editor when the item data genuinely changes', () => {
  const { view, props } = renderLineItem(baseItem);

  view.rerender(<LineItem {...props} item={{ ...baseItem, service_id: 'svc-2', quantity: 5, rate: 900 }} />);

  expect((document.getElementById('service-select-item-1') as HTMLSelectElement).value).toBe('svc-2');
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
      item={{ ...baseItem, service_id: 'svc-1' }}
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
  // A taxable catalog service (svc-taxable has a non-null tax_rate_id). The
  // operator's explicit treatment still wins: null renders Non-Taxable even
  // though the selected service is taxable.
  const catalogServiceOptions = [
    ...serviceOptions,
    { value: 'svc-taxable', label: 'Taxable Support', rate: 100, tax_rate_id: 'rate-svc' },
  ];
  const collapsed = (taxRateId: string | null) => (
    <LineItem
      item={{ ...baseItem, service_id: 'svc-taxable', tax_rate_id: taxRateId }}
      index={0}
      isExpanded={false}
      serviceOptions={catalogServiceOptions}
      onRemove={vi.fn()}
      onChange={vi.fn()}
      onToggleExpand={vi.fn()}
      currencyCode="USD"
      taxRateOptions={[{ value: 'rate-ny', label: 'NY Sales (8.875%)' }]}
    />
  );

  const taxable = render(collapsed('rate-svc'));
  expect(screen.getByText('(Taxable)')).toBeTruthy();
  taxable.unmount();

  render(collapsed(null));
  expect(screen.getByText('(Non-Taxable)')).toBeTruthy();
});
