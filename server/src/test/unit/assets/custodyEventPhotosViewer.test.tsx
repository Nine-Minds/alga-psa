// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocument, getDocumentThumbnailUrl } from '@alga-psa/documents/actions/documentActions';
import { CustodyEventPhotos } from '@alga-psa/msp-composition/assets/CustodyEventPhotos';

// Renders custody photos through the real Documents drawer; only its data
// sources and heavy editors are replaced.
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, any> | string) =>
      typeof options === 'string' ? options : (options?.defaultValue ?? key),
  }),
}));
vi.mock('@alga-psa/user-composition/hooks', () => ({ useUserPreference: () => ({ value: 'grid', setValue: vi.fn() }) }));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' }),
  searchUsersForMentions: vi.fn(),
}));
vi.mock('@alga-psa/tenancy/actions', () => ({ getExperimentalFeatures: vi.fn().mockResolvedValue({}) }));
vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getDocument: vi.fn(),
  getDocumentThumbnailUrl: vi.fn(),
  getDocumentsByEntity: vi.fn(),
  getDocumentsByFolder: vi.fn().mockResolvedValue({ documents: [], total: 0 }),
  moveDocumentsToFolder: vi.fn(),
  createFolder: vi.fn(),
  deleteDocument: vi.fn(),
  removeDocumentAssociations: vi.fn(),
  toggleDocumentVisibility: vi.fn(),
  updateDocument: vi.fn(),
  ensureEntityFolders: vi.fn().mockResolvedValue({ success: true }),
  getDocumentPreview: vi.fn().mockResolvedValue(null),
}));
vi.mock('@alga-psa/documents/actions/documentBlockContentActions', () => ({
  getBlockContent: vi.fn(),
  updateBlockContent: vi.fn(),
  createBlockDocument: vi.fn(),
}));
vi.mock('@alga-psa/documents/actions/collaborativeEditingActions', () => ({ syncCollabSnapshot: vi.fn() }));
vi.mock('@alga-psa/documents/components/DocumentStorageCard', () => ({ default: () => <div data-testid="doc-card" /> }));
vi.mock('@alga-psa/documents/components/CollaborativeEditor', () => ({ CollaborativeEditor: () => <div data-testid="collab-editor" /> }));
vi.mock('@alga-psa/documents/components/DocumentEditor', () => ({ DocumentEditor: () => <div data-testid="fallback-editor" /> }));
vi.mock('@alga-psa/ui/components/Drawer', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="drawer">{children}</div> : null,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

describe('custody event photos in the document viewer', () => {
  beforeAll(() => {
    window.IntersectionObserver ??= class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as unknown as typeof IntersectionObserver;
    window.matchMedia ??= ((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });
  beforeEach(() => { vi.mocked(getDocument).mockReset(); vi.mocked(getDocumentThumbnailUrl).mockReset(); });
  afterEach(() => cleanup());

  it('opens, closes and reopens Received and Moved custody photos without a document grid', async () => {
    vi.mocked(getDocument).mockImplementation(async (id: string) => ({
      document_id: id, document_name: `${id}.jpg`, file_id: `file-${id}`,
      mime_type: 'image/jpeg', preview_file_id: `preview-${id}`,
    } as any));
    vi.mocked(getDocumentThumbnailUrl).mockImplementation(async (id: string) => `/thumbnail/${id}`);
    render(<>
      <section aria-label="Received"><CustodyEventPhotos documentIds={['received']} /></section>
      <section aria-label="Moved"><CustodyEventPhotos documentIds={['moved']} /></section>
    </>);
    for (const id of ['received', 'moved']) {
      await waitFor(() => expect(document.querySelector(`img[src="/thumbnail/${id}"]`)).not.toBeNull());
      fireEvent.load(document.querySelector(`img[src="/thumbnail/${id}"]`)!);
      const button = await screen.findByRole('button', { name: `${id}.jpg` });
      for (let attempt = 0; attempt < 2; attempt++) {
        fireEvent.click(button);
        const images = await screen.findAllByRole('img', { name: `${id}.jpg` });
        expect(images).toHaveLength(2);
        expect(images[1]).toHaveAttribute('src', `/api/documents/${id}/preview`);
        expect(screen.queryByTestId('doc-card')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Close preview' })).not.toBeInTheDocument());
      }
    }
  });

  it('does not expose custody photos when document or thumbnail reads are refused', async () => {
    vi.mocked(getDocument).mockResolvedValue({ permissionError: 'denied' } as any);
    vi.mocked(getDocumentThumbnailUrl).mockResolvedValue('/thumbnail/secret');
    const { container } = render(<CustodyEventPhotos documentIds={['secret']} />);
    await waitFor(() => expect(getDocument).toHaveBeenCalledWith('secret'));
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});
