// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DrawerProvider, useDrawer } from '@alga-psa/ui';
import { useClientCrossFeature } from '@alga-psa/clients/context/ClientCrossFeatureContext';
import CoManagedCustomerShell from '@/components/co-managed/CoManagedCustomerShell';
import WorkspaceProviders from '@/components/layout/WorkspaceProviders';

vi.mock('@/lib/actions/coManagedAcceptanceActions', () => ({
  getCoManagedPasswordStatus: vi.fn().mockResolvedValue({ hasResetPassword: true }),
}));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children }: any) => <a href={href}>{children}</a> }));
vi.mock('@/context/ProductContext', () => ({ useProduct: () => ({ isAlgaDesk: false }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));
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

function InteractionDetailsProbe() {
  const { renderQuickAddTicket } = useClientCrossFeature();
  return <section aria-label="Interaction details"><h1>Interaction details</h1><div>{renderQuickAddTicket ? 'Ticket actions available' : 'Ticket actions unavailable'}</div></section>;
}

function InteractionFeedProbe() {
  const { openDrawer } = useDrawer();
  const [page, setPage] = useState(1);
  return (
    <section aria-label="Interactions">
      <p>Page {page}</p>
      <button onClick={() => openDrawer(<InteractionDetailsProbe />)}>Select DOS-SMOKE-0248-003</button>
      <button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
      <button onClick={() => setPage(page + 1)}>Next</button>
    </section>
  );
}

afterEach(cleanup);

describe('co-managed workspace drawer ownership', () => {
  it('renders one provider-complete interaction drawer and keeps feed pagination usable after close', async () => {
    render(
      <CoManagedCustomerShell>
        <WorkspaceProviders><InteractionFeedProbe /></WorkspaceProviders>
      </CoManagedCustomerShell>,
    );

    await screen.findByRole('region', { name: 'Interactions' });
    await waitFor(() => expect(document.querySelectorAll('#drawer-close-button')).toHaveLength(0));
    fireEvent.click(screen.getByRole('button', { name: 'Select DOS-SMOKE-0248-003' }));

    expect(await screen.findByRole('heading', { name: 'Interaction details' })).toBeInTheDocument();
    expect(screen.getByText('Ticket actions available')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close drawer' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Interaction details' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('keeps the shell outlet available when a route has no workspace outlet', async () => {
    function ShellRoute() {
      const { openDrawer } = useDrawer();
      return <button onClick={() => openDrawer(<section><h1>Shell route details</h1></section>)}>Open shell route drawer</button>;
    }

    render(<CoManagedCustomerShell><ShellRoute /></CoManagedCustomerShell>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open shell route drawer' }));
    expect(await screen.findByRole('heading', { name: 'Shell route details' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close drawer' })).toHaveLength(1);
  });

  it('keeps the ordinary PSA workspace outlet provider-complete without a co-managed shell fallback', async () => {
    render(
      <DrawerProvider>
        <WorkspaceProviders><InteractionFeedProbe /></WorkspaceProviders>
      </DrawerProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Select DOS-SMOKE-0248-003' }));

    expect(await screen.findByRole('heading', { name: 'Interaction details' })).toBeInTheDocument();
    expect(screen.getByText('Ticket actions available')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close drawer' })).toHaveLength(1);
  });
});
