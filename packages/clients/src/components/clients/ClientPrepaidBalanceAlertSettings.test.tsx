/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getSettingsMock = vi.fn();
const updateSettingsMock = vi.fn();
const getContractOverridesMock = vi.fn();
const updateContractOverrideMock = vi.fn();

vi.mock('../../lib/billingHelpers', () => ({
  getPrepaidBalanceAlertSettingsAsync: (...args: unknown[]) => getSettingsMock(...args),
  updatePrepaidBalanceAlertSettingsAsync: (...args: unknown[]) => updateSettingsMock(...args),
  getPrepaidReplenishmentContractOverridesAsync: (...args: unknown[]) => getContractOverridesMock(...args),
  updatePrepaidReplenishmentContractOverrideAsync: (...args: unknown[]) => updateContractOverrideMock(...args),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('posthog-js/react', () => ({
  usePostHog: () => null,
}));

const toastMock = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastMock('success', ...args),
    error: (...args: unknown[]) => toastMock('error', ...args),
  },
  toast: {
    success: (...args: unknown[]) => toastMock('success', ...args),
    error: (...args: unknown[]) => toastMock('error', ...args),
    custom: (...args: unknown[]) => toastMock('custom', ...args),
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

import ClientPrepaidBalanceAlertSettings from './ClientPrepaidBalanceAlertSettings';

describe('ClientPrepaidBalanceAlertSettings', () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    updateSettingsMock.mockReset();
    getContractOverridesMock.mockReset();
    updateContractOverrideMock.mockReset();
    toastMock.mockReset();
    getSettingsMock.mockResolvedValue({
      prepaidCreditAlertThreshold: null,
      prepaidCreditAlertCurrencyCode: null,
      bucketUsageAlertPercent: null,
      notifyClientOnPrepaidAlert: false,
      prepaidReplenishmentTier: 'notify',
      defaultCurrencyCode: 'EUR',
    });
    updateSettingsMock.mockResolvedValue({ success: true });
    getContractOverridesMock.mockResolvedValue([]);
    updateContractOverrideMock.mockResolvedValue({ success: true });
  });

  it('initializes the credit currency from the client default when no policy exists', async () => {
    render(<ClientPrepaidBalanceAlertSettings clientId="c1" defaultCurrencyCode="EUR" />);
    await waitFor(() => expect(getSettingsMock).toHaveBeenCalledWith('c1'));
    expect(screen.getByText('Prepaid Balance Alerts')).toBeDefined();
    // Credit and bucket controls start off; client opt-in is disabled.
    // findBy*: the mock having been called does not mean its resolved value
    // has committed to the DOM yet, so sync getBy* races on slow runners.
    const notifySwitch = await screen.findByRole('switch', { name: /client billing recipient/i });
    expect(notifySwitch).toBeDisabled();
  });

  it('enables credit controls and converts money to minor units on save', async () => {
    render(<ClientPrepaidBalanceAlertSettings clientId="c1" defaultCurrencyCode="EUR" />);
    await waitFor(() => expect(getSettingsMock).toHaveBeenCalled());

    await userEvent.click(await screen.findByRole('switch', { name: /prepaid credit alerts/i }));
    const amount = screen.getByPlaceholderText('e.g. 500.00');
    await userEvent.type(amount, '50');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith({
        clientId: 'c1',
        prepaidCreditAlertThreshold: 5000,
        prepaidCreditAlertCurrencyCode: 'EUR',
        bucketUsageAlertPercent: null,
        notifyClientOnPrepaidAlert: false,
        prepaidReplenishmentTier: 'notify',
        prepaidCreditReplenishmentAmount: null,
        prepaidBucketReplenishmentMinutes: null,
        prepaidReplenishmentHorizonDays: 30,
      })
    );
  });

  it('displays and saves credit replenishment in currency units, not raw minor units', async () => {
    getSettingsMock.mockResolvedValueOnce({
      prepaidCreditAlertThreshold: 5000,
      prepaidCreditAlertCurrencyCode: 'EUR',
      bucketUsageAlertPercent: null,
      notifyClientOnPrepaidAlert: false,
      prepaidReplenishmentTier: 'draft',
      prepaidCreditReplenishmentAmount: 50000,
      prepaidBucketReplenishmentMinutes: null,
      prepaidReplenishmentHorizonDays: 30,
      defaultCurrencyCode: 'EUR',
    });
    render(<ClientPrepaidBalanceAlertSettings clientId="c1" defaultCurrencyCode="EUR" />);
    const topUp = await screen.findByDisplayValue('500.00');
    expect(topUp).toBeDefined();
    await userEvent.clear(topUp);
    await userEvent.type(topUp, '750');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(updateSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      prepaidCreditReplenishmentAmount: 75000,
    })));
  });

  it('validates whole-percent bucket input and does not submit invalid values', async () => {
    render(<ClientPrepaidBalanceAlertSettings clientId="c1" />);
    await waitFor(() => expect(getSettingsMock).toHaveBeenCalled());

    await userEvent.click(await screen.findByRole('switch', { name: /bucket usage alerts/i }));
    const percent = screen.getByPlaceholderText('e.g. 80');
    await userEvent.type(percent, '150');

    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(screen.getByText(/whole number from 1 to 100/i)).toBeDefined();
  });

  it('submits bucket percentage and client opt-in together', async () => {
    render(<ClientPrepaidBalanceAlertSettings clientId="c1" />);
    await waitFor(() => expect(getSettingsMock).toHaveBeenCalled());

    await userEvent.click(await screen.findByRole('switch', { name: /bucket usage alerts/i }));
    await userEvent.type(screen.getByPlaceholderText('e.g. 80'), '80');
    await userEvent.click(screen.getByRole('switch', { name: /client billing recipient/i }));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith({
        clientId: 'c1',
        prepaidCreditAlertThreshold: null,
        prepaidCreditAlertCurrencyCode: null,
        bucketUsageAlertPercent: 80,
        notifyClientOnPrepaidAlert: true,
        prepaidReplenishmentTier: 'notify',
        prepaidCreditReplenishmentAmount: null,
        prepaidBucketReplenishmentMinutes: null,
        prepaidReplenishmentHorizonDays: 30,
      })
    );
  });

  it('keeps the policy not loaded and prevents saving when the read action returns an error', async () => {
    getSettingsMock.mockResolvedValueOnce({ actionError: 'Prepaid balance alerts are not enabled for this workspace' });
    render(<ClientPrepaidBalanceAlertSettings clientId="c1" />);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('error', expect.any(String)));

    expect(screen.getByRole('alert')).toHaveTextContent(/failed to load prepaid balance alert settings/i);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.queryByRole('switch', { name: /prepaid credit alerts/i })).toBeNull();
    expect(screen.queryByRole('switch', { name: /bucket usage alerts/i })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it('keeps Save disabled when the settings read rejects or returns an unusable result', async () => {
    getSettingsMock.mockRejectedValueOnce(new Error('read unavailable'));
    const { rerender } = render(<ClientPrepaidBalanceAlertSettings clientId="c1" />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(updateSettingsMock).not.toHaveBeenCalled();

    getSettingsMock.mockResolvedValueOnce(null);
    rerender(<ClientPrepaidBalanceAlertSettings clientId="c2" />);

    // Waiting on the call alone only proves the read started; the null result
    // still has to resolve and re-render before the alert exists. Wait on the
    // alert itself, which is the actual post-condition.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to load prepaid balance alert settings/i)
    );
    expect(getSettingsMock).toHaveBeenCalledWith('c2');
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it('pre-populates existing policy values and resets opt-in when both alerts are disabled', async () => {
    getSettingsMock.mockResolvedValue({
      prepaidCreditAlertThreshold: 5000,
      prepaidCreditAlertCurrencyCode: 'USD',
      bucketUsageAlertPercent: 80,
      notifyClientOnPrepaidAlert: true,
      defaultCurrencyCode: 'EUR',
    });
    render(<ClientPrepaidBalanceAlertSettings clientId="c1" />);
    await waitFor(() => expect(getSettingsMock).toHaveBeenCalled());

    expect(await screen.findByPlaceholderText('e.g. 500.00')).toHaveValue(50);
    expect(screen.getByPlaceholderText('e.g. 80')).toHaveValue(80);
    // Turning off both alert types disables and clears the client opt-in.
    await userEvent.click(screen.getByRole('switch', { name: /prepaid credit alerts/i }));
    await userEvent.click(screen.getByRole('switch', { name: /bucket usage alerts/i }));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith({
        clientId: 'c1',
        prepaidCreditAlertThreshold: null,
        prepaidCreditAlertCurrencyCode: null,
        bucketUsageAlertPercent: null,
        notifyClientOnPrepaidAlert: false,
        prepaidReplenishmentTier: 'notify',
        prepaidCreditReplenishmentAmount: null,
        prepaidBucketReplenishmentMinutes: null,
        prepaidReplenishmentHorizonDays: 30,
      })
    );
  });

  it('converts the saved threshold using the alert currency, not the client default', async () => {
    getSettingsMock.mockResolvedValue({
      prepaidCreditAlertThreshold: 500,
      prepaidCreditAlertCurrencyCode: 'JPY',
      bucketUsageAlertPercent: null,
      notifyClientOnPrepaidAlert: false,
      prepaidReplenishmentTier: 'notify',
      defaultCurrencyCode: 'USD',
    });
    render(<ClientPrepaidBalanceAlertSettings clientId="c1" defaultCurrencyCode="USD" />);
    await waitFor(() => expect(getSettingsMock).toHaveBeenCalled());

    // JPY has 0 fraction digits: 500 JPY must display as "500", never "5.00".
    const amount = await screen.findByPlaceholderText('e.g. 500.00') as HTMLInputElement;
    expect(amount.value).toBe('500');

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ prepaidCreditAlertThreshold: 500, prepaidCreditAlertCurrencyCode: 'JPY' })
      )
    );
  });

  it('keeps the card busy while the read is in flight', async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    getSettingsMock.mockReturnValue(new Promise((res) => { resolveRead = res; }));
    render(<ClientPrepaidBalanceAlertSettings clientId="c1" />);
    await waitFor(() => expect(getSettingsMock).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();

    resolveRead({
      prepaidCreditAlertThreshold: null,
      prepaidCreditAlertCurrencyCode: null,
      bucketUsageAlertPercent: null,
      notifyClientOnPrepaidAlert: false,
      defaultCurrencyCode: 'USD',
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled());
  });
});
