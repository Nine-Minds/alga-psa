/** @vitest-environment jsdom */
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import Documents from '@alga-psa/documents/components/Documents.tsx';
import TicketDocumentsSection from '@alga-psa/tickets/components/ticket/TicketDocumentsSection.tsx';

// Composition belongs in server: Documents must not depend on Tickets, even in tests.
// Keep the section, Documents prop synchronization and storage cards real.
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    getDocumentByTicketId: vi.fn().mockResolvedValue([]),
    renderDocuments: (props: React.ComponentProps<typeof Documents>) => <Documents {...props} gridColumns={3} />,
  }),
}));
vi.mock('@alga-psa/ui/components', () => ({ useContentCardVariant: () => 'default' }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown> | string) =>
      typeof options === 'string' ? options : (options?.defaultValue ?? key),
  }),
}));
vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUserPreference: () => ({ value: 'grid', setValue: vi.fn() }),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' }),
  searchUsersForMentions: vi.fn(),
}));
vi.mock('@alga-psa/documents/actions/documentActions', () => ({
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
vi.mock('@alga-psa/documents/actions/documentBlockContentActions', () => ({
  getBlockContent: vi.fn(), updateBlockContent: vi.fn(), createBlockDocument: vi.fn(),
}));
vi.mock('@alga-psa/documents/actions/collaborativeEditingActions', () => ({ syncCollabSnapshot: vi.fn() }));
// Select the source component even when local package builds left .jsx siblings.
vi.mock('@alga-psa/documents/components/DocumentStorageCard', () =>
  vi.importActual('@alga-psa/documents/components/DocumentStorageCard.tsx'));
vi.mock('@alga-psa/documents/components/DocumentUpload', () => ({ default: () => null }));
vi.mock('@alga-psa/documents/components/DocumentSelector', () => ({ default: () => null }));
vi.mock('@alga-psa/documents/components/FolderTreeView', () => ({ default: () => null }));
vi.mock('@alga-psa/documents/components/FolderManager', () => ({ default: () => null }));
vi.mock('@alga-psa/documents/components/FolderSelectorModal', () => ({ default: () => null }));
vi.mock('@alga-psa/documents/components/DocumentsPagination', () => ({ default: () => null }));
vi.mock('@alga-psa/documents/components/DocumentListView', () => ({ default: () => null }));
vi.mock('@alga-psa/documents/components/DocumentsPageSkeleton', () => ({ DocumentsGridSkeleton: () => null }));
vi.mock('@alga-psa/documents/components/CollaborativeEditor', () => ({ CollaborativeEditor: () => null }));
vi.mock('@alga-psa/documents/components/DocumentEditor', () => ({ DocumentEditor: () => null }));
vi.mock('@alga-psa/documents/components/DocumentViewer', () => ({ DocumentViewer: () => null }));
vi.mock('@alga-psa/documents/components/DocumentCredentialsSection', () => ({ DocumentCredentialsSection: () => null }));
vi.mock('@alga-psa/ui/components/Drawer', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => cleanup());

describe('Ticket document metadata composition', () => {
  it('passes same-ID metadata through the ticket Documents section into the rendered card', async () => {
    const document = {
      document_id: 'same-id', document_name: 'attachment.pdf', file_id: 'file-1',
      tenant: 'tenant-1', type_id: null, user_id: 'user-1', created_by: 'user-1',
      order_number: 0, is_client_visible: true, comment_attachment_is_public: false,
    };
    const { rerender } = render(<TicketDocumentsSection ticketId="ticket-1" initialDocuments={[document]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hidden from clients' })).toBeDisabled());
    rerender(<TicketDocumentsSection ticketId="ticket-1" initialDocuments={[{ ...document, comment_attachment_is_public: true }]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Visible to clients' })).toBeEnabled());
    expect(screen.getByText('Client visible')).toBeInTheDocument();
    rerender(<TicketDocumentsSection ticketId="ticket-1" initialDocuments={[document]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hidden from clients' })).toBeDisabled());
    expect(screen.getByText('Internal')).toBeInTheDocument();
  });

});
