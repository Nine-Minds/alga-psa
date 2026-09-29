// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeAnchorSettingsForCycle } from '@alga-psa/shared/billingClients/billingCycleAnchors';

/**
 * The review step and the post-creation confirmation both state when the new
 * fixed-fee line first invoices. Contract cadence needs nothing but the form;
 * client cadence needs the client's billing cycle, and must never show a date it
 * could not justify.
 */

const mocks = vi.hoisted(() => ({
  getClientBillingCycleAnchor: vi.fn(),
}));

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
}));

const { FirstInvoiceNotice } = await import('./FirstInvoiceNotice');

const monthlyConfig = () => ({
  billingCycle: 'monthly',
  anchor: normalizeAnchorSettingsForCycle('monthly', {}),
});

describe('FirstInvoiceNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('contract cadence, arrears: names the end of the first service period and does not fetch the client schedule', () => {
    render(
      <FirstInvoiceNotice
        id="notice"
        cadenceOwner="contract"
        billingTiming="arrears"
        billingFrequency="monthly"
        startDate="2025-01-15"
        clientId="client-1"
      />,
    );

    const notice = screen.getByText(/Billed in arrears on the contract's cadence/);
    expect(notice.textContent).toContain('2025-02-15');
    expect(screen.getByText(/nothing to bill for this line/)).toBeTruthy();
    expect(mocks.getClientBillingCycleAnchor).not.toHaveBeenCalled();
  });

  it('contract cadence, advance: names the start date and omits the arrears note', () => {
    render(
      <FirstInvoiceNotice
        id="notice"
        cadenceOwner="contract"
        billingTiming="advance"
        billingFrequency="quarterly"
        startDate="2025-01-15"
      />,
    );

    expect(screen.getByText(/Billed in advance on the contract's cadence/).textContent).toContain('2025-01-15');
    expect(screen.queryByText(/nothing to bill for this line/)).toBeNull();
  });

  it('client cadence, arrears: waits for the client schedule, then names the end of the current billing period', async () => {
    mocks.getClientBillingCycleAnchor.mockResolvedValue(monthlyConfig());

    render(
      <FirstInvoiceNotice
        id="notice"
        cadenceOwner="client"
        billingTiming="arrears"
        billingFrequency="monthly"
        startDate="2025-01-15"
        clientId="client-1"
      />,
    );

    expect(screen.getByText(/Checking the client's billing schedule/)).toBeTruthy();
    const notice = await screen.findByText(/Billed in arrears on the client's billing schedule/);
    expect(notice.textContent).toContain('2025-02-01');
    expect(mocks.getClientBillingCycleAnchor).toHaveBeenCalledWith('client-1');
  });

  it('client cadence, advance: names the start of the billing period that contains the start date', async () => {
    mocks.getClientBillingCycleAnchor.mockResolvedValue(monthlyConfig());

    render(
      <FirstInvoiceNotice
        id="notice"
        cadenceOwner="client"
        billingTiming="advance"
        startDate="2025-01-15"
        clientId="client-1"
      />,
    );

    const notice = await screen.findByText(/Billed in advance on the client's billing schedule/);
    expect(notice.textContent).toContain('2025-01-01');
  });

  it.each([
    ['a permission error', { permissionError: 'Permission denied' }],
    ['an action error', { actionError: 'Nope' }],
  ])('client cadence: %s from the schedule lookup yields a date-free sentence', async (_label, response) => {
    mocks.getClientBillingCycleAnchor.mockResolvedValue(response);

    render(
      <FirstInvoiceNotice
        id="notice"
        cadenceOwner="client"
        billingTiming="arrears"
        startDate="2025-01-15"
        clientId="client-1"
      />,
    );

    const notice = await screen.findByText(/couldn't be loaded, so no date is shown/);
    expect(notice.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('client cadence: a rejected schedule lookup yields a date-free sentence', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getClientBillingCycleAnchor.mockRejectedValue(new Error('boom'));

    render(
      <FirstInvoiceNotice
        id="notice"
        cadenceOwner="client"
        billingTiming="advance"
        startDate="2025-01-15"
        clientId="client-1"
      />,
    );

    await waitFor(() => expect(screen.getByText(/couldn't be loaded, so no date is shown/)).toBeTruthy());
    consoleError.mockRestore();
  });

  it('asks for a start date before stating anything', () => {
    render(
      <FirstInvoiceNotice id="notice" cadenceOwner="contract" billingTiming="arrears" startDate="" />,
    );

    expect(screen.getByText(/Choose a start date/)).toBeTruthy();
  });

  it('contract cadence: a frequency contract cadence does not support shows no date', () => {
    render(
      <FirstInvoiceNotice
        id="notice"
        cadenceOwner="contract"
        billingTiming="arrears"
        billingFrequency="weekly"
        startDate="2025-01-15"
      />,
    );

    const notice = screen.getByText(/doesn't support this frequency/);
    expect(notice.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
