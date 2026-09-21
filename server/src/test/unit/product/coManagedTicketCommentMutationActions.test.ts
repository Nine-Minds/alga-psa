import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), session: vi.fn(), override: vi.fn(), db: vi.fn(),
  user: { user_id: 'home-user', tenant: 'home-tenant', user_type: 'internal' }, knex: {},
  Forbidden: class extends Error {}, Lifecycle: class extends Error {}, Command: class extends Error { constructor(public code: string) { super(code); } } }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args), getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.db }));
vi.mock('@alga-psa/licensing', () => ({ CoManagedLifecycleError: mocks.Lifecycle }));
vi.mock('@alga-psa/co-managed', () => ({ CoManagedSharedWorkError: mocks.Forbidden, CoManagedCommentMutationError: mocks.Command }));
vi.mock('../../../lib/co-managed/mutateTicketComment', () => ({ mutateSharedTicketComment: mocks.mutate }));
import { mutateCoManagedTicketCommentAction } from '../../../lib/actions/coManagedTicketCommentMutationActions';
const resource = { tenant: 'customer', relationshipId: 'relationship', kind: 'ticket' as const, id: 'ticket' };
const request = { kind: 'edit' as const, comment: { storeTenant: 'customer', threadId: 'thread', commentId: 'comment' }, expectedUpdatedAt: null, operationId: 'operation', text: 'IT note' };
beforeEach(() => { vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.db.mockResolvedValue({ knex: mocks.knex });
  mocks.session.mockResolvedValue({ session_id: 'tracked-session', user: { id: mocks.user.user_id, tenant: mocks.user.tenant, user_type: 'internal' } }); });
it('retains verified home browser identity while forwarding the qualified target and exact command', async () => {
  const receipt = { operationId: request.operationId, storeTenant: 'customer', threadId: 'thread', commentId: 'comment', updatedAt: 'now', deleted: false };
  mocks.mutate.mockResolvedValue(receipt);
  expect(await mutateCoManagedTicketCommentAction(resource, request)).toEqual({ ok: true, receipt });
  expect(mocks.db).toHaveBeenCalledWith('home-tenant');
  expect(mocks.mutate).toHaveBeenCalledWith(mocks.knex, { kind: 'session', tenant: 'home-tenant', userId: 'home-user', sessionId: 'tracked-session' }, resource, request);
});
it.each(['api', 'client', 'missing', 'foreign-session'])('rejects %s identity before starting the production command', async kind => {
  if (kind === 'api') mocks.override.mockReturnValue(mocks.user);
  if (kind === 'client') mocks.user.user_type = 'client';
  if (kind === 'missing') mocks.session.mockResolvedValue(null);
  if (kind === 'foreign-session') mocks.session.mockResolvedValue({ session_id: 'tracked', user: { id: 'different', tenant: 'other', user_type: 'internal' } });
  expect(await mutateCoManagedTicketCommentAction(resource, request)).toEqual({ ok: false, code: 'forbidden' });
  expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
});
it('distinguishes a rejected command from an uncertain commit outcome', async () => {
  for (const [error, code] of [[new mocks.Command('COMMENT_MUTATION_OPERATION_CONFLICT'), 'operationConflict'], [new mocks.Command('COMMENT_MUTATION_CONFLICT'), 'conflict'], [new mocks.Command('INVALID_COMMENT_MUTATION'), 'invalid'], [new mocks.Lifecycle(), 'readOnly'], [new Error('COMMIT response lost'), 'unknownOutcome']] as const) {
    mocks.mutate.mockRejectedValue(error); expect(await mutateCoManagedTicketCommentAction(resource, request)).toEqual({ ok: false, code });
  }
});
