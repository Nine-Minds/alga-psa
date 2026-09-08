/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedTicketAssignment from '../../../components/co-managed/CoManagedTicketAssignment';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), read: vi.fn(), choices: vi.fn(), save: vi.fn(), saved: vi.fn(), unavailable: vi.fn(), reload: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedTicketAssignmentActions', () => ({ getSharedTicketAssignmentAction: mocks.read, listSharedTicketAssigneesAction: mocks.choices, assignSharedTicketAction: mocks.save }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata() {}, updateActions() {} }) }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, disabled, options, onValueChange }: any) => <label htmlFor={id}>{label}<select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}><option value="">Select</option>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null }));
const resource = { kind: 'ticket' as const, tenant: 'customer', relationshipId: 'relationship', id: 'ticket' };
const person = { tenant: 'msp', kind: 'user', id: 'user', name: 'Alex', organizationName: 'MSP' };
const state = () => ({ resource, canEdit: true, canAssign: true, revision: 2, hasAssignment: false, mspAssignment: null });
const props = () => ({ resource, onSaved: mocks.saved, onUnavailable: mocks.unavailable, onReload: mocks.reload });
const mount = () => render(<CoManagedFeatureBoundary><CoManagedTicketAssignment {...props()} /></CoManagedFeatureBoundary>);
const choose = async () => { await screen.findByRole('option', { name: 'Alex · MSP' }); await waitFor(() => expect(screen.getByLabelText('coManaged.projects.assignment.assignee')).not.toBeDisabled()); fireEvent.change(screen.getByLabelText('coManaged.projects.assignment.assignee'), { target: { value: 'user' } }); };
const save = () => fireEvent.click(screen.getByRole('button', { name: 'coManaged.projects.assignment.assign' }));
beforeEach(() => { vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null }); mocks.read.mockResolvedValue(state()); mocks.choices.mockResolvedValue({ options: [person], nextAfterId: null }); mocks.save.mockResolvedValue({ ok: true, receipt: {} }); });
afterEach(cleanup);
it.each([{ enabled: false }, { enabled: true, loading: true }, { enabled: undefined }, { enabled: true, error: new Error('Flag unavailable') }])('gates assignment UI and reads for flag state %j', flag => {
  mocks.flag.mockReturnValue({ loading: false, error: null, ...flag }); mount(); expect(mocks.read).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
});
it.each([0, 2])('assigns the qualified option with retained revision %s and refreshes after success', async revision => {
  mocks.read.mockResolvedValue({ ...state(), revision });
  mount(); await choose(); save(); await waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce());
  expect(mocks.save).toHaveBeenCalledWith(resource, { operationId: expect.any(String), expectedRevision: revision, assignee: { tenant: 'msp', kind: 'user', id: 'user' } });
});
it('loads further scoped options and switches between technician and team choices', async () => {
  mocks.choices.mockImplementation(async (_resource, kind, after) => kind === 'team' ? { options: [{ ...person, kind: 'team', id: 'team', name: 'Service desk' }], nextAfterId: null } : { options: after ? [{ ...person, id: 'second', name: 'Pat' }] : [person], nextAfterId: after ? null : 'cursor' });
  mount(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'coManaged.projects.assignment.more' }));
  await screen.findByRole('option', { name: 'Pat · MSP' }); expect(mocks.choices).toHaveBeenCalledWith(resource, 'user', 'cursor');
  await waitFor(() => expect(screen.getByLabelText('coManaged.projects.assignment.kind')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('coManaged.projects.assignment.kind'), { target: { value: 'team' } });
  await screen.findByRole('option', { name: 'Service desk · MSP' }); expect(screen.queryByRole('option', { name: 'Alex · MSP' })).toBeNull();
  await waitFor(() => expect(screen.getByLabelText('coManaged.projects.assignment.assignee')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('coManaged.projects.assignment.assignee'), { target: { value: 'team' } }); save();
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(resource, expect.objectContaining({ assignee: { tenant: 'msp', kind: 'team', id: 'team' } })));
});
it.each(['throw', 'response'])('freezes uncertain %s saves for exact retry', async mode => {
  if (mode === 'throw') mocks.save.mockRejectedValueOnce(new Error('Lost response')); else mocks.save.mockResolvedValueOnce({ ok: false, code: 'unknownOutcome' });
  mount(); await choose(); save(); await screen.findByRole('alert');
  const first = structuredClone(mocks.save.mock.calls[0]); expect(screen.getByLabelText('coManaged.projects.assignment.kind')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' })); await waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce()); expect(mocks.save.mock.calls[1]).toEqual(first);
});
it('allows clearing an assignment whose collaborator is no longer available', async () => {
  mocks.read.mockResolvedValue({ ...state(), hasAssignment: true }); mount(); await screen.findByText('coManaged.ticket.assignment.unavailable');
  await waitFor(() => expect(screen.getByRole('button', { name: 'coManaged.projects.assignment.clear' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.projects.assignment.clear' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(resource, expect.objectContaining({ assignee: null, expectedRevision: 2 })));
});
it('shows permitted assignment read-only and avoids choices when fields are masked', async () => {
  mocks.read.mockResolvedValue({ ...state(), canEdit: false, canAssign: false, hasAssignment: true, mspAssignment: person });
  mount(); await screen.findByText('MSP · Alex'); expect(mocks.choices).not.toHaveBeenCalled(); expect(screen.queryByRole('combobox')).toBeNull(); cleanup();
  mocks.read.mockResolvedValue({ resource, canEdit: false, canAssign: false }); mount(); await screen.findByText('coManaged.ticket.restricted'); expect(screen.queryByText('MSP · Alex')).toBeNull(); expect(mocks.choices).not.toHaveBeenCalled();
});
it('requires reload after conflict and clears values after access is revoked', async () => {
  mocks.save.mockResolvedValueOnce({ ok: false, code: 'conflict' }); mount(); await choose(); save();
  expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.editor.errors.conflict'); expect(screen.getByLabelText('coManaged.projects.assignment.assignee')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.reload' })); expect(mocks.reload).toHaveBeenCalledOnce(); cleanup();
  mocks.save.mockResolvedValue({ ok: false, code: 'forbidden' }); mount(); await choose(); save();
  expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.editor.loadError'); expect(screen.queryByRole('combobox')).toBeNull(); expect(mocks.unavailable).toHaveBeenCalledOnce();
});
it('discards pending choice responses after navigating to another qualified ticket', async () => {
  let resolve!: (value: any) => void; mocks.choices.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const view = render(<CoManagedTicketAssignment {...props()} />); await waitFor(() => expect(mocks.choices).toHaveBeenCalledOnce());
  const next = { ...resource, tenant: 'other-customer' }; view.rerender(<CoManagedTicketAssignment {...props()} resource={next} />);
  await choose(); await act(async () => resolve({ options: [{ ...person, name: 'Stale name' }], nextAfterId: null }));
  expect(screen.queryByRole('option', { name: 'Stale name · MSP' })).toBeNull(); save(); await waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce()); expect(mocks.save.mock.lastCall[0]).toEqual(next);
});
