/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Documents from './Documents.tsx';
import { syncCollabSnapshot } from '../actions/collaborativeEditingActions';
import { updateBlockContent, createBlockDocument } from '../actions/documentBlockContentActions';
import { getDocumentsByFolder, getDocumentsByEntity, updateDocument, deleteDocument } from '../actions/documentActions';

const mockRefresh = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();
let mockRealStorageCards = false;
let mockTreeMounts = 0;
const mockFolderTreeView = vi.fn((props: { selectedFolder: string | null; entityId?: string; entityType?: string }) => (
  <div
    data-testid="folder-tree-view"
    data-selected-folder={props.selectedFolder ?? ''}
    data-entity-id={props.entityId ?? ''}
    data-entity-type={props.entityType ?? ''}
  />
));

// DocumentCredentialsSection reaches useFeatureFlag, which calls useSession.
// The drawer is rendered bare here, with no SessionProvider above it.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

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

vi.mock('@alga-psa/user-composition/hooks', () => ({
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
  ensureEntityFolders: vi.fn().mockResolvedValue({ success: true }),
  getDocumentPreview: vi.fn().mockResolvedValue(null),
}));

vi.mock('../actions/documentBlockContentActions', () => ({
  getBlockContent: vi.fn(),
  updateBlockContent: vi.fn(),
  createBlockDocument: vi.fn().mockResolvedValue({ document_id: 'doc-1', content_id: 'content-1' }),
}));

vi.mock('../actions/collaborativeEditingActions', () => ({
  syncCollabSnapshot: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('./DocumentStorageCard', async () => {
  const { default: RealStorageCard } = await vi.importActual<typeof import('./DocumentStorageCard')>('./DocumentStorageCard.tsx');
  return { default: (props: any) => mockRealStorageCards ? <RealStorageCard {...props} /> : (
    <button data-testid="doc-card" onClick={props.onClick}>
      {props.document.document_name}
    </button>
  ) };
});

vi.mock('./DocumentUpload', () => ({ default: () => null }));
vi.mock('./DocumentSelector', () => ({ default: () => null }));
vi.mock('./FolderTreeView', () => ({
  default: function FolderTreeViewMock(props: { selectedFolder: string | null; entityId?: string; entityType?: string }) {
    React.useEffect(() => { mockTreeMounts += 1; }, []);
    return mockFolderTreeView(props);
  },
}));
vi.mock('./FolderManager', () => ({ default: () => null }));
vi.mock('./FolderSelectorModal', () => ({
  default: (props: { isOpen: boolean; onSelectFolder: (p: string | null) => void }) =>
    props.isOpen ? <button data-testid="pick-folder" onClick={() => props.onSelectFolder(null)}>Pick</button> : null,
}));
vi.mock('./DocumentsPagination', () => ({ default: () => null }));
vi.mock('./DocumentListView', () => ({ default: () => null }));
vi.mock('./DocumentsPageSkeleton', () => ({ DocumentsGridSkeleton: () => null }));

let mockCollabStatus: string | null = 'connected';
let mockFallbackUnsaved = false;
let mockFallbackContent: Record<string, any> | null = null;

vi.mock('./CollaborativeEditor', () => ({
  CollaborativeEditor: function CollaborativeEditorMock(props: { onConnectionStatusChange?: (status: string) => void }) {
    React.useEffect(() => {
      if (mockCollabStatus) {
        props.onConnectionStatusChange?.(mockCollabStatus);
      }
    }, [props.onConnectionStatusChange]);
    return <div data-testid="collab-editor" />;
  },
}));

vi.mock('./DocumentEditor', () => ({
  DocumentEditor: function DocumentEditorMock({
    onUnsavedChangesChange,
    onContentChange,
  }: {
    onUnsavedChangesChange?: (hasChanges: boolean) => void;
    onContentChange?: (content: Record<string, any> | null) => void;
  }) {
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


const NEW_DOC = {
  document_id: 'new-doc-1', document_name: 'Untitled Document', type_id: null,
  user_id: 'user-1', order_number: 0, created_by: 'user-1', type_name: 'text/plain', tenant: 'tenant-1',
};
const EXISTING_DOC = { ...NEW_DOC, document_id: 'doc-1', document_name: 'Runbook' };
const entityProps = { id: 'documents', gridColumns: 3, userId: 'user-1', entityId: 'entity-1', entityType: 'asset' as const, isLoading: false };
const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe('Documents list refresh after drawer save', () => {
  beforeAll(() => {
    window.IntersectionObserver ??= class {
      observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
    } as unknown as typeof IntersectionObserver;
    window.matchMedia ??= ((query: string) => ({
      matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockTreeMounts = 0;
    mockCollabStatus = 'connected';
    mockFallbackUnsaved = false;
    mockFallbackContent = null;
    mockSearchParams = new URLSearchParams();
    asMock(createBlockDocument).mockResolvedValue({ document_id: 'new-doc-1', content_id: 'c-1' });
    asMock(syncCollabSnapshot).mockResolvedValue({ success: true });
    asMock(updateBlockContent).mockResolvedValue({ success: true });
    asMock(updateDocument).mockResolvedValue({ success: true });
    asMock(deleteDocument).mockResolvedValue({ success: true });
    // Entity mode never fetches on mount (rows come from the `documents` prop, here empty),
    // so every getDocumentsByEntity call is a post-save refetch and must return the new row.
    asMock(getDocumentsByEntity)
      .mockResolvedValue({ documents: [NEW_DOC], totalCount: 1, totalPages: 1 });
    asMock(getDocumentsByFolder).mockResolvedValue({ documents: [], total: 0 });
  });

  async function startNewDocument() {
    fireEvent.click(screen.getByRole('button', { name: /Add document/ }));
    fireEvent.click(await screen.findByTestId('pick-folder'));
    await waitFor(() => expect(screen.getByTestId('collab-editor')).toBeInTheDocument());
  }

  it('shows a new document in the list after saving via the collaborative snapshot path', async () => {
    const onDocumentCreated = vi.fn();
    render(<Documents {...entityProps} documents={[]} onDocumentCreated={onDocumentCreated} />);
    await startNewDocument();
    expect(createBlockDocument).toHaveBeenCalled();
    asMock(getDocumentsByEntity).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(syncCollabSnapshot).toHaveBeenCalledWith('new-doc-1'));
    await waitFor(() => expect(getDocumentsByEntity).toHaveBeenCalled());
    expect(await screen.findByText('Untitled Document')).toBeInTheDocument();
    expect(onDocumentCreated).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('drawer')).not.toBeInTheDocument());
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('still closes the drawer when the refetch fails after a successful save', async () => {
    render(<Documents {...entityProps} documents={[]} />);
    await startNewDocument();
    asMock(getDocumentsByEntity).mockReset().mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByTestId('drawer')).not.toBeInTheDocument());
    expect(getDocumentsByEntity).toHaveBeenCalled();
  });

  it('refetches after the fallback save path', async () => {
    mockCollabStatus = null;
    mockFallbackUnsaved = true;
    mockFallbackContent = { type: 'doc', content: [{ type: 'paragraph' }] };
    vi.useFakeTimers();
    try {
      render(<Documents {...entityProps} documents={[EXISTING_DOC]} />);
      fireEvent.click(screen.getByTestId('doc-card'));
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(screen.getByTestId('fallback-editor')).toBeInTheDocument();
      await act(async () => { await Promise.resolve(); });

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });

      expect(updateBlockContent).toHaveBeenCalled();
      expect(getDocumentsByEntity).toHaveBeenCalled();
      expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refetches after renaming an existing document', async () => {
    render(<Documents {...entityProps} documents={[EXISTING_DOC]} />);
    fireEvent.click(screen.getByTestId('doc-card'));
    await waitFor(() => expect(screen.getByTestId('collab-editor')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('Runbook'), { target: { value: 'Renamed' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateDocument).toHaveBeenCalledWith('doc-1', expect.objectContaining({ document_name: 'Renamed' })));
    await waitFor(() => expect(getDocumentsByEntity).toHaveBeenCalled());
  });

  it('refetches after the pre-created document is deleted on cancel, delete first', async () => {
    const order: string[] = [];
    asMock(deleteDocument).mockImplementation(async () => { order.push('delete'); return { success: true }; });
    asMock(getDocumentsByEntity).mockReset().mockImplementation(async () => {
      order.push('fetch');
      return { documents: [], totalCount: 0, totalPages: 1 };
    });
    render(<Documents {...entityProps} documents={[]} />);
    await startNewDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(order).toEqual(['delete', 'fetch']));
  });

  it('bumps the folder tree after a save in folder mode', async () => {
    render(<Documents id="documents" gridColumns={3} userId="user-1" documents={[]} isLoading={false} />);
    await waitFor(() => expect(mockTreeMounts).toBeGreaterThan(0));
    await startNewDocument();
    await waitFor(() => expect(mockTreeMounts).toBeGreaterThan(1)); // bumped on pre-create
    const afterCreate = mockTreeMounts;
    asMock(getDocumentsByFolder).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(getDocumentsByFolder).toHaveBeenCalled());
    await waitFor(() => expect(mockTreeMounts).toBeGreaterThan(afterCreate));
  });
});
