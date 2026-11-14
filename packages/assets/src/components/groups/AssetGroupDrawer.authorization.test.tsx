// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getAssetGroup: vi.fn(), toastError: vi.fn() }));

vi.mock('react-hot-toast', () => ({ toast: { error: h.toastError } }));
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
vi.mock('../../actions/assetGroupActions', () => ({
  addAssetGroupUser: vi.fn(), addAssetsToGroup: vi.fn(), deleteAssetGroup: vi.fn(),
  getAssetGroup: h.getAssetGroup, removeAssetFromGroup: vi.fn(), removeAssetGroupUser: vi.fn(),
  setAssetGroupOwner: vi.fn(), updateAssetGroup: vi.fn(),
}));
vi.mock('../../actions/assetActions', () => ({ getAsset: vi.fn() }));
vi.mock('../../actions/clientLookupActions', () => ({ getClientContactsForAssets: vi.fn(), getClientLocationsForAssets: vi.fn() }));

import { AssetGroupDrawer } from './AssetGroupDrawer';

describe('AssetGroupDrawer permission denial', () => {
  beforeEach(() => {
    h.getAssetGroup.mockReset();
    h.toastError.mockReset();
  });
  afterEach(cleanup);

  it('settles loading after denial and renders no group details or management controls', async () => {
    h.getAssetGroup.mockResolvedValue({ permissionError: 'Permission denied', messageKey: 'msp/assets:errors.permissions.readAssets' });
    render(<AssetGroupDrawer groupId="restricted-group" />);

    expect(await screen.findByText('You do not have permission to view this group.')).toBeTruthy();
    expect(screen.queryByText('Loading...')).toBeNull();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete group' })).toBeNull();
    expect(h.toastError).toHaveBeenCalledWith('Permission denied');
  });

  it('ignores an older response after the selection changes', async () => {
    let resolveOld!: (value: unknown) => void;
    h.getAssetGroup.mockImplementation((id: string) => id === 'old'
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ permissionError: 'Permission denied' }));
    const view = render(<AssetGroupDrawer groupId="old" />);
    view.rerender(<AssetGroupDrawer groupId="new" />);
    expect(await screen.findByText('You do not have permission to view this group.')).toBeTruthy();

    resolveOld({ group_id: 'old', name: 'Stale private group', kind: 'bundle', members: [], contacts: [] });
    await waitFor(() => expect(screen.queryByText('Stale private group')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Delete group' })).toBeNull();
  });
});
