import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), session: vi.fn(), override: vi.fn(), db: vi.fn(),
  user: { user_id: 'msp-user', tenant: 'msp-tenant', user_type: 'internal' }, knex: {}, Forbidden: class extends Error {} }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: mocks.user.tenant }, ...args), getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.db }));
vi.mock('@alga-psa/co-managed', () => ({ getCoManagedTicketQueue: mocks.list, CoManagedSharedWorkError: mocks.Forbidden }));
import { getCoManagedTicketQueueAction } from '../../../lib/actions/coManagedTicketQueueActions';
beforeEach(() => { vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.db.mockResolvedValue({ knex: mocks.knex });
  mocks.session.mockResolvedValue({ session_id: 'tracked-session', user: { id: mocks.user.user_id, tenant: mocks.user.tenant, user_type: 'internal' } }); });
it('uses verified home browser authority for combined queue queries without a release-flag dependency', async () => {
  const request = { view: 'working' as const, workspaceTenant: 'customer', page: 2 };
  await getCoManagedTicketQueueAction(request);
  expect(mocks.db).toHaveBeenCalledWith('msp-tenant');
  expect(mocks.list).toHaveBeenCalledWith(mocks.knex, { kind: 'session', tenant: 'msp-tenant', userId: 'msp-user', sessionId: 'tracked-session' }, request);
});
it.each(['api', 'client', 'missing', 'foreign-session'])('rejects %s identity before querying tickets', async kind => {
  if (kind === 'api') mocks.override.mockReturnValue(mocks.user);
  if (kind === 'client') mocks.user.user_type = 'client';
  if (kind === 'missing') mocks.session.mockResolvedValue(null);
  if (kind === 'foreign-session') mocks.session.mockResolvedValue({ session_id: 'tracked', user: { id: 'different', tenant: 'other', user_type: 'internal' } });
  await expect(getCoManagedTicketQueueAction({ view: 'working' })).rejects.toBeInstanceOf(mocks.Forbidden);
  expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
});
