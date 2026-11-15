import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * User administration's seat technician actions (F088, F089): the capability and the user-read permission are
 * checked on the server before any read, and the effective-access check reaches only users who hold a live seat.
 */
const gate = vi.hoisted(() => ({ open: true, permissions: new Set<string>(), userType: 'internal', scopedOut: new Set<string>() }));
const domain = vi.hoisted(() => ({ technicians: vi.fn(), simulate: vi.fn(), tickets: vi.fn() }));
const createTenantKnex = vi.hoisted(() => vi.fn());
const browserActor = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/capability/server', () => ({
  requireCapabilityForAction: async () => { if (!gate.open) throw new Error('CAPABILITY_UNAVAILABLE'); },
  requireCapabilityEitherMode: async () => { if (!gate.open) throw new Error('CAPABILITY_UNAVAILABLE'); return 'admits'; },
}));
vi.mock('@alga-psa/core/capability', () => ({ admits: async () => ({ admitted: true }), serves: async () => ({ served: true }) }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: gate.userType }, { tenant: 't' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async (_u: unknown, resource: string, action: string) => gate.permissions.has(`${resource}:${action}`) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: (...a: any[]) => createTenantKnex(...a), tenantDb: () => ({}) }));
vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({
  createClientScopeContext: async () => ({ permits: async (_r: string, id: string) => !gate.scopedOut.has(id) }),
}));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: vi.fn() }));
vi.mock('@alga-psa/licensing', () => ({ CoManagedAdmissionError: class extends Error {}, resizeCoManagedSeatAllocation: vi.fn(), getCoManagedEntitlementState: vi.fn() }));
vi.mock('@alga-psa/co-managed', () => ({
  CoManagedSeatArrangementError: class extends Error {}, CoManagedSeatInvitationError: class extends Error {},
  readCoManagedSeatTechnicianUsers: (...a: any[]) => domain.technicians(...a),
}));
vi.mock('@enterprise/lib/actions/auth/authorizationBundleActions', () => ({
  runAuthorizationBundleSimulationAction: (...a: any[]) => domain.simulate(...a),
  listAuthorizationSimulationRecordsAction: (...a: any[]) => domain.tickets(...a),
}));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: (...a: any[]) => browserActor(...a) }));
vi.mock('../../../lib/co-managed/admitSponsor', () => ({ admitCoManagedSponsor: vi.fn() }));

const load = () => import('@/lib/actions/coManagedSeatActions');
const technician = { userId: 'tech', assignmentId: 'a', arrangementId: 'arr', clientId: 'c1', clientName: 'Acme Co', state: 'active' };

beforeEach(() => {
  gate.open = true; gate.userType = 'internal'; gate.scopedOut = new Set();
  gate.permissions = new Set(['user:read']);
  for (const fn of Object.values(domain)) fn.mockReset();
  createTenantKnex.mockReset().mockResolvedValue({ knex: 'knex' });
  browserActor.mockReset().mockResolvedValue({ kind: 'session' });
});

describe('seat technicians in user administration', () => {
  it('capability closed: every action refuses before a connection or a read', async () => {
    gate.open = false;
    const actions = await load();
    for (const run of [
      () => actions.listCoManagedSeatTechniciansAction(),
      () => actions.searchCoManagedSeatAccessTicketsAction({ search: 'x' }),
      () => actions.explainCoManagedSeatTicketAccessAction({ userId: 'tech', ticketId: 'tk' }),
    ]) await expect(run()).rejects.toThrow('CAPABILITY_UNAVAILABLE');
    expect(createTenantKnex).not.toHaveBeenCalled();
    for (const fn of Object.values(domain)) expect(fn).not.toHaveBeenCalled();
  });

  it('needs the permission to read users, and an internal user', async () => {
    const actions = await load();
    gate.permissions.clear();
    await expect(actions.listCoManagedSeatTechniciansAction()).rejects.toThrow('Permission denied');
    gate.permissions.add('user:read'); gate.userType = 'client';
    await expect(actions.explainCoManagedSeatTicketAccessAction({ userId: 'tech', ticketId: 'tk' })).rejects.toThrow('Permission denied');
    expect(domain.technicians).not.toHaveBeenCalled();
    expect(domain.simulate).not.toHaveBeenCalled();
  });

  it('lists each seat technician with the client name, and hides the name of a client outside the administrator\'s scope', async () => {
    domain.technicians.mockResolvedValue([technician, { ...technician, userId: 'tech2', clientId: 'c2', clientName: 'Hidden Co' }]);
    gate.scopedOut.add('c2');
    const { listCoManagedSeatTechniciansAction } = await load();
    await expect(listCoManagedSeatTechniciansAction()).resolves.toEqual([
      { userId: 'tech', clientName: 'Acme Co', state: 'active' },
      { userId: 'tech2', clientName: null, state: 'active' },
    ]);
    expect(domain.technicians).toHaveBeenCalledWith('knex', { sponsorTenant: 't' });
  });

  it('explains through the simulator: a ticket read for the technician, no bundle, the published decision returned', async () => {
    domain.technicians.mockResolvedValue([technician]);
    const explanation = { code: 'resolver_template_denied', kind: 'resolver_board_scope', messageKey: 'k', params: { resource: 'ticket', action: 'read' } };
    domain.simulate.mockResolvedValue({ ok: true, data: {
      draft: { allowed: false, reasonCodes: [], explanations: [] },
      published: { allowed: false, reasonCodes: ['builtin:resolver_template_denied'], explanations: [explanation] },
    } });
    const { explainCoManagedSeatTicketAccessAction } = await load();
    await expect(explainCoManagedSeatTicketAccessAction({ userId: 'tech', ticketId: 'tk' }))
      .resolves.toEqual({ ok: true, allowed: false, explanations: [explanation] });
    expect(domain.simulate).toHaveBeenCalledWith({ principalUserId: 'tech', resourceType: 'ticket', action: 'read', resourceId: 'tk' });
  });

  it('is not a way to simulate anyone else: a user without a live seat is refused and nothing is simulated', async () => {
    domain.technicians.mockResolvedValue([technician]);
    const { explainCoManagedSeatTicketAccessAction } = await load();
    await expect(explainCoManagedSeatTicketAccessAction({ userId: 'staff', ticketId: 'tk' })).rejects.toThrow('Permission denied');
    expect(domain.simulate).not.toHaveBeenCalled();
  });

  it('a simulator refusal comes back as a message, not an allow', async () => {
    domain.technicians.mockResolvedValue([technician]);
    domain.simulate.mockResolvedValue({ ok: false, error: { code: 'x', message: 'Not supported.' } });
    const { explainCoManagedSeatTicketAccessAction } = await load();
    await expect(explainCoManagedSeatTicketAccessAction({ userId: 'tech', ticketId: 'tk' })).resolves.toEqual({ ok: false, message: 'Not supported.' });
  });

  it('the picker reads tickets through the simulator\'s record list with the search term', async () => {
    domain.tickets.mockResolvedValue([{ id: 't1', label: 'T-1 — Printer' }]);
    const { searchCoManagedSeatAccessTicketsAction } = await load();
    await expect(searchCoManagedSeatAccessTicketsAction({ search: 'print' })).resolves.toEqual([{ id: 't1', label: 'T-1 — Printer' }]);
    expect(domain.tickets).toHaveBeenCalledWith({ resourceType: 'ticket', search: 'print' });
  });
});
