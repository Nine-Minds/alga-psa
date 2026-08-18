// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RmmIntegrationStatus } from '../../../actions/integrations/rmmIntegrationStatusActions';

const { getStatusesMock, updateMock } = vi.hoisted(() => ({
  getStatusesMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('../../../actions/integrations/rmmIntegrationStatusActions', () => ({
  getRmmIntegrationStatuses: getStatusesMock,
  updateRmmDeviceSyncSettings: updateMock,
}));

// The package-wide i18n mock only provides useTranslation; this card also
// formats timestamps in the app locale.
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string } & Record<string, unknown>) => {
    const template = options?.defaultValue ?? key;
    return template.replace(/\{\{(\w+)\}\}/g, (match, name) => {
      const value = options?.[name];
      return value === undefined || value === null ? match : String(value);
    });
  };
  const translation = { t };
  const formatters = {
    locale: 'en',
    formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en', options).format(typeof date === 'string' ? new Date(date) : date),
    formatNumber: (value: number) => String(value),
    formatCurrency: (value: number) => String(value),
    formatRelativeTime: () => '',
  };
  return { useTranslation: () => translation, useFormatters: () => formatters };
});

import { RmmDeviceSyncSettings } from './RmmDeviceSyncSettings';

// Input and Button take their DOM id from the ui-reflection hook, which the
// package test setup stubs out, so reach those two by role instead of by id.
const intervalInput = () => screen.getByRole('spinbutton');
const saveButton = () => screen.getByRole('button', { name: /Save sync schedule/ });

function makeStatus(overrides: Partial<RmmIntegrationStatus> = {}): RmmIntegrationStatus {
  return {
    provider: 'ninjaone',
    integrationId: 'integration-1',
    isActive: true,
    syncStatus: 'completed',
    syncError: null,
    connectedAt: '2026-08-01T00:00:00.000Z',
    lastSyncAt: '2026-08-09T12:00:00.000Z',
    deviceCount: 12,
    deviceSyncEnabled: false,
    deviceSyncIntervalMinutes: 60,
    lastIncrementalSyncAt: null,
    ...overrides,
  };
}

describe('RmmDeviceSyncSettings', () => {
  beforeEach(() => {
    getStatusesMock.mockResolvedValue({ success: true, statuses: {} });
    updateMock.mockResolvedValue({ success: true, intervalMinutes: 30 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('T001: renders the schedule control for a supported provider', () => {
    render(<RmmDeviceSyncSettings provider="ninjaone" status={makeStatus({ deviceSyncEnabled: true })} />);

    expect(document.getElementById('ninjaone-device-sync-settings')).toBeInTheDocument();
    expect(document.getElementById('ninjaone-device-sync-enabled')).toBeInTheDocument();
    expect(intervalInput()).toHaveValue(60);
    expect(screen.getByText('The scheduled sync has not run yet.')).toBeInTheDocument();
  });

  it('T002: renders nothing for a provider without a scheduled device sync', () => {
    const { container } = render(
      <RmmDeviceSyncSettings provider="huntress" status={makeStatus({ provider: 'huntress' })} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(getStatusesMock).not.toHaveBeenCalled();
  });

  it('T003: saving sends the chosen enablement and interval to the action', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<RmmDeviceSyncSettings provider="levelio" status={makeStatus({ provider: 'levelio' })} onSaved={onSaved} />);

    await user.clear(intervalInput());
    await user.type(intervalInput(), '30');
    await user.click(document.getElementById('levelio-device-sync-enabled') as HTMLElement);
    await user.click(saveButton());

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({ provider: 'levelio', enabled: true, intervalMinutes: 30 });
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('T004: an interval outside 15..1440 is rejected before it reaches the action', async () => {
    const user = userEvent.setup();
    render(<RmmDeviceSyncSettings provider="ninjaone" status={makeStatus()} />);

    await user.clear(intervalInput());
    await user.type(intervalInput(), '5');

    expect(screen.getByText('Enter a whole number of minutes between 15 and 1440.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await user.click(saveButton());
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('T005: shows the integration sync error and distinguishes scheduled runs from manual ones', () => {
    render(
      <RmmDeviceSyncSettings
        provider="ninjaone"
        status={makeStatus({
          syncError: 'NinjaOne returned 401',
          lastIncrementalSyncAt: '2026-08-10T08:00:00.000Z',
        })}
      />
    );

    expect(screen.getByText('The last sync failed: NinjaOne returned 401')).toBeInTheDocument();
    expect(screen.getByText(/^Last scheduled run: /)).toBeInTheDocument();
    expect(screen.getByText(/^Last sync of any kind, including manual full syncs: /)).toBeInTheDocument();
  });

  it('T006: loads its own status when the caller does not supply one', async () => {
    getStatusesMock.mockResolvedValue({
      success: true,
      statuses: { ninjaone: makeStatus({ deviceSyncEnabled: true, deviceSyncIntervalMinutes: 240 }) },
    });

    render(<RmmDeviceSyncSettings provider="ninjaone" />);

    await waitFor(() => {
      expect(intervalInput()).toHaveValue(240);
    });
  });

  it('T007: surfaces a failed save without claiming success', async () => {
    const user = userEvent.setup();
    updateMock.mockResolvedValue({ success: false, error: 'Forbidden' });
    const onSaved = vi.fn();
    render(<RmmDeviceSyncSettings provider="ninjaone" status={makeStatus()} onSaved={onSaved} />);

    await user.click(saveButton());

    expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
