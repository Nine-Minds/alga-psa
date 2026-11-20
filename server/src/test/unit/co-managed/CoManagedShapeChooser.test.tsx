// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({ enable: vi.fn(), options: vi.fn(), choices: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(o?.[k])) }),
}));
vi.mock('@/lib/actions/coManagedSeatActions', () => ({
  enableCoManagedSeatArrangementAction: actions.enable, getCoManagedSeatAdminOptions: actions.options,
  getCoManagedSeatContactChoicesAction: actions.choices,
}));

import { QuickAddClientProvider } from '@alga-psa/ui/context/QuickAddClientContext';
import CoManagedShapeChooser from '@/components/co-managed/CoManagedShapeChooser';

const enable = (overrides: any = {}) => ({ capacity: { purchased: 10, allocated: 4, available: 6 }, blocker: null, ...overrides });
// The standard quick-add contact dialog stands in as a button that "creates" a contact for the preset client.
const quickAdd = vi.hoisted(() => ({ props: null as any }));
const callbacks = {
  renderQuickAddClient: () => null,
  renderQuickAddInteraction: () => null,
  openInteractionDetails: async () => undefined,
  renderQuickAddContact: (props: any) => {
    quickAdd.props = props;
    return props.isOpen ? <button onClick={() => props.onContactAdded({ contact_name_id: 'c-zoe', full_name: 'Zoe New' })}>Create Zoe</button> : null;
  },
};
const mount = (props: any = {}) => render(
  <QuickAddClientProvider value={callbacks}>
    <CoManagedShapeChooser clientId="c1" idPrefix="t" enable={enable()} workspaceSetup={<div>workspace-setup-flow</div>} onEnabled={vi.fn()} {...props} />
  </QuickAddClientProvider>);
const pickContact = async (name: RegExp) => {
  fireEvent.click(await screen.findByRole('button', { name: 'Choose a contact' }));
  fireEvent.click(await screen.findByRole('option', { name }));
};

beforeEach(() => {
  actions.enable.mockReset();
  actions.choices.mockReset().mockResolvedValue([
    { contactId: 'c-dana', name: 'Dana Reyes', email: 'dana@s34-review.example', blocker: null },
    { contactId: 'c-gone', name: 'Ines Inactive', email: 'ines@s34-review.example', blocker: 'INACTIVE' },
    { contactId: 'c-nomail', name: 'Nora NoEmail', email: null, blocker: 'NO_EMAIL' },
    { contactId: 'c-held', name: 'Hal Holder', email: 'hal@s34-review.example', blocker: 'HAS_SEAT' },
  ]);
  actions.options.mockReset().mockResolvedValue({ boards: [{ boardId: 'b1', name: 'Service desk' }, { boardId: 'b2', name: 'Projects' }], projects: [], staff: [] });
});
afterEach(cleanup);

describe('shape chooser', () => {
  // F084
  it('offers Seat and Workspace with one sentence each and shows the pool', () => {
    mount();
    expect(screen.getByRole('radio', { name: /Seat/ })).toBeInTheDocument();
    expect(screen.getByText("The client's technicians work in your PSA, limited to their company.")).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Workspace/ })).toBeInTheDocument();
    expect(screen.getByText("The client's IT team gets its own service desk and escalates to you.")).toBeInTheDocument();
    expect(screen.getByText('6 of 10 seats available. 4 allocated.')).toBeInTheDocument();
    expect(screen.queryByText('workspace-setup-flow')).not.toBeInTheDocument();
  });

  // F084: choosing Workspace hands over to the existing flow, which the chooser does not touch.
  it('Workspace renders the provisioning flow it was given, unchanged', () => {
    mount();
    fireEvent.click(screen.getByRole('radio', { name: /Workspace/ }));
    expect(screen.getByText('workspace-setup-flow')).toBeInTheDocument();
    expect(screen.queryByLabelText('Number of seats')).not.toBeInTheDocument();
  });

  it('without a workspace flow only Seat is offered', () => {
    mount({ workspaceSetup: null });
    expect(screen.queryByRole('radio', { name: /Workspace/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Seat/ })).toBeInTheDocument();
  });

  // F084
  it('shows the blocker, disables Seat and stops: no purchase review is offered', () => {
    mount({ enable: enable({ blocker: 'CAPACITY_UNAVAILABLE', capacity: { purchased: 4, allocated: 4, available: 0 } }) });
    expect(screen.getByText(/The pool has no seats left/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Seat/ })).toBeDisabled();
    expect(screen.queryByText(/purchase/i)).not.toBeInTheDocument();
    // Workspace stays available: it is the existing flow with its own eligibility.
    expect(screen.getByRole('radio', { name: /Workspace/ })).not.toBeDisabled();
  });

  it('an inactive client is named as the blocker', () => {
    mount({ enable: enable({ blocker: 'CLIENT_INACTIVE' }) });
    expect(screen.getByText('Reactivate this client before enabling co-managed IT.')).toBeInTheDocument();
  });

  // F084
  it('Seat collects seats, boards with a create toggle and the first technician, then confirms once', async () => {
    actions.enable.mockResolvedValue({ created: true, scopeSet: true, invited: true, delivered: true, followUpError: null });
    const onEnabled = vi.fn();
    mount({ onEnabled });
    fireEvent.click(screen.getByRole('radio', { name: /Seat/ }));
    await waitFor(() => expect(screen.getByLabelText('Service desk')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Number of seats'), { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText('Service desk'));
    fireEvent.click(screen.getByLabelText('Can create tickets'));
    expect(screen.getByRole('button', { name: 'Enable seats' })).toBeDisabled();
    await pickContact(/Dana Reyes/);
    fireEvent.click(screen.getByRole('button', { name: 'Enable seats' }));
    await waitFor(() => expect(onEnabled).toHaveBeenCalledOnce());
    expect(actions.enable).toHaveBeenCalledWith({
      clientId: 'c1', seats: 3, boards: [{ boardId: 'b1', canCreate: true }], contactId: 'c-dana', operationId: expect.any(String) });
    // The request names the contact and nothing free-typed.
    expect(actions.enable.mock.calls[0][0]).not.toHaveProperty('technician');
    expect(actions.choices).toHaveBeenCalledWith('c1');
  });

  // F084 / F085: the picker offers this client's eligible contacts only; the server decided which.
  it('lists only the contacts the server says can be invited, and counts the rest', async () => {
    mount();
    fireEvent.click(screen.getByRole('radio', { name: /Seat/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a contact' }));
    expect(await screen.findByRole('option', { name: /Dana Reyes/ })).toBeInTheDocument();
    for (const hidden of [/Ines Inactive/, /Nora NoEmail/, /Hal Holder/]) expect(screen.queryByRole('option', { name: hidden })).not.toBeInTheDocument();
    expect(screen.getByText(/Not listed because they are inactive, have no email address, or already hold a seat or invitation: 3\./)).toBeInTheDocument();
    expect(document.querySelector('input[type="email"]')).toBeNull();
  });

  // F084: quick-add with the client preset, then the new contact is selected without another click.
  it('adds a new contact through the standard quick-add dialog and selects it', async () => {
    actions.enable.mockResolvedValue({ created: true, scopeSet: true, invited: true, delivered: true, followUpError: null });
    mount();
    fireEvent.click(screen.getByRole('radio', { name: /Seat/ }));
    actions.choices.mockResolvedValue([
      { contactId: 'c-dana', name: 'Dana Reyes', email: 'dana@s34-review.example', blocker: null },
      { contactId: 'c-zoe', name: 'Zoe New', email: 'zoe@s34-review.example', blocker: null },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a contact' }));
    fireEvent.click(await screen.findByRole('button', { name: /Add new contact/ }));
    expect(quickAdd.props).toMatchObject({ isOpen: true, selectedClientId: 'c1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Create Zoe' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Zoe New/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Enable seats' }));
    await waitFor(() => expect(actions.enable).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'c-zoe' })));
  });

  it('a contact added without an email is not selected, and the screen says why', async () => {
    mount();
    fireEvent.click(screen.getByRole('radio', { name: /Seat/ }));
    actions.choices.mockResolvedValue([{ contactId: 'c-zoe', name: 'Zoe New', email: null, blocker: 'NO_EMAIL' }]);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a contact' }));
    fireEvent.click(await screen.findByRole('button', { name: /Add new contact/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create Zoe' }));
    expect(await screen.findByText('Zoe New was added but has no email address, so they cannot be invited yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable seats' })).toBeDisabled();
  });

  it('cannot confirm more seats than the pool has, and a refusal keeps the same operation key for the retry', async () => {
    actions.enable.mockResolvedValueOnce({ rejected: true, errorCode: 'EMAIL_IN_USE' }).mockResolvedValueOnce({ created: true });
    const onEnabled = vi.fn();
    mount({ onEnabled });
    fireEvent.click(screen.getByRole('radio', { name: /Seat/ }));
    await pickContact(/Dana Reyes/);
    fireEvent.change(screen.getByLabelText('Number of seats'), { target: { value: '7' } });
    expect(screen.getByRole('button', { name: 'Enable seats' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Number of seats'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable seats' }));
    await waitFor(() => expect(screen.getByText(/already belongs to a user account/)).toBeInTheDocument());
    expect(onEnabled).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enable seats' }));
    await waitFor(() => expect(onEnabled).toHaveBeenCalledOnce());
    const [first, second] = actions.enable.mock.calls.map(([input]) => input.operationId);
    expect(first).toBe(second);
  });
});
