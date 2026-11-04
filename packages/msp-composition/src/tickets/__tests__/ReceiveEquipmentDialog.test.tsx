// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  receiveEquipment: vi.fn(),
  assets: [] as any[],
  badges: new Map<string, any>(),
  mutate: vi.fn(),
}));

vi.mock('../receiveEquipmentActions', () => ({ receiveEquipment: mocks.receiveEquipment }));
vi.mock('swr', () => ({
  default: () => ({ data: mocks.assets }),
  useSWRConfig: () => ({ mutate: mocks.mutate }),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  // Resolve defaultValue with {{params}} interpolation, like i18next with no catalogue.
  useTranslation: () => ({
    t: (key: string, opts: Record<string, unknown> = {}) =>
      String(opts.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts[k] ?? '')),
  }),
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant, size, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (p: any) => <input {...p} /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: (p: any) => <label {...p} /> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: any) => (isOpen ? <div>{children}{footer}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) => (
    <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {id.endsWith("-asset") ? <option value="">--</option> : null}
      {options.map((o: any) => (<option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>))}
    </select>
  ),
}));
vi.mock('@alga-psa/assets/components/custody/CustodyBadge', () => ({ useCustodyBadges: () => mocks.badges }));
vi.mock('@alga-psa/ui/components/labels/LabelPrintDialog', () => ({ LabelPrintDialog: () => null }));
vi.mock('@alga-psa/assets/actions/assetCustodyActions', () => ({ listCustodyBins: vi.fn(), listCustodyLocations: vi.fn() }));
vi.mock('@alga-psa/assets/actions/assetActions', () => ({ listAssets: vi.fn() }));
vi.mock('@alga-psa/documents/actions/documentActions', () => ({ uploadDocument: vi.fn() }));
vi.mock('@alga-psa/assets/lib/assetCacheKeys', () => ({ matchAssetCacheKeys: (ids: string[]) => ({ ids }) }));
vi.mock('@alga-psa/assets/components/shared/useAssetTypeOptions', () => ({
  useAssetTypeRegistry: () => [{ slug: 'docking_station', name: 'Docking Station', is_builtin: false }],
  buildAssetTypeOptions: (entries: any[], _t: unknown, opts: any) => [
    ...(opts?.includeUnknown ? [{ value: 'unknown', label: 'Unknown' }] : []),
    { value: 'workstation', label: 'Workstation' },
    ...(entries ?? []).filter((e) => !e.is_builtin).map((e) => ({ value: e.slug, label: e.name })),
  ],
}));
vi.mock('@alga-psa/assets/components/custody/CustodyFields', () => ({
  CustodyDetailFields: () => null,
  CustodyPlaceFields: () => null,
  cleanAccessories: () => [],
  emptyCustodyDetails: () => ({ purpose: 'repair', next_action_party: 'msp', next_action_note: '', follow_up_on: '', condition_note: '', accessories: [] }),
}));
vi.mock('@alga-psa/assets/components/custody/CustodyDialogs', async () => {
  // Keep the real DialogShell (it owns the role=alert); stub the user picker.
  const actual = await vi.importActual<any>('@alga-psa/assets/components/custody/CustodyDialogs').catch(() => null);
  return { DialogShell: actual?.DialogShell, HolderPicker: () => null };
});
vi.mock('@alga-psa/assets/components/custody/custodyClient', async () => {
  const actual = await vi.importActual<any>('@alga-psa/assets/components/custody/custodyClient');
  return {
    ...actual,
    useCustodyLocations: () => ({ locations: [{ location_id: 'loc-1', is_default: true, name: 'Main' }], canUpdate: true, isLoading: false }),
  };
});

import { ReceiveEquipmentDialog } from '../ReceiveEquipmentDialog';

const ticket = { ticket_id: 't-1', client_id: 'c-1', ticket_number: 'TIC001' };
const idBase = 'receive-equipment-t-1';

async function openNewItem() {
  render(<ReceiveEquipmentDialog ticket={ticket} />);
  fireEvent.click(screen.getByText('Receive equipment'));
  fireEvent.click(await screen.findByText('New item'));
  fireEvent.change(document.getElementById(`${idBase}-name`)!, { target: { value: 'Dell WD19 Dock' } });
}

describe('ReceiveEquipmentDialog New item type', () => {
  beforeEach(() => mocks.receiveEquipment.mockReset());
  afterEach(cleanup);

  it('offers registry options and posts unknown by default', async () => {
    mocks.receiveEquipment.mockResolvedValue({ success: false, error: { code: 'validation', message: 'x' } });
    await openNewItem();
    const select = document.getElementById(`${idBase}-asset_type`) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['unknown', 'workstation', 'docking_station']);
    fireEvent.click(document.getElementById(`${idBase}-submit`)!);
    await waitFor(() => expect(mocks.receiveEquipment).toHaveBeenCalled());
    expect(mocks.receiveEquipment.mock.calls[0][0].new_asset.asset_type).toBe('unknown');
  });

  it('posts the chosen slug as is', async () => {
    mocks.receiveEquipment.mockResolvedValue({ success: false, error: { code: 'validation', message: 'x' } });
    await openNewItem();
    fireEvent.change(document.getElementById(`${idBase}-asset_type`)!, { target: { value: 'docking_station' } });
    fireEvent.click(document.getElementById(`${idBase}-submit`)!);
    await waitFor(() => expect(mocks.receiveEquipment).toHaveBeenCalled());
    expect(mocks.receiveEquipment.mock.calls[0][0].new_asset.asset_type).toBe('docking_station');
  });

  it('shows a friendly message for an invalid_asset_type failure, never raw JSON', async () => {
    mocks.receiveEquipment.mockResolvedValue({
      success: false,
      error: {
        code: 'validation',
        message: 'Asset type "docking station" is not available. Choose a valid asset type.',
        messageKey: 'msp/assets:errors.asset.typeUnavailableNamed',
        messageParams: { assetType: 'docking station' },
      },
    });
    await openNewItem();
    fireEvent.click(document.getElementById(`${idBase}-submit`)!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('is not available');
    expect(alert.textContent).not.toContain('{');
    expect(alert.textContent).not.toContain('"kind"');
  });

  it('falls back to a generic message when the server message is a raw JSON payload', async () => {
    mocks.receiveEquipment.mockResolvedValue({
      success: false,
      error: { code: 'validation', message: '{"kind":"invalid_asset_type","asset_type":"x"}' },
    });
    await openNewItem();
    fireEvent.click(document.getElementById(`${idBase}-submit`)!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Something went wrong.');
  });
});

describe('ReceiveEquipmentDialog existing-asset picker', () => {
  beforeEach(() => {
    mocks.receiveEquipment.mockReset();
    mocks.mutate.mockReset();
    mocks.assets = [
      { asset_id: 'a-free', name: 'Free Laptop', asset_tag: 'F-1' },
      { asset_id: 'a-held', name: 'Held Dock', asset_tag: 'H-1' },
    ];
    mocks.badges = new Map();
  });
  afterEach(() => {
    cleanup();
    mocks.assets = [];
    mocks.badges = new Map();
  });

  const openExisting = async () => {
    render(<ReceiveEquipmentDialog ticket={ticket} />);
    fireEvent.click(screen.getByText('Receive equipment'));
    return (await screen.findByDisplayValue('--')) as HTMLSelectElement;
  };

  it('disables an asset that is already in custody and shows where it is', async () => {
    mocks.badges = new Map([['a-held', { asset_id: 'a-held', state: 'in_office', location_label: 'Main Warehouse / Shelf C1', next_action_party: 'msp' }]]);
    const select = await openExisting();
    const held = Array.from(select.options).find((o) => o.value === 'a-held')!;
    const free = Array.from(select.options).find((o) => o.value === 'a-free')!;
    expect(held.disabled).toBe(true);
    expect(held.textContent).toBe('Held Dock (H-1) — In custody: Main Warehouse / Shelf C1');
    expect(free.disabled).toBe(false);
  });

  it('says "With vendor" for a held asset that is away', async () => {
    mocks.badges = new Map([['a-held', { asset_id: 'a-held', state: 'with_vendor', location_label: null, next_action_party: 'vendor' }]]);
    const select = await openExisting();
    expect(Array.from(select.options).find((o) => o.value === 'a-held')!.textContent).toContain('In custody: With vendor');
  });

  it('leaves every option enabled when the badge read failed (empty map); the server stays the gate', async () => {
    const select = await openExisting();
    expect(Array.from(select.options).every((o) => !o.disabled)).toBe(true);
    expect(Array.from(select.options).map((o) => o.textContent).join('|')).not.toContain('In custody');
  });

  it('shows a server refusal in the top alert, focuses the asset field and marks it aria-invalid', async () => {
    mocks.receiveEquipment.mockResolvedValue({ success: false, error: { code: 'conflict', message: 'That asset is already in custody.' } });
    const select = await openExisting();
    fireEvent.change(select, { target: { value: 'a-free' } });
    fireEvent.click(document.getElementById(`${idBase}-submit`)!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That asset is already in custody.');
    await waitFor(() => expect(document.activeElement).toBe(select));
    expect(select.getAttribute('aria-invalid')).toBe('true');
  });

  it('invalidates this ticket\'s Assets panel after a successful receive', async () => {
    mocks.receiveEquipment.mockResolvedValue({
      success: true,
      data: { asset: { asset_id: 'a-free', name: 'Free Laptop', asset_tag: 'F-1' } },
    });
    const select = await openExisting();
    fireEvent.change(select, { target: { value: 'a-free' } });
    fireEvent.click(document.getElementById(`${idBase}-submit`)!);
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
    expect(mocks.mutate.mock.calls[0][0]).toEqual({ ids: ['a-free', 't-1'] });
  });
});
