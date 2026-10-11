import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ editor: vi.fn(), options: vi.fn(), edit: vi.fn(), core: vi.fn(), session: vi.fn(), override: vi.fn(), db: vi.fn(),
  user: { user_id: 'msp-user', tenant: 'msp-tenant', user_type: 'internal' }, knex: {},
  Setup: class extends Error {}, Forbidden: class extends Error {}, Lifecycle: class extends Error {}, Close: class extends Error {},
  Edit: class extends Error { constructor(public code: string) { super(code); } },
}));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args), getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.db }));
vi.mock('@alga-psa/co-managed', () => ({ getCoManagedTicketEditor: mocks.editor, searchCoManagedTicketEditOptions: mocks.options, editCoManagedTicket: mocks.edit,
  CoManagedSlaSetupError: mocks.Setup, CoManagedSharedWorkError: mocks.Forbidden, CoManagedTicketEditError: mocks.Edit }));
vi.mock('@alga-psa/licensing', () => ({ CoManagedLifecycleError: mocks.Lifecycle }));
vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({ updateTicketInTransaction: mocks.core }));
vi.mock('@alga-psa/tickets/lib/validateTicketClosure', () => ({ TicketCloseValidationError: mocks.Close }));
import { getSharedTicketEditorAction, searchSharedTicketEditOptionsAction, saveSharedTicketEditAction } from '../../../lib/actions/coManagedTicketEditActions';
const resource = { tenant: 'customer-tenant', relationshipId: 'relationship', kind: 'ticket' as const, id: 'ticket' };
const request = { operationId: 'operation', expected: { title: 'Before' }, patch: { title: 'After' } };
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.db.mockResolvedValue({ knex: mocks.knex });
  mocks.session.mockResolvedValue({ session_id: 'tracked-session', user: { id: mocks.user.user_id, tenant: mocks.user.tenant, user_type: 'internal' } });
});
it('derives browser authority from the home session for editor and picklist reads', async () => {
  await getSharedTicketEditorAction(resource); await searchSharedTicketEditOptionsAction(resource, { field: 'status_id', afterId: 'cursor' });
  const actor = { kind: 'session', tenant: 'msp-tenant', userId: 'msp-user', sessionId: 'tracked-session' };
  expect(mocks.editor).toHaveBeenCalledWith(mocks.knex, actor, resource);
  expect(mocks.options).toHaveBeenCalledWith(mocks.knex, actor, resource, { field: 'status_id', afterId: 'cursor' });
});
it('delegates the admitted edit to the canonical core with separate internal attribution and owner identity', async () => {
  const context = { trx: {}, resource, actorReferenceId: 'reference', assertWriteAuthority: vi.fn() };
  const receipt = { operationId: 'operation', appliedAt: '2026-09-06T23:00:00.000Z' };
  mocks.edit.mockImplementation(async (_db, _actor, _resource, input, apply) => { await apply(context, input.patch); return receipt; });
  expect(await saveSharedTicketEditAction(resource, request)).toEqual({ ok: true, receipt });
  expect(mocks.core).toHaveBeenCalledWith(context.trx, mocks.user, 'customer-tenant', 'ticket', request.patch, undefined,
    { actorReferenceId: 'reference', assertWriteAuthority: context.assertWriteAuthority });
  expect(mocks.db).toHaveBeenCalledWith('msp-tenant');
});
it.each(['api', 'client', 'missing', 'foreign-session'])('rejects %s identity before any editor domain call', async kind => {
  if (kind === 'api') mocks.override.mockReturnValue(mocks.user);
  if (kind === 'client') mocks.user.user_type = 'client';
  if (kind === 'missing') mocks.session.mockResolvedValue(null);
  if (kind === 'foreign-session') mocks.session.mockResolvedValue({ session_id: 'tracked', user: { id: 'different', tenant: 'other', user_type: 'internal' } });
  await expect(getSharedTicketEditorAction(resource)).rejects.toBeInstanceOf(mocks.Forbidden);
  await expect(searchSharedTicketEditOptionsAction(resource, { field: 'priority_id' })).rejects.toBeInstanceOf(mocks.Forbidden);
  expect(await saveSharedTicketEditAction(resource, request)).toEqual({ ok: false, code: 'forbidden' });
  expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.edit).not.toHaveBeenCalled(); expect(mocks.core).not.toHaveBeenCalled();
});
it.each([
  [new mocks.Setup(), 'slaSetupRequired'], [new mocks.Forbidden(), 'forbidden'], [new mocks.Lifecycle(), 'readOnly'], [new mocks.Close(), 'closeRules'],
  [new mocks.Edit('INVALID_TICKET_EDIT'), 'invalid'], [new mocks.Edit('TICKET_EDIT_CONFLICT'), 'conflict'],
  [new mocks.Edit('TICKET_EDIT_OPERATION_CONFLICT'), 'operationConflict'], [new Error('Lost COMMIT response'), 'unknownOutcome'],
])('returns a stable result for classified failures without claiming rollback on unknown outcomes', async (error, code) => {
  mocks.edit.mockRejectedValue(error);
  expect(await saveSharedTicketEditAction(resource, request)).toEqual({ ok: false, code });
});
