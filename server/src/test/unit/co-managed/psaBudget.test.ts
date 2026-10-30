import { beforeEach, describe, expect, it, vi } from 'vitest';

// A psa tenant (capability not served) must issue no co-managed query: every L2 action gates first.
const createTenantKnex = vi.fn();
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'internal' }, { tenant: 't' }, ...args) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: (...a: any[]) => createTenantKnex(...a), tenantDb: vi.fn() }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: vi.fn().mockRejectedValue(new Error('capability off')) }));
vi.mock('@alga-psa/co-managed', () => ({ listCoManagedCustomerTickets: vi.fn(), getCoManagedSharedWorkSummary: vi.fn(),
  isCoManagedSharedWorkError: () => false }));
vi.mock('@/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: vi.fn() }));

describe('psa budget', () => {
  beforeEach(() => createTenantKnex.mockClear());
  it('Customer Tickets actions touch no database when the capability is off', async () => {
    const actions = await import('@/lib/actions/coManagedWorkActions');
    await expect((actions.listCoManagedCustomerTicketsAction as any)()).rejects.toThrow('capability off');
    await expect((actions.getCoManagedSharedTicketAction as any)('r', 't')).rejects.toThrow('capability off');
    expect(createTenantKnex).not.toHaveBeenCalled();
  });
});
