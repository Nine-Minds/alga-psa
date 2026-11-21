// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({
  resize: vi.fn(), invite: vi.fn(), resend: vi.fn(), revoke: vi.fn(), options: vi.fn(),
  boards: vi.fn(), projects: vi.fn(), handoff: vi.fn(), choices: vi.fn(),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(o?.[k])) }),
}));
vi.mock('@/lib/actions/coManagedSeatActions', () => ({
  changeCoManagedSeatAllocationAction: actions.resize, inviteCoManagedSeatTechnicianAction: actions.invite,
  resendCoManagedSeatInvitationAction: actions.resend, revokeCoManagedSeatInvitationAction: actions.revoke,
  getCoManagedSeatAdminOptions: actions.options, setCoManagedSeatBoardScopeAction: actions.boards,
  getCoManagedSeatContactChoicesAction: actions.choices, setCoManagedSeatProjectGrantsAction: actions.projects, setCoManagedSeatHandoffDefaultsAction: actions.handoff,
}));

import { QuickAddClientProvider } from '@alga-psa/ui/context/QuickAddClientContext';
import CoManagedSeatPanel from '@/components/co-managed/CoManagedSeatPanel';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const panel = (overrides: any = {}) => ({
  arrangementId: '11111111-1111-4111-8111-111111111111', clientId: '22222222-2222-4222-8222-222222222222', clientName: 'Acme',
  allocationId: '33333333-3333-4333-8333-333333333333', state: 'active', revision: 2, seats: 3, usedSeats: 2,
  technicians: [
    { assignmentId: 'as-active', contactId: 'c-ada', state: 'active', name: 'Ada Active', email: 'ada@client.example', expiresAt: null, expired: false },
    { assignmentId: 'as-invited', contactId: 'c-ian', state: 'invited', name: 'Ian Invited', email: 'ian@client.example', expiresAt: '2030-01-01T00:00:00.000Z', expired: false },
  ],
  boardScope: [{ boardId: 'b1', canCreate: false }], sharedProjectIds: ['p1'], handoffDefaults: {}, ...overrides,
});
const quickAdd = vi.hoisted(() => ({ props: null as any }));
const callbacks = {
  renderQuickAddClient: () => null, renderQuickAddInteraction: () => null, openInteractionDetails: async () => undefined,
  renderQuickAddContact: (props: any) => {
    quickAdd.props = props;
    return props.isOpen ? <button onClick={() => props.onContactAdded({ contact_name_id: 'c-zoe', full_name: 'Zoe New' })}>Create Zoe</button> : null;
  },
};
const mount = (props: any = {}) => render(
  <QuickAddClientProvider value={callbacks}><CoManagedSeatPanel panel={panel()} canManage idPrefix="t" onChanged={vi.fn()} {...props} /></QuickAddClientProvider>);
const pickContact = async (name: RegExp) => {
  fireEvent.click(await screen.findByRole('button', { name: 'Choose a contact' }));
  fireEvent.click(await screen.findByRole('option', { name }));
};

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.choices.mockResolvedValue([
    { contactId: 'c-dana', name: 'Dana Reyes', email: 'dana@s34-review.example', blocker: null },
    { contactId: 'c-gone', name: 'Ines Inactive', email: 'ines@s34-review.example', blocker: 'INACTIVE' },
    { contactId: 'c-nomail', name: 'Nora NoEmail', email: null, blocker: 'NO_EMAIL' },
    { contactId: 'c-held', name: 'Hal Holder', email: 'hal@s34-review.example', blocker: 'HAS_SEAT' },
  ]);
  actions.options.mockResolvedValue({
    boards: [{ boardId: 'b1', name: 'Service desk' }, { boardId: 'b2', name: 'Projects' }],
    projects: [{ projectId: 'p1', name: 'Rollout' }, { projectId: 'p2', name: 'Migration' }],
    staff: [{ userId: 'u1', name: 'Sam Staff' }],
  });
});
afterEach(cleanup);

describe('seat arrangement panel', () => {
  // F085
  it('shows seats used and allocated and the technicians by name, never an id', async () => {
    const { container } = mount();
    expect(screen.getByText('2 of 3 seats used')).toBeInTheDocument();
    expect(screen.getByText('Ada Active')).toBeInTheDocument();
    expect(screen.getByText('Ian Invited')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Service desk')).toBeInTheDocument());
    expect((container.textContent ?? '')).not.toMatch(UUID);
  });

  // F085
  it('changes the allocation against the size it last showed', async () => {
    actions.resize.mockResolvedValue({ changed: true });
    const onChanged = vi.fn();
    mount({ onChanged });
    fireEvent.change(screen.getByLabelText('Seats allocated'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change seats' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(actions.resize).toHaveBeenCalledWith({ arrangementId: panel().arrangementId, seats: 5, expectedSeats: 3 });
  });

  it('names a refused resize', async () => {
    actions.resize.mockResolvedValue({ rejected: true, errorCode: 'CO_MANAGED_SEAT_LIMIT' });
    mount();
    fireEvent.change(screen.getByLabelText('Seats allocated'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change seats' }));
    await waitFor(() => expect(screen.getByText(/Every seat is in use/)).toBeInTheDocument());
  });

  // F085: resend and withdraw exist for a pending invitation only; an accepted technician has neither.
  it('offers resend and withdraw for the pending invitation only', async () => {
    actions.resend.mockResolvedValue({ resent: true, delivered: true });
    actions.revoke.mockResolvedValue({ revoked: true });
    mount();
    expect(screen.getAllByRole('button', { name: 'Resend' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(actions.resend).toHaveBeenCalledWith({ assignmentId: 'as-invited' }));
    expect(await screen.findByText('Invitation sent.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    // The confirmation dialog's own Withdraw button is the last one in the document.
    fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw' }).at(-1)!);
    await waitFor(() => expect(actions.revoke).toHaveBeenCalledWith({ assignmentId: 'as-invited' }));
  });

  it('says so when the invitation email did not send', async () => {
    actions.resend.mockResolvedValue({ resent: true, delivered: false });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    expect(await screen.findByText('The seat is held, but the email did not send. Resend it.')).toBeInTheDocument();
  });

  // F085: the technician's name links to the contact; a seat from before contacts were recorded is plain text.
  it('links each technician to their contact', () => {
    mount({ panel: panel({ technicians: [
      ...panel().technicians, { assignmentId: 'as-old', contactId: null, state: 'active', name: 'Olga Older', email: 'olga@client.example', expiresAt: null, expired: false }] }) });
    expect(screen.getByRole('link', { name: 'Ada Active' })).toHaveAttribute('href', '/msp/contacts/c-ada');
    expect(screen.getByRole('link', { name: 'Ian Invited' })).toHaveAttribute('href', '/msp/contacts/c-ian');
    expect(screen.queryByRole('link', { name: 'Olga Older' })).not.toBeInTheDocument();
  });

  // F085
  it('invites another technician by picking one of the client\'s contacts', async () => {
    actions.invite.mockResolvedValue({ invited: true, delivered: true });
    mount();
    expect(screen.getByRole('button', { name: 'Invite technician' })).toBeDisabled();
    await pickContact(/Dana Reyes/);
    fireEvent.click(screen.getByRole('button', { name: 'Invite technician' }));
    await waitFor(() => expect(actions.invite).toHaveBeenCalledWith({ arrangementId: panel().arrangementId, contactId: 'c-dana' }));
    expect(actions.choices).toHaveBeenCalledWith(panel().clientId);
    // No free-text name or email: the only fields are the contact picker and the seat count.
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('names a contact the server refused', async () => {
    actions.invite.mockResolvedValue({ rejected: true, errorCode: 'CONTACT_HAS_SEAT' });
    mount();
    await pickContact(/Dana Reyes/);
    fireEvent.click(screen.getByRole('button', { name: 'Invite technician' }));
    expect(await screen.findByText('This contact already holds a seat or a pending invitation.')).toBeInTheDocument();
  });

  it('adds a contact who is not on file yet through quick-add, with the client preset, and selects them', async () => {
    actions.invite.mockResolvedValue({ invited: true, delivered: true });
    mount();
    actions.choices.mockResolvedValue([{ contactId: 'c-zoe', name: 'Zoe New', email: 'zoe@s34-review.example', blocker: null }]);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a contact' }));
    fireEvent.click(await screen.findByRole('button', { name: /Add new contact/ }));
    expect(quickAdd.props).toMatchObject({ isOpen: true, selectedClientId: panel().clientId });
    fireEvent.click(await screen.findByRole('button', { name: 'Create Zoe' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Invite technician' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Invite technician' }));
    await waitFor(() => expect(actions.invite).toHaveBeenCalledWith({ arrangementId: panel().arrangementId, contactId: 'c-zoe' }));
  });

  // F085
  it('saves board scope, shared projects and handoff defaults through their own commands', async () => {
    actions.boards.mockResolvedValue({ changed: true }); actions.projects.mockResolvedValue({ changed: true }); actions.handoff.mockResolvedValue({ changed: true });
    mount();
    await waitFor(() => expect(screen.getByLabelText('Projects')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Projects'));
    fireEvent.click(screen.getByRole('button', { name: 'Save board scope' }));
    await waitFor(() => expect(actions.boards).toHaveBeenCalledWith({ arrangementId: panel().arrangementId,
      boards: [{ boardId: 'b1', canCreate: false }, { boardId: 'b2', canCreate: false }] }));
    fireEvent.click(screen.getByLabelText('Migration'));
    fireEvent.click(screen.getByRole('button', { name: 'Save shared projects' }));
    await waitFor(() => expect(actions.projects).toHaveBeenCalledWith({ arrangementId: panel().arrangementId, projectIds: ['p1', 'p2'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Save handoff defaults' }));
    await waitFor(() => expect(actions.handoff).toHaveBeenCalledWith({ arrangementId: panel().arrangementId, assignedTo: null }));
  });

  it('read-only without manage rights: usage and technicians, no controls and no option read', () => {
    mount({ canManage: false });
    expect(screen.getByText('2 of 3 seats used')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(actions.options).not.toHaveBeenCalled();
    expect(actions.choices).not.toHaveBeenCalled();
  });
});
