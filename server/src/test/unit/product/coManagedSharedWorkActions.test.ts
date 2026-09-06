import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), override: vi.fn(), db: vi.fn(), read: vi.fn(),
  home: { user_id: 'home-user', tenant: 'home-tenant', user_type: 'internal' }, knex: {} }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.home, { tenant: mocks.home.tenant }, ...args),
  getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.db }));
vi.mock('@alga-psa/co-managed', () => ({ getCoManagedSharedWorkSummary: mocks.read,
  CoManagedSharedWorkError: class extends Error { code = 'CO_MANAGED_SHARED_WORK_FORBIDDEN'; } }));
import { getSharedWorkSummaryAction } from '../../../lib/actions/coManagedSharedWorkActions';
const resource = { tenant: 'customer-tenant', relationshipId: 'relationship', kind: 'ticket' as const, id: 'ticket' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.home.user_type = 'internal';
  mocks.session.mockResolvedValue({ session_id: 'tracked-session', user: { tenant: mocks.home.tenant, id: mocks.home.user_id, user_type: 'internal' } });
  mocks.db.mockResolvedValue({ knex: mocks.knex }); mocks.read.mockResolvedValue({ resource, revision: 3, fields: { title: 'Shared issue' } });
});
describe('shared summary session adapter', () => {
  it('constructs the principal from verified home identity and retains qualified customer input', async () => {
    const input = { ...resource, actor: { tenant: 'forged', sessionId: 'forged' }, sessionId: 'forged', userId: 'forged' };
    expect(await getSharedWorkSummaryAction(input)).toEqual({ resource, revision: 3, fields: { title: 'Shared issue' } });
    expect(mocks.db).toHaveBeenCalledWith('home-tenant');
    expect(mocks.read).toHaveBeenCalledWith(mocks.knex, { kind: 'session', tenant: 'home-tenant', userId: 'home-user', sessionId: 'tracked-session' }, input);
  });
  it.each([
    null, { user: { tenant: 'home-tenant', id: 'home-user', user_type: 'internal' } },
    { session_id: 'tracked', user: { tenant: 'foreign', id: 'home-user', user_type: 'internal' } },
    { session_id: 'tracked', user: { tenant: 'home-tenant', id: 'foreign', user_type: 'internal' } },
    { session_id: 'tracked', user: { tenant: 'home-tenant', id: 'home-user', user_type: 'client' } },
  ])('rejects incomplete or mismatched session identity before accessing the domain: %j', async session => {
    mocks.session.mockResolvedValue(session);
    await expect(getSharedWorkSummaryAction(resource)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(['api', 'client'])('rejects %s identity even with a matching browser cookie', async kind => {
    if (kind === 'api') mocks.override.mockReturnValue(mocks.home); else mocks.home.user_type = 'client';
    await expect(getSharedWorkSummaryAction(resource)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
});
