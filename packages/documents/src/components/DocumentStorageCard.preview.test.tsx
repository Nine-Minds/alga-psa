/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { IDocument } from '@alga-psa/types';
import DocumentStorageCard from './DocumentStorageCard.tsx';
import { getDocumentPreview } from '../actions/documentActions';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, any> | string) =>
      typeof options === 'string' ? options : (options?.defaultValue ?? _key),
  }),
}));
vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui', () => ({ DeleteEntityDialog: () => null }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@alga-psa/ui/components/Spinner', () => ({ default: () => <div>Loading...</div> }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({ preCheckDeletion: vi.fn() }));
vi.mock('@alga-psa/documents/lib/documentUtils', () => ({
  getDocumentDownloadUrl: vi.fn(() => '/download'),
  downloadDocument: vi.fn(),
}));
vi.mock('../actions/documentActions', () => ({ getDocumentPreview: vi.fn() }));

function buildDocument(overrides: Partial<IDocument> = {}): IDocument {
  return {
    tenant: 'tenant-1',
    document_id: 'doc-1',
    document_name: 'photo.png',
    mime_type: 'image/png',
    file_id: 'file-1',
    type_id: null,
    user_id: 'user-1',
    order_number: 1,
    created_by: 'user-1',
    is_client_visible: false,
    updated_at: new Date(),
    ...overrides,
  } as IDocument;
}

describe('DocumentStorageCard background preview', () => {
  beforeAll(() => {
    // Every observed card is immediately "in view".
    window.IntersectionObserver = class {
      constructor(private cb: (entries: any[]) => void) {}
      observe() { this.cb([{ isIntersecting: true }]); }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the placeholder and never calls getDocumentPreview while the preview is pending', async () => {
    render(<DocumentStorageCard id="card" document={buildDocument()} hideActions />);
    await waitFor(() => expect(screen.getByTestId('document-preview-placeholder')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'photo.png' })).not.toBeInTheDocument();
    expect(getDocumentPreview).not.toHaveBeenCalled();
  });

  it('switches to the stored preview when preview_file_id arrives', async () => {
    const { rerender } = render(<DocumentStorageCard id="card" document={buildDocument()} hideActions />);
    await screen.findByTestId('document-preview-placeholder');

    rerender(
      <DocumentStorageCard
        id="card"
        document={buildDocument({ preview_file_id: 'preview-1', thumbnail_file_id: 'thumb-1', preview_generated_at: new Date() })}
        hideActions
      />
    );

    const img = await screen.findByAltText('photo.png');
    expect(img.getAttribute('src')).toMatch(/^\/api\/documents\/doc-1\/preview/);
    expect(screen.queryByTestId('document-preview-placeholder')).not.toBeInTheDocument();
    expect(getDocumentPreview).not.toHaveBeenCalled();
  });

  it('replaces an already-loaded legacy preview when preview_file_id appears', async () => {
    const old = buildDocument({ updated_at: new Date(0) });
    (getDocumentPreview as any).mockResolvedValue({ previewImage: 'data:image/png;base64,AAAA' });
    const { rerender } = render(<DocumentStorageCard id="card" document={old} hideActions />);
    const img = await screen.findByAltText('photo.png');
    expect(img.getAttribute('src')).toMatch(/^data:image/);

    rerender(<DocumentStorageCard id="card" document={{ ...old, preview_file_id: 'preview-1' }} hideActions />);
    await waitFor(() =>
      expect(screen.getByAltText('photo.png').getAttribute('src')).toMatch(/^\/api\/documents\/doc-1\/preview/)
    );
  });
});
