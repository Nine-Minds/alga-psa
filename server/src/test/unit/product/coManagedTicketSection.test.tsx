/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedTicketSection from '../../../components/co-managed/CoManagedTicketSection';

const mocks = vi.hoisted(() => ({ load: vi.fn(), history: vi.fn(), escalate: vi.fn(), handback: vi.fn(), revoke: vi.fn(),
  assignment: vi.fn(), assignees: vi.fn(), assign: vi.fn(), signals: vi.fn() }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('../../../components/co-managed/CoManagedWorkSignalsProvider', () => ({ useCoManagedWorkSignals: () => ({ refresh: mocks.signals }) }));
vi.mock('../../../lib/actions/coManagedSharedWorkActions', () => ({ getCoManagedTicketScreenAction: mocks.load,
  getSharedTicketHandoffHistoryAction: mocks.history, escalateSharedTicketAction: mocks.escalate,
  handBackSharedTicketAction: mocks.handback, revokeSharedTicketGrantAction: mocks.revoke }));
vi.mock('../../../lib/actions/coManagedTicketAssignmentActions', () => ({ getSharedTicketAssignmentAction: mocks.assignment,
  listSharedTicketAssigneesAction: mocks.assignees, assignSharedTicketAction: mocks.assign }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => options?.organization ? `${key}: ${options.organization}` : key }),
  useOptionalI18n: () => null, useFormatters: () => ({ formatDate: (date: Date) => date.toISOString() }) }));

const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'ticket' as const, id: 'ticket-a' };
const clock = (kind: 'response' | 'resolution') => ({ status: 'running', dueAt: '2026-10-16T10:00:00.000Z', kind });
const screenData = (overrides: Record<string, unknown> = {}) => ({
  summary: { resource, revision: 4, fields: { responsibility: 'msp', work_revision: 7 } },
  side: 'customer', customerName: 'Customer A', sponsorName: 'Acme MSP', canWrite: true, canEscalate: false, canHandBack: true, canRevoke: false,
  sla: { customer: { state: 'tracking', paused: false, response: clock('response'), resolution: clock('resolution') },
    msp: { state: 'tracking', paused: false, response: clock('response'), resolution: clock('resolution') } },
  ...overrides });
const assignmentData = (overrides: Record<string, unknown> = {}) => ({ revision: 7, canEdit: false, canAssign: false, hasAssignment: true,
  mspAssignment: { kind: 'user', id: 'user-1', tenant: 'msp', name: 'Pat Tech', organizationName: 'Acme MSP' }, ...overrides });
const history = (revision: number) => ({ operationId: `op-${revision}`, transition: 'escalated', occurredAt: '2026-10-14T10:00:00.000Z', note: `Note ${revision}`,
  author: { name: 'Sam', organization: 'Customer A' } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(screenData());
  mocks.assignment.mockResolvedValue(assignmentData());
  mocks.history.mockResolvedValue({ items: [], nextBeforeRevision: null });
  mocks.handback.mockResolvedValue({ appliedRevision: 8 });
});
afterEach(cleanup);

it('shows responsibility, both SLA clocks and the MSP assignment in the native tile', async () => {
  render(<CoManagedTicketSection target={{ kind: 'local', ticketId: 'ticket-a' }} />);
  expect(await screen.findByText('Acme MSP', { selector: '#co-ticket-responsibility span' })).toBeTruthy();
  expect(document.getElementById('co-ticket-sla-customer-response')).toBeTruthy();
  expect(document.getElementById('co-ticket-sla-customer-resolution')).toBeTruthy();
  expect(document.getElementById('co-ticket-sla-msp-response')).toBeTruthy();
  expect(document.getElementById('co-ticket-sla-msp-resolution')).toBeTruthy();
  await waitFor(() => expect(document.getElementById('co-ticket-assignment-value')).toHaveTextContent('Acme MSP · Pat Tech'));
  // Customer side cannot edit the MSP assignment.
  expect(document.getElementById('co-ticket-assignment-change')).toBeNull();
});

it('offers no write affordance when the section is read only', async () => {
  mocks.load.mockResolvedValue(screenData({ canWrite: false, canEscalate: true }));
  render(<CoManagedTicketSection target={{ kind: 'local', ticketId: 'ticket-a' }} />);
  await screen.findByText('coManaged.ticket.readOnly');
  expect(document.getElementById('co-ticket-handoff-actions')).toBeNull();
  expect(document.getElementById('co-ticket-assignment-change')).toBeNull();
});

it.each([
  [{ hasAssignment: false }, 'coManaged.ticket.assignment.needsHandoff'],
  [{ hasAssignment: true }, 'coManaged.ticket.assignment.needsHandoff'],
  [{}, 'coManaged.ticket.restricted'],
])('renders the assignment disclosure without a revision: %j', async (state, expected) => {
  mocks.assignment.mockResolvedValue({ ...state, canEdit: false, canAssign: false, mspAssignment: null });
  render(<CoManagedTicketSection target={{ kind: 'local', ticketId: 'ticket-a' }} />);
  await waitFor(() => expect(document.getElementById('co-ticket-assignment-value')).toHaveTextContent(expected));
  expect(document.getElementById('co-ticket-assignment-change')).toBeNull();
});

it('hands back with the current revision, then refreshes the screen, the work signals and the owner', async () => {
  const onChanged = vi.fn();
  render(<CoManagedTicketSection target={{ kind: 'local', ticketId: 'ticket-a' }} onChanged={onChanged} />);
  fireEvent.click(await screen.findByRole('button', { name: 'coManaged.ticket.takeBack' }));
  fireEvent.change(screen.getByLabelText(/coManaged.ticket.note/), { target: { value: '  Back to us.  ' } });
  fireEvent.click(document.getElementById('co-ticket-handoff-submit')!);
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(mocks.handback).toHaveBeenCalledWith(resource, { operationId: expect.any(String), expectedRevision: 7, note: 'Back to us.' });
  expect(mocks.signals).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
});

it('pages the handoff history, newest first, from the drawer', async () => {
  mocks.history.mockResolvedValueOnce({ items: [history(3), history(2)], nextBeforeRevision: 2 })
    .mockResolvedValueOnce({ items: [{ ...history(1), operationId: 'op-1' }], nextBeforeRevision: null });
  render(<CoManagedTicketSection target={{ kind: 'local', ticketId: 'ticket-a' }} />);
  await screen.findByText('Acme MSP', { selector: '#co-ticket-responsibility span' });
  expect(mocks.history).not.toHaveBeenCalled();
  fireEvent.click(document.getElementById('co-ticket-history-open')!);
  await screen.findByText('Note 3');
  fireEvent.click(document.getElementById('co-ticket-history-older')!);
  await screen.findByText('Note 1');
  expect(mocks.history.mock.calls.map(call => call[1])).toEqual([undefined, 2]);
  expect(within(document.getElementById('co-ticket-history-list')!).getAllByRole('listitem')).toHaveLength(3);
  expect(document.getElementById('co-ticket-history-older')).toBeNull();
});

it('shows a single Reload when the section is unavailable', async () => {
  mocks.load.mockRejectedValueOnce(new Error('down'));
  render(<CoManagedTicketSection target={{ kind: 'local', ticketId: 'ticket-a' }} />);
  await screen.findByRole('alert');
  expect(screen.getAllByRole('button', { name: 'coManaged.ticket.reload' })).toHaveLength(1);
  fireEvent.click(document.getElementById('co-ticket-reload')!);
  await screen.findByText('Acme MSP', { selector: '#co-ticket-responsibility span' });
});

it('lets the sponsor side change the MSP assignment with the current revision and refreshes signals', async () => {
  mocks.load.mockResolvedValue(screenData({ side: 'sponsor', canHandBack: false }));
  mocks.assignment.mockResolvedValue(assignmentData({ canEdit: true, canAssign: true }));
  mocks.assignees.mockResolvedValue({ options: [{ tenant: 'msp', kind: 'user', id: 'user-2', name: 'Lee Tech', organizationName: 'Acme MSP' }], nextAfterId: null });
  mocks.assign.mockResolvedValue({ ok: true });
  const onChanged = vi.fn();
  render(<CoManagedTicketSection target={{ kind: 'shared', resource }} onChanged={onChanged} />);
  fireEvent.click(await screen.findByRole('button', { name: 'coManaged.section.change' }));
  await waitFor(() => expect(mocks.assignees).toHaveBeenCalled());
  fireEvent.click(document.getElementById('co-ticket-assignment-person')!);
  fireEvent.click(await screen.findByText('Lee Tech · Acme MSP'));
  fireEvent.click(document.getElementById('co-ticket-assignment-save')!);
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(mocks.assign).toHaveBeenCalledWith(resource, { operationId: expect.any(String), expectedRevision: 7, assignee: { tenant: 'msp', kind: 'user', id: 'user-2' } });
  expect(mocks.signals).toHaveBeenCalledTimes(1);
});
