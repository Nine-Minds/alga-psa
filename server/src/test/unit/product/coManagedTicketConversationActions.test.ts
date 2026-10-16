import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), permissions: vi.fn(), session: vi.fn(), override: vi.fn(), db: vi.fn(),
  user: { user_id: 'home-user', tenant: 'home-tenant', user_type: 'internal' }, knex: {}, Forbidden: class extends Error {} }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args), getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.db }));
vi.mock('@alga-psa/co-managed', () => ({ getCoManagedTicketConversation: mocks.read, getCoManagedConversationContributionHints: mocks.permissions, CoManagedSharedWorkError: mocks.Forbidden }));
import { getCoManagedTicketConversationAction, getCoManagedTicketConversationScreenAction } from '../../../lib/actions/coManagedTicketConversationActions';
const resource = { tenant: 'customer', relationshipId: 'relationship', kind: 'ticket' as const, id: 'ticket' };
beforeEach(() => { vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.db.mockResolvedValue({ knex: mocks.knex });
  mocks.session.mockResolvedValue({ session_id: 'tracked-session', user: { id: mocks.user.user_id, tenant: mocks.user.tenant, user_type: 'internal' } }); });
it('retains home browser authority and forwards the qualified target and cursor without a release-flag dependency', async () => {
  const before = { createdAt: '2026-01-01T00:00:00.123456Z', storeTenant: 'customer', commentId: 'comment' };
  await getCoManagedTicketConversationAction(resource, before);
  expect(mocks.db).toHaveBeenCalledWith('home-tenant');
  expect(mocks.read).toHaveBeenCalledWith(mocks.knex, { kind: 'session', tenant: 'home-tenant', userId: 'home-user', sessionId: 'tracked-session' }, resource, before);
});
it.each(['api', 'client', 'missing', 'foreign-session'])('rejects %s identity before reading conversation stores', async kind => {
  if (kind === 'api') mocks.override.mockReturnValue(mocks.user);
  if (kind === 'client') mocks.user.user_type = 'client';
  if (kind === 'missing') mocks.session.mockResolvedValue(null);
  if (kind === 'foreign-session') mocks.session.mockResolvedValue({ session_id: 'tracked', user: { id: 'different', tenant: 'other', user_type: 'internal' } });
  await expect(getCoManagedTicketConversationAction(resource)).rejects.toBeInstanceOf(mocks.Forbidden);
  expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});

it('returns the actual home actor and current write hints with each authorized conversation page', async () => {
  mocks.permissions.mockResolvedValue({ writeAudiences: ['shared_it'], attachmentAudiences: [] }); mocks.read.mockResolvedValue({ resource, items: [], nextBefore: null });
  expect(await getCoManagedTicketConversationScreenAction(resource)).toEqual({ resource, items: [], nextBefore: null,
    actor: { tenant: 'home-tenant', userId: 'home-user' }, writeAudiences: ['shared_it'], draftAttachments: { audiences: [], maxBytes: 20905984, maxFiles: 20 } });
});
