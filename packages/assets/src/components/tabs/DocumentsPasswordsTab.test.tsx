/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { DocumentsPasswordsTab } from './DocumentsPasswordsTab';

const { getAssetDocuments, renderDocuments } = vi.hoisted(() => ({
  getAssetDocuments: vi.fn(),
  renderDocuments: vi.fn((_props: any): React.ReactNode => null),
}));

vi.mock('../../actions/assetDocumentActions', () => ({ getAssetDocuments }));
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ renderDocuments }),
}));
vi.mock('./AssetCredentialsSection', () => ({ AssetCredentialsSection: () => <div data-testid="credentials" /> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const stableT = (_key: string, options: any) => options?.defaultValue ?? _key;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: stableT }) }));

const asset = { asset_id: 'asset-1', tenant: 'tenant-1', client_id: 'client-1' } as any;
const doc = (id: string) => ({ document_id: id, document_name: id, association_id: `assoc-${id}` });

const lastProps = () => renderDocuments.mock.calls[renderDocuments.mock.calls.length - 1][0];

const renderTab = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <DocumentsPasswordsTab asset={asset} />
    </SWRConfig>
  );

describe('DocumentsPasswordsTab linked documents', () => {
  beforeEach(() => {
    getAssetDocuments.mockReset();
    renderDocuments.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('passes the documents returned by getAssetDocuments to renderDocuments', async () => {
    const docs = [doc('d1'), doc('d2')];
    getAssetDocuments.mockResolvedValue(docs);
    renderTab();

    await waitFor(() => expect(lastProps().documents).toEqual(docs));
    expect(getAssetDocuments).toHaveBeenCalledWith('asset-1');
    expect(lastProps()).toMatchObject({ entityId: 'asset-1', entityType: 'asset', userId: 'tenant-1', isLoading: false });
  });

  it('reports loading before the fetch resolves', async () => {
    getAssetDocuments.mockReturnValue(new Promise(() => {}));
    renderTab();
    await waitFor(() => expect(renderDocuments).toHaveBeenCalled());
    expect(lastProps()).toMatchObject({ documents: [], isLoading: true });
  });

  it('does not reset the list to [] on re-render', async () => {
    const docs = [doc('d1')];
    getAssetDocuments.mockResolvedValue(docs);
    const { rerender } = renderTab();
    await waitFor(() => expect(lastProps().documents).toEqual(docs));

    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <DocumentsPasswordsTab asset={{ ...asset }} />
      </SWRConfig>
    );
    expect(lastProps().documents).toEqual(docs);
    expect(getAssetDocuments).toHaveBeenCalledTimes(1);
  });

  it('refetches and shows the new list when onDocumentCreated is called', async () => {
    getAssetDocuments.mockResolvedValueOnce([doc('d1')]).mockResolvedValue([doc('d1'), doc('d2')]);
    renderTab();
    await waitFor(() => expect(lastProps().documents).toEqual([doc('d1')]));

    await act(async () => {
      await lastProps().onDocumentCreated();
    });

    expect(getAssetDocuments).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(lastProps().documents).toEqual([doc('d1'), doc('d2')]));
  });

  it('renders an error state, not the empty list, when the action returns an error result', async () => {
    getAssetDocuments.mockResolvedValue({ permissionError: 'Permission denied: Cannot read asset documents' });
    renderTab();

    expect(await screen.findByTestId('asset-documents-error')).toBeTruthy();
    expect(screen.getByText('Documents unavailable')).toBeTruthy();
    expect(renderDocuments).not.toHaveBeenCalledWith(expect.objectContaining({ isLoading: false }));
    expect(screen.getByTestId('credentials')).toBeTruthy();
  });

  it('renders an error state and keeps credentials when the fetch rejects', async () => {
    getAssetDocuments.mockRejectedValue(new Error('column does not exist'));
    renderTab();

    expect(await screen.findByTestId('asset-documents-error')).toBeTruthy();
    expect(screen.getByTestId('credentials')).toBeTruthy();
    expect(renderDocuments).not.toHaveBeenCalledWith(expect.objectContaining({ isLoading: false }));
  });
});
