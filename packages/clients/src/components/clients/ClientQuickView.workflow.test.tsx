// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ updateClient: vi.fn(async (_id: string, client: any) => client) }));

vi.mock('@alga-psa/tags/actions/tagActions', () => ({ findTagsByEntityId: vi.fn(async () => []) }));
vi.mock('@alga-psa/tags/actions/tagActionErrors', () => ({ isTagActionError: () => false }));
vi.mock('../../lib/usersHelpers', () => ({ getAllUsersBasicAsync: vi.fn(async () => []) }));
vi.mock('@shared/interfaces/user.interfaces', () => ({}));
vi.mock('@alga-psa/clients/actions/clientActions', () => ({
  deleteClient: vi.fn(), deleteClientLogo: vi.fn(), markClientActiveWithContacts: vi.fn(),
  markClientInactiveWithContacts: vi.fn(), recropClientLogo: vi.fn(), updateClient: (...args: any[]) => actions.updateClient(...args),
  uploadClientLogo: vi.fn(), validateClientDeletion: vi.fn(),
}));
vi.mock('@alga-psa/clients/actions/queryActions', () => ({ getContactsByClient: vi.fn(async () => []), getClientById: vi.fn(async () => null) }));
vi.mock('@alga-psa/clients/actions/clientInboundEmailDomainActions', () => ({
  addClientInboundEmailDomain: vi.fn(), listClientInboundEmailDomains: vi.fn(async () => []),
  removeClientInboundEmailDomain: vi.fn(), setClientInboundEmailDomainAutoCreateContacts: vi.fn(),
}));
vi.mock('@alga-psa/clients/actions/clientNameAliasActions', () => ({
  addClientNameAlias: vi.fn(), listClientNameAliases: vi.fn(async () => []), removeClientNameAlias: vi.fn(),
}));
vi.mock('@alga-psa/clients/actions/inboundTicketDestinationActions', () => ({ listInboundTicketDestinationOptions: vi.fn(async () => []) }));
vi.mock('@alga-psa/clients/actions/entraClientSyncActions', () => ({ startClientEntraSync: vi.fn() }));
vi.mock('../../context/ClientCrossFeatureContext', () => ({
  useClientCrossFeature: () => ({
    renderQuickAddTicket: ({ open, onOpenChange }: any) => open ? <button onClick={() => onOpenChange(false)}>Ticket form</button> : null,
    renderSurveySummaryCard: () => null,
    getSlaPolicies: vi.fn(async () => []),
    renderClientCoManagedIntegration: null,
  }),
}));
vi.mock('@alga-psa/ui', () => ({
  handleError: vi.fn(), useDrawer: () => ({}), DeleteEntityDialog: () => null,
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (e: any) => String(e), isActionMessageError: () => false, isActionPermissionError: () => false,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, options: any) => options?.defaultValue ?? _key }) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: () => ({ enabled: false }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@radix-ui/themes', () => ({ Heading: ({ children }: any) => <h1>{children}</h1> }));
vi.mock('./useEntraSyncPermission', () => ({ useEntraSyncPermission: () => ({ canManage: false }) }));
vi.mock('./ClientDetailsTabContent', () => ({
  ClientDetailsTabContent: (props: any) => <section>
    <button onClick={() => props.onFieldChange('client_name', 'Changed name')}>Edit client</button>
    <button onClick={props.onSave}>Save client</button>
    <button onClick={props.onManageLocations}>Manage locations</button>
    <button onClick={props.onAddTicket}>Add ticket</button>
  </section>,
}));
vi.mock('./ClientLocations', () => ({ default: () => <div>Client locations</div> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: ({ children }: any) => <div role="alert">{children}</div>, AlertDescription: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@alga-psa/ui/components/CustomTabs', () => ({ default: ({ tabs }: any) => <>{tabs.map((tab: any) => <div key={tab.id}>{tab.content}</div>)}</> }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title }: any) => isOpen ? <section aria-label={title}>{children}</section> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/EntityImageUpload', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/PrintButton', () => ({ PrintButton: () => null }));
vi.mock('@alga-psa/ui/components/Spinner', () => ({ default: () => <div role="status">Loading</div> }));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({ usePageSaveShortcut: vi.fn(), usePanelSubmitShortcut: vi.fn() }));
vi.mock('@alga-psa/ui/components/ModalityContext', () => ({ useInsideDrawer: () => true }));
vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({ ReflectionContainer: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/tags/components', () => ({ TagManager: () => null }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() }, toast: { success: vi.fn(), error: vi.fn() } }));

import ClientQuickView from './ClientQuickView';

describe('ClientQuickView project drawer workflows', () => {
  beforeEach(() => { actions.updateClient.mockClear(); });

  it('renders the full client quick view and keeps editing, location management, and ticket creation wired', async () => {
    const client = { client_id: 'client-1', client_name: 'Acme', client_type: 'company', properties: {} } as any;
    render(<ClientQuickView client={client} isInDrawer quickView />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit client' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save client' }));
    await waitFor(() => expect(actions.updateClient).toHaveBeenCalledWith('client-1', expect.objectContaining({ client_name: 'Changed name' })));

    fireEvent.click(screen.getByRole('button', { name: 'Manage locations' }));
    expect(screen.getByText('Client locations')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
    expect(screen.getByRole('button', { name: 'Ticket form' })).toBeTruthy();
  });
});
