/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Documents from './Documents.tsx';

const mockRefresh = vi.fn();
const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    replace: mockReplace,
  }),
  useSearchParams: () => new URLSearchParams(),
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
vi.mock('./FolderTreeView', () => ({ default: () => null }));
vi.mock('./FolderManager', () => ({ default: () => null }));
vi.mock('./FolderSelectorModal', () => ({ default: () => null }));
vi.mock('./DocumentsPagination', () => ({ default: () => null }));
vi.mock('./DocumentListView', () => ({ default: () => null }));
vi.mock('./DocumentsPageSkeleton', () => ({ DocumentsGridSkeleton: () => null }));

vi.mock('./CollaborativeEditor', () => ({
  CollaborativeEditor: () => <div data-testid="collab-editor" />,
}));

vi.mock('./DocumentEditor', () => ({
  DocumentEditor: () => <div data-testid="fallback-editor" />,
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
  ConfirmationDialog: () => null,
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
});
