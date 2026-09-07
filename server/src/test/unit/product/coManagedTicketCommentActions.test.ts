import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), session: vi.fn(), override: vi.fn(), db: vi.fn(),
  user: { user_id: 'home-user', tenant: 'home-tenant', user_type: 'internal' }, knex: {},
  Forbidden: class extends Error {}, Lifecycle: class extends Error {}, Command: class extends Error { constructor(public code: string) { super(code); } } }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args), getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.db }));
vi.mock('@alga-psa/licensing', () => ({ CoManagedLifecycleError: mocks.Lifecycle }));
vi.mock('@alga-psa/co-managed', () => ({ CoManagedSharedWorkError: mocks.Forbidden, CoManagedCommentCreateError: mocks.Command }));
vi.mock('../../../lib/co-managed/createTicketComment', () => ({ createSharedTicketComment: mocks.create }));
import { createCoManagedTicketCommentAction } from '../../../lib/actions/coManagedTicketCommentActions';
const resource = { tenant: 'customer', relationshipId: 'relationship', kind: 'ticket' as const, id: 'ticket' };
const request = { audience: 'shared_it' as const, operationId: 'operation', text: 'IT note' };
beforeEach(() => { vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.db.mockResolvedValue({ knex: mocks.knex });
  mocks.session.mockResolvedValue({ session_id: 'tracked-session', user: { id: mocks.user.user_id, tenant: mocks.user.tenant, user_type: 'internal' } }); });
it('retains verified home browser identity while forwarding the qualified target and exact command', async () => {
  const receipt = { operationId: request.operationId, storeTenant: 'customer', threadId: 'thread', commentId: 'comment', appliedAt: 'now' };
  mocks.create.mockResolvedValue(receipt);
  expect(await createCoManagedTicketCommentAction(resource, request)).toEqual({ ok: true, receipt });
  expect(mocks.db).toHaveBeenCalledWith('home-tenant');
  expect(mocks.create).toHaveBeenCalledWith(mocks.knex, { kind: 'session', tenant: 'home-tenant', userId: 'home-user', sessionId: 'tracked-session' }, resource, request);
});
it.each(['api', 'client', 'missing', 'foreign-session'])('rejects %s identity before starting the production command', async kind => {
  if (kind === 'api') mocks.override.mockReturnValue(mocks.user);
  if (kind === 'client') mocks.user.user_type = 'client';
  if (kind === 'missing') mocks.session.mockResolvedValue(null);
  if (kind === 'foreign-session') mocks.session.mockResolvedValue({ session_id: 'tracked', user: { id: 'different', tenant: 'other', user_type: 'internal' } });
  expect(await createCoManagedTicketCommentAction(resource, request)).toEqual({ ok: false, code: 'forbidden' });
  expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});
it('distinguishes a rejected command from an uncertain commit outcome', async () => {
  for (const [error, code] of [[new mocks.Command('COMMENT_CREATE_OPERATION_CONFLICT'), 'operationConflict'], [new mocks.Lifecycle(), 'readOnly'], [new Error('COMMIT response lost'), 'unknownOutcome']] as const) {
    mocks.create.mockRejectedValue(error); expect(await createCoManagedTicketCommentAction(resource, request)).toEqual({ ok: false, code });
  }
});
