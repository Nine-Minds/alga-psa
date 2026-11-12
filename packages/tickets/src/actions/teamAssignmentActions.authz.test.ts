import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'msp-1', user_type: 'internal' } as any,
  recordAllowed: true,
  assignment: { assigned_team_id: 'team-old' as string | null, assigned_to: 'agent-old' as string | null },
  resources: ['agent-old', 'agent-team-member'] as string[],
  coreCalls: [] as string[],
  authorizationCalls: [] as any[],
  publishedEvents: [] as any[],
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(state.user, { tenant: 'tenant-1' }, ...args),
  hasPermission: async () => true,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: unknown, work: (trx: any) => Promise<unknown>) => work({ label: 'trx' }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: async (event: any) => { state.publishedEvents.push(event); },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@alga-psa/shared/services/tickets/teamAssignmentCore', () => ({
  assignTeamToTicketCore: async (_trx: unknown, _tenant: string, _actorId: string, _ticketId: string, teamId: string) => {
    state.coreCalls.push('assign');
    state.assignment.assigned_team_id = teamId;
    state.resources.push('agent-new-team-member');
    return state.assignment.assigned_to;
  },
  removeTeamFromTicketCore: async (_trx: unknown, _tenant: string, _actorId: string, _ticketId: string, _options: unknown) => {
    state.coreCalls.push('remove');
    state.assignment.assigned_team_id = null;
    state.resources = ['agent-old'];
  },
}));

vi.mock('../lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccessConcealed: async (input: any) => {
    state.authorizationCalls.push({ ...input, user: input.user.user_id });
    if (!state.recordAllowed) throw new Error('Permission denied: Cannot access ticket');
    return { ticket_id: input.ticketId };
  },
}));

const before = () => ({ assignment: { ...state.assignment }, resources: [...state.resources] });
const removeOptions = { mode: 'remove_all' as const };

describe('team assignment ticket authorization', () => {
  beforeEach(() => {
    state.user = { user_id: 'msp-1', user_type: 'internal' };
    state.recordAllowed = true;
    state.assignment = { assigned_team_id: 'team-old', assigned_to: 'agent-old' };
    state.resources = ['agent-old', 'agent-team-member'];
    state.coreCalls = [];
    state.authorizationCalls = [];
    state.publishedEvents = [];
  });

  it.each([
    ['assign', ['ticket-1', 'team-new', { suppressContactNotifications: true, suppressInternalNotifications: true }]],
    ['remove', ['ticket-1', removeOptions]],
  ] as const)('%s denies a client with generic ticket:update and leaves assignment data unchanged', async (operation, args) => {
    state.user = { user_id: 'client-1', user_type: 'client' };
    const initial = before();
    const actions = await import('./teamAssignmentActions');

    const result = operation === 'assign'
      ? await actions.assignTeamToTicket(...args as [string, string, any])
      : await actions.removeTeamFromTicket(...args as [string, any]);

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(state.coreCalls).toEqual([]);
    expect(state.assignment).toEqual(initial.assignment);
    expect(state.resources).toEqual(initial.resources);
    expect(state.authorizationCalls).toEqual([]);
    expect(state.publishedEvents).toEqual([]);
  });

  it.each([
    ['assign', ['ticket-1', 'team-new']],
    ['remove', ['ticket-1', removeOptions]],
  ] as const)('%s denies an internal user outside the ticket record scope with no mutation', async (operation, args) => {
    state.recordAllowed = false;
    const initial = before();
    const actions = await import('./teamAssignmentActions');

    const result = operation === 'assign'
      ? await actions.assignTeamToTicket(...args as [string, string])
      : await actions.removeTeamFromTicket(...args as [string, any]);

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(state.authorizationCalls).toHaveLength(1);
    expect(state.authorizationCalls[0]).toMatchObject({ ticketId: 'ticket-1', action: 'update', tenant: 'tenant-1', trx: { label: 'trx' } });
    expect(state.coreCalls).toEqual([]);
    expect(state.assignment).toEqual(initial.assignment);
    expect(state.resources).toEqual(initial.resources);
    expect(state.publishedEvents).toEqual([]);
  });

  it('allows an authorized MSP assignment and removal on the specific ticket', async () => {
    const actions = await import('./teamAssignmentActions');

    await actions.assignTeamToTicket('ticket-1', 'team-new');
    expect(state.assignment.assigned_team_id).toBe('team-new');
    expect(state.resources).toContain('agent-new-team-member');

    await actions.removeTeamFromTicket('ticket-1', removeOptions);
    expect(state.assignment.assigned_team_id).toBeNull();
    expect(state.resources).toEqual(['agent-old']);
    expect(state.coreCalls).toEqual(['assign', 'remove']);
    expect(state.authorizationCalls).toHaveLength(2);
    expect(state.authorizationCalls.map(({ action, ticketId }) => [action, ticketId])).toEqual([
      ['update', 'ticket-1'],
      ['update', 'ticket-1'],
    ]);
  });
});
