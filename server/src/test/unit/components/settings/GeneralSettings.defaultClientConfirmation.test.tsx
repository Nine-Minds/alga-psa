/**
 * @vitest-environment jsdom
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const readEnBundle = (namespace: string) =>
  JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), `public/locales/en/${namespace}.json`),
      'utf8'
    )
  );

const enBundles: Record<string, any> = {
  'msp/settings': readEnBundle('msp/settings'),
  // Dialog's shared dismiss guard renders its discard prompt from `common`.
  common: readEnBundle('common'),
};

// Resolve against the real en bundle of the requested namespace so the test also
// proves the keys exist where the component actually looks them up.
const makeTranslate = (namespace: string) => (key: string, options?: Record<string, unknown>) => {
  const bundle = enBundles[namespace];
  if (!bundle) {
    throw new Error(`Unexpected i18n namespace in test: ${namespace}`);
  }
  const template = key.split('.').reduce<any>((acc, part) => acc?.[part], bundle);
  if (typeof template !== 'string') {
    throw new Error(`Missing en ${namespace} key: ${key}`);
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    options?.[name] === undefined ? match : String(options[name])
  );
};
const stableI18n = { language: 'en' };
const stableTranslations: Record<string, { t: ReturnType<typeof makeTranslate>; i18n: typeof stableI18n }> = {};
const translationFor = (namespace: string = 'msp/settings') =>
  (stableTranslations[namespace] ??= { t: makeTranslate(namespace), i18n: stableI18n });
const stableTranslation = translationFor('msp/settings');
const translate = stableTranslation.t;
const enSettings = enBundles['msp/settings'];

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: (namespace?: string) => translationFor(namespace),
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

vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/dashboardWelcomeActions', () => ({
  getDashboardWelcomeSettingsAction: vi.fn().mockResolvedValue({
    useCompanyName: false,
    companyName: 'Acme MSP',
  }),
  setDashboardWelcomeUseCompanyNameAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alga-psa/clients/actions/queryActions', () => ({
  getAllClients: vi.fn().mockResolvedValue([
    { client_id: 'client-1', client_name: 'Acme MSP' },
    { client_id: 'client-2', client_name: 'Globex' },
    { client_id: 'client-3', client_name: 'Initech' },
  ]),
}));

// Country-derived defaults: the MSP sits in the US, the client being considered
// in the UK, so switching visibly changes the date shape.
const countryDefaults: Record<string, unknown> = {
  'client-1': {
    country: { code: 'US', name: 'United States', phone_code: '+1' },
    dateFormat: { country: 'US', datePattern: 'MM/dd/yyyy', hour12: true },
  },
  'client-2': {
    country: { code: 'GB', name: 'United Kingdom', phone_code: '+44' },
    dateFormat: { country: 'GB', datePattern: 'dd/MM/yyyy', hour12: false },
  },
};

vi.mock('@alga-psa/clients/actions/countryActions', () => ({
  getClientCountryDefaultsPreview: vi.fn(async (clientId: string) => countryDefaults[clientId] ?? null),
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

    // A node message makes the dialog describe itself by its title, so the
    // heading and the screen-reader description both carry it.
    await screen.findAllByText(enSettings.general.clients.confirmDialog.title);
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

  it('spells out the country, dial code and date format your company decides', async () => {
    render(<GeneralSettings />);

    await screen.findByText(enSettings.general.clients.defaults.title);
    expect(
      screen.getByText(
        translate('general.clients.defaults.country', { country: 'United States (US)' })
      )
    ).toBeTruthy();
    expect(
      screen.getByText(translate('general.clients.defaults.phoneCode', { code: '+1' }))
    ).toBeTruthy();
    expect(
      screen.getByText(
        translate('general.clients.defaults.dateFormat', {
          pattern: 'MM/dd/yyyy',
          example: '11/22/2033',
          clock: enSettings.general.clients.defaults.clock12,
        })
      )
    ).toBeTruthy();
    expect(screen.getByText(enSettings.general.clients.defaults.portalNote)).toBeTruthy();
  });

  it('shows what changes before the default client is switched', async () => {
    render(<GeneralSettings />);

    await waitFor(() => expect(radioFor('client-2')).toBeTruthy());
    fireEvent.click(radioFor('client-2'));

    await screen.findByText(
      translate('general.clients.defaults.changeIntro', { name: 'Globex' })
    );
    expect(
      screen.getByText(
        translate('general.clients.defaults.dateFormat', {
          pattern: 'dd/MM/yyyy',
          example: '22/11/2033',
          clock: enSettings.general.clients.defaults.clock24,
        })
      )
    ).toBeTruthy();
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
