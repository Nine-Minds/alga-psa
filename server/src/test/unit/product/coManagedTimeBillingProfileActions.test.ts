import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), session: vi.fn(), override: vi.fn(), db: vi.fn(), knex: {},
  user: { user_id: 'user', tenant: 'home', user_type: 'internal' }, Forbidden: class extends Error {} }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn(mocks.user, { tenant: 'home' }, ...args), getSession: mocks.session, getApiKeyUserOverride: mocks.override }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.db, tenantDb: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@alga-psa/co-managed', () => ({ getCoManagedTimeBillingProfile: mocks.get, setCoManagedTimeBillingProfile: mocks.set,
  CoManagedSharedWorkError: mocks.Forbidden, getCoManagedEffortTotals: vi.fn(), registerCoManagedTimeWorkReference: vi.fn() }));
import { getSharedTimeBillingProfileAction as get, setSharedTimeBillingProfileAction as set } from '../../../lib/actions/coManagedTimeActions';
const resource = { kind: 'ticket' as const, tenant: 'customer', relationshipId: 'relationship', id: 'ticket' };
const request = { expectedProfileId: null, profileId: 'profile' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.db.mockResolvedValue({ knex: mocks.knex });
  mocks.session.mockResolvedValue({ session_id: 'tracked', user: { id: 'user', tenant: 'home', user_type: 'internal' } });
});
it('binds both profile actions to the tracked home browser without a caller-supplied client', async () => {
  await get(resource); await set(resource, request);
  const actor = { kind: 'session', sessionId: 'tracked', tenant: 'home', userId: 'user' };
  expect(mocks.get).toHaveBeenCalledWith(mocks.knex, actor, resource);
  expect(mocks.set).toHaveBeenCalledWith(mocks.knex, actor, resource, request);
  expect(mocks.db.mock.calls).toEqual([['home'], ['home']]);
});
it.each(['api', 'client', 'missing', 'other-user'])('rejects %s identity before profile access', async kind => {
  if (kind === 'api') mocks.override.mockReturnValue(mocks.user);
  if (kind === 'client') mocks.user.user_type = 'client';
  if (kind === 'missing') mocks.session.mockResolvedValue(null);
  if (kind === 'other-user') mocks.session.mockResolvedValue({ session_id: 'tracked', user: { id: 'other', tenant: 'home', user_type: 'internal' } });
  await expect(get(resource)).rejects.toBeInstanceOf(mocks.Forbidden);
  await expect(set(resource, request)).rejects.toBeInstanceOf(mocks.Forbidden);
  expect(mocks.db).not.toHaveBeenCalled();
});
it('hides unavailable optional profile controls but does not turn an unauthorized write into success', async () => {
  mocks.get.mockRejectedValue(new mocks.Forbidden()); expect(await get(resource)).toBeNull();
  mocks.set.mockRejectedValue(new mocks.Forbidden()); await expect(set(resource, request)).rejects.toBeInstanceOf(mocks.Forbidden);
  expect(await get({ ...resource, tenant: 'home' })).toBeNull(); expect(mocks.get).toHaveBeenCalledTimes(1);
});
