/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Documents from './Documents.tsx';
import { uploadDocument, getDocumentsByEntity } from '../actions/documentActions';

const mockRefresh = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, replace: mockReplace }),
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

vi.mock('@alga-psa/tenancy/actions', () => ({
  getExperimentalFeatures: vi.fn().mockResolvedValue({}),
}));

vi.mock('@alga-psa/storage', () => ({}));

vi.mock('@alga-psa/user-composition/actions', () => ({
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
  uploadDocument: vi.fn(),
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

// Documents.tsx imports './DocumentUpload' (extensionless) which Vite would
// resolve to the stale committed .jsx twin. Load the real .tsx explicitly so
// the batch-completion contract under test is the one being shipped.
vi.mock('./DocumentUpload', async () => {
  const actual = await vi.importActual<typeof import('./DocumentUpload.tsx')>('./DocumentUpload.tsx');
  return { default: actual.default };
});
vi.mock('./DocumentSelector', () => ({ default: () => null }));
vi.mock('./DocumentStorageCard', () => ({ default: () => null }));
vi.mock('./FolderTreeView', () => ({ default: () => null }));
vi.mock('./FolderManager', () => ({ default: () => null }));
vi.mock('./FolderSelectorModal', () => ({ default: () => null }));
vi.mock('./DocumentCredentialsSection', () => ({ DocumentCredentialsSection: () => null }));
vi.mock('./AssociatedEntityPicker', () => ({ default: () => null }));
vi.mock('./DocumentsPagination', () => ({ default: () => null }));
vi.mock('./DocumentListView', () => ({ default: () => null }));
vi.mock('./DocumentsPageSkeleton', () => ({ DocumentsGridSkeleton: () => null }));

vi.mock('./CollaborativeEditor', () => ({
  CollaborativeEditor: () => <div data-testid="collab-editor" />,
}));
vi.mock('./DocumentEditor', () => ({
  DocumentEditor: () => <div data-testid="fallback-editor" />,
}));
vi.mock('./DocumentViewer', () => ({ DocumentViewer: () => <div data-testid="viewer" /> }));

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
  AlertTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

const { toastError, toastFn } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastFn: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(toastFn, { success: vi.fn(), error: toastError }),
  toast: Object.assign(toastFn, { success: vi.fn(), error: toastError }),
}));

const makeDocument = (name: string) => ({
  document_id: `doc-${name}`,
  document_name: name,
  file_id: `file-${name}`,
});

const makeFile = (name: string) => new File(['data'], name, { type: 'application/pdf' });

const renderEntityDocuments = () => {
  const utils = render(
    <Documents
      id="documents"
      documents={[]}
      userId="user-1"
      entityId="ticket-1"
      entityType="ticket"
      forceUploadToRoot={true}
    />,
  );
  return utils;
};

const openUploaderAndSelect = async (
  container: HTMLElement,
  files: File[],
) => {
  const uploadButton = container.querySelector('#documents-upload-btn') as HTMLButtonElement;
  fireEvent.click(uploadButton);
  const input = await waitFor(() => {
    const el = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(el).toBeTruthy();
    return el;
  });
  fireEvent.change(input, { target: { files } });
};

const mockUpload = uploadDocument as unknown as {
  mockReset: () => void;
  mockResolvedValueOnce: (v: unknown) => void;
};

const mockEntityRefresh = getDocumentsByEntity as unknown as {
  mockReset: () => void;
  mockResolvedValue: (v: unknown) => void;
};

describe('Documents parent integration with batch uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpload.mockReset();
    mockEntityRefresh.mockReset();
    mockEntityRefresh.mockResolvedValue({ documents: [], totalCount: 0, totalPages: 0 });
    mockSearchParams = new URLSearchParams();
  });

  it('keeps a mixed batch mounted, retains the failure, and refreshes once for the success', async () => {
    mockUpload
      .mockResolvedValueOnce({ success: true, document: makeDocument('good.pdf') })
      .mockResolvedValueOnce({ success: false, error: 'Blocked MIME type' });
    const { container } = renderEntityDocuments();

    await openUploaderAndSelect(container, [makeFile('good.pdf'), makeFile('bad.eml')]);

    await waitFor(() => expect(screen.getByText('Blocked MIME type')).toBeInTheDocument());
    // Uploader is still mounted with both rows.
    expect(screen.getByText('good.pdf')).toBeInTheDocument();
    expect(screen.getByText('bad.eml')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    // Successes refreshed exactly once, and the uploader was not closed early.
    expect(mockEntityRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Browse Files/i })).toBeInTheDocument();
  });

  it('refreshes once and closes after an all-success batch', async () => {
    mockUpload
      .mockResolvedValueOnce({ success: true, document: makeDocument('a.pdf') })
      .mockResolvedValueOnce({ success: true, document: makeDocument('b.pdf') });
    const { container } = renderEntityDocuments();

    await openUploaderAndSelect(container, [makeFile('a.pdf'), makeFile('b.pdf')]);

    await waitFor(() => expect(mockEntityRefresh).toHaveBeenCalledTimes(1));
    // Both files completed before the uploader closed.
    expect(mockUpload).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Browse Files/i })).not.toBeInTheDocument(),
    );
  });

  it('keeps an all-failure batch mounted and does not refresh', async () => {
    mockUpload
      .mockResolvedValueOnce({ success: false, error: 'First failed' })
      .mockResolvedValueOnce({ success: false, error: 'Second failed' });
    const { container } = renderEntityDocuments();

    await openUploaderAndSelect(container, [makeFile('one.eml'), makeFile('two.xls')]);

    await waitFor(() => expect(screen.getByText('Second failed')).toBeInTheDocument());
    expect(screen.getByText('First failed')).toBeInTheDocument();
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockEntityRefresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Browse Files/i })).toBeInTheDocument();
  });

  it('holds the batch guard until a deferred parent refresh settles', async () => {
    let resolveRefresh: (value: unknown) => void = () => {};
    mockUpload
      .mockResolvedValueOnce({ success: true, document: makeDocument('good.pdf') })
      .mockResolvedValueOnce({ success: false, error: 'Blocked MIME type' });
    mockEntityRefresh.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRefresh = resolve; }),
    );
    const { container } = renderEntityDocuments();

    await openUploaderAndSelect(container, [makeFile('good.pdf'), makeFile('bad.eml')]);

    // The batch finished and the parent refresh is still pending.
    await waitFor(() => expect(mockEntityRefresh).toHaveBeenCalledTimes(1));
    expect(mockUpload).toHaveBeenCalledTimes(2);

    // A drop while finalizing must not start a second batch.
    const dropZone = container.querySelector('.border-dashed') as HTMLElement;
    fireEvent.drop(dropZone, { dataTransfer: { files: [makeFile('second.pdf')] } });
    // The file input is disabled during finalization too.
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { files: [makeFile('second.pdf')] } });

    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(toastFn).toHaveBeenCalledWith(
      'An upload is already in progress. Wait for it to finish before adding more files.',
    );

    await act(async () => {
      resolveRefresh({ documents: [], totalCount: 0, totalPages: 0 });
    });

    // The first batch's mixed outcome survives the parent refresh, and the
    // second batch never started.
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(screen.getByText('good.pdf')).toBeInTheDocument();
    expect(screen.getByText('bad.eml')).toBeInTheDocument();
    expect(screen.getByText('Blocked MIME type')).toBeInTheDocument();
    expect(screen.queryByText('second.pdf')).not.toBeInTheDocument();
  });

  it('reports a parent refresh failure with reload guidance without relabeling the file', async () => {
    mockUpload.mockResolvedValueOnce({ success: true, document: makeDocument('good.pdf') });
    mockEntityRefresh.mockRejectedValueOnce(new Error('network down'));
    const { container } = renderEntityDocuments();

    await openUploaderAndSelect(container, [makeFile('good.pdf')]);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      'Your files were uploaded, but the document list could not refresh. Reload the page to see them.',
    ));
    // The stored file is not relabeled as an upload failure, and the uploader
    // stays open rather than closing over a stale list.
    expect(screen.getByText('good.pdf')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Browse Files/i })).toBeInTheDocument();
  });
});
