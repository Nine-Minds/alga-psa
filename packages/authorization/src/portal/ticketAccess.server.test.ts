import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: null as any,
  ticket: null as any,
  visibility: null as any,
  visibilityError: false,
  bundleCalls: [] as any[],
  resolvedRules: [] as any[],
  resolveBundleRules: async (..._args: any[]) => [] as any[],
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: (name: string) => ({ where: () => ({
    first: async () => (name === 'users' ? state.user : state.ticket),
  }) }) }),
}));
vi.mock('./visibility.server', () => ({
  getClientContactVisibilityContext: async () => { if (state.visibilityError) throw new Error('boom'); return state.visibility; },
}));
vi.mock('../assetReadAuthorization', () => ({
  resolveAuthorizationSubjectForUser: async (_c: unknown, tenant: string, u: any) => ({
    tenant,
    userId: u.user_id,
    userType: u.user_type,
  }),
}));
vi.mock('../bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: (...args: any[]) => {
    state.bundleCalls.push(args[1]);
    return Promise.resolve(state.resolveBundleRules(...args)).then(rules => {
      state.resolvedRules = rules;
      return rules;
    });
  },
}));

import { canReadTicket, canWriteTicket } from './ticketAccess.server';

const ticket = { ticket_id: 't1', client_id: 'cl1', board_id: 'b1', contact_name_id: 'c2', attributes: null };
const scope = { effectiveTicketScope: 'contact', contactId: 'c1', clientId: 'cl1', visibleBoardIds: ['b1'] };

beforeEach(() => {
  state.user = { user_id: 'u1', user_type: 'client', contact_id: 'c1' };
  state.ticket = ticket;
  state.visibility = scope;
  state.visibilityError = false;
  state.bundleCalls = [];
  state.resolvedRules = [];
  state.resolveBundleRules = async () => [];
});

describe('ticketAccess.server', () => {
  it('denies missing users and tickets', async () => {
    state.user = undefined;
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(false);
    state.user = { user_id: 'u1', user_type: 'internal' }; state.ticket = undefined;
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(false);
  });
  it('client: contact scope denies a sibling ticket, grants admit it', async () => {
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(false);
    state.ticket = { ...ticket, contact_name_id: 'c1' };
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(true);
    state.ticket = { ...ticket, attributes: { watch_list: [{ entity_type: 'contact', entity_id: 'c1', active: true }] } };
    state.visibility = { ...scope, watchGrant: true };
    expect(await canWriteTicket({} as any, 't', 'u1', 't1')).toBe(true);
  });
  it('client: client scope, other client, no contact and unresolved context', async () => {
    state.visibility = { ...scope, effectiveTicketScope: 'client' };
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(true);
    state.ticket = { ...ticket, client_id: 'other' };
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(false);
    state.ticket = ticket; state.user = { ...state.user, contact_id: null };
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(false);
    state.user = { ...state.user, contact_id: 'c1' }; state.visibilityError = true;
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(false);
  });
  it('internal: evaluates read and update against bundle scope', async () => {
    state.user = { user_id: 'u1', user_type: 'internal' };
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(true);
    expect(await canWriteTicket({} as any, 't', 'u1', 't1')).toBe(true);
    expect(state.bundleCalls.map(input => input.resource.action)).toEqual(['read', 'update']);
  });
  it('denies read and write when bundle-rule resolution rejects through the real kernel/provider', async () => {
    state.user = { user_id: 'u1', user_type: 'internal' };
    state.resolveBundleRules = async () => { throw new Error('bundle lookup failed'); };

    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(false);
    expect(await canWriteTicket({} as any, 't', 'u1', 't1')).toBe(false);
    expect(state.bundleCalls.map(input => input.resource.action)).toEqual(['read', 'update']);
  });
  it('allows an unrestricted internal user when bundle resolution succeeds with no rules', async () => {
    state.user = { user_id: 'u1', user_type: 'internal' };
    state.resolveBundleRules = async () => [];

    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(true);
    expect(await canWriteTicket({} as any, 't', 'u1', 't1')).toBe(true);
  });
  it('denies out-of-scope records when the real bundle provider applies a selected-client rule', async () => {
    state.user = { user_id: 'u1', user_type: 'internal' };
    state.resolveBundleRules = async (_conn: unknown, input: any) => [{
      id: 'selected-client-rule',
      resource: 'ticket',
      action: input.resource.action,
      templateKey: 'selected_clients',
      selectedClientIds: ['allowed-client'],
    }];

    const readAllowed = await canReadTicket({} as any, 't', 'u1', 't1');
    expect(state.bundleCalls).toHaveLength(1);
    expect(state.bundleCalls[0]).toMatchObject({
      resource: { type: 'ticket', action: 'read' },
      record: { clientId: 'cl1' },
    });
    expect(state.resolvedRules).toEqual([
      expect.objectContaining({ resource: 'ticket', action: 'read', selectedClientIds: ['allowed-client'] }),
    ]);
    expect(readAllowed).toBe(false);
    expect(await canWriteTicket({} as any, 't', 'u1', 't1')).toBe(false);
    expect(state.bundleCalls.map(input => input.resource.action)).toEqual(['read', 'update']);
  });
  it('denies other user types', async () => {
    state.user = { user_id: 'u1', user_type: 'service' };
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(false);
  });
});
