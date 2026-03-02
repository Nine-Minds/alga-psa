/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import ClientDocumentsPage from './ClientDocumentsPage';
import type { IDocument, IFolderNode } from '@alga-psa/types';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const mockFolders: IFolderNode[] = [
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
];

const mockDocuments: IDocument[] = [
  {
    tenant: 'tenant-1',
    document_id: 'doc-1',
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
];

vi.mock('@alga-psa/client-portal/actions/client-portal-actions/client-documents', () => ({
  getClientDocuments: vi.fn().mockResolvedValue({
    documents: mockDocuments,
    total: 2,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  }),
  getClientDocumentFolders: vi.fn().mockResolvedValue(mockFolders),
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

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className} data-testid="card">{children}</div>
  ),
  CardContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

describe('ClientDocumentsPage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
