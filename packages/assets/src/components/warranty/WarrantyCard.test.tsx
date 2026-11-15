/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import '@testing-library/jest-dom/vitest';

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getAssetWarrantySummary = vi.fn();
vi.mock('../../actions/assetWarrantyActions', () => ({
  getAssetWarrantySummary: (id: string) => getAssetWarrantySummary(id),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (k: string, o?: any) => String(o?.defaultValue ?? k) }),
  useFormatters: () => ({
    formatDate: (v: string | Date) =>
      new Date(v).toLocaleDateString('en-US', { dateStyle: 'medium' }),
  }),
}));

import { WarrantyCard } from './WarrantyCard';

afterEach(() => cleanup());

describe('WarrantyCard layout', () => {
  it('renders values in full without a grid-cols-2 ancestor', async () => {
    getAssetWarrantySummary.mockResolvedValue({
      asset_id: 'a1',
      ownership: 'client',
      stock_tracked: false,
      warranty_end_date: '2027-03-31',
      vendor_id: null,
      vendor_name: 'Dell',
      claims: [],
      open_claim: null,
    });
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <WarrantyCard id="warranty-card" assetId="a1" />
      </SWRConfig>
    );

    const owner = await screen.findByText('Client-owned');
    const date = await screen.findByText('Mar 31, 2027');
    for (const node of [owner, date]) {
      expect(node.closest('.grid-cols-2')).toBeNull();
    }
  });
});
