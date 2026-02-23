// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

(globalThis as unknown as { React?: typeof React }).React = React;

const pushMock = vi.fn();
const useSearchParamsMock = vi.fn(() => new URLSearchParams());
const createBlockDocumentMock = vi.fn();
const getBlockContentMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => useSearchParamsMock(),
}));

vi.mock('@alga-psa/documents/components', () => ({
  CollaborativeEditor: () => <div data-testid="collaborative-editor" />,
}));

vi.mock('@alga-psa/documents/actions/documentBlockContentActions', () => ({
  createBlockDocument: (...args: unknown[]) => createBlockDocumentMock(...args),
  getBlockContent: (...args: unknown[]) => getBlockContentMock(...args),
}));

vi.mock('@alga-psa/documents/actions/collaborativeEditingActions', () => ({
  syncCollabSnapshot: vi.fn(),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

const { default: CollabTestPageClient } = await import(
  '@/app/msp/collab-test/CollabTestPageClient'
);

describe('CollabTestPageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    getBlockContentMock.mockResolvedValue(null);
  });

  it('creates a document and navigates to the new doc id', async () => {
    createBlockDocumentMock.mockResolvedValue({ document_id: 'doc-123' });

    const { getByText } = render(
      <CollabTestPageClient userId="user-1" userName="User One" tenantId="tenant-1" />
    );

    fireEvent.click(getByText('Create New Document'));

    await waitFor(() => {
      expect(createBlockDocumentMock).toHaveBeenCalled();
    });

    expect(createBlockDocumentMock).toHaveBeenCalledWith({
      document_name: expect.stringContaining('Collab Test'),
      user_id: 'user-1',
      block_data: expect.any(Object),
    });
    expect(pushMock).toHaveBeenCalledWith('/msp/collab-test?doc=doc-123');
  });

  it('loads an existing document from the query string', async () => {
    const params = new URLSearchParams();
    params.set('doc', 'doc-456');
    useSearchParamsMock.mockReturnValue(params);
    getBlockContentMock.mockResolvedValue({ block_data: '{}' });

    const { findByTestId } = render(
      <CollabTestPageClient userId="user-1" userName="User One" tenantId="tenant-1" />
    );

    await waitFor(() => {
      expect(getBlockContentMock).toHaveBeenCalledWith('doc-456');
    });

    expect(await findByTestId('collaborative-editor')).toBeTruthy();
  });

  it('shows an error when the document does not exist', async () => {
    const params = new URLSearchParams();
    params.set('doc', 'missing-doc');
    useSearchParamsMock.mockReturnValue(params);
    getBlockContentMock.mockResolvedValue(null);

    const { findByText, queryByTestId } = render(
      <CollabTestPageClient userId="user-1" userName="User One" tenantId="tenant-1" />
    );

    expect(await findByText('Document not found. Check the ID and try again.')).toBeTruthy();
    expect(queryByTestId('collaborative-editor')).toBeNull();
  });

  it('calls syncCollabSnapshot and shows success message', async () => {
    const params = new URLSearchParams();
    params.set('doc', 'doc-789');
    useSearchParamsMock.mockReturnValue(params);
    getBlockContentMock.mockResolvedValue({ block_data: '{}' });

    const { syncCollabSnapshot } = await import(
      '@alga-psa/documents/actions/collaborativeEditingActions'
    );
    const syncCollabSnapshotMock = syncCollabSnapshot as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    syncCollabSnapshotMock.mockResolvedValue({ success: true });

    const { findByText, getByText } = render(
      <CollabTestPageClient userId="user-1" userName="User One" tenantId="tenant-1" />
    );

    await waitFor(() => {
      expect(getBlockContentMock).toHaveBeenCalledWith('doc-789');
    });

    fireEvent.click(getByText('Snapshot to DB'));

    expect(await findByText('Snapshot saved to document_block_content.')).toBeTruthy();
    expect(syncCollabSnapshot).toHaveBeenCalledWith('doc-789');
  });

  it('shows debug panel values for room and connection status', async () => {
    const params = new URLSearchParams();
    params.set('doc', 'doc-999');
    useSearchParamsMock.mockReturnValue(params);
    getBlockContentMock.mockResolvedValue({ block_data: '{}' });

    const { findByText } = render(
      <CollabTestPageClient userId="user-1" userName="User One" tenantId="tenant-1" />
    );

    expect(await findByText('Room: document:tenant-1:doc-999')).toBeTruthy();
    expect(await findByText('Connection: connecting')).toBeTruthy();
    expect(await findByText('Connected users: 0')).toBeTruthy();
  });
});
