/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) =>
      `${key}${o ? `:${Object.entries(o).map(([k, v]) => `${k}=${v}`).join(',')}` : ''}`,
  }),
}));

const getAssetSoftware = vi.fn();
vi.mock('@alga-psa/assets/actions/softwareActions', () => ({
  getAssetSoftware: (params: unknown) => getAssetSoftware(params),
}));

import { AssetSoftwareInventory } from '../AssetSoftwareInventory';

const item = (id: string, name: string) => ({
  software_id: id, name, publisher: 'Vendor', category: null, software_type: 'application', version: '1.0',
  install_date: null, size_bytes: null, first_seen_at: '2026-01-01T00:00:00.000Z',
  is_current: true, is_managed: false, is_security_relevant: false,
});
const list = (software: any[], total = software.length) => ({ software, total, page: 1, limit: 100 });

// Tactical-only device: legacy JSON empty, inventory only in asset_software.
const tactical: any = {
  asset_id: 'a1', asset_type: 'workstation', rmm_provider: 'tacticalrmm', rmm_device_id: 'agent-1',
  workstation: { installed_software: [] },
};

describe('AssetSoftwareInventory (EE drawer panel)', () => {
  beforeEach(() => {
    getAssetSoftware.mockReset();
    getAssetSoftware.mockResolvedValue(list([item('s1', 'Google Chrome'), item('s2', 'Zoom')], 7));
  });
  afterEach(cleanup);

  it('renders from asset_software even when the legacy JSON is empty, counting the full total', async () => {
    render(<AssetSoftwareInventory asset={tactical} />);
    expect(await screen.findByText('assetSoftwareInventory.appsCount:count=7')).toBeTruthy();
    expect(screen.getByText('Google Chrome')).toBeTruthy();
    expect(getAssetSoftware).toHaveBeenCalledWith({ asset_id: 'a1', search: undefined, limit: 100 });
  });

  it('searches server-side after a debounce and reports shown vs total', async () => {
    render(<AssetSoftwareInventory asset={tactical} />);
    await screen.findByText('Google Chrome');
    fireEvent.click(screen.getByText('assetSoftwareInventory.heading'));
    getAssetSoftware.mockResolvedValue(list([item('s2', 'Zoom')], 1));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.change(screen.getByPlaceholderText('assetSoftwareInventory.searchPlaceholder'), { target: { value: 'zo' } });
      await act(async () => { vi.advanceTimersByTime(350); });
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(getAssetSoftware).toHaveBeenLastCalledWith({ asset_id: 'a1', search: 'zo', limit: 100 }));
    await waitFor(() => expect(screen.queryByText('Google Chrome')).toBeNull());
    expect(screen.getByText('Zoom')).toBeTruthy();
  });

  it('renders nothing when the device has no inventory', async () => {
    getAssetSoftware.mockResolvedValue(list([]));
    const { container } = render(<AssetSoftwareInventory asset={tactical} />);
    await waitFor(() => expect(getAssetSoftware).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing (and does not query) for non-RMM assets', () => {
    const { container } = render(<AssetSoftwareInventory asset={{ ...tactical, rmm_provider: null }} />);
    expect(container.innerHTML).toBe('');
    expect(getAssetSoftware).not.toHaveBeenCalled();
  });

  it('hides on a permission error instead of showing a broken panel', async () => {
    getAssetSoftware.mockResolvedValue({ permissionError: 'Permission denied: Cannot read assets' });
    const { container } = render(<AssetSoftwareInventory asset={tactical} />);
    await waitFor(() => expect(getAssetSoftware).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });
});
