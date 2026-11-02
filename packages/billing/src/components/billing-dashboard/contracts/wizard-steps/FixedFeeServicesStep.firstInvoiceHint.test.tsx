// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeAnchorSettingsForCycle } from '@alga-psa/shared/billingClients/billingCycleAnchors';
import { createDefaultContractWizardData } from '../ContractWizard';

/**
 * Fixed-fee lines default to arrears. When a client-cadence line starts partway
 * through a client billing period, the editor says when the first partial period
 * invoices and offers a per-line switch to In Advance. The switch changes that
 * line's billing timing and nothing else (in particular, not the cadence owner).
 */

const mocks = vi.hoisted(() => ({ getClientBillingCycleAnchor: vi.fn() }));

vi.mock('@alga-psa/billing/actions/billingCycleAnchorActions', () => ({
  getClientBillingCycleAnchor: mocks.getClientBillingCycleAnchor,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const fallback = (options?.defaultValue as string) ?? key;
      return fallback.replace(/{{(\w+)}}/g, (_match, token) => String(options?.[token] ?? ''));
    },
  }),
  useFormatters: () => ({
    formatDate: (value: Date) =>
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`,
  }),
  useOptionalI18n: () => null,
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useFormatBillingFrequency: () => (value: string) => value,
}));
vi.mock('@alga-psa/core', () => ({
  getCurrencySymbol: () => '$',
  currencyFractionDigits: () => 2,
}));
vi.mock('../ServiceCatalogPicker', () => ({
  ServiceCatalogPicker: () => <div data-testid="service-picker" />,
}));
vi.mock('../BillingFrequencyOverrideSelect', () => ({
  BillingFrequencyOverrideSelect: () => <div />,
}));

const { FixedFeeServicesStep } = await import('./FixedFeeServicesStep');

const monthlyConfig = () => ({
  billingCycle: 'monthly',
  anchor: normalizeAnchorSettingsForCycle('monthly', {}),
});

const buildData = (overrides: Record<string, unknown> = {}, lineOverrides: Record<string, unknown> = {}) => ({
  ...createDefaultContractWizardData(),
  client_id: 'client-1',
  start_date: '2026-10-20',
  cadence_owner: 'client' as const,
  billing_timing: 'arrears' as const,
  fixed_lines: [
    {
      line_key: 'line-1',
      enable_proration: true,
      base_rate: null,
      services: [
        { service_id: 'svc-1', service_name: 'Managed Services', quantity: 1, pricing_basis: 'bundle' as const },
      ],
      ...lineOverrides,
    },
  ],
  ...overrides,
});

function Harness({ initial, onData }: { initial: any; onData?: (data: any) => void }) {
  const [data, setData] = useState(initial);
  onData?.(data);
  return (
    <FixedFeeServicesStep
      data={data}
      updateData={(patch) => setData((prev: any) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }))}
    />
  );
}

const hint = () => document.getElementById('fixed-line-0-first-invoice-hint');
const button = () => document.getElementById('fixed-line-0-first-invoice-hint-bill-in-advance');

describe('FixedLineEditor arrears first-invoice hint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientBillingCycleAnchor.mockResolvedValue(monthlyConfig());
  });
  afterEach(() => cleanup());

  it('mid-cycle client-arrears start shows the derived dates, visible without opening anything', async () => {
    render(<Harness initial={buildData()} />);

    const el = await screen.findByText(/First invoice:/);
    expect(el.textContent).toContain('the 2026-11-01 invoice covers 2026-10-20 – 2026-10-31');
    expect(el.textContent).toContain('period starting 2026-10-01');
    expect(mocks.getClientBillingCycleAnchor).toHaveBeenCalledTimes(1);
    expect(mocks.getClientBillingCycleAnchor).toHaveBeenCalledWith('client-1');
  });

  it('fetches the schedule once for several lines, not once per line', async () => {
    const data = buildData();
    data.fixed_lines = [data.fixed_lines[0], { ...data.fixed_lines[0], line_key: 'line-2' }];
    render(<Harness initial={data} />);

    await screen.findAllByText(/First invoice:/);
    expect(mocks.getClientBillingCycleAnchor).toHaveBeenCalledTimes(1);
  });

  it('clicking Bill in advance flips that line to advance and leaves cadence_owner alone', async () => {
    let latest: any;
    render(<Harness initial={buildData()} onData={(d) => (latest = d)} />);
    await screen.findByText(/First invoice:/);

    fireEvent.click(button()!);

    expect(latest.fixed_lines[0].billing_timing).toBe('advance');
    expect(latest.cadence_owner).toBe('client');
    expect(latest.billing_timing).toBe('arrears');
    expect(hint()).toBeNull();
  });

  it('a line whose template set billing_timing arrears over an advance contract default still flips', async () => {
    let latest: any;
    render(
      <Harness
        initial={buildData({ billing_timing: 'advance' }, { billing_timing: 'arrears' })}
        onData={(d) => (latest = d)}
      />,
    );
    await screen.findByText(/First invoice:/);

    fireEvent.click(button()!);

    expect(latest.fixed_lines[0].billing_timing).toBe('advance');
    expect(hint()).toBeNull();
  });

  it('an aligned start shows nothing', async () => {
    render(<Harness initial={buildData({ start_date: '2026-10-01' })} />);
    await vi.waitFor(() => expect(mocks.getClientBillingCycleAnchor).toHaveBeenCalled());
    await Promise.resolve();
    expect(hint()).toBeNull();
  });

  it('shows nothing for contract cadence or an advance line, and no longer shows the step-level alert', async () => {
    const { unmount } = render(<Harness initial={buildData({ cadence_owner: 'contract' })} />);
    expect(hint()).toBeNull();
    expect(document.getElementById('fixed-fee-advance-suggestion')).toBeNull();
    unmount();

    render(<Harness initial={buildData({}, { billing_timing: 'advance' })} />);
    await vi.waitFor(() => expect(mocks.getClientBillingCycleAnchor).toHaveBeenCalled());
    await Promise.resolve();
    expect(hint()).toBeNull();
    expect(document.getElementById('fixed-fee-advance-suggestion')).toBeNull();
  });

  it('shows nothing when the schedule fails to load', async () => {
    mocks.getClientBillingCycleAnchor.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Harness initial={buildData()} />);
    await vi.waitFor(() => expect(mocks.getClientBillingCycleAnchor).toHaveBeenCalled());
    await Promise.resolve();
    expect(hint()).toBeNull();
  });
});
