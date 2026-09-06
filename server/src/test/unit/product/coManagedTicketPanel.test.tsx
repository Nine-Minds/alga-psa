/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedTicketPanel from '../../../components/co-managed/CoManagedTicketPanel';
import CoManagedExplicitTicketGrantsPanel from '../../../components/co-managed/CoManagedExplicitTicketGrantsPanel';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn(), history: vi.fn(), grants: vi.fn(), escalate: vi.fn(), handback: vi.fn(), revoke: vi.fn() }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedSharedWorkActions', () => ({ getCoManagedTicketScreenAction: mocks.load,
  getSharedTicketHandoffHistoryAction: mocks.history, getExplicitTicketGrantsAction: mocks.grants,
  escalateSharedTicketAction: mocks.escalate, handBackSharedTicketAction: mocks.handback, revokeSharedTicketGrantAction: mocks.revoke }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => options?.organization ? `${key}: ${options.organization}` : key }),
  useOptionalI18n: () => null, useFormatters: () => ({ formatDate: (date: Date) => date.toISOString() }) }));
const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'ticket' as const, id: 'ticket-a' };
const data = () => ({ summary: { resource, revision: 4, fields: { title: 'Customer A issue', ticket_number: 'A-1', responsibility: 'customer', work_revision: 0 } },
  side: 'customer', customerName: 'Customer A', sponsorName: 'MSP', canWrite: true, canEscalate: true, canHandBack: false, canRevoke: false });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const button = (name: string) => screen.getByRole('button', { name: `coManaged.ticket.${name}` });
const mount = () => render(<CoManagedFeatureBoundary><CoManagedTicketPanel target={{ kind: 'shared', resource }} showSummary /></CoManagedFeatureBoundary>);
beforeEach(() => {
  vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.load.mockResolvedValue(data()); mocks.history.mockResolvedValue({ items: [], nextBeforeRevision: null });
  mocks.grants.mockResolvedValue({ items: [{ resource, revision: 1, ticketNumber: 'A-1', title: 'Customer A issue' }], nextAfterTicketId: null });
  mocks.escalate.mockResolvedValue({ appliedRevision: 1 }); mocks.handback.mockResolvedValue({ appliedRevision: 2 }); mocks.revoke.mockResolvedValue({ appliedRevision: 2 });
});
afterEach(cleanup);

it('does not mount readers or controls while the release flag is off', () => {
  mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null }); mount();
  render(<CoManagedFeatureBoundary><CoManagedExplicitTicketGrantsPanel /></CoManagedFeatureBoundary>);
  expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.grants).not.toHaveBeenCalled();
  expect(screen.queryByRole('button')).toBeNull();
});

it('requires a note and retries exactly the same handoff after an uncertain response', async () => {
  const pending = deferred<unknown>(); mocks.escalate.mockReturnValueOnce(pending.promise);
  mount(); await screen.findByText('A-1 · Customer A issue'); fireEvent.click(button('escalate'));
  expect(button('escalate')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: '  Please investigate.  ' } });
  fireEvent.click(button('escalate'));
  expect(screen.getByLabelText('coManaged.ticket.note')).toBeDisabled();
  await act(async () => pending.reject(new Error('Lost response')));
  expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.ticket.uncertain');
  expect(screen.getByLabelText('coManaged.ticket.note')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'coManaged.ticket.cancel' })).toBeNull();
  expect(mocks.escalate.mock.calls[0]).toEqual([resource, { operationId: expect.any(String), expectedRevision: 0, note: 'Please investigate.' }]);
  fireEvent.click(button('retry'));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(mocks.escalate.mock.calls[1]).toEqual(mocks.escalate.mock.calls[0]);
});

it('reloads current revision before another attempt after a competing change', async () => {
  mocks.escalate.mockRejectedValueOnce(new Error('HANDOFF_CHANGED'));
  mount(); await screen.findByText('A-1 · Customer A issue'); fireEvent.click(button('escalate'));
  fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Investigate' } }); fireEvent.click(button('escalate'));
  await screen.findByRole('alert');
  const changed = data(); changed.summary.fields.work_revision = 2; mocks.load.mockResolvedValue(changed);
  fireEvent.click(button('reload')); await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  fireEvent.click(button('escalate')); fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Investigate again' } });
  fireEvent.click(button('escalate'));
  await waitFor(() => expect(mocks.escalate).toHaveBeenCalledTimes(2));
  expect(mocks.escalate.mock.calls[1][1].expectedRevision).toBe(2);
  expect(mocks.escalate.mock.calls[1][1].operationId).not.toBe(mocks.escalate.mock.calls[0][1].operationId);
});

it('discards late reads and submissions when navigating to another qualified customer', async () => {
  const first = deferred<any>(); mocks.load.mockReturnValueOnce(first.promise);
  const view = mount();
  const other = { ...resource, tenant: 'customer-b', id: 'ticket-b' };
  const next = data(); next.summary.resource = other; next.summary.fields.title = 'Customer B issue';
  mocks.load.mockResolvedValue(next);
  view.rerender(<CoManagedFeatureBoundary><CoManagedTicketPanel target={{ kind: 'shared', resource: other }} showSummary /></CoManagedFeatureBoundary>);
  await screen.findByText('A-1 · Customer B issue'); await act(async () => first.resolve(data()));
  expect(screen.queryByText('A-1 · Customer A issue')).toBeNull();
  const pending = deferred<any>(); mocks.escalate.mockReturnValueOnce(pending.promise);
  fireEvent.click(button('escalate')); fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'B handoff' } }); fireEvent.click(button('escalate'));
  mocks.load.mockResolvedValue(data());
  view.rerender(<CoManagedFeatureBoundary><CoManagedTicketPanel target={{ kind: 'shared', resource }} showSummary /></CoManagedFeatureBoundary>);
  await screen.findByText('A-1 · Customer A issue'); const reads = mocks.load.mock.calls.length;
  await act(async () => pending.resolve({ appliedRevision: 1 }));
  expect(mocks.load).toHaveBeenCalledTimes(reads);
});

it('keeps revocation available during read-only mode without exposing handoff writes', async () => {
  mocks.load.mockResolvedValue({ ...data(), canWrite: false, canEscalate: false, canRevoke: true });
  mount(); await screen.findByText('coManaged.ticket.readOnly');
  expect(screen.queryByRole('button', { name: 'coManaged.ticket.escalate' })).toBeNull();
  fireEvent.click(button('revoke')); expect(screen.getByText('coManaged.ticket.revokeHelp')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Remove access' } }); fireEvent.click(button('revoke'));
  await waitFor(() => expect(mocks.revoke).toHaveBeenCalledTimes(1)); expect(mocks.handback).not.toHaveBeenCalled();
});

it.each(['customer', 'sponsor'])('labels handback for the %s actor', async side => {
  mocks.load.mockResolvedValue({ ...data(), side, canEscalate: false, canHandBack: true });
  mount(); await screen.findByText('A-1 · Customer A issue');
  fireEvent.click(button(side === 'customer' ? 'takeBack' : 'handback'));
  fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Return responsibility' } });
  fireEvent.click(button(side === 'customer' ? 'takeBack' : 'handback'));
  await waitFor(() => expect(mocks.handback).toHaveBeenCalledTimes(1)); expect(mocks.revoke).not.toHaveBeenCalled();
});

it('loads older shared journal entries using the server cursor and renders plain text', async () => {
  const entry = { operationId: 'first', revision: 26, transition: 'escalated', occurredAt: '2026-09-06T12:00:00Z', note: '<script>private()</script>',
    author: { tenant: 'customer-a', userId: 'it-a', name: 'IT Admin', organization: 'Customer A' } };
  mocks.history.mockResolvedValueOnce({ items: [entry], nextBeforeRevision: 2 });
  mocks.history.mockResolvedValueOnce({ items: [{ ...entry, operationId: 'older', revision: 1, note: 'Original request' }], nextBeforeRevision: null });
  mount(); await screen.findByText('<script>private()</script>'); expect(document.querySelector('script')).toBeNull();
  fireEvent.click(button('older')); await screen.findByText('Original request');
  expect(mocks.history.mock.calls[1]).toEqual([resource, 2]);
  expect(screen.queryByRole('button', { name: 'coManaged.ticket.older' })).toBeNull();
});

it('paginates customer grant inventory and revokes a grant without requiring a readable ticket title', async () => {
  mocks.grants.mockResolvedValueOnce({ items: [{ resource, revision: 9 }], nextAfterTicketId: resource.id });
  render(<CoManagedFeatureBoundary><CoManagedExplicitTicketGrantsPanel /></CoManagedFeatureBoundary>);
  await screen.findByText('coManaged.ticket.restricted'); expect(screen.queryByRole('link', { name: 'A-1' })).toBeNull();
  fireEvent.click(button('revoke')); expect(screen.getByRole('button', { name: 'coManaged.provisioning.next' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'End access' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'coManaged.ticket.revoke' }).find(element => !element.hasAttribute('disabled'))!);
  await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith(resource, expect.objectContaining({ expectedRevision: 9, note: 'End access' })));
  await screen.findByText('A-1 · Customer A issue');
  mocks.grants.mockResolvedValue({ items: [], nextAfterTicketId: null });
  // Reloaded grant page may contain a next cursor after concurrent grant additions.
  cleanup(); mocks.grants.mockResolvedValueOnce({ items: [{ resource, revision: 10 }], nextAfterTicketId: resource.id });
  render(<CoManagedExplicitTicketGrantsPanel />); await screen.findByText('coManaged.ticket.restricted');
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.next' }));
  await screen.findByText('coManaged.grants.empty'); expect(mocks.grants).toHaveBeenLastCalledWith(resource.id);
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.provisioning.previous' }));
  await waitFor(() => expect(mocks.grants).toHaveBeenLastCalledWith(undefined));
});
