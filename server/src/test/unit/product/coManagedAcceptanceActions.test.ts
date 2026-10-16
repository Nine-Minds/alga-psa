import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptCustomerCoManagedRelationship, getCustomerCoManagedAcceptance } from '../../../lib/actions/coManagedAcceptanceActions';
const mocks = vi.hoisted(() => ({ review: vi.fn(), accept: vi.fn(), db: {},
  user: { tenant: 'home-customer', user_id: 'home-admin', user_type: 'internal' } }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => (...args: any[]) =>
  handler(mocks.user, { tenant: mocks.user.tenant }, ...args) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: async () => ({ knex: mocks.db }) }));
vi.mock('@alga-psa/co-managed', () => ({ getCoManagedAcceptanceState: mocks.review, acceptCoManagedRelationship: mocks.accept }));
beforeEach(() => { vi.resetAllMocks(); mocks.user.user_type = 'internal'; });
describe('customer acceptance authentication adapter', () => {
  it('derives the actor only from the authenticated home identity', async () => {
    const input = { relationshipId: 'relationship', revision: 1, scopeFingerprint: 'hash', tenant: 'sibling', userId: 'sponsor' };
    await acceptCustomerCoManagedRelationship(input);
    expect(mocks.accept).toHaveBeenCalledWith(mocks.db, { tenant: 'home-customer', userId: 'home-admin' }, input);
    await getCustomerCoManagedAcceptance();
    expect(mocks.review).toHaveBeenCalledWith(mocks.db, { tenant: 'home-customer', userId: 'home-admin' });
  });
  it('rejects requester sessions before reviewing or accepting', async () => {
    mocks.user.user_type = 'client';
    await expect(getCustomerCoManagedAcceptance()).rejects.toThrow('Permission denied');
    await expect(acceptCustomerCoManagedRelationship({ relationshipId: 'r', revision: 1, scopeFingerprint: 'h' })).rejects.toThrow('Permission denied');
    expect(mocks.review).not.toHaveBeenCalled(); expect(mocks.accept).not.toHaveBeenCalled();
  });
});
