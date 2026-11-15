// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({ explain: vi.fn(), search: vi.fn() }));
vi.mock('@/lib/actions/coManagedSeatActions', () => ({
  explainCoManagedSeatTicketAccessAction: actions.explain,
  searchCoManagedSeatAccessTicketsAction: actions.search,
}));
const interpolate = (text: string, o?: any) => text.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(o?.[k] ?? ''));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (k: string, o?: any) => interpolate(o?.defaultValue ?? (k.endsWith('resolverBoardScope')
    ? 'The record is on a board outside this user\'s board scope, so {{action}} on {{resource}} is denied.' : k), o) }),
}));
vi.mock('@alga-psa/projects/components/TicketSelect', () => ({
  default: ({ options, onValueChange }: any) => (
    <ul>{options.map((o: any) => <li key={o.value}><button onClick={() => onValueChange(o.value)}>{o.label}</button></li>)}</ul>
  ),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, footer, title }: any) => <div role="dialog"><h2>{title}</h2>{children}{footer}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

import SeatTechnicianUsers from '@/components/settings/general/SeatTechnicianUsers';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const user = { user_id: '11111111-1111-4111-8111-111111111111', first_name: 'Dana', last_name: 'Reyes', email: 'dana@client.example', username: 'dana' } as any;
const listings = { [user.user_id]: { userId: user.user_id, clientName: 'Acme Co', state: 'active' as const } };

beforeEach(() => { actions.explain.mockReset(); actions.search.mockReset().mockResolvedValue([{ id: 'tk-1', label: 'T-1001 — Printer is down' }]); });
afterEach(cleanup);

describe('seat technicians section of user administration', () => {
  it('lists the technician under their client\'s name, with no raw ids', () => {
    const { container } = render(<SeatTechnicianUsers users={[user]} listings={listings} />);
    expect(screen.getByText('Seat technicians')).toBeInTheDocument();
    expect(screen.getByText('Dana Reyes')).toBeInTheDocument();
    expect(screen.getByText('Acme Co')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(UUID);
  });

  it('more technicians than one page holds are paged, never silently dropped', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...user, user_id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`, first_name: `Tech${i}`, last_name: 'Seat',
    }));
    const manyListings = Object.fromEntries(many.map((u) => [u.user_id, { userId: u.user_id, clientName: 'Acme Co', state: 'active' as const }]));
    const { container } = render(<SeatTechnicianUsers users={many} listings={manyListings} />);
    expect(screen.getByText('Tech0 Seat')).toBeInTheDocument();
    expect(screen.queryByText('Tech11 Seat')).toBeNull();
    // The pager is shown, so the remaining technicians are one page away.
    expect(await screen.findByText(/Page 1 of 2/)).toBeInTheDocument();
    expect(container.querySelector('#seat-technician-users-table-pagination-next-btn')).not.toBeNull();
  });

  it('a client outside the administrator\'s scope reads as unavailable, not as a blank', () => {
    render(<SeatTechnicianUsers users={[user]} listings={{ [user.user_id]: { ...listings[user.user_id], clientName: null } }} />);
    expect(screen.getByText('Client not available')).toBeInTheDocument();
  });

  it('effective access: picks a ticket by number and title and shows the board-scope reason the simulator gave', async () => {
    actions.explain.mockResolvedValue({ ok: true, allowed: false, explanations: [
      { code: 'resolver_template_denied', kind: 'resolver_board_scope', messageKey: 'policyManagement.simulator.explanations.resolverBoardScope', params: { resource: 'ticket', action: 'read' } },
    ] });
    const { container } = render(<SeatTechnicianUsers users={[user]} listings={listings} />);
    fireEvent.click(screen.getByText('Effective access'));
    fireEvent.click(await screen.findByText('T-1001 — Printer is down'));
    await waitFor(() => expect(screen.getByText('Dana Reyes cannot read this ticket.')).toBeInTheDocument());
    expect(actions.explain).toHaveBeenCalledWith({ userId: user.user_id, ticketId: 'tk-1' });
    expect(screen.getByText(/outside this user's board scope/)).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(UUID);
  });

  it('a refusal (CE has no simulator) reads as a translated not-available message, never an unhandled error', async () => {
    actions.explain.mockResolvedValue({ ok: false, code: 'simulator_unavailable' });
    render(<SeatTechnicianUsers users={[user]} listings={listings} />);
    fireEvent.click(screen.getByText('Effective access'));
    fireEvent.click(await screen.findByText('T-1001 — Printer is down'));
    await waitFor(() => expect(screen.getByText(/cannot be checked for this ticket/)).toBeInTheDocument());
    expect(document.getElementById('seat-technician-effective-access-allowed')).toBeNull();
  });

  it('an allowed ticket says so and lists no reasons', async () => {
    actions.explain.mockResolvedValue({ ok: true, allowed: true, explanations: [] });
    render(<SeatTechnicianUsers users={[user]} listings={listings} />);
    fireEvent.click(screen.getByText('Effective access'));
    fireEvent.click(await screen.findByText('T-1001 — Printer is down'));
    await waitFor(() => expect(screen.getByText('Dana Reyes can read this ticket.')).toBeInTheDocument());
    expect(document.getElementById('seat-technician-effective-access-reasons')).toBeNull();
  });
});
