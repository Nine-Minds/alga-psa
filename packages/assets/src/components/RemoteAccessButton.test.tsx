/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RemoteAccessButton } from './RemoteAccessButton';

const mockRmm = vi.hoisted(() => ({ getAssetRemoteControlTypes: vi.fn(), getAssetRemoteControlUrl: vi.fn() }));
const mockGetLinks = vi.hoisted(() => vi.fn());
vi.mock('../context/AssetCrossFeatureContext', () => ({ useAssetCrossFeature: () => ({ rmm: mockRmm }) }));
vi.mock('../actions/remoteAccessLinkActions', () => ({ getRemoteAccessLinksForAsset: mockGetLinks }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children, onOpenChange }: any) => <div><button data-testid="open-menu" onClick={() => onOpenChange(true)}>Open menu</button>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: ({ children, ...props }: any) => <div role="alert" {...props}>{children}</div>, AlertDescription: ({ children }: any) => <span>{children}</span> }));

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
  it('renders nothing without RMM candidates or configured template links', () => {
    const { container } = render(<RemoteAccessButton asset={asset()} hasTemplateLinks={false} />);
    expect(container.firstChild).toBeNull();
    expect(mockRmm.getAssetRemoteControlTypes).not.toHaveBeenCalled();
  });

  it('supports a compact icon-only trigger with an accessible label', () => {
    render(<RemoteAccessButton asset={asset({ rmm_provider: 'ninjaone', rmm_device_id: '123' })} iconOnly />);
    const button = screen.getByRole('button', { name: 'remoteAccess.remoteAccess' });
    expect(button).toBeTruthy();
    expect(button.textContent).toBe('');
  });

  it('shows an empty state after opening when no options are available', async () => {
    mockGetLinks.mockResolvedValue([]);
    mockRmm.getAssetRemoteControlTypes.mockResolvedValue([]);
    render(<RemoteAccessButton asset={asset({ rmm_provider: 'ninjaone', rmm_device_id: '123' })} />);
    fireEvent.click(screen.getByTestId('open-menu'));
    await vi.waitFor(() => expect(mockRmm.getAssetRemoteControlTypes).toHaveBeenCalledWith('asset-1'));
    expect(await screen.findByText('remoteAccess.links.noneAvailable')).toBeTruthy();
  });

  it('treats a returned action error as a failed options load', async () => {
    mockGetLinks.mockResolvedValue({ actionError: 'Permission denied' });
    mockRmm.getAssetRemoteControlTypes.mockResolvedValue([]);
    render(<RemoteAccessButton asset={asset({ rmm_provider: 'ninjaone', rmm_device_id: '123' })} />);
    fireEvent.click(screen.getByTestId('open-menu'));
    expect(await screen.findByText('remoteAccess.errors.urlFetchFailed')).toBeTruthy();
  });

  it('keeps Desktop and Shell options available for an RMM asset', async () => {
    mockRmm.getAssetRemoteControlTypes.mockResolvedValue(['splashtop', 'shell']);
    render(<RemoteAccessButton asset={asset({ rmm_provider: 'ninjaone', rmm_device_id: '123' })} />);
    fireEvent.click(screen.getByTestId('open-menu'));
    expect(await screen.findByText('remoteAccess.remoteDesktop')).toBeTruthy();
    expect(await screen.findByText('remoteAccess.remoteShell')).toBeTruthy();
  });

  it('renders only provider-reported supported types and fetches the selected URL', async () => {
    mockGetLinks.mockResolvedValue([]);
    mockRmm.getAssetRemoteControlTypes.mockResolvedValue(['splashtop', 'shell', 'vnc']);
    mockRmm.getAssetRemoteControlUrl.mockResolvedValue('https://remote.example/session');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<RemoteAccessButton asset={asset({ rmm_provider: 'tacticalrmm', rmm_device_id: 'agent-1' })} />);
    expect(mockRmm.getAssetRemoteControlTypes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('open-menu'));

    const typeItem = await screen.findByText('remoteAccess.remoteShell');
    expect(screen.queryByText('VNC')).toBeNull();
    typeItem.closest('button')?.click();
    await vi.waitFor(() => expect(mockRmm.getAssetRemoteControlUrl).toHaveBeenCalledWith('asset-1', 'shell'));
    expect(open).toHaveBeenCalledWith('https://remote.example/session', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('shows an error when the provider cannot resolve a session URL', async () => {
    mockRmm.getAssetRemoteControlTypes.mockResolvedValue(['shell']);
    mockRmm.getAssetRemoteControlUrl.mockResolvedValue(null);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<RemoteAccessButton asset={asset({ rmm_provider: 'ninjaone', rmm_device_id: '123' })} />);
    fireEvent.click(screen.getByTestId('open-menu'));
    const typeItem = await screen.findByText('remoteAccess.remoteShell');
    typeItem.closest('button')?.click();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('remoteAccess.errors.urlFetchFailed')).toBeTruthy();
    open.mockRestore();
  });

  it('shows configured remote links on an asset without an RMM provider', async () => {
    mockGetLinks.mockResolvedValue([{ label: 'ScreenConnect', url: 'https://remote.example/asset' }]);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<RemoteAccessButton asset={asset()} hasTemplateLinks />);
    fireEvent.click(screen.getByTestId('open-menu'));
    const link = await screen.findByText('ScreenConnect');
    link.closest('button')?.click();
    expect(open).toHaveBeenCalledWith('https://remote.example/asset', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('disables unavailable template links while keeping valid links connectable', async () => {
    mockGetLinks.mockResolvedValue([
      { label: 'Name link', url: 'https://remote.example/Workstation' },
      { label: 'Serial link', url: null },
    ]);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<RemoteAccessButton asset={asset()} hasTemplateLinks />);
    fireEvent.click(screen.getByTestId('open-menu'));

    const unavailableLink = await screen.findByText('Serial link');
    expect(unavailableLink.closest('button')?.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('remoteAccess.links.unavailable')).toBeTruthy();

    screen.getByText('Name link').closest('button')?.click();
    expect(open).toHaveBeenCalledWith('https://remote.example/Workstation', '_blank', 'noopener,noreferrer');
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
});
