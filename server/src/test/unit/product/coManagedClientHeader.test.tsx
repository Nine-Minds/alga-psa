/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientPage from '../../../app/msp/clients/[id]/page';

// Renders the real client page module so its header wiring is what is under
// test. Only the data loaders and the heavy ClientDetails shell are replaced;
// the shell keeps ClientDetails' header composition (summary slot, then the
// page's headerActions) around the real co-managed integration and summary.
const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn(), legacyProbe: vi.fn(), openTab: vi.fn(), push: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
// `canOpenCoManagedClientProvisioning` backed the removed header action; it is
// kept in the mock (always granting) so restoring that action shows up here.
vi.mock('@/lib/actions/coManagedActions', () => ({
  getCoManagedClientManagement: mocks.load, canOpenCoManagedClientProvisioning: mocks.legacyProbe,
}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found'); }, useRouter: () => ({ push: mocks.push }) }));
vi.mock('@alga-psa/clients/actions', () => ({
  getClientById: async (id: string) => ({ client_id: id, client_name: 'White Rabbit' }),
  getContactsByClient: async () => [],
}));
vi.mock('@alga-psa/documents/actions/documentActions', () => ({ getDocumentByClientId: async () => [] }));
vi.mock('@alga-psa/surveys/actions/survey-actions/surveyDashboardActions', () => ({ getSurveyClientSummary: async () => null }));
vi.mock('@product/chat/context', () => ({ AIChatContextBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/productAccess', () => ({ getCurrentTenantProduct: async () => 'psa' }));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerTranslation: async () => ({ t: (key: string) => key }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const english: Record<string, string> = { 'coManaged.provisioning.create': 'Enable co-managed IT' };
  const t = (key: string, options?: Record<string, unknown>) =>
    String(options?.defaultValue ?? english[key] ?? key).replace(/{{(\w+)}}/g, (match, name) => String(options?.[name] ?? match));
  return { useTranslation: () => ({ t }), useFormatters: () => ({ formatDate: (value: Date) => value.toISOString() }), useOptionalI18n: () => null };
});
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', { id, onClick }, children),
}));
vi.mock('../../../components/co-managed/CoManagedClientView', () => ({ default: () => <div data-testid="view" /> }));
vi.mock('../../../components/co-managed/CoManagedCalloutStrip', () => ({ CoManagedClientCalloutStrip: () => null }));
vi.mock('@alga-psa/clients', async () => {
  const { default: Integration } = await import('../../../components/co-managed/CoManagedClientIntegration');
  return {
    ClientDetails: ({ client, headerActions }: { client: { client_id: string; client_name: string }; headerActions?: React.ReactNode }) => (
      <Integration clientId={client.client_id} clientName={client.client_name} idPrefix="client" onOpenTab={mocks.openTab}>
        {(slots) => <div data-testid="client-header">{slots?.summary}{headerActions}</div>}
      </Integration>
    ),
  };
});

const relationship = (over: Record<string, unknown> = {}) => ({
  relationshipId: 'rel', operationId: 'operation', state: 'active', ended: false, endedAt: null, retained: false, seats: 2, usedSeats: 1,
  workspaceName: 'White Rabbit IT', administratorEmail: 'alice@whiterabbit.test', canManage: true, canChangeSeats: false,
  canRetry: false, canCancel: false, invitationSent: true, invitationExpired: false, deliveryFailed: false, cleanupFailed: false, ...over,
});
const ended = (over: Record<string, unknown> = {}) => relationship({ relationshipId: 'old', state: 'terminated', ended: true, retained: true,
  endedAt: '2026-10-26T00:13:30.705Z', usedSeats: null, ...over });
const view = (over: Record<string, unknown> = {}) => ({
  clientId: 'client-1', clientName: 'White Rabbit', selectionRequired: false, selectedRelationshipId: null,
  canManage: true, canSetUp: false, relationships: [], ...over,
});

async function renderHeader() {
  render(await ClientPage({ params: Promise.resolve({ id: 'client-1' }) }));
  const header = screen.getByTestId('client-header');
  await waitFor(() => expect(header.querySelector('#client-summary')).not.toBeNull());
  // Let any header-action probe settle so a late Enable cannot slip past the assertion.
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  return header;
}
const actions = (header: HTMLElement) => within(header).queryAllByRole('button').map((button) => button.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.legacyProbe.mockResolvedValue(true);
});
afterEach(cleanup);

describe('client header co-managed entry', () => {
  it('offers Enable once, from the summary, to a manager the view authorizes for setup', async () => {
    mocks.load.mockResolvedValue(view({ canSetUp: true }));
    const header = await renderHeader();
    expect(within(header).getByText('Co-managed IT not enabled')).toBeInTheDocument();
    expect(actions(header)).toEqual(['Enable co-managed IT']);
    fireEvent.click(within(header).getByRole('button', { name: 'Enable co-managed IT' }));
    expect(mocks.openTab).toHaveBeenCalledWith('co-managed');
  });

  it('shows no Enable to a reader the view does not authorize for setup', async () => {
    mocks.load.mockResolvedValue(view({ canManage: false, canSetUp: false }));
    mocks.legacyProbe.mockResolvedValue(false);
    const header = await renderHeader();
    expect(within(header).getByText('Co-managed IT not enabled')).toBeInTheDocument();
    expect(actions(header)).toEqual([]);
  });

  it('shows only Manage for an active relationship', async () => {
    mocks.load.mockResolvedValue(view({ selectedRelationshipId: 'rel', relationships: [relationship()] }));
    const header = await renderHeader();
    expect(actions(header)).toEqual(['Manage']);
  });

  it('shows only View history for an ended relationship', async () => {
    mocks.load.mockResolvedValue(view({ selectedRelationshipId: 'old', relationships: [ended()] }));
    const header = await renderHeader();
    expect(within(header).getByText('Ended 2026-10-26T00:13:30.705Z')).toBeInTheDocument();
    expect(actions(header)).toEqual(['View history']);
  });

  it('shows only Manage when one relationship is live and another has ended', async () => {
    mocks.load.mockResolvedValue(view({ selectedRelationshipId: 'rel', relationships: [ended(), relationship()] }));
    const header = await renderHeader();
    expect(actions(header)).toEqual(['Manage']);
  });

  it('asks for a choice, not setup, when several relationships are live', async () => {
    mocks.load.mockResolvedValue(view({ selectionRequired: true, relationships: [relationship(), relationship({ relationshipId: 'second' })] }));
    const header = await renderHeader();
    expect(actions(header)).toEqual(['Choose relationship']);
  });

  it('offers setup again when the only history is a cancelled setup', async () => {
    mocks.load.mockResolvedValue(view({ selectionRequired: true, canSetUp: true,
      relationships: [relationship({ state: 'cancelled', ended: true, endedAt: '2026-10-20T00:00:00.000Z' })] }));
    const header = await renderHeader();
    expect(within(header).getByText('Co-managed IT not enabled')).toBeInTheDocument();
    expect(actions(header)).toEqual(['Enable co-managed IT']);
  });
});
