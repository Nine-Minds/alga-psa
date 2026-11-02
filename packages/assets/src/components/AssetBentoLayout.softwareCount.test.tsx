/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import '@testing-library/jest-dom/vitest';

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAssetSoftwareSummary = vi.fn();
vi.mock('../actions/softwareActions', () => ({
  getAssetSoftwareSummary: (id: string) => getAssetSoftwareSummary(id),
  getAssetSoftware: vi.fn(async () => ({ software: [], total: 0, page: 1, limit: 50 })),
}));
vi.mock('../actions/assetActions', () => ({
  getAssetLinkedTickets: vi.fn(async () => []),
  getAssetMaintenanceReport: vi.fn(async () => null),
}));
vi.mock('../actions/assetGroupActions', () => ({ getAssetGroup: vi.fn(async () => null) }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (k: string, o?: any) =>
      String(o?.defaultValue ?? k).replace('{{count}}', String(o?.count ?? '')),
  }),
}));
vi.mock('@alga-psa/ui', () => ({ useClientDrawer: () => null }));
vi.mock('@alga-psa/ui/components', () => ({
  ContentCardVariantProvider: ({ children }: any) => <>{children}</>,
}));
vi.mock('@alga-psa/ui/components/Drawer', () => ({ default: () => null }));
vi.mock('./shared/useAssetStatusOptions', () => ({
  useAssetStatusRegistry: () => ({ statuses: [] }),
}));
vi.mock('./AssetAssigneeRow', () => ({ AssetAssigneeRow: () => null }));
vi.mock('./AssetSignedInUserRow', () => ({ AssetSignedInUserRow: () => null }));
vi.mock('./groups/AssetGroupDrawer', () => ({ AssetGroupDrawer: () => null }));
vi.mock('./AssetTimeline', () => ({ AssetTimeline: () => null }));
vi.mock('./AssetFormClient', () => ({ default: () => null }));
vi.mock('./panels/AssetNotesPanel', () => ({ AssetNotesPanel: () => null }));
vi.mock('./panels/CustomTypeDetailsPanel', () => ({ CustomTypeDetailsPanel: () => null }));
vi.mock('./panels/HuduDocumentationCard', () => ({ HuduDocumentationCard: () => null }));
vi.mock('./tabs/SoftwareInventoryTab', () => ({ SoftwareInventoryTab: () => null }));
vi.mock('./tabs/MaintenanceSchedulesTab', () => ({ MaintenanceSchedulesTab: () => null }));
vi.mock('./tabs/RelatedAssetsTab', () => ({ RelatedAssetsTab: () => null }));
vi.mock('./tabs/DocumentsPasswordsTab', () => ({ DocumentsPasswordsTab: () => null }));
vi.mock('./tabs/ServiceHistoryTab', () => ({ ServiceHistoryTab: () => null }));
vi.mock('./AssetInventoryProvenance', () => ({ AssetInventoryProvenanceSection: () => null }));
vi.mock('./custody/CustodyCard', () => ({
  CustodyCard: ({ id, assetId }: { id: string; assetId: string }) => (
    <div id={id} data-asset-id={assetId} />
  ),
}));

vi.mock('./warranty/WarrantyCard', () => ({
  WarrantyCard: ({ id, assetId }: { id: string; assetId: string }) => <div id={id} data-asset-id={assetId} />,
}));

import { AssetBentoLayout } from './AssetBentoLayout';

const asset: any = {
  asset_id: 'a1',
  name: 'Server-1',
  asset_type: 'server',
  server: { installed_software: [] },
};

function renderLayout(onFocusChange = vi.fn()) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <AssetBentoLayout
        asset={asset}
        metrics={undefined}
        rmmData={null}
        assetFacts={undefined}
        focusView={null}
        onFocusChange={onFocusChange}
      />
    </SWRConfig>
  );
  return onFocusChange;
}

describe('AssetBentoLayout software tile count', () => {
  beforeEach(() => { getAssetSoftwareSummary.mockReset(); });
  afterEach(cleanup);

  it('counts from asset_software, not the legacy installed_software JSON', async () => {
    getAssetSoftwareSummary.mockResolvedValue({ total_installed: 58 });
    const onFocusChange = renderLayout();
    expect(await screen.findByText('58 packages reported')).toBeInTheDocument();
    expect(getAssetSoftwareSummary).toHaveBeenCalledWith('a1');
    const open = document.getElementById('asset-bento-software-open') as HTMLButtonElement;
    expect(open).not.toBeNull();
    open.click();
    expect(onFocusChange).toHaveBeenCalledWith('software');
    expect(document.getElementById('asset-bento-software-empty')).toBeNull();
  });

  it('mounts the custody tile for the same asset alongside the software tile', async () => {
    getAssetSoftwareSummary.mockResolvedValue({ total_installed: 3 });
    renderLayout();
    expect(await screen.findByText('3 packages reported')).toBeInTheDocument();
    const custody = document.getElementById('asset-bento-custody');
    expect(custody).not.toBeNull();
    expect(custody).toHaveAttribute('data-asset-id', 'a1');
  });

  it('shows the empty message when the summary reports zero', async () => {
    getAssetSoftwareSummary.mockResolvedValue({ total_installed: 0 });
    renderLayout();
    expect(await screen.findByText('No software inventory reported.')).toBeInTheDocument();
    expect(document.getElementById('asset-bento-software-open')).toBeNull();
  });

  it('shows neither count nor empty message while pending', async () => {
    getAssetSoftwareSummary.mockReturnValue(new Promise(() => {}));
    renderLayout();
    await waitFor(() => expect(getAssetSoftwareSummary).toHaveBeenCalled());
    expect(screen.queryByText('No software inventory reported.')).not.toBeInTheDocument();
    expect(screen.queryByText(/packages reported/)).not.toBeInTheDocument();
    expect(document.getElementById('asset-bento-software-open')).toBeNull();
  });

  it('shows neither count nor empty message when the fetch rejects', async () => {
    getAssetSoftwareSummary.mockRejectedValue(new Error('boom'));
    renderLayout();
    await waitFor(() => expect(getAssetSoftwareSummary).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('No software inventory reported.')).not.toBeInTheDocument();
    expect(screen.queryByText(/packages reported/)).not.toBeInTheDocument();
    expect(document.getElementById('asset-bento-software-open')).toBeNull();
  });
});
