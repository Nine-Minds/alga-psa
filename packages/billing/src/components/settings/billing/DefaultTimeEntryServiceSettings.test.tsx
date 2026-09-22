/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getDefaultBillingSettings = vi.fn();
const updateDefaultBillingSettings = vi.fn();
const getServices = vi.fn();
const handleError = vi.fn();
const toastSuccess = vi.fn();

const { translate } = vi.hoisted(() => ({
  translate: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
}));

vi.mock('../../../actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: (...args: unknown[]) => getDefaultBillingSettings(...(args as [])),
  updateDefaultBillingSettings: (...args: unknown[]) => updateDefaultBillingSettings(...(args as [])),
}));

vi.mock('../../../actions/serviceActions', () => ({
  getServices: (...args: unknown[]) => getServices(...(args as [])),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
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

import DefaultTimeEntryServiceSettings from './DefaultTimeEntryServiceSettings';

const SERVICES = {
  services: [
    { service_id: 'service-a', service_name: 'Service A' },
    { service_id: 'service-b', service_name: 'Service B' },
  ],
};

async function renderLoaded() {
  render(<DefaultTimeEntryServiceSettings />);
  await waitFor(() =>
    expect((screen.getByTestId('default-time-entry-service') as HTMLSelectElement).value).toBe('service-a')
  );
}

describe('DefaultTimeEntryServiceSettings error handling', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps the current value and does not show success when the save returns an action error', async () => {
    getDefaultBillingSettings.mockResolvedValue({ defaultTimeEntryServiceId: 'service-a' });
    getServices.mockResolvedValue(SERVICES);
    updateDefaultBillingSettings.mockResolvedValue({ actionError: 'not an active hourly service' });

    await renderLoaded();
    await userEvent.selectOptions(screen.getByTestId('default-time-entry-service'), 'service-b');

    await waitFor(() => expect(handleError).toHaveBeenCalledWith('not an active hourly service'));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect((screen.getByTestId('default-time-entry-service') as HTMLSelectElement).value).toBe('service-a');
  });

  it('updates the local value and shows success when the save succeeds', async () => {
    getDefaultBillingSettings.mockResolvedValue({ defaultTimeEntryServiceId: 'service-a' });
    getServices.mockResolvedValue(SERVICES);
    updateDefaultBillingSettings.mockResolvedValue({ success: true });

    await renderLoaded();
    await userEvent.selectOptions(screen.getByTestId('default-time-entry-service'), 'service-b');

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    await waitFor(() =>
      expect((screen.getByTestId('default-time-entry-service') as HTMLSelectElement).value).toBe('service-b')
    );
  });

  it('clears the default by sending null', async () => {
    getDefaultBillingSettings.mockResolvedValue({ defaultTimeEntryServiceId: 'service-a' });
    getServices.mockResolvedValue(SERVICES);
    updateDefaultBillingSettings.mockResolvedValue({ success: true });

    await renderLoaded();
    await userEvent.selectOptions(screen.getByTestId('default-time-entry-service'), '');

    await waitFor(() => expect(updateDefaultBillingSettings).toHaveBeenCalledWith({ defaultTimeEntryServiceId: null }));
  });
});
