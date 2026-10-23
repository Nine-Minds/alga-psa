/**
 * @vitest-environment jsdom
 */

/**
 * A project's billing currency is pinned to the client's on every write, but a
 * client can change currency afterwards and strand the figures: seen in
 * production with a CHF tenant, an ARS client and a cap still counted in USD
 * (alga-2026-0002622). The cards have to say so, and re-entering the cap has to
 * move the project to the currency invoices actually use.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import type { IProjectBillingConfig } from '@alga-psa/types';

const updateProjectBillingConfigMock = vi.hoisted(() => vi.fn());

vi.mock('../../actions/projectBillingConfigActions', () => ({
  updateProjectBillingConfig: (...args: unknown[]) => updateProjectBillingConfigMock(...args),
}));

vi.mock('react-hot-toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>, params?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : _key;
      const vars = (typeof fallback === 'string' ? params : fallback) ?? {};
      return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
        vars[name] === undefined ? match : String(vars[name]));
    },
    i18n: { language: 'en' },
  }),
}));

import BudgetVsActualCard from './BudgetVsActualCard';
import CapPanel from './CapPanel';

function tmConfig(overrides: Partial<IProjectBillingConfig> = {}): IProjectBillingConfig {
  return {
    tenant: 'tenant-1',
    config_id: 'config-1',
    project_id: 'project-1',
    billing_model: 'time_and_materials',
    total_price: null,
    currency: 'USD',
    invoice_mode: 'standalone',
    contract_id: null,
    cap_amount: 100_000,
    cap_behavior: 'hard_cap',
    cap_notify_thresholds: [75, 90, 100],
    deposit_treatment: 'credit',
    is_taxable: true,
    tax_region: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as IProjectBillingConfig;
}

// The tenant's own default is a third currency, so a notice that quoted it
// instead of the client's would be visible here.
function renderInTenant(node: React.ReactNode) {
  return render(<CurrencyFormatProvider currencyCode="CHF">{node}</CurrencyFormatProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('project billing currency drift', () => {
  it('names the invoice currency when the budget card amounts are stranded', () => {
    renderInTenant(
      <BudgetVsActualCard config={tmConfig()} rollup={null} capUsage={null} invoiceCurrency="ARS" />,
    );

    const notice = document.getElementById('project-billing-currency-mismatch');
    expect(notice).toHaveTextContent("Amounts here are in USD, but this project's invoices bill in ARS");
    expect(notice).toHaveTextContent('a budget cap counted here is not applied');
  });

  it('stays quiet when the project and the invoice currency agree', () => {
    renderInTenant(
      <BudgetVsActualCard config={tmConfig({ currency: 'ars' })} rollup={null} capUsage={null} invoiceCurrency="ARS" />,
    );

    expect(document.getElementById('project-billing-currency-mismatch')).toBeNull();
  });

  it('asks for the cap in the invoice currency and re-pins the project on save', async () => {
    updateProjectBillingConfigMock.mockResolvedValue(tmConfig({ currency: 'ARS', cap_amount: 250_000 }));
    renderInTenant(
      <CapPanel config={tmConfig()} canManage invoiceCurrency="ARS" onChanged={vi.fn()} />,
    );

    expect(document.getElementById('project-billing-cap-currency-stale')).toHaveTextContent(
      "The saved cap is in USD, which this project's invoices do not bill in",
    );
    // Empty rather than the USD figure re-labelled as ARS: the stored number
    // means nothing in the new currency.
    const capInput = document.getElementById('billing-cap-amount') as HTMLInputElement;
    expect(capInput.value).toBe('');
    expect(screen.getByText('Cap amount (ARS)')).toBeInTheDocument();

    fireEvent.change(capInput, { target: { value: '2500' } });
    fireEvent.click(document.getElementById('billing-cap-save') as HTMLElement);

    await waitFor(() => expect(updateProjectBillingConfigMock).toHaveBeenCalledTimes(1));
    expect(updateProjectBillingConfigMock).toHaveBeenCalledWith('config-1', {
      cap_amount: 250_000,
      cap_behavior: 'hard_cap',
      cap_notify_thresholds: [75, 90, 100],
      currency: 'ARS',
    });
  });

  it('keeps a dormant cap when only the thresholds are edited', async () => {
    updateProjectBillingConfigMock.mockResolvedValue(tmConfig());
    renderInTenant(
      <CapPanel config={tmConfig()} canManage invoiceCurrency="ARS" onChanged={vi.fn()} />,
    );

    // The amount field is blank because the currency is stale, not because the
    // biller cleared it, so a thresholds-only save must not discard the stored
    // figure -- nor re-pin the currency and make that figure start biting.
    fireEvent.change(document.getElementById('billing-cap-thresholds') as HTMLElement, {
      target: { value: '50, 80' },
    });
    fireEvent.click(document.getElementById('billing-cap-save') as HTMLElement);

    await waitFor(() => expect(updateProjectBillingConfigMock).toHaveBeenCalledTimes(1));
    const payload = updateProjectBillingConfigMock.mock.calls[0][1];
    expect(payload).not.toHaveProperty('cap_amount');
    expect(payload).not.toHaveProperty('currency');
    expect(payload.cap_notify_thresholds).toEqual([50, 80]);
  });

  it('still removes the cap when an aligned project is cleared', async () => {
    updateProjectBillingConfigMock.mockResolvedValue(tmConfig({ currency: 'ARS', cap_amount: null }));
    renderInTenant(
      <CapPanel config={tmConfig({ currency: 'ARS' })} canManage invoiceCurrency="ARS" onChanged={vi.fn()} />,
    );

    fireEvent.change(document.getElementById('billing-cap-amount') as HTMLElement, {
      target: { value: '' },
    });
    fireEvent.click(document.getElementById('billing-cap-save') as HTMLElement);

    await waitFor(() => expect(updateProjectBillingConfigMock).toHaveBeenCalledTimes(1));
    expect(updateProjectBillingConfigMock.mock.calls[0][1].cap_amount).toBeNull();
  });

  it('leaves an aligned project exactly as it was', async () => {
    updateProjectBillingConfigMock.mockResolvedValue(tmConfig({ currency: 'ARS' }));
    renderInTenant(
      <CapPanel config={tmConfig({ currency: 'ARS' })} canManage invoiceCurrency="ARS" onChanged={vi.fn()} />,
    );

    expect(document.getElementById('project-billing-cap-currency-stale')).toBeNull();
    const capInput = document.getElementById('billing-cap-amount') as HTMLInputElement;
    expect(capInput.value).toBe('1000');

    fireEvent.click(document.getElementById('billing-cap-save') as HTMLElement);
    await waitFor(() => expect(updateProjectBillingConfigMock).toHaveBeenCalledTimes(1));
    expect(updateProjectBillingConfigMock.mock.calls[0][1]).not.toHaveProperty('currency');
  });
});
