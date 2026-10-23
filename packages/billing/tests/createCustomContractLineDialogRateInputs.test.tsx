// @vitest-environment jsdom

/**
 * The custom-line dialog is the authoring surface reached from a contract's
 * Contract Lines tab, and it carries its own copy of the index-keyed rate maps:
 * removing a row shifted the rows but not the strings, so a later row committed
 * its predecessor's rate. Its minute fields are also plain number inputs, which
 * the mouse wheel used to step.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/billing/actions/contractLinePresetActions', () => ({
  createCustomContractLine: vi.fn(),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
}));

const translate = (_key: string, second?: string | Record<string, unknown>) => {
  const options = typeof second === 'object' && second ? second : {};
  let value = String((typeof second === 'string' ? second : options.defaultValue) ?? _key);
  for (const [name, replacement] of Object.entries(options)) {
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
  useOptionalI18n: () => ({ locale: 'en-US' }),
  useFormatters: () => ({
    formatCurrency: (value: number, currency: string) => `${currency} ${value}`,
  }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: any) => (isOpen ? <div role="dialog">{children}{footer}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Switch', () => ({ Switch: () => null }));
vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({ SwitchWithLabel: () => null }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../src/components/billing-dashboard/contracts/BucketOverlayFields', () => ({
  BucketOverlayFields: () => null,
}));
vi.mock('../src/components/billing-dashboard/contracts/ServiceCatalogPicker', () => ({
  ServiceCatalogPicker: ({ selectedLabel }: { selectedLabel?: string }) => <div>{selectedLabel}</div>,
}));
vi.mock('../src/components/billing-dashboard/service-configurations/FixedServiceConfigPanel', () => ({
  FixedServiceConfigPanel: () => null,
}));
vi.mock('../src/components/billing-dashboard/service-configurations/UsageServiceConfigPanel', () => ({
  UsageServiceConfigPanel: () => null,
}));

import { CreateCustomContractLineDialog } from '../src/components/billing-dashboard/contracts/CreateCustomContractLineDialog';

const renderDialog = () => render(
  <CreateCustomContractLineDialog
    isOpen
    onClose={vi.fn()}
    contractId="contract-1"
    currencyCode="USD"
    onCreated={vi.fn(async () => {})}
  />
);

const field = (id: string) => document.getElementById(id) as HTMLInputElement;

/** Add three rows and type $100 / $200 / $300 into them. */
const addThreeRatedRows = async (addButtonId: string, ratePrefix: string) => {
  for (let index = 0; index < 3; index += 1) {
    fireEvent.click(field(addButtonId));
    await waitFor(() => expect(document.getElementById(`${ratePrefix}-${index}`)).not.toBeNull());
    const input = field(`${ratePrefix}-${index}`);
    fireEvent.change(input, { target: { value: `${(index + 1) * 100}` } });
    fireEvent.blur(input);
    await waitFor(() => expect(field(`${ratePrefix}-${index}`).value).toBe(`${(index + 1) * 100}.00`));
  }
};

describe('CreateCustomContractLineDialog service removal keeps rates with their rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps each remaining hourly rate on its own row after a removal and blur', async () => {
    renderDialog();

    fireEvent.click(screen.getByText('Hourly'));
    await addThreeRatedRows('add-hourly-service-button', 'hourly-rate');

    fireEvent.click(field('remove-hourly-service-0'));

    await waitFor(() => expect(document.getElementById('hourly-rate-2')).toBeNull());
    expect(field('hourly-rate-0').value).toBe('200.00');
    expect(field('hourly-rate-1').value).toBe('300.00');

    // Blurring the shifted last row must commit $300, not its predecessor's $200.
    fireEvent.blur(field('hourly-rate-1'));

    await waitFor(() => expect(screen.getByText('$300.00/hour')).not.toBeNull());
    expect(field('hourly-rate-1').value).toBe('300.00');
    expect(screen.getByText('$200.00/hour')).not.toBeNull();
  });

  it('keeps each remaining usage rate on its own row after a removal and blur', async () => {
    renderDialog();

    fireEvent.click(screen.getByText('Usage-Based'));
    await addThreeRatedRows('add-usage-service-button', 'unit-rate');

    fireEvent.click(field('remove-usage-service-0'));

    await waitFor(() => expect(document.getElementById('unit-rate-2')).toBeNull());
    expect(field('unit-rate-0').value).toBe('200.00');
    expect(field('unit-rate-1').value).toBe('300.00');

    fireEvent.blur(field('unit-rate-1'));

    await waitFor(() => expect(screen.getByText('$300.00/unit')).not.toBeNull());
    expect(field('unit-rate-1').value).toBe('300.00');
    expect(screen.getByText('$200.00/unit')).not.toBeNull();
  });
});

describe('CreateCustomContractLineDialog number inputs ignore the mouse wheel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blurs the rounding fields instead of stepping their value', async () => {
    renderDialog();

    fireEvent.click(screen.getByText('Hourly'));
    fireEvent.click(field('add-hourly-service-button'));

    const minimumBillable = await waitFor(() => {
      const node = document.getElementById('minimum-billable-time') as HTMLInputElement | null;
      expect(node).not.toBeNull();
      return node!;
    });
    fireEvent.change(minimumBillable, { target: { value: '15' } });
    minimumBillable.focus();
    expect(document.activeElement).toBe(minimumBillable);

    fireEvent.wheel(minimumBillable, { deltaY: -100 });

    expect(document.activeElement).not.toBe(minimumBillable);
    expect(minimumBillable.value).toBe('15');

    const roundUp = field('round-up-to-nearest');
    fireEvent.change(roundUp, { target: { value: '15' } });
    roundUp.focus();
    fireEvent.wheel(roundUp, { deltaY: 100 });

    expect(document.activeElement).not.toBe(roundUp);
    expect(roundUp.value).toBe('15');
  });
});
