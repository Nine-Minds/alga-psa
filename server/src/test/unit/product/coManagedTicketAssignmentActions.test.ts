import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), list: vi.fn(), assign: vi.fn(), session: vi.fn(), override: vi.fn(), db: vi.fn(), user: { user_id: 'user', tenant: 'home', user_type: 'internal' }, knex: {}, Forbidden: class extends Error {}, Lifecycle: class extends Error {}, Assignment: class extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args), getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.db }));
vi.mock('@alga-psa/licensing', () => ({ isCoManagedLifecycleError: (error: unknown) => error instanceof mocks.Lifecycle }));
vi.mock('@alga-psa/co-managed', () => ({ getCoManagedTicketAssignment: mocks.read, listCoManagedTicketAssignees: mocks.list, assignCoManagedTicket: mocks.assign, CoManagedSharedWorkError: mocks.Forbidden, CoManagedTicketAssignmentError: mocks.Assignment }));
import { getSharedTicketAssignmentAction, listSharedTicketAssigneesAction, assignSharedTicketAction } from '../../../lib/actions/coManagedTicketAssignmentActions';
const resource = { kind: 'ticket' as const, tenant: 'customer', relationshipId: 'relationship', id: 'ticket' };
const request = { operationId: 'operation', expectedRevision: 1, assignee: null };
beforeEach(() => { vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.db.mockResolvedValue({ knex: mocks.knex }); mocks.session.mockResolvedValue({ session_id: 'tracked', user: { id: 'user', tenant: 'home', user_type: 'internal' } }); });
it('uses tracked home authority for reads choices and assignment without switching tenant', async () => {
  await getSharedTicketAssignmentAction(resource); await listSharedTicketAssigneesAction(resource, 'team', 'cursor'); mocks.assign.mockResolvedValue({ operationId: 'operation', appliedAt: 'time' });
  expect(await assignSharedTicketAction(resource, request)).toMatchObject({ ok: true, receipt: { operationId: 'operation' } });
  const actor = { kind: 'session', tenant: 'home', userId: 'user', sessionId: 'tracked' };
  expect(mocks.read).toHaveBeenCalledWith(mocks.knex, actor, resource); expect(mocks.list).toHaveBeenCalledWith(mocks.knex, actor, resource, 'team', 'cursor'); expect(mocks.assign).toHaveBeenCalledWith(mocks.knex, actor, resource, request);
  expect(mocks.db.mock.calls.every(([tenant]) => tenant === 'home')).toBe(true);
});
it.each(['api', 'client', 'missing', 'foreign'])('rejects %s authority before using an assignment principal', async kind => {
  if (kind === 'api') mocks.override.mockReturnValue(mocks.user); if (kind === 'client') mocks.user.user_type = 'client'; if (kind === 'missing') mocks.session.mockResolvedValue(null);
  if (kind === 'foreign') mocks.session.mockResolvedValue({ session_id: 'tracked', user: { id: 'other', tenant: 'home', user_type: 'internal' } });
  await expect(getSharedTicketAssignmentAction(resource)).rejects.toBeInstanceOf(mocks.Forbidden); await expect(listSharedTicketAssigneesAction(resource, 'user')).rejects.toBeInstanceOf(mocks.Forbidden);
  expect(await assignSharedTicketAction(resource, request)).toEqual({ ok: false, code: 'forbidden' }); expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.assign).not.toHaveBeenCalled();
});
it.each([[new mocks.Assignment('INVALID_TICKET_ASSIGNMENT'), 'invalid'], [new mocks.Assignment('TICKET_ASSIGNMENT_CONFLICT'), 'conflict'], [new mocks.Assignment('TICKET_ASSIGNMENT_OPERATION_CONFLICT'), 'operationConflict'], [new mocks.Lifecycle(), 'readOnly'], [new Error('Internal secret'), 'unknownOutcome']])('returns a safe assignment outcome for %s', async (error, code) => {
  mocks.assign.mockRejectedValue(error); expect(await assignSharedTicketAction(resource, request)).toEqual({ ok: false, code });
});
