// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DrawerProvider, useDrawer } from '@alga-psa/ui';
import { useClientCrossFeature, useOptionalClientCrossFeature } from '@alga-psa/clients/context/ClientCrossFeatureContext';
import OverallInteractionsFeed from '../../../../../packages/clients/src/components/interactions/OverallInteractionsFeed';
import CoManagedCustomerShell from '@/components/co-managed/CoManagedCustomerShell';
import WorkspaceProviders from '@/components/layout/WorkspaceProviders';

const mocks = vi.hoisted(() => ({
  getInteractionsPage: vi.fn(),
  getAllInteractionTypes: vi.fn(),
  getInteractionStatuses: vi.fn(),
  getUserAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getInteractionsPage: mocks.getInteractionsPage,
  getAllInteractionTypes: mocks.getAllInteractionTypes,
  getInteractionStatuses: mocks.getInteractionStatuses,
}));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction: mocks.getUserAvatarUrlsBatchAction,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (_key: string, options?: { defaultValue?: string; [key: string]: unknown }) => {
    let value = options?.defaultValue ?? _key;
    for (const [name, replacement] of Object.entries(options ?? {})) {
      value = value.replace(`{{${name}}}`, String(replacement));
    }
    return value;
  };
  return { useTranslation: () => ({ t }) };
});
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ containerClassName: _containerClassName, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { containerClassName?: string }) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: (props: Record<string, any>) => (
    <div data-testid="interaction-data-table">
      {props.data.map((row: Record<string, any>) => (
        <React.Fragment key={row.interaction_id}>
          {props.columns.find((column: Record<string, any>) => column.dataIndex === 'title')?.render(row.title, row)}
        </React.Fragment>
      ))}
      {props.hasMorePages && <button onClick={() => props.onPageChange(props.currentPage + 1)}>Next</button>}
      {props.currentPage > 1 && <button onClick={() => props.onPageChange(props.currentPage - 1)}>Previous</button>}
    </div>
  ),
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id }: { id?: string }) => <div id={id} /> }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => <div /> }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => <div /> }));
vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({ DateTimePicker: ({ id }: { id?: string }) => <div id={id} /> }));
vi.mock('@alga-psa/ui/components/InteractionIcon', () => ({ default: () => <span /> }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => <div /> }));
vi.mock('@alga-psa/ui/components/ClientAvatar', () => ({ default: () => <span /> }));
vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({ default: () => <span /> }));
vi.mock('@alga-psa/ui/components/UserAvatar', () => ({ default: () => <span /> }));
vi.mock('@alga-psa/clients/components/interactions/InteractionDetails', async () => {
  const { useClientCrossFeature: useCrossFeature } = await import('@alga-psa/clients/context/ClientCrossFeatureContext');
  return {
    default: function InteractionDetailsProbe() {
      const { renderQuickAddTicket } = useCrossFeature();
      return <section aria-label="Interaction details"><h1>Interaction details</h1><div>{renderQuickAddTicket ? 'Ticket actions available' : 'Ticket actions unavailable'}</div></section>;
    },
  };
});
vi.mock('@alga-psa/clients/components/interactions/QuickAddInteraction', () => ({
  QuickAddInteraction: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div /> : null,
}));
vi.mock('@alga-psa/clients/components/clients/ClientQuickView', () => ({ default: () => <div /> }));
vi.mock('@alga-psa/clients/components/contacts/QuickAddContact', () => ({ default: () => null }));
vi.mock('@alga-psa/clients/components/contacts/bento/useContactQuickViewDrawer', () => ({
  useContactQuickViewDrawer: () => vi.fn(),
}));

vi.mock('@/lib/actions/coManagedAcceptanceActions', () => ({
  getCoManagedPasswordStatus: vi.fn().mockResolvedValue({ hasResetPassword: true }),
}));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children }: any) => <a href={href}>{children}</a> }));
vi.mock('@/context/ProductContext', () => ({ useProduct: () => ({ isAlgaDesk: false }) }));
vi.mock('@alga-psa/users/components/settings/PasswordChangeForm', () => ({ default: () => null }));
vi.mock('@alga-psa/scheduling/providers/StopwatchProvider', () => ({ StopwatchProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/msp-composition/clients/MspClientTagsProvider', () => ({ MspClientTagsProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/scheduling/providers/SchedulingProviderWithCallbacks', () => ({ SchedulingProviderWithCallbacks: ({ children }: any) => children }));
vi.mock('@alga-psa/msp-composition/user-activities/ActivityDrawerProvider', () => ({ ActivityDrawerProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/msp-composition/projects/MspTicketIntegrationProvider', () => ({ MspTicketIntegrationProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/msp-composition/projects/MspProjectBillingIntegrationProvider', () => ({ MspProjectBillingIntegrationProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/msp-composition/projects/MspClientIntegrationProvider', () => ({ MspClientIntegrationProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/msp-composition/clients/MspClientDrawerProvider', () => ({ MspClientDrawerProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/msp-composition/clients/MspClientCrossFeatureProvider', async () => {
  const { ClientCrossFeatureProvider } = await import('@alga-psa/clients/context/ClientCrossFeatureContext');
  return {
    MspClientCrossFeatureProvider: ({ children }: any) => (
      <ClientCrossFeatureProvider value={{ renderQuickAddTicket: () => null, refreshMeetingRecordings: vi.fn() } as any}>
        {children}
      </ClientCrossFeatureProvider>
    ),
  };
});
vi.mock('@alga-psa/msp-composition/assets/MspAssetCrossFeatureProvider', () => ({ MspAssetCrossFeatureProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/msp-composition/documents/MspDocumentsCrossFeatureProvider', () => ({ MspDocumentsCrossFeatureProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/msp-composition/scheduling/MspSchedulingCrossFeatureProvider', () => ({ MspSchedulingCrossFeatureProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/msp-composition/workflows/MspActivityCrossFeatureProvider', () => ({ MspActivityCrossFeatureProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/clients/providers/QuickAddClientProviderWithCallbacks', () => ({ QuickAddClientProviderWithCallbacks: ({ children }: any) => children }));

const interaction = {
  interaction_id: '588e6c15-c17e-4224-927d-c7ed1478cf6d',
  type_id: 'type-1',
  type_name: 'note',
  contact_name_id: 'contact-1',
  contact_name: 'Dorothy Gale',
  client_id: 'client-1',
  client_name: 'Emerald City',
  user_id: 'user-1',
  user_name: 'Agent',
  ticket_id: null,
  title: 'DOS-SMOKE-0248-003',
  interaction_date: new Date('2026-08-25T12:00:00.000Z'),
  duration: null,
  tenant: 'tenant-1',
  status_id: 'status-1',
  status_name: 'In Progress',
  is_status_closed: false,
};
const cursor1 = { interaction_date: '2026-08-25T12:00:00.000Z', interaction_id: interaction.interaction_id };
const cursor2 = { interaction_date: '2026-08-24T12:00:00.000Z', interaction_id: 'interaction-page-2' };

function DetailsRoute() {
  const { openDrawer } = useDrawer();
  return <button onClick={() => openDrawer(<InteractionDetailsProbe />)}>Open shell route drawer</button>;
}

function InteractionDetailsProbe() {
  const features = useOptionalClientCrossFeature();
  return <section><h1>Shell route details</h1><span>{features ? 'Shell ticket action' : 'No shell ticket action'}</span></section>;
}

function WorkspaceActionProbe() {
  const { renderQuickAddTicket } = useClientCrossFeature();
  return <section><h1>Ancestor launched details</h1><span>{renderQuickAddTicket ? 'Workspace ticket action' : 'No workspace ticket action'}</span></section>;
}

function AncestorDrawerLauncher() {
  const { openDrawer, hasOutlet } = useDrawer();
  const [usedFallback, setUsedFallback] = useState(false);
  return (
    <div>
      {usedFallback && <p>Stopwatch fallback used</p>}
      <button onClick={() => {
        if (!hasOutlet?.()) {
          setUsedFallback(true);
          return;
        }
        openDrawer(<WorkspaceActionProbe />);
      }}>Launch from shell ancestor</button>
    </div>
  );
}

function Feed() {
  return <OverallInteractionsFeed users={[]} contacts={[]} clients={[]} />;
}

afterEach(cleanup);
beforeEach(() => {
  mocks.getInteractionsPage.mockReset().mockImplementation(({ page }: { page: number }) => Promise.resolve({
    interactions: page === 1 ? [interaction] : [{ ...interaction, interaction_id: `interaction-page-${page}`, title: `Page ${page}` }],
    total: 100,
    totalExact: false,
    page,
    pageSize: 10,
    nextCursor: page === 1 ? cursor1 : cursor2,
    hasMore: page < 3,
  }));
  mocks.getAllInteractionTypes.mockReset().mockResolvedValue([]);
  mocks.getInteractionStatuses.mockReset().mockResolvedValue([]);
  mocks.getUserAvatarUrlsBatchAction.mockReset().mockResolvedValue(new Map());
});

describe('co-managed workspace drawer ownership', () => {
  it('opens one feed detail drawer, closes it, then makes cursor requests for Next and Previous', async () => {
    render(<CoManagedCustomerShell><WorkspaceProviders><Feed /></WorkspaceProviders></CoManagedCustomerShell>);

    fireEvent.click(await screen.findByRole('button', { name: 'Open interaction DOS-SMOKE-0248-003' }));
    expect(await screen.findByRole('heading', { name: 'Interaction details' })).toBeInTheDocument();
    expect(screen.getByText('Ticket actions available')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close drawer' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Interaction details' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mocks.getInteractionsPage).toHaveBeenCalledWith(expect.objectContaining({ page: 2, cursor: cursor1 })));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mocks.getInteractionsPage).toHaveBeenCalledWith(expect.objectContaining({ page: 3, cursor: cursor2 })));
    const pageTwoRequestsBeforePrevious = mocks.getInteractionsPage.mock.calls.filter(([request]) => request.page === 2).length;
    const requestsBeforePrevious = mocks.getInteractionsPage.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(mocks.getInteractionsPage.mock.calls.length).toBe(requestsBeforePrevious + 1));
    expect(mocks.getInteractionsPage.mock.calls.slice(-1)[0][0]).toMatchObject({ page: 2, cursor: cursor1 });
    expect(mocks.getInteractionsPage.mock.calls.filter(([request]) => request.page === 2)).toHaveLength(pageTwoRequestsBeforePrevious + 1);
  });

  it('routes an ancestor drawer launch to the active workspace outlet', async () => {
    render(
      <DrawerProvider>
        <AncestorDrawerLauncher />
        <WorkspaceProviders><div>Workspace route</div></WorkspaceProviders>
      </DrawerProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Launch from shell ancestor' }));

    expect(await screen.findByRole('heading', { name: 'Ancestor launched details' })).toBeInTheDocument();
    expect(screen.queryByText('Stopwatch fallback used')).not.toBeInTheDocument();
    expect(screen.getByText('Workspace ticket action')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close drawer' })).toHaveLength(1);
  });

  it('discards workspace drawer content when navigating to a shell route', async () => {
    const { rerender } = render(<CoManagedCustomerShell><WorkspaceProviders><Feed /></WorkspaceProviders></CoManagedCustomerShell>);

    fireEvent.click(await screen.findByRole('button', { name: 'Open interaction DOS-SMOKE-0248-003' }));
    expect(await screen.findByRole('heading', { name: 'Interaction details' })).toBeInTheDocument();
    rerender(<CoManagedCustomerShell><DetailsRoute /></CoManagedCustomerShell>);

    expect(screen.queryByRole('heading', { name: 'Interaction details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close drawer' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open shell route drawer' }));
    expect(await screen.findByRole('heading', { name: 'Shell route details' })).toBeInTheDocument();
    expect(screen.getByText('No shell ticket action')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close drawer' })).toHaveLength(1);
  });

  it('keeps shell-only routes able to open one drawer without workspace capabilities', async () => {
    render(<CoManagedCustomerShell><DetailsRoute /></CoManagedCustomerShell>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open shell route drawer' }));

    expect(await screen.findByRole('heading', { name: 'Shell route details' })).toBeInTheDocument();
    expect(screen.getByText('No shell ticket action')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close drawer' })).toHaveLength(1);
  });

  it('can close a shell-owned drawer after entering a workspace scope', async () => {
    const view = render(<CoManagedCustomerShell><DetailsRoute /></CoManagedCustomerShell>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open shell route drawer' }));
    expect(await screen.findByRole('heading', { name: 'Shell route details' })).toBeInTheDocument();

    view.rerender(<CoManagedCustomerShell><WorkspaceProviders><div>Workspace route</div></WorkspaceProviders></CoManagedCustomerShell>);
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));

    expect(screen.queryByRole('heading', { name: 'Shell route details' })).not.toBeInTheDocument();
  });

  it('transfers shell drawer ownership to a workspace without rendering two drawers', async () => {
    const view = render(<CoManagedCustomerShell><DetailsRoute /></CoManagedCustomerShell>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open shell route drawer' }));
    expect(await screen.findByRole('heading', { name: 'Shell route details' })).toBeInTheDocument();

    view.rerender(<CoManagedCustomerShell><WorkspaceProviders><Feed /></WorkspaceProviders></CoManagedCustomerShell>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open interaction DOS-SMOKE-0248-003', hidden: true }));

    expect(await screen.findByRole('heading', { name: 'Interaction details' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shell route details' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close drawer' })).toHaveLength(1);
  });

  it('keeps ordinary PSA workspace drawer details under workspace providers', async () => {
    render(<DrawerProvider><WorkspaceProviders><Feed /></WorkspaceProviders></DrawerProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open interaction DOS-SMOKE-0248-003' }));

    expect(await screen.findByRole('heading', { name: 'Interaction details' })).toBeInTheDocument();
    expect(screen.getByText('Ticket actions available')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close drawer' })).toHaveLength(1);
  });
});
