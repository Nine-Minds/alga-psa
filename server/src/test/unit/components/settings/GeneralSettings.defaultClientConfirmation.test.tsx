/**
 * @vitest-environment jsdom
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const enSettings = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'public/locales/en/msp/settings.json'),
    'utf8'
  )
);

// Resolve against the real en bundle so the test also proves the keys exist.
const translate = (key: string, options?: Record<string, unknown>) => {
  const template = key.split('.').reduce<any>((acc, part) => acc?.[part], enSettings);
  if (typeof template !== 'string') {
    throw new Error(`Missing en msp/settings key: ${key}`);
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    options?.[name] === undefined ? match : String(options[name])
  );
};
const stableI18n = { language: 'en' };
const stableTranslation = { t: translate, i18n: stableI18n };

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => stableTranslation,
  useFormatters: () => ({}),
  useI18n: () => ({ locale: 'en', ...stableTranslation }),
  useOptionalI18n: () => ({ locale: 'en', ...stableTranslation }),
  detectClientLocale: () => 'en',
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const setDefaultClient = vi.fn().mockResolvedValue(undefined);

vi.mock('@alga-psa/tenancy/actions/coreTenantActions', () => ({
  getTenantDetails: vi.fn().mockResolvedValue({
    client_name: 'Acme MSP',
    clients: [
      { client_id: 'client-1', client_name: 'Acme MSP', is_default: true },
      { client_id: 'client-2', client_name: 'Globex', is_default: false },
    ],
  }),
  updateTenantName: vi.fn().mockResolvedValue(undefined),
  addClientToTenant: vi.fn().mockResolvedValue(undefined),
  removeClientFromTenant: vi.fn().mockResolvedValue(undefined),
  setDefaultClient: (...args: unknown[]) => setDefaultClient(...args),
}));

vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions', () => ({
  getTenantTimezoneAuth: vi.fn().mockResolvedValue('UTC'),
  setTenantTimezone: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alga-psa/clients/actions/queryActions', () => ({
  getAllClients: vi.fn().mockResolvedValue([
    { client_id: 'client-1', client_name: 'Acme MSP' },
    { client_id: 'client-2', client_name: 'Globex' },
    { client_id: 'client-3', client_name: 'Initech' },
  ]),
}));

const clientPickerProps = vi.fn();

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: (props: { clients: { client_id: string }[] }) => {
    clientPickerProps(props);
    return <div data-testid="client-picker" />;
  },
}));

vi.mock('@alga-psa/ui/components/TimezonePicker', () => ({
  default: () => <div data-testid="timezone-picker" />,
}));

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
  });
  return { default: toast, toast };
});

import GeneralSettings from '@/components/settings/general/GeneralSettings';

const radioFor = (clientId: string) =>
  document.getElementById(`default-client-radio-${clientId}`) as HTMLInputElement;

describe('GeneralSettings default client confirmation', () => {
  beforeEach(() => {
    setDefaultClient.mockClear();
    clientPickerProps.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('asks for confirmation before changing the default client', async () => {
    render(<GeneralSettings />);

    await waitFor(() => expect(radioFor('client-2')).toBeTruthy());
    expect(radioFor('client-1').checked).toBe(true);
    expect(screen.getByText(enSettings.general.clients.help)).toBeTruthy();
    expect(screen.getByText(enSettings.general.clients.yourCompanyBadge)).toBeTruthy();
    expect(
      screen.getByText(translate('general.clients.currentDefault', { name: 'Acme MSP' }))
    ).toBeTruthy();

    fireEvent.click(radioFor('client-2'));

    await screen.findByText(enSettings.general.clients.confirmDialog.title);
    expect(
      screen.getAllByText(
        translate('general.clients.confirmDialog.message', {
          current: 'Acme MSP',
          next: 'Globex',
        })
      ).length
    ).toBeGreaterThan(0);
    expect(setDefaultClient).not.toHaveBeenCalled();
    expect(radioFor('client-1').checked).toBe(true);
  });

  it('keeps the previous default when the dialog is cancelled', async () => {
    render(<GeneralSettings />);

    await waitFor(() => expect(radioFor('client-2')).toBeTruthy());
    fireEvent.click(radioFor('client-2'));

    const cancelButton = await screen.findByText(
      enSettings.general.clients.confirmDialog.cancel
    );
    fireEvent.click(cancelButton);

    await waitFor(() =>
      expect(
        screen.queryByText(enSettings.general.clients.confirmDialog.title)
      ).toBeNull()
    );
    expect(setDefaultClient).not.toHaveBeenCalled();
    expect(radioFor('client-1').checked).toBe(true);
    expect(radioFor('client-2').checked).toBe(false);
  });

  it('applies the new default once confirmed', async () => {
    render(<GeneralSettings />);

    await waitFor(() => expect(radioFor('client-2')).toBeTruthy());
    fireEvent.click(radioFor('client-2'));

    const confirmButton = await screen.findByText(
      enSettings.general.clients.confirmDialog.confirm
    );
    fireEvent.click(confirmButton);

    await waitFor(() => expect(setDefaultClient).toHaveBeenCalledWith('client-2'));
    await waitFor(() => expect(radioFor('client-2').checked).toBe(true));
    expect(radioFor('client-1').checked).toBe(false);
  });

  it('does not offer clients that are already listed', async () => {
    render(<GeneralSettings />);

    await waitFor(() => expect(radioFor('client-2')).toBeTruthy());
    await waitFor(() => {
      const lastCall = clientPickerProps.mock.calls.at(-1)?.[0];
      expect(lastCall.clients.map((c: { client_id: string }) => c.client_id)).toEqual([
        'client-3',
      ]);
    });
  });
});
