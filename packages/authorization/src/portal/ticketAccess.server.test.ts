import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ user: null as any, ticket: null as any, visibility: null as any, visibilityError: false, decision: { allowed: true }, calls: [] as any[] }));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: (name: string) => ({ where: () => ({
    first: async () => (name === 'users' ? state.user : state.ticket),
  }) }) }),
}));
vi.mock('./visibility.server', () => ({
  getClientContactVisibilityContext: async () => { if (state.visibilityError) throw new Error('boom'); return state.visibility; },
}));
vi.mock('../assetReadAuthorization', () => ({ resolveAuthorizationSubjectForUser: async (_c: unknown, _t: string, u: any) => ({ userId: u.user_id }) }));
vi.mock('../bundles/service', () => ({ resolveBundleNarrowingRulesForEvaluation: async () => [] }));
vi.mock('../kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {},
  RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({ authorizeResource: async (input: any) => { state.calls.push(input); return state.decision; } }),
}));

import { canReadTicket, canWriteTicket } from './ticketAccess.server';

const ticket = { ticket_id: 't1', client_id: 'cl1', board_id: 'b1', contact_name_id: 'c2', attributes: null };
const scope = { effectiveTicketScope: 'contact', contactId: 'c1', clientId: 'cl1', visibleBoardIds: ['b1'] };

beforeEach(() => {
  state.user = { user_id: 'u1', user_type: 'client', contact_id: 'c1' };
  state.ticket = ticket; state.visibility = scope; state.visibilityError = false; state.decision = { allowed: true }; state.calls = [];
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
  it('internal: delegates to the kernel with read / update and fails closed', async () => {
    state.user = { user_id: 'u1', user_type: 'internal' };
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(true);
    expect(await canWriteTicket({} as any, 't', 'u1', 't1')).toBe(true);
    expect(state.calls.map(c => c.resource.action)).toEqual(['read', 'update']);
    state.decision = { allowed: false };
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(false);
  });
  it('denies other user types', async () => {
    state.user = { user_id: 'u1', user_type: 'service' };
    expect(await canReadTicket({} as any, 't', 'u1', 't1')).toBe(false);
  });
});
