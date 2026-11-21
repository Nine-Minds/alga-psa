// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  loadClient: vi.fn(async (_id?: string, _projectId?: string) => null),
  updateClient: vi.fn(async (_id: string, patch: any, _projectId?: string) => ({ client_id: _id, ...patch })),
  loadClientQuickView: vi.fn(),
  updateClientQuickView: vi.fn(),
  loadClientQuickViewLocations: vi.fn(async () => []),
  updateClientQuickViewLocation: vi.fn(async () => undefined),
  getUnrestrictedLocations: vi.fn(async () => { throw new Error('quick-view must not use the unrestricted location action'); }),
  getSlaPolicies: vi.fn(async () => []),
  startEntraSync: vi.fn(),
  entraFeatureEnabled: false,
  entraCanManage: false,
  toast: vi.fn(),
  translate: (_key: string, options: any) => typeof options === 'string' ? options : options?.defaultValue ?? _key,
}));

vi.mock('@alga-psa/tags/actions/tagActions', () => ({ findTagsByEntityId: vi.fn(async () => []) }));
vi.mock('@alga-psa/tags/actions/tagActionErrors', () => ({ isTagActionError: () => false }));
vi.mock('../../lib/usersHelpers', () => ({ getAllUsersBasicAsync: vi.fn(async () => []) }));
vi.mock('@shared/interfaces/user.interfaces', () => ({}));
vi.mock('@alga-psa/clients/actions/clientActions', () => ({
  deleteClient: vi.fn(), deleteClientLogo: vi.fn(), markClientActiveWithContacts: vi.fn(),
  markClientInactiveWithContacts: vi.fn(), recropClientLogo: vi.fn(),
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
vi.mock('@alga-psa/clients/actions', () => ({
  getClientLocations: (...args: any[]) => actions.getUnrestrictedLocations(...args),
  createClientLocation: vi.fn(), updateClientLocation: vi.fn(), deleteClientLocation: vi.fn(), setDefaultClientLocation: vi.fn(),
  getAllCountries: vi.fn(async () => [{ code: 'US', name: 'United States' }]),
  getTenantDefaultCountry: vi.fn(async () => ({ code: 'US', name: 'United States' })),
}));
vi.mock('../../lib/billingHelpers', () => ({ getActiveTaxRegionsAsync: vi.fn(async () => []) }));
vi.mock('@alga-psa/clients/actions/clientBillingProfileActions', () => ({ getClientBillingProfiles: vi.fn(async () => []) }));
vi.mock('@alga-psa/clients/actions/entraClientSyncActions', () => ({ startClientEntraSync: (...args: any[]) => actions.startEntraSync(...args) }));
vi.mock('../../context/ClientCrossFeatureContext', () => ({
  useClientCrossFeature: () => ({
    loadClientQuickView: actions.loadClientQuickView,
    updateClientQuickView: actions.updateClientQuickView,
    loadClientQuickViewLocations: actions.loadClientQuickViewLocations,
    updateClientQuickViewLocation: actions.updateClientQuickViewLocation,
    renderQuickAddTicket: ({ open, onOpenChange }: any) => open ? <button onClick={() => onOpenChange(false)}>Ticket form</button> : null,
    renderSurveySummaryCard: () => null,
    getSlaPolicies: actions.getSlaPolicies,
    renderClientCoManagedIntegration: null,
  }),
}));
vi.mock('@alga-psa/ui', () => ({
  handleError: vi.fn(), useDrawer: () => ({}), DeleteEntityDialog: () => null, useToast: () => ({ toast: actions.toast }),
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (e: any) => String(e), isActionMessageError: () => false, isActionPermissionError: () => false,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: actions.translate }) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: () => ({ enabled: actions.entraFeatureEnabled }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@radix-ui/themes', () => ({ Heading: ({ children }: any) => <h1>{children}</h1> }));
vi.mock('./useEntraSyncPermission', () => ({ useEntraSyncPermission: () => ({ canManage: actions.entraCanManage }) }));
vi.mock('./ClientDetailsTabContent', async () => {
  const { default: QuickViewLocations } = await import('./ClientLocations');
  return {
    ClientDetailsTabContent: (props: any) => <section>
      <output data-testid="client-data">{JSON.stringify(props.editedClient)}</output>
      <button onClick={() => props.onFieldChange('client_name', 'Changed name')}>Edit client</button>
      <button onClick={props.onSave}>Save client</button>
      <button onClick={props.onManageLocations}>Manage locations</button>
      <button onClick={props.onAddTicket}>Add ticket</button>
      <QuickViewLocations
        clientId={props.editedClient.client_id}
        isEditing={false}
        loadLocations={props.loadQuickViewLocations}
        updateLocation={props.updateQuickViewLocation}
      />
    </section>,
  };
});
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
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: () => ({ automationIdProps: {}, updateMetadata: vi.fn() }) }));
vi.mock('@alga-psa/tags/components', () => ({ TagManager: () => null }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() }, toast: { success: vi.fn(), error: vi.fn() } }));

import ClientQuickView from './ClientQuickView';

function renderQuickView(client: any) {
  return render(<ClientQuickView client={client} isInDrawer quickView sourceProjectId="project-1" />);
}

describe('ClientQuickView project drawer workflows', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    cleanup();
    actions.loadClient.mockReset();
    actions.updateClient.mockReset().mockImplementation(async (_id: string, patch: any, _projectId?: string) => ({ client_id: _id, ...patch }));
    actions.loadClientQuickView.mockReset().mockImplementation((clientId: string, sourceProjectId?: string) => actions.loadClient(clientId, sourceProjectId));
    actions.updateClientQuickView.mockReset().mockImplementation((clientId: string, patch: any, sourceProjectId?: string) => actions.updateClient(clientId, patch, sourceProjectId));
    actions.loadClientQuickViewLocations.mockReset().mockResolvedValue([{
      location_id: 'location-1', client_id: 'client-1', location_name: 'HQ', email: null, phone: null,
      address_line1: null, city: null, is_active: true, is_default: true,
    }]);
    actions.updateClientQuickViewLocation.mockReset().mockResolvedValue(undefined);
    actions.startEntraSync.mockReset();
    actions.entraFeatureEnabled = false;
    actions.entraCanManage = false;
  });

  it('renders the full client quick view and keeps editing, location management, and ticket creation wired', async () => {
    const client = { client_id: 'client-1', client_name: 'Acme', client_type: 'company', properties: {}, tax_id_number: null } as any;
    renderQuickView(client);

    fireEvent.click(screen.getByRole('button', { name: 'Edit client' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save client' }));
    await waitFor(() => expect(actions.updateClient).toHaveBeenCalledWith('client-1', { client_name: 'Changed name' }, 'project-1'));

    expect(await screen.findByText('HQ')).toBeTruthy();
    expect(actions.loadClientQuickViewLocations).toHaveBeenCalledWith('client-1', 'project-1');
    expect(actions.getUnrestrictedLocations).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Manage locations' }));
    expect(await screen.findByRole('button', { name: 'Add Location' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('SECRET-EMAIL');
    expect(document.body.textContent).not.toContain('SECRET-PHONE');
    expect(document.body.textContent).not.toContain('SECRET-ADDRESS');
    expect(actions.loadClientQuickViewLocations.mock.calls.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: 'Add ticket' }));
    expect(screen.getByRole('button', { name: 'Ticket form' })).toBeTruthy();
  });

  it('keeps a redacted field out of the patch and uses the masked mutation response', async () => {
    actions.updateClient.mockResolvedValueOnce({
      client_id: 'client-1', client_name: 'Changed name', properties: {}, tax_id_number: null,
    });
    renderQuickView({ client_id: 'client-1', client_name: 'Acme', properties: {}, tax_id_number: null } as any);

    fireEvent.click(screen.getByRole('button', { name: 'Edit client' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save client' }));
    await waitFor(() => expect(actions.updateClient).toHaveBeenCalled());
    expect(actions.updateClient.mock.calls[0][1]).toEqual({ client_name: 'Changed name' });
    expect(screen.getByTestId('client-data').textContent).not.toContain('SECRET-TAX');
  });

  it('loads details through the authorization boundary when mounted by ID', async () => {
    actions.loadClient.mockImplementation(async () => ({
      client_id: 'client-1', client_name: 'Acme', properties: {}, tax_id_number: null,
    } as any));
    render(<ClientQuickView clientId="client-1" isInDrawer quickView sourceProjectId="project-1" />);

    await waitFor(() => expect(actions.loadClient).toHaveBeenCalledWith('client-1', 'project-1'));
    expect(screen.getByTestId('client-data').textContent).toContain('Acme');
    expect(screen.getByTestId('client-data').textContent).not.toContain('SECRET-TAX');
  });

  it('clears cached details when save reauthorization denies the source project', async () => {
    actions.updateClient.mockRejectedValueOnce(new Error('Permission denied: Cannot read project client'));
    renderQuickView({ client_id: 'client-1', client_name: 'Acme', properties: {} } as any);

    fireEvent.click(screen.getByRole('button', { name: 'Edit client' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save client' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Failed to load client details');
    expect(screen.queryByTestId('client-data')).toBeNull();
  });

  it('uses the authorized loader on refresh and clears cached details when access is revoked', async () => {
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
    actions.entraFeatureEnabled = true;
    actions.entraCanManage = true;
    actions.startEntraSync.mockResolvedValue({ success: true, data: { workflowId: 'run-1' } });
    actions.loadClient.mockRejectedValue(new Error('Permission denied: Cannot read project client'));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'completed' }) })));
    renderQuickView({
      client_id: 'client-1', client_name: 'Acme', properties: {}, entra_tenant_id: 'entra-tenant-1', tax_id_number: null,
    } as any);

    fireEvent.click(screen.getByRole('button', { name: 'Sync Entra Now' }));
    await waitFor(() => expect(actions.startEntraSync).toHaveBeenCalled());
    await waitFor(() => expect(actions.loadClient).toHaveBeenCalledWith('client-1', 'project-1'), { timeout: 6000 });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('client-data')).toBeNull();
  }, 8000);
});
