/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RemoteAccessButton } from './RemoteAccessButton';

const mockRmm = vi.hoisted(() => ({ getAssetRemoteControlTypes: vi.fn(), getAssetRemoteControlUrl: vi.fn() }));
const mockGetLinks = vi.hoisted(() => vi.fn());
vi.mock('../context/AssetCrossFeatureContext', () => ({ useAssetCrossFeature: () => ({ rmm: mockRmm }) }));
vi.mock('../actions/remoteAccessLinkActions', () => ({ getRemoteAccessLinksForAsset: mockGetLinks }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: ({ children }: any) => <div>{children}</div>, AlertDescription: ({ children }: any) => <span>{children}</span> }));

const asset = (overrides: Record<string, unknown> = {}) => ({
  asset_id: 'asset-1', name: 'Workstation', rmm_provider: null, rmm_device_id: null, ...overrides,
} as any);

afterEach(() => {
  cleanup();
  mockRmm.getAssetRemoteControlTypes.mockReset();
  mockRmm.getAssetRemoteControlUrl.mockReset();
  mockGetLinks.mockReset();
});

beforeEach(() => mockGetLinks.mockResolvedValue([]));

describe('RemoteAccessButton availability', () => {
  it('hides when the asset has no RMM mapping', () => {
    render(<RemoteAccessButton asset={asset()} />);
    expect(screen.queryByText('remoteAccess.remoteAccess')).toBeNull();
    expect(mockRmm.getAssetRemoteControlTypes).not.toHaveBeenCalled();
  });

  it('hides when the resolved provider has no remote control types', async () => {
    mockGetLinks.mockResolvedValue([]);
    mockRmm.getAssetRemoteControlTypes.mockResolvedValue([]);
    render(<RemoteAccessButton asset={asset({ rmm_provider: 'ninjaone', rmm_device_id: '123' })} />);
    await vi.waitFor(() => expect(mockRmm.getAssetRemoteControlTypes).toHaveBeenCalledWith('asset-1'));
    expect(screen.queryByText('remoteAccess.remoteAccess')).toBeNull();
  });

  it('renders only provider-reported supported types and fetches the selected URL', async () => {
    mockGetLinks.mockResolvedValue([]);
    mockRmm.getAssetRemoteControlTypes.mockResolvedValue(['splashtop', 'shell', 'vnc']);
    mockRmm.getAssetRemoteControlUrl.mockResolvedValue('https://remote.example/session');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<RemoteAccessButton asset={asset({ rmm_provider: 'tacticalrmm', rmm_device_id: 'agent-1' })} />);

    const typeItem = await screen.findByText('remoteAccess.remoteShell');
    expect(screen.queryByText('VNC')).toBeNull();
    typeItem.closest('button')?.click();
    await vi.waitFor(() => expect(mockRmm.getAssetRemoteControlUrl).toHaveBeenCalledWith('asset-1', 'shell'));
    expect(open).toHaveBeenCalledWith('https://remote.example/session', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('shows configured remote links on an asset without an RMM provider', async () => {
    mockGetLinks.mockResolvedValue([{ label: 'ScreenConnect', url: 'https://remote.example/asset' }]);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<RemoteAccessButton asset={asset()} />);
    const link = await screen.findByText('ScreenConnect');
    link.closest('button')?.click();
    expect(open).toHaveBeenCalledWith('https://remote.example/asset', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
});
