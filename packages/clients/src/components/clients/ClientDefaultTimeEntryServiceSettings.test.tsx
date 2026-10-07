/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getClientContractLineSettingsAsync = vi.fn();
const updateClientContractLineSettingsAsync = vi.fn();
const getServicesAsync = vi.fn();
const handleError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('../../lib/billingHelpers', () => ({
  getClientContractLineSettingsAsync: (...args: unknown[]) => getClientContractLineSettingsAsync(...(args as [])),
  updateClientContractLineSettingsAsync: (...args: unknown[]) => updateClientContractLineSettingsAsync(...(args as [])),
  getServicesAsync: (...args: unknown[]) => getServicesAsync(...(args as [])),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  // Fresh translator per render: an unstable `t` identity used to be an effect
  // dependency here, which re-ran the load after every state update.
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: (...args: unknown[]) => handleError(...args),
  isActionPermissionError: (value: unknown) =>
    typeof value === 'object' && value !== null && 'permissionError' in value,
  isActionMessageError: (value: unknown) =>
    typeof value === 'object' && value !== null && 'actionError' in value,
}));

vi.mock('react-hot-toast', () => ({
  default: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() },
}));

vi.mock('@radix-ui/themes', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange, disabled }: any) => (
    <select
      data-testid={id}
      value={value}
      disabled={!!disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">none</option>
      {options.map((option: { value: string; label: string }) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

import ClientDefaultTimeEntryServiceSettings from './ClientDefaultTimeEntryServiceSettings';

const SERVICES = {
  services: [
    { service_id: 'service-a', service_name: 'Service A' },
    { service_id: 'service-b', service_name: 'Service B' },
  ],
};

async function renderLoaded() {
  render(<ClientDefaultTimeEntryServiceSettings clientId="client-1" />);
  await waitFor(() => expect(screen.getByTestId('client-default-time-entry-service')).toBeInTheDocument());
  await waitFor(() =>
    expect((screen.getByTestId('client-default-time-entry-service') as HTMLSelectElement).value).toBe('service-a')
  );
}

describe('ClientDefaultTimeEntryServiceSettings error handling', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps the current value and does not show success when the save returns an action error', async () => {
    getClientContractLineSettingsAsync.mockResolvedValue({ defaultTimeEntryServiceId: 'service-a' });
    getServicesAsync.mockResolvedValue(SERVICES);
    updateClientContractLineSettingsAsync.mockResolvedValue({ actionError: 'not applicable to this client' });

    await renderLoaded();
    await userEvent.selectOptions(screen.getByTestId('client-default-time-entry-service'), 'service-b');

    await waitFor(() => expect(handleError).toHaveBeenCalledWith('not applicable to this client'));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect((screen.getByTestId('client-default-time-entry-service') as HTMLSelectElement).value).toBe('service-a');
  });

  it('updates the local value and shows success when the save succeeds', async () => {
    getClientContractLineSettingsAsync.mockResolvedValue({ defaultTimeEntryServiceId: 'service-a' });
    getServicesAsync.mockResolvedValue(SERVICES);
    updateClientContractLineSettingsAsync.mockResolvedValue({ success: true });

    await renderLoaded();
    await userEvent.selectOptions(screen.getByTestId('client-default-time-entry-service'), 'service-b');

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    await waitFor(() =>
      expect((screen.getByTestId('client-default-time-entry-service') as HTMLSelectElement).value).toBe('service-b')
    );
  });

  it('loads exactly once and settles while idle despite a changing translator identity', async () => {
    getClientContractLineSettingsAsync.mockResolvedValue({ defaultTimeEntryServiceId: 'service-a' });
    getServicesAsync.mockResolvedValue(SERVICES);

    await renderLoaded();

    // Let any runaway effect/state cycle surface before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getClientContractLineSettingsAsync).toHaveBeenCalledTimes(1);
    expect(getServicesAsync).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId('client-default-time-entry-service') as HTMLSelectElement).value).toBe('service-a');
  });

  it('loads the new client value and ignores a stale response when clientId changes', async () => {
    let resolveFirst: (value: { defaultTimeEntryServiceId: string }) => void = () => {};
    getClientContractLineSettingsAsync.mockImplementation((id: string) => {
      if (id === 'client-1') {
        return new Promise<{ defaultTimeEntryServiceId: string }>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ defaultTimeEntryServiceId: 'service-b' });
    });
    getServicesAsync.mockResolvedValue(SERVICES);

    const { rerender } = render(<ClientDefaultTimeEntryServiceSettings clientId="client-1" />);
    rerender(<ClientDefaultTimeEntryServiceSettings clientId="client-2" />);

    await waitFor(() =>
      expect((screen.getByTestId('client-default-time-entry-service') as HTMLSelectElement).value).toBe('service-b')
    );

    resolveFirst({ defaultTimeEntryServiceId: 'service-a' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((screen.getByTestId('client-default-time-entry-service') as HTMLSelectElement).value).toBe('service-b');
    expect(getClientContractLineSettingsAsync).toHaveBeenNthCalledWith(1, 'client-1');
    expect(getClientContractLineSettingsAsync).toHaveBeenNthCalledWith(2, 'client-2');
  });
});
