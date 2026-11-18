/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AssetDetailHeader } from './AssetDetailHeader';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);
  const value = { t };
  return { useTranslation: () => value };
});
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _v, size: _s, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/PrintButton', () => ({ PrintButton: () => null }));
vi.mock('@alga-psa/ui/components/BackNav', () => ({ default: () => null }));
vi.mock('@alga-psa/ui', () => ({ DeleteEntityDialog: () => null }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@alga-psa/ui/components/IconPicker', () => ({ getIconComponent: () => () => null }));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
}));
vi.mock('./shared/StatusBadge', () => ({ StatusBadge: () => null }));
vi.mock('./shared/useAssetTypeOptions', () => ({ useAssetTypeRegistry: () => [] }));
vi.mock('./RemoteAccessButton', () => ({ RemoteAccessButton: () => null }));
vi.mock('../context/AssetCrossFeatureContext', () => ({ useAssetCrossFeature: () => ({ renderQuickAddTicket: () => null }) }));
vi.mock('../actions/remoteAccessLinkActions', () => ({ hasRemoteAccessLinks: vi.fn(async () => false) }));
vi.mock('../actions/assetActions', () => ({ deleteAsset: vi.fn() }));
vi.mock('../lib/rmmProviderDisplay', () => ({ getRmmProviderDisplayName: () => 'RMM' }));
vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({ preCheckDeletion: vi.fn() }));
vi.mock('@alga-psa/ui/components/labels/LabelPrintDialog', () => ({
  LabelPrintDialog: (props: any) => (
    <div data-testid="label-dialog" data-label-class={props.labelClass} data-ids={JSON.stringify(props.ids)} />
  ),
}));

describe('AssetDetailHeader print label', () => {
  afterEach(cleanup);

  it('opens the label dialog for this asset with the asset-identity class', async () => {
    const asset = { asset_id: 'asset-123', asset_type: 'workstation', name: 'WS-1', asset_tag: 'T1', status: 'active' } as any;
    render(<AssetDetailHeader asset={asset} />);
    expect(screen.queryByTestId('label-dialog')).toBeNull();

    await userEvent.click(document.getElementById('asset-print-label-button')!);

    const dialog = screen.getByTestId('label-dialog');
    expect(dialog.getAttribute('data-label-class')).toBe('asset-identity');
    expect(JSON.parse(dialog.getAttribute('data-ids')!)).toEqual(['asset-123']);
  });
});
