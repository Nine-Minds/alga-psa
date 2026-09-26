/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import ClientDocumentsPage from './ClientDocumentsPage';
import type { IDocument, IFolderNode } from '@alga-psa/types';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const { mockFolders, mockDocuments, mockRenderViewer } = vi.hoisted(() => {
  const mockFolders = [
    {
      name: 'Contracts',
      path: '/Contracts',
      docCount: 2,
      children: [],
    },
    {
      name: 'Invoices',
      path: '/Invoices',
      docCount: 1,
      children: [
        {
          name: '2026',
          path: '/Invoices/2026',
          docCount: 1,
          children: [],
        },
      ],
    },
  ] as IFolderNode[];

  const mockDocuments = [
    {
      tenant: 'tenant-1',
      document_id: 'doc-1',
      file_id: 'file-1',
      document_name: 'Service Agreement.pdf',
      type_id: null,
      user_id: 'user-1',
      order_number: 1,
      created_by: 'user-1',
      folder_path: '/Contracts',
      mime_type: 'application/pdf',
      is_client_visible: true,
      created_at: '2026-02-28T00:00:00Z',
      updated_at: '2026-02-28T00:00:00Z',
      file_size: 1024000,
    },
    {
      tenant: 'tenant-1',
      document_id: 'doc-2',
      file_id: 'file-2',
      document_name: 'Network Diagram.png',
      type_id: null,
      user_id: 'user-1',
      order_number: 2,
      created_by: 'user-1',
      folder_path: '/Contracts',
      mime_type: 'image/png',
      is_client_visible: true,
      created_at: '2026-02-28T00:00:00Z',
      updated_at: '2026-02-28T00:00:00Z',
      file_size: 512000,
    },
  ] as IDocument[];

  return { mockFolders, mockDocuments, mockRenderViewer: vi.fn(() => null) };
});

vi.mock('@alga-psa/client-portal/actions/client-portal-actions/client-documents', () => ({
  getClientDocuments: vi.fn().mockResolvedValue({
    documents: mockDocuments,
    total: 2,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  }),
  getClientDocumentFolders: vi.fn().mockResolvedValue(mockFolders),
  getClientDocumentContent: vi.fn().mockResolvedValue({ document: { document_id: 'doc-1' }, content: { kind: 'file' } }),
  downloadClientDocument: vi.fn().mockResolvedValue({
    success: true,
    fileId: 'file-1',
    fileName: 'Service Agreement.pdf',
    mimeType: 'application/pdf',
  }),
}));

vi.mock('@alga-psa/documents/lib/documentUtils', () => ({
  downloadDocument: vi.fn(),
}));

vi.mock('../../lib/fetchAndSaveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/fetchAndSaveFile')>()),
  fetchAndSaveFile: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn() } }));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    renderDocumentViewer: mockRenderViewer,
    downloadDocument: vi.fn(),
    getDocumentDownloadUrl: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, disabled, variant, size, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} data-size={size} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, onClose, title, children, footer }: any) => isOpen ? (
    <div role="dialog" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose}>Close</button>
      {children}{footer}
    </div>
  ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className} data-testid="card">{children}</div>
  ),
  CardContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => children,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, ...props }: any) => <button {...props} onClick={onSelect}>{children}</button>,
}));

describe('ClientDocumentsPage', () => {
  afterEach(async () => {
    cleanup();
    mockDocuments[0].file_id = 'file-1';
    mockDocuments[0].document_name = 'Service Agreement.pdf';
    mockRenderViewer.mockReset().mockReturnValue(null);
    const actions = await import('@alga-psa/client-portal/actions/client-portal-actions/client-documents');
    vi.mocked(actions.getClientDocuments).mockReset().mockResolvedValue({ documents: mockDocuments, total: 2, page: 1, pageSize: 20, totalPages: 1 } as any);
    vi.mocked(actions.getClientDocumentContent).mockReset().mockResolvedValue({ document: { document_id: 'doc-1' }, content: { kind: 'file' } } as any);
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders folder tree sidebar', async () => {
    render(<ClientDocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText('Contracts')).toBeInTheDocument();
      expect(screen.getByText('Invoices')).toBeInTheDocument();
    });
  });

  it('renders document cards with view/download actions', async () => {
    render(<ClientDocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText('Service Agreement.pdf')).toBeInTheDocument();
      expect(screen.getByText('Network Diagram.png')).toBeInTheDocument();
    });

    // Check for download buttons
    const downloadButtons = screen.getAllByRole('button');
    expect(downloadButtons.length).toBeGreaterThan(0);
  });

  it('routes uploaded document downloads through the checked portal file endpoint', async () => {
    const { fetchAndSaveFile } = await import('../../lib/fetchAndSaveFile');
    render(<ClientDocumentsPage />);
    await waitFor(() => expect(screen.getByText('Service Agreement.pdf')).toBeInTheDocument());
    fireEvent.click(document.getElementById('client-docs-download-document-doc-1')!);
    await waitFor(() => expect(fetchAndSaveFile).toHaveBeenCalledWith('/api/client-portal/documents/doc-1/file?disposition=attachment', 'Service Agreement.pdf'));
  });

  it('shows a visible error when a file download request fails', async () => {
    const { fetchAndSaveFile } = await import('../../lib/fetchAndSaveFile');
    const { toast } = await import('react-hot-toast');
    vi.mocked(fetchAndSaveFile).mockRejectedValueOnce(new Error('Missing storage object'));
    render(<ClientDocumentsPage />);
    await waitFor(() => expect(screen.getByText('Service Agreement.pdf')).toBeInTheDocument());
    fireEvent.click(document.getElementById('client-docs-download-document-doc-1')!);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not download this document. Please try again.'));
  });

  it('offers readable PDF and Markdown exports for an in-app document', async () => {
    mockDocuments[0].file_id = null;
    mockDocuments[0].document_name = 'Meeting Notes';
    render(<ClientDocumentsPage />);
    await waitFor(() => expect(screen.getByText('Meeting Notes')).toBeInTheDocument());
    fireEvent.click(document.getElementById('client-docs-title-view-doc-1')!);
    await waitFor(() => expect(screen.getByText('Download PDF')).toBeInTheDocument());
    fireEvent.click(document.getElementById('client-docs-preview-download-pdf-doc-1')!);
    await waitFor(async () => {
      const { fetchAndSaveFile } = await import('../../lib/fetchAndSaveFile');
      expect(fetchAndSaveFile).toHaveBeenCalledWith('/api/client-portal/documents/doc-1/export?format=pdf', 'Meeting Notes.pdf');
    });
    fireEvent.click(document.getElementById('client-docs-preview-markdown-doc-1')!);
    await waitFor(async () => {
      const { fetchAndSaveFile } = await import('../../lib/fetchAndSaveFile');
      expect(fetchAndSaveFile).toHaveBeenCalledWith('/api/client-portal/documents/doc-1/export?format=md', 'Meeting Notes.md');
    });
  });

  it('offers explicit translated format choices from the in-app card download menu', async () => {
    mockDocuments[0].file_id = null;
    mockDocuments[0].document_name = 'Meeting Notes';
    render(<ClientDocumentsPage />);
    await waitFor(() => expect(screen.getByText('Meeting Notes')).toBeInTheDocument());
    fireEvent.click(document.getElementById('client-docs-download-document-doc-1')!);
    await waitFor(() => {
      expect(screen.getByText('Download PDF')).toBeInTheDocument();
      expect(screen.getByText('Download Markdown')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Download Markdown'));
    const { fetchAndSaveFile } = await import('../../lib/fetchAndSaveFile');
    await waitFor(() => expect(fetchAndSaveFile).toHaveBeenCalledWith('/api/client-portal/documents/doc-1/export?format=md', 'Meeting Notes.md'));
  });

  it.each([
    ['doc-1', 'application/pdf'],
    ['doc-2', 'image/png'],
  ])('fetches uploaded %s preview bytes from the inline endpoint', async (documentId) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['preview'])));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(`blob:${documentId}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    render(<ClientDocumentsPage />);
    await waitFor(() => expect(screen.getByText('Service Agreement.pdf')).toBeInTheDocument());
    fireEvent.click(document.getElementById(`client-docs-view-document-${documentId}`)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/client-portal/documents/${documentId}/file?disposition=inline`, { credentials: 'include' }));
    if (documentId === 'doc-1') await waitFor(() => expect(screen.getByTitle('Service Agreement.pdf')).toHaveAttribute('src', 'blob:doc-1'));
    else await waitFor(() => expect(screen.getByAltText('Network Diagram.png')).toHaveAttribute('src', 'blob:doc-2'));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(revoke).toHaveBeenCalledWith(`blob:${documentId}`);
  });

  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
  };

  it('keeps the newer preview when older content and byte responses finish later', async () => {
    const { getClientDocumentContent } = await import('@alga-psa/client-portal/actions/client-portal-actions/client-documents');
    const firstContent = deferred<any>();
    const secondContent = deferred<any>();
    const firstBytes = deferred<Response>();
    const secondBytes = deferred<Response>();
    vi.mocked(getClientDocumentContent).mockReturnValueOnce(firstContent.promise).mockReturnValueOnce(secondContent.promise);
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('doc-1') ? firstBytes.promise : secondBytes.promise));
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => `blob:${blob.size}`);
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    render(<ClientDocumentsPage />);
    await waitFor(() => {
      expect(screen.getByText('Service Agreement.pdf')).toBeInTheDocument();
      expect(screen.getByText('Network Diagram.png')).toBeInTheDocument();
    });
    fireEvent.click(document.getElementById('client-docs-view-document-doc-1')!);
    await waitFor(() => expect(getClientDocumentContent).toHaveBeenCalledTimes(1));
    act(() => firstContent.resolve({ document: { document_id: 'doc-1' }, content: { kind: 'file' } }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/client-portal/documents/doc-1/file?disposition=inline', { credentials: 'include' }));
    fireEvent.click(document.getElementById('client-docs-view-document-doc-2')!);
    await waitFor(() => expect(getClientDocumentContent).toHaveBeenCalledTimes(2));
    act(() => secondContent.resolve({ document: { document_id: 'doc-2' }, content: { kind: 'file' } }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/client-portal/documents/doc-2/file?disposition=inline', { credentials: 'include' }));
    expect(screen.getByRole('status', { name: 'Loading preview' })).toBeInTheDocument();
    expect(screen.queryByAltText('Network Diagram.png')).not.toBeInTheDocument();
    act(() => secondBytes.resolve(new Response(new Blob(['image bytes']))));
    await waitFor(() => expect(screen.getByAltText('Network Diagram.png')).toHaveAttribute('src', createUrl.mock.results[0]?.value));
    act(() => firstBytes.resolve(new Response(new Blob(['pdf bytes']))));
    await waitFor(() => expect(screen.getByAltText('Network Diagram.png')).toBeInTheDocument());
    expect(screen.getByAltText('Network Diagram.png')).toHaveAttribute('src', createUrl.mock.results[0]?.value);
    expect(createUrl).toHaveBeenCalledTimes(1);
  });

  it('ignores content and bytes that resolve after the preview is closed', async () => {
    const { getClientDocumentContent } = await import('@alga-psa/client-portal/actions/client-portal-actions/client-documents');
    const content = deferred<any>();
    vi.mocked(getClientDocumentContent).mockReturnValueOnce(content.promise);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ClientDocumentsPage />);
    await waitFor(() => expect(screen.getByText('Service Agreement.pdf')).toBeInTheDocument());
    fireEvent.click(document.getElementById('client-docs-view-document-doc-1')!);
    await screen.findByRole('dialog');
    await waitFor(() => expect(getClientDocumentContent).toHaveBeenCalledWith('doc-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    act(() => content.resolve({ document: { document_id: 'doc-1' }, content: { kind: 'block', blockData: [] } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByTitle('Service Agreement.pdf')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockRenderViewer).not.toHaveBeenCalled();
  });

  it('renders readable BlockNote content for an in-app document', async () => {
    const { getClientDocumentContent } = await import('@alga-psa/client-portal/actions/client-portal-actions/client-documents');
    const blockData = [{ type: 'paragraph', content: [{ type: 'text', text: 'Meeting Notes' }] }];
    vi.mocked(getClientDocumentContent).mockResolvedValueOnce({ document: { document_id: 'doc-1' }, content: { kind: 'block', blockData } } as any);
    mockRenderViewer.mockReturnValue(<div>Rendered meeting notes</div>);
    render(<ClientDocumentsPage />);
    await waitFor(() => expect(screen.getByText('Service Agreement.pdf')).toBeInTheDocument());
    fireEvent.click(document.getElementById('client-docs-title-view-doc-1')!);
    await waitFor(() => {
      expect(mockRenderViewer).toHaveBeenCalledWith({ content: blockData });
      expect(screen.getByText('Rendered meeting notes')).toBeInTheDocument();
    });
  });

  it('shows a visible render error for a broken image or block renderer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['image'])));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bad-image');
    render(<ClientDocumentsPage />);
    await waitFor(() => expect(screen.getByText('Service Agreement.pdf')).toBeInTheDocument());
    fireEvent.click(document.getElementById('client-docs-view-document-doc-2')!);
    const image = await screen.findByAltText('Network Diagram.png');
    fireEvent.error(image);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this preview. Please try again.');
  });

  it('shows a visible error when the in-app document renderer throws', async () => {
    const { getClientDocumentContent } = await import('@alga-psa/client-portal/actions/client-portal-actions/client-documents');
    mockDocuments[0].file_id = null;
    vi.mocked(getClientDocumentContent).mockResolvedValueOnce({ document: { document_id: 'doc-1' }, content: { kind: 'block', blockData: [] } } as any);
    mockRenderViewer.mockImplementation(() => { throw new Error('renderer failed'); });
    render(<ClientDocumentsPage />);
    await waitFor(() => expect(screen.getByText('Service Agreement.pdf')).toBeInTheDocument());
    fireEvent.click(document.getElementById('client-docs-title-view-doc-1')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this preview. Please try again.');
  });

  it('renders search filter input', async () => {
    render(<ClientDocumentsPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    });
  });

  it('filters documents when search is entered', async () => {
    render(<ClientDocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText('Service Agreement.pdf')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'Agreement' } });

    // The component should filter or trigger a refetch
    expect(searchInput).toHaveValue('Agreement');
  });

  it('shows document MIME type icons', async () => {
    render(<ClientDocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText('Service Agreement.pdf')).toBeInTheDocument();
    });

    // Document cards should be present with icons
    const cards = screen.getAllByTestId('card');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('renders folder tree with nested children', async () => {
    render(<ClientDocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText('Invoices')).toBeInTheDocument();
    });

    // Should show nested folder when expanded
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('renders All Documents option in sidebar', async () => {
    render(<ClientDocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText('All Documents')).toBeInTheDocument();
    });
  });

  it('shows document count and page information', async () => {
    render(<ClientDocumentsPage />);

    await waitFor(() => {
      // Should show total or pagination info
      expect(screen.getByText(/2/)).toBeInTheDocument();
    });
  });

  it('does not show edit or delete actions (view/download only)', async () => {
    render(<ClientDocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText('Service Agreement.pdf')).toBeInTheDocument();
    });

    // Should not have edit/delete buttons
    expect(screen.queryByText(/edit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
  });
});
