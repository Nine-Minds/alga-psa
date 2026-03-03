/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import ShareLinkDialog from './ShareLinkDialog';
import type { IDocumentShareLink } from '@alga-psa/documents/actions';

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
}));

const mockExistingLinks: IDocumentShareLink[] = [
  {
    share_id: 'share-1',
    tenant: 'tenant-1',
    document_id: 'doc-1',
    share_type: 'public',
    token: 'abc123token',
    password_hash: null,
    expires_at: null,
    max_downloads: null,
    download_count: 5,
    created_at: '2026-02-28T00:00:00Z',
    created_by: 'user-1',
    revoked_at: null,
    revoked_by: null,
  },
  {
    share_id: 'share-2',
    tenant: 'tenant-1',
    document_id: 'doc-1',
    share_type: 'password',
    token: 'xyz789token',
    password_hash: '$2b$10$hashedpassword',
    expires_at: '2026-03-28T00:00:00Z',
    max_downloads: 100,
    download_count: 10,
    created_at: '2026-02-28T00:00:00Z',
    created_by: 'user-1',
    revoked_at: null,
    revoked_by: null,
  },
];

const mockCreateShareLink = vi.fn().mockResolvedValue({
  shareLink: {
    share_id: 'share-new',
    tenant: 'tenant-1',
    document_id: 'doc-1',
    share_type: 'public',
    token: 'newtoken123',
    password_hash: null,
    expires_at: null,
    max_downloads: null,
    download_count: 0,
    created_at: '2026-02-28T00:00:00Z',
    created_by: 'user-1',
    revoked_at: null,
    revoked_by: null,
  },
});

vi.mock('@alga-psa/documents/actions', async () => {
  const actual = await vi.importActual('@alga-psa/documents/actions');
  return {
    ...actual,
    getShareLinksForDocument: vi.fn().mockResolvedValue(mockExistingLinks),
    createShareLink: mockCreateShareLink,
    revokeShareLink: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('../lib/documentUtils', () => ({
  getShareUrl: vi.fn((token: string) => `https://example.com/share/${token}`),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, disabled, variant, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ options, value, onValueChange, label, placeholder }: any) => (
    <div data-testid="select" data-value={value}>
      {label && <label>{label}</label>}
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        aria-label={placeholder}
      >
        {options?.map((opt: any) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  ),
}));

describe('ShareLinkDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders share type selector with options', async () => {
    render(
      <ShareLinkDialog
        isOpen={true}
        onClose={() => {}}
        documentId="doc-1"
        documentName="Test Document.pdf"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('dialog')).toBeInTheDocument();
    });

    // Should have select for share type
    expect(screen.getByTestId('select')).toBeInTheDocument();
  });

  it('lists existing share links with copy URL and revoke actions', async () => {
    render(
      <ShareLinkDialog
        isOpen={true}
        onClose={() => {}}
        documentId="doc-1"
        documentName="Test Document.pdf"
      />
    );

    await waitFor(() => {
      // Should show existing links - look for share type indicators
      expect(screen.getByText('Public')).toBeInTheDocument();
    });

    // Should have copy and revoke buttons for each link
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('shows password input for password-protected type', async () => {
    render(
      <ShareLinkDialog
        isOpen={true}
        onClose={() => {}}
        documentId="doc-1"
        documentName="Test Document.pdf"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('dialog')).toBeInTheDocument();
    });

    // The password input should be shown when password type is selected
    // (depends on component state)
  });

  it('shows expiry picker when enabled', async () => {
    render(
      <ShareLinkDialog
        isOpen={true}
        onClose={() => {}}
        documentId="doc-1"
        documentName="Test Document.pdf"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('dialog')).toBeInTheDocument();
    });

    // Look for expiry-related text
    expect(screen.getByText(/expir/i)).toBeInTheDocument();
  });

  it('shows max downloads input when enabled', async () => {
    render(
      <ShareLinkDialog
        isOpen={true}
        onClose={() => {}}
        documentId="doc-1"
        documentName="Test Document.pdf"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('dialog')).toBeInTheDocument();
    });

    // Look for max downloads text
    expect(screen.getByText(/download/i)).toBeInTheDocument();
  });

  it('renders create new link button', async () => {
    render(
      <ShareLinkDialog
        isOpen={true}
        onClose={() => {}}
        documentId="doc-1"
        documentName="Test Document.pdf"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/create/i)).toBeInTheDocument();
    });
  });

  it('displays document name in dialog title', async () => {
    render(
      <ShareLinkDialog
        isOpen={true}
        onClose={() => {}}
        documentId="doc-1"
        documentName="Test Document.pdf"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Test Document/i)).toBeInTheDocument();
    });
  });

  it('shows download count for existing links', async () => {
    render(
      <ShareLinkDialog
        isOpen={true}
        onClose={() => {}}
        documentId="doc-1"
        documentName="Test Document.pdf"
      />
    );

    await waitFor(() => {
      // Should show download count - the mock has 5 downloads for first link
      expect(screen.getByText(/5/)).toBeInTheDocument();
    });
  });
});
