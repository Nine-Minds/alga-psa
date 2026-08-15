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

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: () => <div data-testid="rate-symbol-skeleton" />,
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
  const tree = () => (
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
  const utils = render(tree());
  return {
    ...utils,
    onClose,
    onSave,
    // Re-render the same tree so the component re-reads the (mutated) mocked
    // feature-flag state — simulates a late flag resolution.
    rerenderDialog: () => utils.rerender(tree()),
  };
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

  it('flag on: switching back to the default rate submits an explicit custom_rate null', async () => {
    featureFlagState.enabled = true;
    const { onSave } = renderDialog({
      schedule: schedule({ custom_rate: 12345 }),
      currencyCode: 'EUR',
    });

    fireEvent.click(screen.getByLabelText('Use default rate'));
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [scheduleId, payload] = updatePricingScheduleMock.mock.calls[0];
    expect(scheduleId).toBe('schedule-1');
    // null, not undefined — Knex drops undefined keys from updates, which
    // silently kept the old rate.
    expect(payload.custom_rate).toBeNull();
  });

  it('flag off: switching back to the default rate also submits an explicit custom_rate null', async () => {
    featureFlagState.enabled = false;
    const { onSave } = renderDialog({
      schedule: schedule({ custom_rate: 5000 }),
    });

    fireEvent.click(screen.getByLabelText('Use default rate'));
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(updatePricingScheduleMock.mock.calls[0][1].custom_rate).toBeNull();
  });

  it('flag loading: disables the rate input with no legacy semantics and blocks submission', async () => {
    featureFlagState.loading = true;
    featureFlagState.enabled = false;
    const { onSave } = renderDialog({
      schedule: schedule({ custom_rate: 5000 }),
      currencyCode: 'JPY',
    });

    const input = rateInput();
    // Non-editable while the currency interpretation is unknown.
    expect(input).toBeDisabled();
    // No legacy symbol/step/placeholder semantics may be shown.
    expect(screen.queryByText('$')).not.toBeInTheDocument();
    expect(screen.queryByText('¥')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('step', 'any');
    expect(input).toHaveAttribute('placeholder', '');
    // The neutral symbol placeholder replaces the currency adornment.
    expect(screen.getByTestId('rate-symbol-skeleton')).toBeInTheDocument();
    // Stored minor units are not exposed through any conversion.
    expect(input.value).toBe('');

    submitForm();

    expect(
      await screen.findByText('Currency settings are still loading; try again in a moment')
    ).toBeInTheDocument();
    expect(updatePricingScheduleMock).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('flag loading: restores editability and contract-currency semantics after resolution', async () => {
    featureFlagState.loading = true;
    featureFlagState.enabled = false;
    const { rerenderDialog } = renderDialog({
      schedule: schedule({ custom_rate: 12345 }),
      currencyCode: 'EUR',
    });

    expect(rateInput()).toBeDisabled();

    featureFlagState.loading = false;
    featureFlagState.enabled = true;
    rerenderDialog();

    const input = rateInput();
    await waitFor(() => expect(input).toBeEnabled());
    expect(input.value).toBe('123.45');
    expect(input).toHaveAttribute('step', '0.01');
    expect(input).toHaveAttribute('placeholder', '0.00');
    expect(screen.getByText('€')).toBeInTheDocument();
    expect(screen.queryByTestId('rate-symbol-skeleton')).not.toBeInTheDocument();
  });

  it('flag loading: keeps the rate uninitialized instead of exposing legacy units, then derives with the resolved factor', async () => {
    featureFlagState.loading = true;
    featureFlagState.enabled = false;
    const { rerenderDialog } = renderDialog({
      schedule: schedule({ custom_rate: 5000 }),
      currencyCode: 'JPY',
    });

    // Unresolved flag: no legacy /100 rendering of the stored minor units.
    expect(rateInput().value).toBe('');

    featureFlagState.loading = false;
    featureFlagState.enabled = true;
    rerenderDialog();

    await waitFor(() => expect(rateInput().value).toBe('5000'));
  });

  it('flag loading: refuses to submit a custom rate and never clobbers input typed before resolution', async () => {
    featureFlagState.loading = true;
    featureFlagState.enabled = false;
    const { rerenderDialog, onSave } = renderDialog({
      schedule: schedule({ custom_rate: 5000 }),
      currencyCode: 'JPY',
    });

    fireEvent.change(rateInput(), { target: { value: '600' } });
    submitForm();

    // Unit math must not run against an unresolved flag.
    expect(
      await screen.findByText('Currency settings are still loading; try again in a moment')
    ).toBeInTheDocument();
    expect(updatePricingScheduleMock).not.toHaveBeenCalled();

    featureFlagState.loading = false;
    featureFlagState.enabled = true;
    rerenderDialog();

    // Late resolution must not overwrite what the user typed.
    expect(rateInput().value).toBe('600');

    submitForm();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(updatePricingScheduleMock).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({ custom_rate: 600 })
    );
  });

  it('flag loading: blocks the default-rate reset so the stored custom rate is not clobbered', async () => {
    featureFlagState.loading = true;
    featureFlagState.enabled = false;
    const { onSave } = renderDialog({
      schedule: schedule({ custom_rate: 5000 }),
      currencyCode: 'JPY',
    });

    // Save is disabled while unresolved, with the loading reason surfaced.
    const saveButton = screen.getByRole('button', { name: 'Update Schedule' });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute(
      'title',
      'Currency settings are still loading; try again in a moment'
    );

    // Switching to the default rate (the custom_rate: null path) and
    // submitting must be blocked in the handler too — the Enter-key path
    // bypasses the disabled button.
    fireEvent.click(screen.getByLabelText('Use default rate'));
    submitForm();

    expect(
      await screen.findByText('Currency settings are still loading; try again in a moment')
    ).toBeInTheDocument();
    expect(updatePricingScheduleMock).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('flag loading: resolving to off lands in legacy two-decimal behavior with no stale gating', async () => {
    featureFlagState.loading = true;
    featureFlagState.enabled = false;
    const { rerenderDialog, onSave } = renderDialog({
      schedule: schedule({ custom_rate: 5000 }),
      // Contract currency is supplied but must be ignored once the flag resolves off.
      currencyCode: 'JPY',
    });

    // Unresolved: Save is disabled and no legacy units are exposed.
    expect(screen.getByRole('button', { name: 'Update Schedule' })).toBeDisabled();
    expect(rateInput().value).toBe('');

    featureFlagState.loading = false;
    featureFlagState.enabled = false;
    rerenderDialog();

    // Legacy ambient-currency semantics return end to end: /100 init,
    // two-decimal step, ambient symbol, and no skeleton left behind.
    const input = rateInput();
    await waitFor(() => expect(input).toBeEnabled());
    expect(input.value).toBe('50.00');
    expect(input).toHaveAttribute('step', '0.01');
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(screen.queryByTestId('rate-symbol-skeleton')).not.toBeInTheDocument();
    // No stale loading gating survives the transition.
    expect(screen.getByRole('button', { name: 'Update Schedule' })).toBeEnabled();

    fireEvent.change(input, { target: { value: '51' } });
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(updatePricingScheduleMock).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({ custom_rate: 5100 })
    );
  });
});
