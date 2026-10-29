/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import '@testing-library/jest-dom/vitest';

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let query = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (k: string, o?: any) => String(o?.defaultValue ?? k).replace(/\{\{(\w+)\}\}/g, (_m: string, n: string) => String(o?.[n] ?? '')),
  }),
}));
const getAssetSoftware = vi.fn();
vi.mock('../../actions/softwareActions', () => ({ getAssetSoftware: (p: any) => getAssetSoftware(p) }));

import { SoftwareInventoryTab } from './SoftwareInventoryTab';

const chrome = {
  software_id: 's1', name: 'Google Chrome', publisher: 'Google', category: 'Browser', software_type: 'application',
  version: '125.0', install_date: null, size_bytes: null, first_seen_at: '2026-01-01T00:00:00.000Z',
  is_current: true, is_managed: false, is_security_relevant: false,
};
const list = (software: any[], total = software.length) => ({ software, total, page: 1, limit: 50 });

// A Tactical-only device: nothing in the legacy JSON, inventory only in asset_software.
const asset: any = { asset_id: 'a1', name: 'TAC-PC', asset_type: 'workstation', workstation: { installed_software: [] } };

describe('SoftwareInventoryTab', () => {
  beforeEach(() => {
    query = '';
    getAssetSoftware.mockReset();
    getAssetSoftware.mockResolvedValue(list([chrome]));
  });
  afterEach(cleanup);

  it('lists the asset_software rows even when the legacy installed_software JSON is empty', async () => {
    render(<SoftwareInventoryTab asset={asset} />);
    expect(await screen.findByText('Google Chrome')).toBeInTheDocument();
    expect(screen.getByText('125.0')).toBeInTheDocument();
    expect(getAssetSoftware).toHaveBeenCalledWith({ asset_id: 'a1', search: undefined, category: undefined, page: 1, limit: 50 });
    expect(screen.getByText('Total Items: 1')).toBeInTheDocument();
  });

  it('applies the ?software= drill filter server-side on first load', async () => {
    query = 'software=Google%20Chrome';
    render(<SoftwareInventoryTab asset={asset} />);
    expect((screen.getByPlaceholderText('Search software...') as HTMLInputElement).value).toBe('Google Chrome');
    await screen.findByText('Google Chrome');
    expect(getAssetSoftware).toHaveBeenNthCalledWith(1, expect.objectContaining({ search: 'Google Chrome', page: 1 }));
  });

  it('debounces typed search into a server query', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<SoftwareInventoryTab asset={asset} />);
      await screen.findByText('Google Chrome');
      getAssetSoftware.mockClear();
      fireEvent.change(screen.getByPlaceholderText('Search software...'), { target: { value: 'fire' } });
      expect(getAssetSoftware).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(350); });
      await waitFor(() => expect(getAssetSoftware).toHaveBeenCalledWith(expect.objectContaining({ search: 'fire', page: 1 })));
    } finally {
      vi.useRealTimers();
    }
  });

  it('says no inventory has been collected when the device has none', async () => {
    getAssetSoftware.mockResolvedValue(list([]));
    render(<SoftwareInventoryTab asset={asset} />);
    expect(await screen.findByText('No software inventory has been collected for this device yet.')).toBeInTheDocument();
  });

  it('says nothing matches when a filter returns no rows', async () => {
    query = 'software=Nope';
    getAssetSoftware.mockResolvedValue(list([]));
    render(<SoftwareInventoryTab asset={asset} />);
    expect(await screen.findByText('No software found matching your search.')).toBeInTheDocument();
  });

  it('shows the action error (e.g. asset:read denied) instead of an empty table', async () => {
    getAssetSoftware.mockResolvedValue({ permissionError: 'Permission denied: Cannot read assets' });
    render(<SoftwareInventoryTab asset={asset} />);
    expect(await screen.findByText(/Permission denied/)).toBeInTheDocument();
    expect(screen.queryByText('No software inventory has been collected for this device yet.')).not.toBeInTheDocument();
  });

  it('shows the load error when the request throws', async () => {
    getAssetSoftware.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SoftwareInventoryTab asset={asset} />);
    expect(await screen.findByText('Could not load software inventory.')).toBeInTheDocument();
  });
});
