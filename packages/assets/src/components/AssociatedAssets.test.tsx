/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import AssociatedAssets from './AssociatedAssets';

vi.mock('../actions/assetActions', () => ({ listEntityAssets: vi.fn(async () => []), createAssetAssociation: vi.fn(), removeAssetAssociation: vi.fn(), listAssets: vi.fn(async () => ({ assets: [], total: 0 })) }));
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
    render(<AssociatedAssets id="ticket-assets" entityId="ticket-1" entityType="ticket" clientId="c1" initialAssets={Promise.resolve([asset])} />);
    const name = await screen.findByRole('button', { name: asset.name });
    expect(name.getAttribute('title')).toBe(asset.name);
    expect(name.className).toContain('min-w-0');
    const remove = screen.getByRole('button', { name: 'Remove' });
    expect(remove.getAttribute('title')).toBe('Remove');
    expect(remove.textContent).toBe('×');
    await waitFor(() => expect(name).toBeTruthy());
  });
});
