import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The seat administration actions are thin wrappers: the capability and the co-managed permission are
 * checked on the server before any connection, actor or domain command, and the domain refusals the
 * screen can name come back as data rather than a thrown (redacted) error.
 */
const gate = vi.hoisted(() => ({ clientInScope: true, workspace: true, serves: true, admits: true, checked: [] as string[], permissions: new Set<string>(), userType: 'internal' }));
const domain = vi.hoisted(() => ({
  create: vi.fn(), scope: vi.fn(), invite: vi.fn(), revoke: vi.fn(), refresh: vi.fn(), panel: vi.fn(), enable: vi.fn(),
  grants: vi.fn(), handoff: vi.fn(), resize: vi.fn(), overview: vi.fn(), seatRows: vi.fn(), choices: vi.fn(),
}));
const createTenantKnex = vi.hoisted(() => vi.fn());
const browserActor = vi.hoisted(() => vi.fn());
const email = vi.hoisted(() => vi.fn());

class SeatError extends Error { constructor(public code: string) { super(code); } }

vi.mock('@alga-psa/core/capability/server', () => ({
  requireCapabilityForAction: async (_c: string, _t: string, mode = 'admits') => {
    gate.checked.push(mode);
    if (!gate[mode as 'serves' | 'admits']) throw new Error('CAPABILITY_UNAVAILABLE');
  },
  requireCapabilityEitherMode: async () => {
    gate.checked.push('either');
    if (gate.admits) return 'admits';
    if (gate.serves) return 'serves';
    throw new Error('CAPABILITY_UNAVAILABLE');
  },
}));
vi.mock('@alga-psa/core/capability', () => ({
  admits: async (key: string) => ({ admitted: key === 'co-managed' ? gate.workspace : gate.admits }),
  serves: async (key: string) => ({ served: key === 'co-managed' ? gate.workspace : gate.serves }),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: gate.userType, first_name: 'Ada', last_name: 'Admin' }, { tenant: 't' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async (_u: unknown, resource: string, action: string) => gate.permissions.has(`${resource}:${action}`) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: (...a: any[]) => createTenantKnex(...a), tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => ({ allocation_id: 'alloc', client_id: 'c', arrangement_id: 'a' }) }) }) }) }));
vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({
  createClientScopeContext: async () => ({ permits: async () => gate.clientInScope }),
}));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: (...a: any[]) => email(...a) }));
vi.mock('@alga-psa/licensing', () => ({
  CoManagedAdmissionError: class extends Error { constructor(public code: string) { super(code); } },
  resizeCoManagedSeatAllocation: (...a: any[]) => domain.resize(...a),
  getCoManagedEntitlementState: async () => ({ capacity: 10, allocated: 4, available: 6 }),
}));
vi.mock('@alga-psa/co-managed', () => ({
  CoManagedSeatArrangementError: SeatError, CoManagedSeatInvitationError: class extends SeatError {},
  coManagedSeatCommitmentCounter: () => () => 0,
  createCoManagedSeatArrangement: (...a: any[]) => domain.create(...a),
  setCoManagedSeatBoardScope: (...a: any[]) => domain.scope(...a),
  inviteCoManagedSeatTechnician: (...a: any[]) => domain.invite(...a),
  revokeCoManagedSeatInvitation: (...a: any[]) => domain.revoke(...a),
  refreshCoManagedSeatInvitation: (...a: any[]) => domain.refresh(...a),
  readCoManagedSeatArrangementPanel: (...a: any[]) => domain.panel(...a),
  readCoManagedSeatEnableState: (...a: any[]) => domain.enable(...a),
  readCoManagedSeatAdminOptions: vi.fn(async () => ({ boards: [], projects: [], staff: [] })),
  readCoManagedSeatContactChoices: (...a: any[]) => domain.choices(...a),
  readCoManagedSeatOverviewRows: (...a: any[]) => domain.seatRows(...a),
  setCoManagedSeatProjectGrants: (...a: any[]) => domain.grants(...a),
  setCoManagedSeatHandoffDefaults: (...a: any[]) => domain.handoff(...a),
  getCoManagedClientOverview: (...a: any[]) => domain.overview(...a),
  mergeCoManagedOverviewEntries: (entries: any[]) => ({ rows: entries, totalCount: entries.length }),
}));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: (...a: any[]) => browserActor(...a) }));
vi.mock('../../../lib/co-managed/admitSponsor', () => ({ admitCoManagedSponsor: vi.fn() }));

const load = () => import('@/lib/actions/coManagedSeatActions');
const enableInput = { clientId: 'c', operationId: 'op', seats: 2, boards: [{ boardId: 'b', canCreate: true }], contactId: 'contact-1' };

beforeEach(() => {
  gate.clientInScope = true; gate.workspace = true; gate.serves = true; gate.admits = true; gate.checked = []; gate.userType = 'internal';
  gate.permissions = new Set(['co_management:read', 'co_management:manage', 'client:read']);
  for (const fn of Object.values(domain)) fn.mockReset();
  createTenantKnex.mockReset().mockResolvedValue({ knex: 'knex' });
  browserActor.mockReset().mockResolvedValue({ kind: 'session' });
  email.mockReset().mockResolvedValue(true);
  process.env.NEXTAUTH_URL = 'https://msp.example';
});

describe('seat administration gate', () => {
  it('capability closed: every action refuses before a connection or a command', async () => {
    gate.admits = false; gate.serves = false;
    const actions = await load();
    for (const run of [
      () => actions.getCoManagedSeatClientState('c'),
      () => actions.getCoManagedSeatAdminOptions('c'),
      () => actions.getCoManagedSeatContactChoicesAction('c'),
      () => actions.enableCoManagedSeatArrangementAction(enableInput),
      () => actions.changeCoManagedSeatAllocationAction({ arrangementId: 'a', seats: 2, expectedSeats: 1 }),
      () => actions.setCoManagedSeatBoardScopeAction({ arrangementId: 'a', boards: [] }),
      () => actions.setCoManagedSeatProjectGrantsAction({ arrangementId: 'a', projectIds: [] }),
      () => actions.setCoManagedSeatHandoffDefaultsAction({ arrangementId: 'a', assignedTo: null }),
      () => actions.inviteCoManagedSeatTechnicianAction({ arrangementId: 'a', contactId: 'contact-1' }),
      () => actions.resendCoManagedSeatInvitationAction({ assignmentId: 'x' }),
      () => actions.revokeCoManagedSeatInvitationAction({ assignmentId: 'x' }),
      () => actions.getCoManagedCombinedOverviewAction({}),
    ]) await expect(run()).rejects.toThrow('CAPABILITY_UNAVAILABLE');
    expect(createTenantKnex).not.toHaveBeenCalled();
    expect(browserActor).not.toHaveBeenCalled();
    for (const fn of Object.values(domain)) expect(fn).not.toHaveBeenCalled();
  });

  it('served but not admitted: reads work, every write is refused', async () => {
    gate.admits = false;
    domain.panel.mockResolvedValue({ arrangementId: 'a' });
    const actions = await load();
    await expect(actions.getCoManagedSeatClientState('c')).resolves.toEqual({ panel: { arrangementId: 'a' }, enable: null, canManage: false });
    await expect(actions.enableCoManagedSeatArrangementAction(enableInput)).rejects.toThrow('CAPABILITY_UNAVAILABLE');
    await expect(actions.setCoManagedSeatProjectGrantsAction({ arrangementId: 'a', projectIds: [] })).rejects.toThrow('CAPABILITY_UNAVAILABLE');
    expect(domain.create).not.toHaveBeenCalled();
    expect(domain.enable).not.toHaveBeenCalled();
  });

  it('a user without the co-managed permission or a portal user is refused', async () => {
    const actions = await load();
    gate.permissions.delete('co_management:manage');
    await expect(actions.enableCoManagedSeatArrangementAction(enableInput)).rejects.toThrow('Permission denied');
    gate.permissions.clear();
    await expect(actions.getCoManagedSeatClientState('c')).rejects.toThrow('Permission denied');
    gate.userType = 'client'; gate.permissions = new Set(['co_management:read', 'co_management:manage', 'client:read']);
    await expect(actions.getCoManagedSeatClientState('c')).rejects.toThrow('Permission denied');
    expect(domain.create).not.toHaveBeenCalled();
    expect(createTenantKnex).not.toHaveBeenCalled();
  });

  // F084: the chooser is offered to an admitted manager only.
  it('the chooser state is read only for an admitted manager with no arrangement', async () => {
    domain.panel.mockResolvedValue(null);
    domain.enable.mockResolvedValue({ clientName: 'Acme', capacity: { purchased: 3, allocated: 1, available: 2 }, blocker: null });
    const actions = await load();
    await expect(actions.getCoManagedSeatClientState('c')).resolves.toMatchObject({ panel: null, canManage: true, enable: { blocker: null } });
    gate.permissions.delete('co_management:manage');
    await expect(actions.getCoManagedSeatClientState('c')).resolves.toMatchObject({ enable: null, canManage: false });
  });
});

describe('client scope', () => {
  // A bundle that narrows the administrator's clients narrows seat administration with it.
  it('a client outside the administrator\'s scope is refused for reads and for every write, by client, arrangement or assignment', async () => {
    gate.clientInScope = false;
    const actions = await load();
    for (const run of [
      () => actions.getCoManagedSeatClientState('c'),
      () => actions.getCoManagedSeatAdminOptions('c'),
      () => actions.getCoManagedSeatContactChoicesAction('c'),
      () => actions.enableCoManagedSeatArrangementAction(enableInput),
      () => actions.setCoManagedSeatProjectGrantsAction({ arrangementId: 'a', projectIds: [] }),
      () => actions.revokeCoManagedSeatInvitationAction({ assignmentId: 'x' }),
    ]) await expect(run()).rejects.toThrow('Permission denied');
    for (const fn of [domain.create, domain.grants, domain.revoke, domain.panel, domain.enable]) expect(fn).not.toHaveBeenCalled();
  });
});

describe('enabling a seat arrangement', () => {
  it('creates, scopes and invites in that order, reusing the one operation key, and delivers the link', async () => {
    domain.create.mockResolvedValue({ arrangement_id: 'arr' });
    domain.scope.mockResolvedValue([]);
    domain.invite.mockResolvedValue({ created: true, token: 'tok', email: 'dana@client.example', firstName: 'Dana', lastName: 'Reyes' });
    const { enableCoManagedSeatArrangementAction } = await load();
    await expect(enableCoManagedSeatArrangementAction(enableInput)).resolves.toEqual({ created: true, scopeSet: true, invited: true, delivered: true, followUpError: null });
    expect(domain.create).toHaveBeenCalledWith('knex', { sponsorTenant: 't', clientId: 'c', operationId: 'op', seats: 2 });
    expect(domain.scope).toHaveBeenCalledWith('knex', { sponsorTenant: 't', arrangementId: 'arr', boards: [{ boardId: 'b', canCreate: true }] });
    expect(domain.invite).toHaveBeenCalledWith('knex', { sponsorTenant: 't', arrangementId: 'arr', contactId: 'contact-1', invitedBy: 'u' });
    // The name and email come back from the contact row: the action sends none of its own.
    expect(email.mock.calls[0][0]).toMatchObject({ email: 'dana@client.example', teamMemberName: 'Dana Reyes' });
    expect(email).toHaveBeenCalledOnce();
    expect(email.mock.calls[0][0].inviteLink).toBe('https://msp.example/auth/team/setup?token=tok');
  });

  it('a refusal from the arrangement command is returned by code and nothing else runs', async () => {
    domain.create.mockRejectedValue(new SeatError('CAPACITY_UNAVAILABLE'));
    const { enableCoManagedSeatArrangementAction } = await load();
    await expect(enableCoManagedSeatArrangementAction(enableInput)).resolves.toEqual({ rejected: true, errorCode: 'CAPACITY_UNAVAILABLE' });
    expect(domain.scope).not.toHaveBeenCalled();
    expect(domain.invite).not.toHaveBeenCalled();
  });

  it('once the arrangement exists a later refusal is reported without losing it', async () => {
    domain.create.mockResolvedValue({ arrangement_id: 'arr' });
    domain.scope.mockResolvedValue([]);
    domain.invite.mockRejectedValue(new SeatError('EMAIL_IN_USE'));
    const { enableCoManagedSeatArrangementAction } = await load();
    await expect(enableCoManagedSeatArrangementAction(enableInput)).resolves.toMatchObject({ created: true, scopeSet: true, invited: false, followUpError: 'EMAIL_IN_USE' });
  });

  it('a failed email still reports the invitation, so the administrator can resend', async () => {
    domain.create.mockResolvedValue({ arrangement_id: 'arr' });
    domain.scope.mockResolvedValue([]);
    domain.invite.mockResolvedValue({ created: true, token: 'tok', email: 'dana@client.example', firstName: 'Dana', lastName: 'Reyes' });
    email.mockRejectedValue(new Error('smtp down'));
    const { enableCoManagedSeatArrangementAction } = await load();
    await expect(enableCoManagedSeatArrangementAction(enableInput)).resolves.toMatchObject({ invited: true, delivered: false });
  });

  it('an unexpected failure is thrown, not turned into a named refusal', async () => {
    domain.create.mockRejectedValue(new Error('connection reset'));
    const { enableCoManagedSeatArrangementAction } = await load();
    await expect(enableCoManagedSeatArrangementAction(enableInput)).rejects.toThrow('connection reset');
  });
});

describe('contact choices and invitation by contact', () => {
  it('the choices come from the domain read for the client, after the gate, and are returned as read', async () => {
    domain.choices.mockResolvedValue([{ contactId: 'c1', name: 'Dana Reyes', email: 'dana@s34-review.example', blocker: null }]);
    const { getCoManagedSeatContactChoicesAction } = await load();
    await expect(getCoManagedSeatContactChoicesAction('c')).resolves.toEqual([expect.objectContaining({ contactId: 'c1', blocker: null })]);
    expect(domain.choices).toHaveBeenCalledWith('knex', { sponsorTenant: 't', clientId: 'c' });
  });

  it('a manager without admission or the manage permission reads no choices', async () => {
    const actions = await load();
    gate.permissions.delete('co_management:manage');
    await expect(actions.getCoManagedSeatContactChoicesAction('c')).rejects.toThrow('Permission denied');
    gate.permissions.add('co_management:manage');
    gate.admits = false;
    await expect(actions.getCoManagedSeatContactChoicesAction('c')).rejects.toThrow('CAPABILITY_UNAVAILABLE');
    expect(domain.choices).not.toHaveBeenCalled();
  });

  it('inviting passes the contact id and nothing typed, and returns the domain\'s named refusal', async () => {
    domain.invite.mockRejectedValue(new SeatError('CONTACT_WRONG_CLIENT'));
    const { inviteCoManagedSeatTechnicianAction } = await load();
    await expect(inviteCoManagedSeatTechnicianAction({ arrangementId: 'a', contactId: 'contact-1' }))
      .resolves.toEqual({ rejected: true, errorCode: 'CONTACT_WRONG_CLIENT' });
    expect(domain.invite).toHaveBeenCalledWith('knex', { sponsorTenant: 't', arrangementId: 'a', contactId: 'contact-1', invitedBy: 'u' });
  });
});

describe('panel actions', () => {
  it('resize passes the size the screen last saw and the commitment counter', async () => {
    domain.resize.mockResolvedValue(undefined);
    const { changeCoManagedSeatAllocationAction } = await load();
    await expect(changeCoManagedSeatAllocationAction({ arrangementId: 'a', seats: 4, expectedSeats: 3 })).resolves.toEqual({ changed: true });
    expect(domain.resize).toHaveBeenCalledWith('knex', 't', expect.objectContaining({ allocationId: 'alloc', seats: 4, expectedSeats: 3 }));
  });

  it('withdraw, resend and handoff defaults map to their commands', async () => {
    domain.revoke.mockResolvedValue({ revoked: true });
    domain.refresh.mockResolvedValue({ token: 'tok', email: 'd@x.io', firstName: 'D', lastName: '' });
    domain.handoff.mockResolvedValue({});
    const actions = await load();
    await expect(actions.revokeCoManagedSeatInvitationAction({ assignmentId: 'x' })).resolves.toEqual({ revoked: true });
    await expect(actions.resendCoManagedSeatInvitationAction({ assignmentId: 'x' })).resolves.toEqual({ resent: true, delivered: true });
    await expect(actions.setCoManagedSeatHandoffDefaultsAction({ arrangementId: 'a', assignedTo: null })).resolves.toEqual({ changed: true, defaults: {} });
    expect(domain.handoff).toHaveBeenCalledWith('knex', { sponsorTenant: 't', arrangementId: 'a', defaults: {} });
  });

  it('an accepted technician cannot be withdrawn: the command refuses and the code comes back', async () => {
    domain.revoke.mockRejectedValue(new SeatError('ASSIGNMENT_NOT_PENDING'));
    const { revokeCoManagedSeatInvitationAction } = await load();
    await expect(revokeCoManagedSeatInvitationAction({ assignmentId: 'x' })).resolves.toEqual({ rejected: true, errorCode: 'ASSIGNMENT_NOT_PENDING' });
  });
});

describe('combined overview', () => {
  const seatRow = { arrangementId: 'a', clientId: 'c', clientName: 'Acme', state: 'active', seats: 3, usedSeats: 1 };

  it('only the seat side open: the seat rows and the pool, and no workspace read', async () => {
    domain.seatRows.mockResolvedValue([seatRow]);
    gate.workspace = false;
    const { getCoManagedCombinedOverviewAction } = await load();
    const result = await getCoManagedCombinedOverviewAction({});
    expect(result.pool).toEqual({ purchased: 10, allocated: 4, available: 6 });
    expect(result.rows).toEqual([expect.objectContaining({ shape: 'seat', clientName: 'Acme', seats: 3, usedSeats: 1 })]);
    expect(domain.overview).not.toHaveBeenCalled();
  });

  // F086
  it('both shapes: every workspace page is read and merged with the seat rows', async () => {
    domain.seatRows.mockResolvedValue([seatRow]);
    domain.overview.mockResolvedValue({ totalCount: 1, rows: [{ clientId: 'w', clientName: 'Beta', relationshipId: 'rel', operationId: 'op', state: 'active', seats: 2, usedSeats: 2 }] });
    const { getCoManagedCombinedOverviewAction } = await load();
    const result = await getCoManagedCombinedOverviewAction({});
    expect(result.rows.map((row) => [row.shape, row.clientName])).toEqual([['seat', 'Acme'], ['workspace', 'Beta']]);
    expect(result.rows[1]).toMatchObject({ relationshipId: 'rel', seats: 2, usedSeats: 2 });
  });
});
