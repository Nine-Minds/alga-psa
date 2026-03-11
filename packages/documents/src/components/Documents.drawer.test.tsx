/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Documents from './Documents.tsx';
import { syncCollabSnapshot } from '../actions/collaborativeEditingActions';
import { updateBlockContent, createBlockDocument } from '../actions/documentBlockContentActions';
import { getDocumentsByFolder } from '../actions/documentActions';

const mockRefresh = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();
const mockFolderTreeView = vi.fn((props: { selectedFolder: string | null; entityId?: string; entityType?: string }) => (
  <div
    data-testid="folder-tree-view"
    data-selected-folder={props.selectedFolder ?? ''}
    data-entity-id={props.entityId ?? ''}
    data-entity-type={props.entityType ?? ''}
  />
));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, any> | string) =>
      typeof options === 'string' ? options : (options?.defaultValue ?? _key),
  }),
}));

vi.mock('@alga-psa/users/hooks', () => ({
  useUserPreference: () => ({ value: 'grid', setValue: vi.fn() }),
}));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    user_id: 'user-1',
    first_name: 'Test',
    last_name: 'User',
    tenant: 'tenant-1',
    email: 'test@example.com',
  }),
  searchUsersForMentions: vi.fn(),
}));

vi.mock('../actions/documentActions', () => ({
  getDocumentsByEntity: vi.fn(),
  getDocumentsByFolder: vi.fn(),
  moveDocumentsToFolder: vi.fn(),
  createFolder: vi.fn(),
  deleteDocument: vi.fn(),
  removeDocumentAssociations: vi.fn(),
  toggleDocumentVisibility: vi.fn(),
  updateDocument: vi.fn(),
}));

vi.mock('../actions/documentBlockContentActions', () => ({
  getBlockContent: vi.fn(),
  updateBlockContent: vi.fn(),
  createBlockDocument: vi.fn().mockResolvedValue({ document_id: 'doc-1', content_id: 'content-1' }),
}));

vi.mock('../actions/collaborativeEditingActions', () => ({
  syncCollabSnapshot: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('./DocumentStorageCard', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button data-testid="doc-card" onClick={onClick}>
      Doc
    </button>
  ),
}));

vi.mock('./DocumentUpload', () => ({ default: () => null }));
vi.mock('./DocumentSelector', () => ({ default: () => null }));
vi.mock('./FolderTreeView', () => ({
  default: (props: { selectedFolder: string | null; entityId?: string; entityType?: string }) => mockFolderTreeView(props),
}));
vi.mock('./FolderManager', () => ({ default: () => null }));
vi.mock('./FolderSelectorModal', () => ({ default: () => null }));
vi.mock('./DocumentsPagination', () => ({ default: () => null }));
vi.mock('./DocumentListView', () => ({ default: () => null }));
vi.mock('./DocumentsPageSkeleton', () => ({ DocumentsGridSkeleton: () => null }));

let mockCollabStatus: string | null = 'connected';
let mockFallbackUnsaved = false;
let mockFallbackContent: Record<string, any> | null = null;

vi.mock('./CollaborativeEditor', () => ({
  CollaborativeEditor: (props: { onConnectionStatusChange?: (status: string) => void }) => {
    React.useEffect(() => {
      if (mockCollabStatus) {
        props.onConnectionStatusChange?.(mockCollabStatus);
      }
    }, [props.onConnectionStatusChange]);
    return <div data-testid="collab-editor" />;
  },
}));

vi.mock('./DocumentEditor', () => ({
  DocumentEditor: ({
    onUnsavedChangesChange,
    onContentChange,
  }: {
    onUnsavedChangesChange?: (hasChanges: boolean) => void;
    onContentChange?: (content: Record<string, any> | null) => void;
  }) => {
    React.useEffect(() => {
      onUnsavedChangesChange?.(mockFallbackUnsaved);
      if (mockFallbackContent) {
        onContentChange?.(mockFallbackContent);
      }
    }, [onUnsavedChangesChange, onContentChange]);
    return <div data-testid="fallback-editor" />;
  },
}));

vi.mock('./DocumentViewer', () => ({
  DocumentViewer: () => <div data-testid="viewer" />,
}));

vi.mock('@alga-psa/ui/components/Drawer', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="drawer">{children}</div> : null,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, title }: { isOpen: boolean; title: string }) =>
    isOpen ? <div data-testid="confirmation-dialog">{title}</div> : null,
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Spinner', () => ({
  default: () => <div>Loading...</div>,
}));

vi.mock('@alga-psa/ui/components/ViewSwitcher', () => ({
  default: () => null,
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Documents drawer', () => {
  beforeAll(() => {
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCollabStatus = 'connected';
    mockFallbackUnsaved = false;
    mockFallbackContent = null;
    mockSearchParams = new URLSearchParams();
    (getDocumentsByFolder as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({
      documents: [],
      total: 0,
    });
  });

  it('renders FolderTreeView sidebar in entity mode', async () => {
    render(
      <Documents
        id="documents"
        documents={[
          {
            document_id: 'doc-1',
            document_name: 'Runbook',
            type_id: null,
            user_id: 'user-1',
            order_number: 0,
            created_by: 'user-1',
            type_name: 'text/plain',
            tenant: 'tenant-1',
          },
        ]}
        gridColumns={3}
        userId="user-1"
        entityId="entity-1"
        entityType="asset"
        isLoading={false}
      />
    );

    expect(screen.getByTestId('folder-tree-view')).toBeInTheDocument();
    expect(screen.getByTestId('folder-tree-view')).toHaveAttribute('data-entity-id', 'entity-1');
    expect(screen.getByTestId('folder-tree-view')).toHaveAttribute('data-entity-type', 'asset');
    expect(mockFolderTreeView).toHaveBeenCalled();
  });

  it('opens CollaborativeEditor when editing an in-app document', async () => {
    render(
      <Documents
        id="documents"
        documents={[
          {
            document_id: 'doc-1',
            document_name: 'Runbook',
            type_id: null,
            user_id: 'user-1',
            order_number: 0,
            created_by: 'user-1',
            type_name: 'text/plain',
            tenant: 'tenant-1',
          },
        ]}
        gridColumns={3}
        userId="user-1"
        entityId="entity-1"
        entityType="asset"
        isLoading={false}
      />
    );

    fireEvent.click(screen.getByTestId('doc-card'));

    await waitFor(() => {
      expect(screen.getByTestId('collab-editor')).toBeInTheDocument();
    });
  });

  it('triggers syncCollabSnapshot when saving in collaborative mode', async () => {
    render(
      <Documents
        id="documents"
        documents={[
          {
            document_id: 'doc-1',
            document_name: 'Runbook',
            type_id: null,
            user_id: 'user-1',
            order_number: 0,
            created_by: 'user-1',
            type_name: 'text/plain',
            tenant: 'tenant-1',
          },
        ]}
        gridColumns={3}
        userId="user-1"
        entityId="entity-1"
        entityType="asset"
        isLoading={false}
      />
    );

    fireEvent.click(screen.getByTestId('doc-card'));

    await waitFor(() => {
      expect(screen.getByTestId('collab-editor')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(syncCollabSnapshot).toHaveBeenCalledWith('doc-1');
    });
  });

  it('triggers a snapshot when closing the drawer', async () => {
    render(
      <Documents
        id="documents"
        documents={[
          {
            document_id: 'doc-1',
            document_name: 'Runbook',
            type_id: null,
            user_id: 'user-1',
            order_number: 0,
            created_by: 'user-1',
            type_name: 'text/plain',
            tenant: 'tenant-1',
          },
        ]}
        gridColumns={3}
        userId="user-1"
        entityId="entity-1"
        entityType="asset"
        isLoading={false}
      />
    );

    fireEvent.click(screen.getByTestId('doc-card'));

    await waitFor(() => {
      expect(screen.getByTestId('collab-editor')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(syncCollabSnapshot).toHaveBeenCalledWith('doc-1');
    });
  });

  it('falls back to the single-user editor when collab is unreachable', async () => {
    mockCollabStatus = null;
    vi.useFakeTimers();

    render(
      <Documents
        id="documents"
        documents={[
          {
            document_id: 'doc-1',
            document_name: 'Runbook',
            type_id: null,
            user_id: 'user-1',
            order_number: 0,
            created_by: 'user-1',
            type_name: 'text/plain',
            tenant: 'tenant-1',
          },
        ]}
        gridColumns={3}
        userId="user-1"
        entityId="entity-1"
        entityType="asset"
        isLoading={false}
      />
    );

    fireEvent.click(screen.getByTestId('doc-card'));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByTestId('fallback-editor')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('allows editing and saving in fallback mode', async () => {
    mockCollabStatus = null;
    mockFallbackUnsaved = true;
    mockFallbackContent = { type: 'doc', content: [{ type: 'paragraph' }] };
    vi.useFakeTimers();

    render(
      <Documents
        id="documents"
        documents={[
          {
            document_id: 'doc-1',
            document_name: 'Runbook',
            type_id: null,
            user_id: 'user-1',
            order_number: 0,
            created_by: 'user-1',
            type_name: 'text/plain',
            tenant: 'tenant-1',
          },
        ]}
        gridColumns={3}
        userId="user-1"
        entityId="entity-1"
        entityType="asset"
        isLoading={false}
      />
    );

    fireEvent.click(screen.getByTestId('doc-card'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByTestId('fallback-editor')).toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(updateBlockContent).toHaveBeenCalledWith('doc-1', expect.objectContaining({
      block_data: JSON.stringify(mockFallbackContent),
    }));

    vi.useRealTimers();
  });

  it('shows offline status indicator in fallback mode', async () => {
    mockCollabStatus = null;
    vi.useFakeTimers();

    render(
      <Documents
        id="documents"
        documents={[
          {
            document_id: 'doc-1',
            document_name: 'Runbook',
            type_id: null,
            user_id: 'user-1',
            order_number: 0,
            created_by: 'user-1',
            type_name: 'text/plain',
            tenant: 'tenant-1',
          },
        ]}
        gridColumns={3}
        userId="user-1"
        entityId="entity-1"
        entityType="asset"
        isLoading={false}
      />
    );

    fireEvent.click(screen.getByTestId('doc-card'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText('Offline — manual save mode')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('creates a new document and opens the collab editor', async () => {
    mockSearchParams = new URLSearchParams('folder=Root');

    render(
      <Documents
        id="documents"
        documents={[]}
        gridColumns={3}
        userId="user-1"
        isLoading={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'New Document' }));

    await waitFor(() => {
      expect(createBlockDocument).toHaveBeenCalled();
      expect(screen.getByTestId('collab-editor')).toBeInTheDocument();
    });
  });

  it('renders read-only viewer when document is not editable', async () => {
    render(
      <Documents
        id="documents"
        documents={[
          {
            document_id: 'doc-2',
            document_name: 'Policy',
            type_id: null,
            user_id: 'user-1',
            order_number: 0,
            created_by: 'user-1',
            type_name: 'application/pdf',
            tenant: 'tenant-1',
          },
        ]}
        gridColumns={3}
        userId="user-1"
        entityId="entity-1"
        entityType="asset"
        isLoading={false}
      />
    );

    fireEvent.click(screen.getByTestId('doc-card'));

    await waitFor(() => {
      expect(screen.getByTestId('viewer')).toBeInTheDocument();
    });
  });

  it('allows editing the document name in the drawer header', async () => {
    render(
      <Documents
        id="documents"
        documents={[
          {
            document_id: 'doc-3',
            document_name: 'Runbook',
            type_id: null,
            user_id: 'user-1',
            order_number: 0,
            created_by: 'user-1',
            type_name: 'text/plain',
            tenant: 'tenant-1',
          },
        ]}
        gridColumns={3}
        userId="user-1"
        entityId="entity-1"
        entityType="asset"
        isLoading={false}
      />
    );

    fireEvent.click(screen.getByTestId('doc-card'));

    const nameInput = await screen.findByPlaceholderText('Document Name *');
    fireEvent.change(nameInput, { target: { value: 'Updated Name' } });

    expect(nameInput).toHaveValue('Updated Name');
  });

  it('shows unsaved changes warning when closing in fallback mode', async () => {
    mockCollabStatus = null;
    mockFallbackUnsaved = true;
    vi.useFakeTimers();

    render(
      <Documents
        id="documents"
        documents={[
          {
            document_id: 'doc-4',
            document_name: 'Runbook',
            type_id: null,
            user_id: 'user-1',
            order_number: 0,
            created_by: 'user-1',
            type_name: 'text/plain',
            tenant: 'tenant-1',
          },
        ]}
        gridColumns={3}
        userId="user-1"
        entityId="entity-1"
        entityType="asset"
        isLoading={false}
      />
    );

    fireEvent.click(screen.getByTestId('doc-card'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('confirmation-dialog')).toHaveTextContent('Unsaved Changes');

    vi.useRealTimers();
  });
});
