/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import '@testing-library/jest-dom/vitest';

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let query = '';
const asset: any = {
  asset_id: 'a1',
  name: 'PC-1',
  workstation: { installed_software: [{ name: 'Google Chrome', version: '1' }, { name: 'Firefox', version: '2' }] },
};

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (k: string, o?: any) => String(o?.defaultValue ?? k) }),
}));
vi.mock('@alga-psa/assets/hooks/useAssetDetail', () => ({
  useAssetDetail: () => ({
    asset, metrics: null, rmmData: null, assetFacts: null, isLoading: false,
    refreshRmmData: vi.fn(), isRefreshing: false, rebootDevice: vi.fn(), isRebooting: false,
  }),
}));
vi.mock('./shared/useAssetStatusOptions', () => ({
  resolveAssetStatusLabel: () => 'Active',
  useAssetStatusRegistry: () => ({ statuses: [] }),
}));
vi.mock('./AssetDetailHeader', () => ({ AssetDetailHeader: () => <div /> }));
vi.mock('@alga-psa/ui/components/PrintableDetailHeader', () => ({ PrintableDetailHeader: () => <div /> }));
// The layout resolves focusView -> drawer content; mirror its 'software' entry
// with the real SoftwareInventoryTab so the prefill path is exercised.
vi.mock('./AssetBentoLayout', async () => {
  const { SoftwareInventoryTab } = await import('./tabs/SoftwareInventoryTab');
  return {
    AssetBentoLayout: ({ asset: a, focusView }: any) => (
      <div data-testid="focus">{focusView === 'software' ? <SoftwareInventoryTab asset={a} /> : null}</div>
    ),
  };
});

import { AssetDetailView } from './AssetDetailView';

describe('AssetDetailView deep link', () => {
  beforeEach(() => { query = ''; });
  afterEach(cleanup);

  it('?tab=software&software=Chrome opens Software with the search prefilled', () => {
    query = 'tab=software&software=Chrome';
    render(<AssetDetailView assetId="a1" />);
    const input = screen.getByPlaceholderText('Search software...') as HTMLInputElement;
    expect(input.value).toBe('Chrome');
    expect(screen.getByText('Google Chrome')).toBeInTheDocument();
    expect(screen.queryByText('Firefox')).not.toBeInTheDocument();
  });

  it('leaves the drawer closed without a known ?tab=', () => {
    query = 'tab=bogus';
    render(<AssetDetailView assetId="a1" />);
    expect(screen.queryByPlaceholderText('Search software...')).not.toBeInTheDocument();
  });
});
