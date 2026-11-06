/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig, mutate, useSWRConfig } from 'swr';
import { matchAssetCacheKeys } from '../lib/assetCacheKeys';
import AssociatedAssets from './AssociatedAssets';
import { listEntityAssets } from '../actions/assetActions';
import { entityAssetsCacheKey, matchEntityAssetsCacheKeys } from '../lib/assetCacheKeys';
import { handleError } from '@alga-psa/ui/lib/errorHandling';

vi.mock('../actions/assetActions', () => ({ listEntityAssets: vi.fn(async () => []), createAssetAssociation: vi.fn(), removeAssetAssociation: vi.fn(), listAssets: vi.fn(async () => ({ assets: [], total: 0 })) }));
const badges = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
vi.mock('./custody/CustodyBadge', () => ({
  useCustodyBadges: () => badges.map,
  CustodyBadge: ({ id }: any) => <span id={id}>In office</span>,
}));
const rmaBadgeState = vi.hoisted(() => ({ badges: new Map<string, any>() }));
vi.mock('./warranty/RmaBadge', () => ({
  useRmaBadges: () => rmaBadgeState.badges,
  RmaBadge: ({ id, badge }: any) => (badge ? <a id={id} href={`/msp/inventory/rma?rmaId=${badge.rma_id}`}>RMA {badge.rma_number}</a> : null),
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

afterEach(() => { cleanup(); rmaBadgeState.badges = new Map(); });

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

  it('preserves received data across remounts and late or failed bootstrap promises', async () => {
    let resolveInitial!: (assets: any[]) => void;
    let rejectInitial!: (error: Error) => void;
    const late = new Promise<any[]>((resolve) => { resolveInitial = resolve; });
    const failed = new Promise<any[]>((_, reject) => { rejectInitial = reject; });
    const cache = new Map();
    const panel = (initialAssets: Promise<any[]> | null) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <Capture />
        {initialAssets && <AssociatedAssets id="ticket-assets" entityId="ticket-1" entityType="ticket" clientId="c1" initialAssets={initialAssets} />}
      </SWRConfig>
    );
    const view = render(panel(Promise.resolve([])));
    await screen.findByText(/No assets associated with this ticket/);
    vi.mocked(listEntityAssets).mockResolvedValue([held] as any);
    await act(async () => { await mutateRef(matchAssetCacheKeys(['a2', 'ticket-1'])); });
    expect(await screen.findByRole('button', { name: held.name })).toBeTruthy();
    view.rerender(panel(null));
    view.rerender(panel(late));
    await act(async () => { resolveInitial([]); await late; });
    expect(screen.getByRole('button', { name: held.name })).toBeTruthy();
    view.rerender(panel(null));
    view.rerender(panel(failed));
    await act(async () => { rejectInitial(new Error('bootstrap failed')); await failed.catch(() => {}); });
    expect(screen.getByRole('button', { name: held.name })).toBeTruthy();
    vi.mocked(listEntityAssets).mockRejectedValueOnce(new Error('refresh failed'));
    await act(async () => { await mutateRef(matchAssetCacheKeys(['a2', 'ticket-1'])); });
    expect(screen.getByRole('button', { name: held.name })).toBeTruthy();
  });

  it('keeps an initialized empty cache when stale bootstrap data arrives', async () => {
    const cache = new Map();
    const panel = (initialAssets?: Promise<any[]>) => <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}><Capture />{initialAssets && <AssociatedAssets id="ticket-assets" entityId="ticket-1" entityType="ticket" clientId="c1" initialAssets={initialAssets} />}</SWRConfig>;
    const view = render(panel(Promise.resolve([])));
    await screen.findByText(/No assets associated with this ticket/);
    view.rerender(panel());
    view.rerender(panel(Promise.resolve([held])));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: held.name })).toBeNull();
  });

  it('lets a refresh supersede a pending initial read', async () => {
    let resolveInitial!: (assets: any[]) => void;
    const initial = new Promise<any[]>((resolve) => { resolveInitial = resolve; });
    renderPanel({ initialAssets: initial });
    vi.mocked(listEntityAssets).mockResolvedValue([held] as any);
    await act(async () => { await mutateRef(matchAssetCacheKeys(['a2', 'ticket-1'])); });
    await screen.findByRole('button', { name: held.name });
    await act(async () => { resolveInitial([]); await initial; });
    expect(screen.getByRole('button', { name: held.name })).toBeTruthy();
  });

  it('refreshes after remount while the original bootstrap is still pending', async () => {
    let resolveInitial!: (assets: any[]) => void;
    const initial = new Promise<any[]>((resolve) => { resolveInitial = resolve; });
    const cache = new Map();
    const panel = (visible: boolean) => <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}><Capture />{visible && <AssociatedAssets id="ticket-assets" entityId="ticket-1" entityType="ticket" clientId="c1" initialAssets={initial} />}</SWRConfig>;
    const view = render(panel(true));
    view.rerender(panel(false));
    view.rerender(panel(true));
    vi.mocked(listEntityAssets).mockResolvedValue([held] as any);
    await act(async () => { await mutateRef(matchAssetCacheKeys(['a2', 'ticket-1'])); });
    await screen.findByRole('button', { name: held.name });
    await act(async () => { resolveInitial([]); await initial; });
    expect(screen.getByRole('button', { name: held.name })).toBeTruthy();
  });

  it('reports an initial read failure and can recover on revalidation', async () => {
    vi.mocked(handleError).mockClear();
    renderPanel({ initialAssets: Promise.reject(new Error('initial read failed')) });
    await waitFor(() => expect(handleError).toHaveBeenCalled());
    vi.mocked(listEntityAssets).mockResolvedValue([held] as any);
    await act(async () => { await mutateRef(matchAssetCacheKeys(['a2', 'ticket-1'])); });
    expect(await screen.findByRole('button', { name: held.name })).toBeTruthy();
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
    // Layout must not depend on viewport breakpoints (the panel is ~281px wide on a 1725px desktop):
    // the chip lives in its own row, never inside the name's single-line flex container.
    const chip = document.getElementById('associated-asset-custody-a2')!;
    const nameRow = name.parentElement!;
    expect(nameRow.contains(chip)).toBe(false);
    expect(nameRow.className).not.toMatch(/(^|\s)(max-)?sm:/);
    expect(chip.closest('[data-testid="associated-asset-custody-row-a2"]')).toBeTruthy();
    expect(chip.closest('[class*="sm:"]')).toBeNull();
    expect(nameRow.parentElement!.contains(chip)).toBe(false);

    // Status badge lives in the meta row beside the custody chip, not in row 1.
    const row1 = name.closest('[data-testid="associated-asset-name-row-a2"]') as HTMLElement;
    const metaRow = chip.closest('[data-testid="associated-asset-custody-row-a2"]') as HTMLElement;
    const status = screen.getByText('Held by MSP');
    expect(row1.contains(status)).toBe(false);
    expect(metaRow.contains(status)).toBe(true);
    expect(metaRow.contains(chip)).toBe(true);
    expect(metaRow.className).toContain('flex-wrap');
    expect(row1.contains(screen.getByRole('button', { name: 'Remove' }))).toBe(true);
    expect(row1.contains(screen.getByRole('button', { name: 'Remote access' }))).toBe(false);
    expect(name.getAttribute('title')).toBe('Dell WD19 Dock');
    badges.map = new Map();
  });

  it('lets the row-2 metadata spans shrink and truncate instead of overflowing a narrow card', async () => {
    renderPanel({ initialAssets: Promise.resolve([held]) });
    const name = await screen.findByRole('button', { name: 'Dell WD19 Dock' });
    const card = name.closest('.rounded-lg') as HTMLElement;
    const row2 = Array.from(card.children).find((c) => c.className.includes('text-xs')) as HTMLElement;
    expect(row2.className).toContain('min-w-0');
    const truncating = Array.from(row2.querySelectorAll('span')).filter((s) => s.className.includes('truncate'));
    expect(truncating.length).toBe(3);
    truncating.forEach((s) => expect(s.className).toContain('min-w-0'));
  });
});

describe('AssociatedAssets shared SWR key', () => {
  const a1 = { asset_id: 'a1', asset_type: 'workstation', name: 'First', status: 'active', asset_tag: 'T1', client_id: 'c1' } as any;
  const a2 = { asset_id: 'a2', asset_type: 'workstation', name: 'Lenovo ThinkPad T14', status: 'held_by_msp', asset_tag: 'T2', client_id: 'c1' } as any;
  // Global SWR cache is shared across tests, so each test uses its own ticket id.
  const renderTile = (entityId: string, initial?: Promise<any[]>) => render(
    <AssociatedAssets id="ticket-assets" entityId={entityId} entityType="ticket" clientId="c1" initialAssets={initial} />
  );

  it('does not fetch on mount when seeded with initialAssets', async () => {
    vi.mocked(listEntityAssets).mockClear();
    renderTile('seed-ticket', Promise.resolve([a1]));
    await screen.findByRole('button', { name: 'First' });
    expect(listEntityAssets).not.toHaveBeenCalled();
  });

  it('refetches and shows a newly linked asset when the shared key is mutated (Receive equipment)', async () => {
    vi.mocked(listEntityAssets).mockReset();
    vi.mocked(listEntityAssets).mockResolvedValue([a1] as any);
    renderTile('recv-ticket', Promise.resolve([a1]));
    await screen.findByRole('button', { name: 'First' });
    vi.mocked(listEntityAssets).mockResolvedValue([a1, a2] as any);
    await mutate(matchEntityAssetsCacheKeys('ticket', 'recv-ticket'));
    expect(await screen.findByRole('button', { name: 'Lenovo ThinkPad T14' })).toBeTruthy();
    expect(listEntityAssets).toHaveBeenCalledWith('recv-ticket', 'ticket');
  });

  it('exposes a stable key', () => {
    expect(entityAssetsCacheKey('ticket', 't1')).toEqual(['entity-assets', 'ticket', 't1']);
    expect(matchEntityAssetsCacheKeys('ticket', 't1')(['entity-assets', 'ticket', 't1'])).toBe(true);
    expect(matchEntityAssetsCacheKeys('ticket', 't1')(['entity-assets', 'project', 't1'])).toBe(false);
  });
});

describe('AssociatedAssets custody and RMA chips', () => {
  const asset = { asset_id: 'a1', asset_type: 'workstation', name: 'Dell dock', status: 'active', asset_tag: 'QA-1', client_id: 'c1' } as any;
  const renderIt = () => render(<AssociatedAssets id="ticket-assets" entityId="ticket-1" entityType="ticket" clientId="c1" initialAssets={Promise.resolve([asset])} />);

  it('puts the RMA chip on its own wrapping row, away from the status badge and the remove button', async () => {
    rmaBadgeState.badges = new Map([['a1', { asset_id: 'a1', rma_id: 'r-9', rma_number: 'RMA-9', status: 'sent_to_vendor' }]]);
    renderIt();
    const chip = await screen.findByRole('link', { name: 'RMA RMA-9' });
    expect(chip.getAttribute('href')).toBe('/msp/inventory/rma?rmaId=r-9');
    const chipRow = chip.parentElement!;
    expect(chipRow.className).toContain('flex-wrap');
    expect(chipRow.className).toContain('min-w-0');
    expect(chipRow.contains(screen.getByRole('button', { name: 'Remove' }))).toBe(false);
    expect(chipRow.contains(screen.getByRole('button', { name: 'Dell dock' }))).toBe(false);
  });

  it('renders no RMA chip when the asset has no RMA badge', async () => {
    rmaBadgeState.badges = new Map();
    renderIt();
    await screen.findByRole('button', { name: 'Dell dock' });
    expect(screen.queryByRole('link', { name: /^RMA / })).toBeNull();
  });
});
