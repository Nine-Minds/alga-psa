/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ──────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────────────────────────────────────
const featureFlagState = vi.hoisted(() => ({
  enabled: false,
  loading: false,
  error: null as Error | null,
}));

const createPricingScheduleMock = vi.hoisted(() => vi.fn());
const updatePricingScheduleMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => featureFlagState,
}));

vi.mock('@alga-psa/billing/actions/contractPricingScheduleActions', () => ({
  createPricingSchedule: async (...args: unknown[]) => createPricingScheduleMock(...args),
  updatePricingSchedule: async (...args: unknown[]) => updatePricingScheduleMock(...args),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useOptionalI18n: () => null,
  useTranslation: () => ({
    t: (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
      if (!fallback) return key;
      if (typeof fallback === 'string') return fallback;
      const base = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : key;
      return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name] ?? ''));
    },
  }),
  useFormatters: () => ({ locale: 'en-US' }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children, footer }: any) =>
    isOpen ? (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ value }: any) => (
    <input readOnly value={value ? value.toISOString() : ''} aria-label="date-picker" />
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value }: any) => <input readOnly id={id} value={value} />,
}));

vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({
  SwitchWithLabel: ({ label, checked, onCheckedChange }: any) => (
    <label>
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

// The global test setup mocks useAutomationIdAndRegister with empty automation
// props, which strips `id` from the real Input; stub it so #custom-rate resolves.
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ id, ...props }: any) => <input id={id} {...props} />,
}));

import type { IContractPricingSchedule } from '@alga-psa/types';
import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import { PricingScheduleDialog } from './PricingScheduleDialog';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

function schedule(overrides: Partial<IContractPricingSchedule> = {}): IContractPricingSchedule {
  return {
    tenant: 'tenant-1',
    schedule_id: 'schedule-1',
    contract_id: 'contract-1',
    effective_date: '2026-01-01T00:00:00.000Z',
    custom_rate: 12345,
    ...overrides,
  };
}

function renderDialog(props: {
  schedule: IContractPricingSchedule;
  currencyCode?: string;
  ambientCurrency?: string;
}) {
  const onClose = vi.fn();
  const onSave = vi.fn();
  const utils = render(
    <CurrencyFormatProvider currencyCode={props.ambientCurrency ?? 'USD'}>
      <PricingScheduleDialog
        contractId="contract-1"
        schedule={props.schedule}
        currencyCode={props.currencyCode}
        onClose={onClose}
        onSave={onSave}
      />
    </CurrencyFormatProvider>
  );
  return { ...utils, onClose, onSave };
}

function rateInput(): HTMLInputElement {
  return document.getElementById('custom-rate') as HTMLInputElement;
}

function submitForm() {
  fireEvent.submit(document.getElementById('pricing-schedule-form') as HTMLFormElement);
}

describe('PricingScheduleDialog contract-currency custom rate (release-v1.5-feature)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagState.enabled = false;
    featureFlagState.loading = false;
    featureFlagState.error = null;
    createPricingScheduleMock.mockResolvedValue(schedule());
    updatePricingScheduleMock.mockResolvedValue(schedule());
  });

  afterEach(() => {
    cleanup();
  });

  it('flag on: renders and submits a two-decimal non-default currency (EUR) in contract minor units', async () => {
    featureFlagState.enabled = true;
    const { onSave } = renderDialog({
      schedule: schedule({ custom_rate: 12345 }),
      currencyCode: 'EUR',
    });

    const input = rateInput();
    expect(input.value).toBe('123.45');
    expect(input).toHaveAttribute('step', '0.01');
    expect(screen.getByText('€')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '150.5' } });
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(updatePricingScheduleMock).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({ custom_rate: 15050 })
    );
  });

  it('flag on: round-trips a zero-decimal currency (JPY) without a x100 conversion', async () => {
    featureFlagState.enabled = true;
    const { onSave } = renderDialog({
      schedule: schedule({ custom_rate: 5000 }),
      currencyCode: 'JPY',
    });

    const input = rateInput();
    expect(input.value).toBe('5000');
    expect(input).toHaveAttribute('step', '1');
    expect(input).toHaveAttribute('placeholder', '0');
    expect(screen.getByText('¥')).toBeInTheDocument();

    // Save without touching the rate: stored minor units must survive unchanged.
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(updatePricingScheduleMock).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({ custom_rate: 5000 })
    );
  });

  it('flag off: preserves the legacy ambient-currency two-decimal rendering and submission', async () => {
    featureFlagState.enabled = false;
    const { onSave } = renderDialog({
      schedule: schedule({ custom_rate: 5000 }),
      // Contract currency is supplied but must be ignored while the flag is off.
      currencyCode: 'JPY',
    });

    const input = rateInput();
    expect(input.value).toBe('50.00');
    expect(input).toHaveAttribute('step', '0.01');
    expect(input).toHaveAttribute('placeholder', '0.00');
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(screen.queryByText('¥')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: '51' } });
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(updatePricingScheduleMock).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({ custom_rate: 5100 })
    );
  });
});
