// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({ enable: vi.fn(), options: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(o?.[k])) }),
}));
vi.mock('@/lib/actions/coManagedSeatActions', () => ({
  enableCoManagedSeatArrangementAction: actions.enable, getCoManagedSeatAdminOptions: actions.options,
}));

import CoManagedShapeChooser from '@/components/co-managed/CoManagedShapeChooser';

const enable = (overrides: any = {}) => ({ capacity: { purchased: 10, allocated: 4, available: 6 }, blocker: null, ...overrides });
const mount = (props: any = {}) => render(
  <CoManagedShapeChooser clientId="c1" idPrefix="t" enable={enable()} workspaceSetup={<div>workspace-setup-flow</div>} onEnabled={vi.fn()} {...props} />);

beforeEach(() => {
  actions.enable.mockReset();
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
    fireEvent.change(screen.getByLabelText('First technician name'), { target: { value: 'Dana Reyes' } });
    fireEvent.change(screen.getByLabelText('First technician email'), { target: { value: 'dana@client.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable seats' }));
    await waitFor(() => expect(onEnabled).toHaveBeenCalledOnce());
    expect(actions.enable).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'c1', seats: 3, boards: [{ boardId: 'b1', canCreate: true }],
      technician: { name: 'Dana Reyes', email: 'dana@client.example' }, operationId: expect.any(String) }));
  });

  it('cannot confirm more seats than the pool has, and a refusal keeps the same operation key for the retry', async () => {
    actions.enable.mockResolvedValueOnce({ rejected: true, errorCode: 'EMAIL_IN_USE' }).mockResolvedValueOnce({ created: true });
    const onEnabled = vi.fn();
    mount({ onEnabled });
    fireEvent.click(screen.getByRole('radio', { name: /Seat/ }));
    fireEvent.change(screen.getByLabelText('First technician name'), { target: { value: 'Dana' } });
    fireEvent.change(screen.getByLabelText('First technician email'), { target: { value: 'dana@client.example' } });
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
