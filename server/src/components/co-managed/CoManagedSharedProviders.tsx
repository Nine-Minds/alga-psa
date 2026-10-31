'use client';

import React, { useMemo, type ReactNode } from 'react';
import { DrawerOutlet } from '@alga-psa/ui';
import { useProduct } from '@/context/ProductContext';
import { DocumentsCrossFeatureProvider, type DocumentsCrossFeatureCallbacks } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { TicketIntegrationProvider, type TicketIntegrationContextType } from '@alga-psa/projects/context/TicketIntegrationContext';
import { ClientIntegrationProvider, type ClientIntegrationContextType } from '@alga-psa/projects/context/ClientIntegrationContext';
import { CoManagedReadOnlyProjectError } from '@/lib/co-managed/sharedProjectDataSource';

/**
 * The provider stack for the native project screen over a customer's SHARED project.
 *
 * `WorkspaceProviders` is deliberately not used here: every Msp* provider in it binds actions to the VIEWER's tenant
 * (documents, tickets, clients, assets, scheduling, activity), and the screen would call them with the customer's
 * project/task ids. Shared mode receives viewer-tenant data from nowhere, so each context the screen reads gets an inert
 * value instead: reads answer empty, mutators refuse loudly, renderers render nothing.
 *
 * Contexts the screen reads and why they need no value here:
 *  - ProjectBillingIntegration: nullable; ProjectDetail/ProjectInfo force it off in shared mode.
 *  - Scheduling callbacks: the default is inert and time entry is a native-only submit path.
 *  - Activity cross-feature: read through `useOptionalActivityCrossFeature`, null without a provider.
 *  - Drawer state: mounted by DefaultLayout; only the outlet is mounted below.
 */
const refuse = (name: string) => () => { throw new CoManagedReadOnlyProjectError('documents', name); };
const none = () => null;

// LEVERAGE: pattern inert-context-value — a cross-feature context needing a hand-written all-empty/refuse-loudly value for a non-native source (documents, ticket, client); a context-level "unavailable" factory would replace these.
export const SHARED_DOCUMENTS_CROSS_FEATURE: DocumentsCrossFeatureCallbacks = Object.freeze({
  renderDocumentViewer: none,
  renderDocuments: none,
  renderDocumentUpload: none,
  renderDocumentSelector: none,
  renderFolderSelectorModal: none,
  renderDocumentStorageCard: none,
  downloadDocument: refuse('downloadDocument') as never,
  getDocumentDownloadUrl: refuse('getDocumentDownloadUrl') as never,
  getDocumentsByEntity: async () => [],
  // Same shape the native action returns: a Map of entity id -> count. Empty means "no counts to show".
  getDocumentCountsForEntities: async () => new Map<string, number>(),
  getDocumentsByContractId: async () => [],
  getDocumentByTicketId: async () => [],
  getImageUrl: refuse('getImageUrl') as never,
  createDocumentAssociations: refuse('createDocumentAssociations') as never,
  removeDocumentAssociations: refuse('removeDocumentAssociations') as never,
  deleteDocument: refuse('deleteDocument') as never,
  updateDocument: refuse('updateDocument') as never,
  getBlockContent: refuse('getBlockContent') as never,
  updateBlockContent: refuse('updateBlockContent') as never,
  downloadDocumentInBrowser: refuse('downloadDocumentInBrowser') as never,
  uploadDocument: refuse('uploadDocument') as never,
  createBlockDocument: refuse('createBlockDocument') as never,
  ensureEntityFolders: refuse('ensureEntityFolders') as never,
});

export const SHARED_TICKET_INTEGRATION: TicketIntegrationContextType = Object.freeze({
  getTicketsForList: async () => [],
  getConsolidatedTicketData: async () => null,
  getTicketCategories: async () => [],
  getAllBoards: async () => [],
  deleteTicket: async () => { throw new CoManagedReadOnlyProjectError('tickets', 'deleteTicket'); },
  renderQuickAddTicket: none,
  openTicketInDrawer: async () => { throw new CoManagedReadOnlyProjectError('tickets', 'openTicketInDrawer'); },
  renderCategoryPicker: none,
  // Priority is not a shared field: the form hides it in shared mode.
  renderPrioritySelect: none,
});

export const SHARED_CLIENT_INTEGRATION: ClientIntegrationContextType = Object.freeze({
  getContactsByClient: async () => [],
  getAllContacts: async () => [],
  getContactByContactNameId: async () => null,
  renderQuickAddContact: none,
  renderQuickAddClient: none,
  renderClientDetails: none,
});

export default function CoManagedSharedProviders({ children }: { children: ReactNode }) {
  const { isAlgaDesk } = useProduct();
  // AlgaDesk mounts one DrawerOutlet in its shell; a second would render every drawer twice (see WorkspaceProviders).
  const outlet = useMemo(() => (isAlgaDesk ? null : <DrawerOutlet />), [isAlgaDesk]);
  return (
    <DocumentsCrossFeatureProvider value={SHARED_DOCUMENTS_CROSS_FEATURE}>
      <TicketIntegrationProvider value={SHARED_TICKET_INTEGRATION}>
        <ClientIntegrationProvider value={SHARED_CLIENT_INTEGRATION}>
          {children}
          {outlet}
        </ClientIntegrationProvider>
      </TicketIntegrationProvider>
    </DocumentsCrossFeatureProvider>
  );
}
