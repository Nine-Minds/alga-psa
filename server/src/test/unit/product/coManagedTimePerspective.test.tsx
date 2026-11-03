/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flag: vi.fn(), load: vi.fn(), session: vi.fn(), summaryProps: [] as any[], entryProps: [] as any[],
  sourceOptions: [] as any[], containerProps: [] as any[],
}));
vi.mock('next-auth/react', () => ({ useSession: mocks.session, signOut: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedTimeActions', () => ({ getSharedEffortTotalsAction: mocks.load }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, values?: any) => (values && typeof values === 'object' && 'value' in values) ? `${values.value} hours` : key }),
  useOptionalI18n: () => null, useFormatters: () => ({ formatNumber: (value: number) => String(value) }) }));
// CoManagedSharedTicket collaborators: only the wiring is under test.
vi.mock('../../../components/co-managed/CoManagedTimeEntry', () => ({ default: (props: any) => { mocks.entryProps.push(props); return <button id="save" onClick={props.onSaved}>save</button>; } }));
vi.mock('../../../components/co-managed/CoManagedEffortSummary', () => ({ CoManagedEffortSummary: (props: any) => { mocks.summaryProps.push(props); return <div data-testid="summary" data-key={props.refreshKey} />; } }));
vi.mock('@alga-psa/billing/components/ticket/QuickInvoiceTicketDialog', () => ({ default: () => <div data-testid="quick-invoice" /> }));
vi.mock('@alga-psa/tickets/components/ticket/TicketDetailsContainer', () => ({ default: (props: any) => { mocks.containerProps.push(props); return <div data-testid="container" />; } }));
vi.mock('@alga-psa/tickets/components/ticket/TicketDataSourceContext', () => ({ TicketDataSourceProvider: ({ children, dataSource }: any) => <div data-testid="provider">{dataSource?.__time?.slots?.timeSummary ? dataSource.__time.slots.timeSummary({ timeEntriesRefreshKey: 3 }) : null}{children}</div> }));
vi.mock('@/lib/co-managed/sharedTicketDataSource', () => ({
  createCoManagedSharedTicketDataSource: (_s: any, _b: any, options: any) => { mocks.sourceOptions.push(options); return { __time: options.time }; },
  sharedTicketOptions: () => ({}), sharedTicketRecord: () => ({ ticket_id: 't1', ticket_number: 'T-1', title: 'Shared' }),
}));
vi.mock('@/lib/co-managed/sharedConversationMapping', () => ({ conversationAuthorMaps: () => ({ userMap: {}, contactMap: {} }) }));
vi.mock('../../../components/co-managed/sharedConversationSession', () => ({
  createSharedConversationSession: () => ({ load: async () => undefined, snapshot: () => null, comments: () => [] }),
}));
vi.mock('../../../components/co-managed/useCoManagedSharedTimeConfig', () => ({ useCoManagedSharedTimeConfig: () => ({}) }));
vi.mock('../../../lib/actions/coManagedLocalTicketActions', () => ({ getCoManagedLocalTicketResourceAction: async () => null }));
vi.mock('@alga-psa/tickets/lib/nativeTicketDataSource', () => ({ nativeTicketDataSource: { comments: { addTicketCommentWithCache: async () => undefined } } }));
vi.mock('@alga-psa/tickets/lib/ticketDataSource', () => ({ composeTicketDataSource: (a: any) => a }));

import CoManagedEffort from '../../../components/co-managed/CoManagedEffort';
import { CoManagedEffortPerspectiveProvider } from '../../../components/co-managed/coManagedEffortPerspective';
import CoManagedSharedTicket, { SharedTimeSummary } from '../../../components/co-managed/CoManagedSharedTicket';
import { CoManagedLocalTicketDataSourceProvider } from '../../../components/co-managed/CoManagedLocalTicketDataSourceProvider';

const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'ticket' as const, id: 'ticket-a' };
const totals = { resource, customerMinutes: 30, mspMinutes: 60, combinedMinutes: 90 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.summaryProps.length = 0; mocks.entryProps.length = 0; mocks.sourceOptions.length = 0; mocks.containerProps.length = 0;
  mocks.session.mockReturnValue({ status: 'authenticated', data: { user: { id: 'user-a', tenant: 'home-a' } } });
  mocks.flag.mockReturnValue({ enabled: true, admitted: true, resolved: true });
  mocks.load.mockResolvedValue(totals);
});
afterEach(cleanup);

// --- 3.3: an MSP save refreshes the effort split --------------------------------------------------
it('3.3 onSaved from the MSP time entry bumps the effort summary refresh key', () => {
  const ticket = { ticket_id: 't1', ticket_number: 'T-1', title: 'Shared' };
  render(<SharedTimeSummary resource={resource} ticket={ticket} refreshKey={2} />);
  expect(screen.getByTestId('summary').dataset.key).toBe('2');
  expect(typeof mocks.entryProps.at(-1).onSaved).toBe('function');
  act(() => screen.getByRole('button', { name: 'save' }).click());
  expect(screen.getByTestId('summary').dataset.key).toBe('3');
  act(() => screen.getByRole('button', { name: 'save' }).click());
  expect(screen.getByTestId('summary').dataset.key).toBe('4');
  expect(screen.getByTestId('quick-invoice')).toBeInTheDocument();
});

// --- 3.4: perspective labels ----------------------------------------------------------------------
const sharedTarget = { kind: 'shared' as const, resource };
it('3.4 MSP perspective keeps the sponsor wording on a shared target', async () => {
  render(<CoManagedEffort target={sharedTarget} />);
  await screen.findByText('1.5 hours');
  expect(screen.getByText('effort.customerMinutes')).toBeInTheDocument();
  expect(screen.getByText('effort.mspMinutes')).toBeInTheDocument();
  expect(screen.queryByText('effort.customerView.customerMinutes')).toBeNull();
});
it('3.4 customer perspective (from context) labels customer time "Your team" and MSP time "MSP"', async () => {
  render(<CoManagedEffortPerspectiveProvider value="customer"><CoManagedEffort target={sharedTarget} /></CoManagedEffortPerspectiveProvider>);
  await screen.findByText('1.5 hours');
  expect(screen.getByText('effort.customerView.customerMinutes')).toBeInTheDocument();
  expect(screen.getByText('effort.customerView.mspMinutes')).toBeInTheDocument();
  expect(screen.queryByText('effort.mspMinutes')).toBeNull();
  expect(screen.getByText('effort.combinedMinutes')).toBeInTheDocument();
});
it('3.4 a local target is always the customer view', async () => {
  render(<CoManagedEffort target={{ kind: 'local_task', taskId: 'task-a' }} />);
  await screen.findByText('1.5 hours');
  expect(screen.getByText('effort.customerView.customerMinutes')).toBeInTheDocument();
});
it('3.4 CoManagedLocalTicketDataSourceProvider supplies the customer perspective to its subtree', async () => {
  render(<CoManagedLocalTicketDataSourceProvider ticketId="t1"><CoManagedEffort target={sharedTarget} /></CoManagedLocalTicketDataSourceProvider>);
  await screen.findByText('effort.customerView.mspMinutes');
});

// --- 3.6: kill switch (capability off) at the UI ---------------------------------------------------
const sharedSummary = { resource } as any;
it('3.6 co-managed on: the shared ticket mounts the time widgets and Quick Invoice', async () => {
  render(<CoManagedSharedTicket summary={sharedSummary} backHref="/x" />);
  await waitFor(() => expect(mocks.containerProps.length).toBeGreaterThan(0));
  expect(mocks.containerProps.at(-1).hideTimeEntry).toBe(false);
  expect(mocks.sourceOptions.at(-1).time).toBeDefined();
  expect(await screen.findByTestId('quick-invoice')).toBeInTheDocument();
});
it('3.6 co-managed off (FORCE_CAPABILITIES=co-managed:off): no time hunk, no widgets, no Quick Invoice', async () => {
  mocks.flag.mockReturnValue({ enabled: false, admitted: false, resolved: true });
  render(<CoManagedSharedTicket summary={sharedSummary} backHref="/x" />);
  await waitFor(() => expect(mocks.containerProps.length).toBeGreaterThan(0));
  expect(mocks.containerProps.at(-1).hideTimeEntry).toBe(true);
  expect(mocks.sourceOptions.at(-1).time).toBeUndefined();
  expect(screen.queryByTestId('quick-invoice')).toBeNull();
  expect(screen.queryByTestId('summary')).toBeNull();
});
