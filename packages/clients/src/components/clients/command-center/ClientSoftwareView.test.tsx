/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientSoftwareView, { assetSoftwareHref } from './ClientSoftwareView';
import { FocusViewNavigationContext } from './FocusViewNavigation';

const t = (key: string, options?: Record<string, unknown>) =>
  String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, n) => String(options?.[n] ?? ''));

const response = (rows: any[], total = rows.length) => ({ rows, total, page: 1, limit: 50 });
const chrome = {
  software_id: 's1',
  title: 'Google Chrome',
  versions: ['124', '125'],
  asset_count: 2,
  assets: [{ asset_id: 'a1', name: 'PC-1' }, { asset_id: 'a2', name: 'PC-2' }],
  last_seen: '2026-01-02T00:00:00.000Z',
};

describe('ClientSoftwareView', () => {
  const getSummary = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    getSummary.mockResolvedValue(response([chrome]));
  });

  it('lists titles and expands a row to links into each asset’s Software tab, filtered by title', async () => {
    render(<ClientSoftwareView id="sw" clientId="c1" getSummary={getSummary} t={t} />);
    expect(await screen.findByText('Google Chrome')).toBeInTheDocument();
    expect(screen.getByText('124, 125')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Google Chrome'));
    const link = await screen.findByText('PC-1');
    expect(link.closest('a')).toHaveAttribute('href', assetSoftwareHref('a1', 'Google Chrome'));
    expect(assetSoftwareHref('a1', 'Google Chrome')).toBe('/msp/assets/a1?tab=software&software=Google%20Chrome');
  });

  it('shows the empty state with an asset list link when the client has no inventory', async () => {
    getSummary.mockResolvedValue(response([], 0));
    render(<ClientSoftwareView id="sw" clientId="c1" getSummary={getSummary} t={t} />);
    expect(await screen.findByText(/No software inventory yet/)).toBeInTheDocument();
    expect(document.getElementById('sw-empty-assets-link')).toHaveAttribute('href', '/msp/assets');
  });

  it('empty-state "View assets" opens this client\'s Assets focus view when hosted in the focus view', async () => {
    getSummary.mockResolvedValue(response([], 0));
    const openView = vi.fn();
    render(
      <FocusViewNavigationContext.Provider value={{ hasView: (tabId) => tabId === 'assets', openView }}>
        <ClientSoftwareView id="sw" clientId="c1" getSummary={getSummary} t={t} />
      </FocusViewNavigationContext.Provider>,
    );
    await screen.findByText(/No software inventory yet/);
    const link = document.getElementById('sw-empty-assets-link')!;
    expect(link.tagName).toBe('BUTTON');
    fireEvent.click(link);
    expect(openView).toHaveBeenCalledWith('assets');
  });

  it('keeps the asset list link when the focus view has no Assets view', async () => {
    getSummary.mockResolvedValue(response([], 0));
    render(
      <FocusViewNavigationContext.Provider value={{ hasView: () => false, openView: vi.fn() }}>
        <ClientSoftwareView id="sw" clientId="c1" getSummary={getSummary} t={t} />
      </FocusViewNavigationContext.Provider>,
    );
    await screen.findByText(/No software inventory yet/);
    expect(document.getElementById('sw-empty-assets-link')).toHaveAttribute('href', '/msp/assets');
  });

  it('debounces search and queries the server from page 1', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ClientSoftwareView id="sw" clientId="c1" getSummary={getSummary} t={t} />);
      await screen.findByText('Google Chrome');
      getSummary.mockClear();
      fireEvent.change(document.getElementById('sw-search')!, { target: { value: 'chr' } });
      expect(getSummary).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(350); });
      await waitFor(() => expect(getSummary).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'c1', search: 'chr', page: 1 }),
      ));
    } finally {
      vi.useRealTimers();
    }
  });

  it('exports with page "all" through the same action', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ClientSoftwareView id="sw" clientId="c1" getSummary={getSummary} t={t} />);
    await screen.findByText('Google Chrome');
    fireEvent.click(document.getElementById('sw-export-csv')!);
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(getSummary).toHaveBeenCalledWith(expect.objectContaining({ page: 'all' }));
    click.mockRestore();
  });
});
