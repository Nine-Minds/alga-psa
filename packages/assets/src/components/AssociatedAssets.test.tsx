/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig, useSWRConfig } from 'swr';
import { matchAssetCacheKeys } from '../lib/assetCacheKeys';
import { listEntityAssets } from '../actions/assetActions';
import AssociatedAssets from './AssociatedAssets';

vi.mock('../actions/assetActions', () => ({ listEntityAssets: vi.fn(async () => []), createAssetAssociation: vi.fn(), removeAssetAssociation: vi.fn(), listAssets: vi.fn(async () => ({ assets: [], total: 0 })) }));
const badges = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
vi.mock('./custody/CustodyBadge', () => ({
  useCustodyBadges: () => badges.map,
  CustodyBadge: ({ id }: any) => <span id={id}>In office</span>,
}));
vi.mock('../actions/remoteAccessLinkActions', () => ({ hasRemoteAccessLinks: vi.fn(async () => false) }));
vi.mock('../actions/assetDrawerActions', () => ({ loadAssetDetailDrawerData: vi.fn() }));
vi.mock('../actions/assetActionErrors', () => ({ unwrapAssetActionResult: (value: any) => value }));
const stableT = (_key: string, options: any) => options?.defaultValue ?? _key;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: stableT }) }));
vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({ ReflectionContainer: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components', () => ({ ContentCard: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: (props: any) => <input type="checkbox" {...props} /> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ __esModule: true, default: () => <select /> }));
vi.mock('@alga-psa/ui/components/SearchInput', () => ({ SearchInput: () => <input /> }));
vi.mock('@alga-psa/ui/components/Pagination', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/IconPicker', () => ({ getIconComponent: () => null }));
vi.mock('./RmmStatusIndicator', () => ({ RmmStatusIndicator: () => <span /> }));
vi.mock('./RemoteAccessButton', () => ({ RemoteAccessButton: () => <button aria-label="Remote access" /> }));
vi.mock('./AssetDetailDrawerClient', () => ({ AssetDetailDrawerClient: () => null }));
vi.mock('./shared/useAssetTypeOptions', () => ({ useAssetTypeRegistry: () => [] }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ handleError: vi.fn() }));

afterEach(cleanup);

describe('AssociatedAssets asset name width', () => {
  it('keeps the asset name flexing with a full-name title and an icon-only remove control', async () => {
    const asset = { asset_id: 'a1', asset_type: 'workstation', name: 'Smoke25 QA Workstation with a Long Name', status: 'active', asset_tag: 'QA-1', client_id: 'c1' } as any;
    render(<SWRConfig value={{ provider: () => new Map() }}><AssociatedAssets id="ticket-assets" entityId="ticket-1" entityType="ticket" clientId="c1" initialAssets={Promise.resolve([asset])} /></SWRConfig>);
    const name = await screen.findByRole('button', { name: asset.name });
    expect(name.getAttribute('title')).toBe(asset.name);
    expect(name.className).toContain('min-w-0');
    const remove = screen.getByRole('button', { name: 'Remove' });
    expect(remove.getAttribute('title')).toBe('Remove');
    expect(remove.textContent).toBe('×');
    await waitFor(() => expect(name).toBeTruthy());
  });
});

describe('AssociatedAssets shared cache', () => {
  const held = { asset_id: 'a2', asset_type: 'unknown', name: 'Dell WD19 Dock', status: 'held_by_msp', asset_tag: 'AST-2', client_id: 'c1' } as any;
  let mutateRef: ReturnType<typeof useSWRConfig>['mutate'];
  const Capture = () => { mutateRef = useSWRConfig().mutate; return null; };
  const renderPanel = (props: Record<string, unknown> = {}) =>
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Capture />
        <AssociatedAssets id="ticket-assets" entityId="ticket-1" entityType="ticket" clientId="c1" {...props} />
      </SWRConfig>
    );

  it('revalidates when the receive dialog invalidates the ticket and asset keys, without a remount', async () => {
    vi.mocked(listEntityAssets).mockResolvedValue([] as any);
    renderPanel();
    await waitFor(() => expect(screen.getAllByText(/No assets associated with this ticket/).length).toBeGreaterThan(0));

    vi.mocked(listEntityAssets).mockResolvedValue([held] as any);
    await act(async () => {
      await mutateRef(matchAssetCacheKeys(['a2', 'ticket-1']));
    });
    expect(await screen.findByRole('button', { name: 'Dell WD19 Dock' })).toBeTruthy();
    expect(screen.queryByText(/No assets associated with this ticket/)).toBeNull();
  });

  it('does not refetch a different ticket\'s panel', async () => {
    vi.mocked(listEntityAssets).mockClear();
    vi.mocked(listEntityAssets).mockResolvedValue([] as any);
    renderPanel();
    await waitFor(() => expect(screen.getAllByText(/No assets associated with this ticket/).length).toBeGreaterThan(0));
    const calls = vi.mocked(listEntityAssets).mock.calls.length;
    await act(async () => {
      await mutateRef(matchAssetCacheKeys(['a2', 'ticket-other']));
    });
    expect(vi.mocked(listEntityAssets).mock.calls.length).toBe(calls);
  });

  it('shows "Held by MSP", not the slug, and keeps the custody chip shrink-0 beside a truncating name', async () => {
    badges.map = new Map([['a2', { asset_id: 'a2', state: 'in_office', location_label: 'Main', next_action_party: 'msp' }]]);
    renderPanel({ initialAssets: Promise.resolve([held]) });
    const name = await screen.findByRole('button', { name: 'Dell WD19 Dock' });
    expect(screen.getByText('Held by MSP')).toBeTruthy();
    expect(screen.queryByText('Held_by_msp')).toBeNull();
    expect(screen.queryByText('held_by_msp')).toBeNull();
    expect(name.className).toContain('truncate');
    expect(name.className).toContain('min-w-0');
    expect(name.className).toContain('flex-1');
    expect(name.getAttribute('title')).toBe('Dell WD19 Dock');
    const chipWrapper = document.getElementById('associated-asset-custody-a2')!.parentElement!;
    expect(chipWrapper.className).toContain('shrink-0');
    expect(chipWrapper.className).toContain('max-sm:basis-full');
    badges.map = new Map();
  });
});
