import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ PolicyError: class extends Error { constructor(public code = 'PERMISSION_DENIED') { super(code); } }, tables: [] as string[], product: 'co_managed', customer: vi.fn(), sponsor: vi.fn(), delegated: vi.fn() }));
const PolicyError = m.PolicyError;
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1' }, { tenant: 't1' }, ...args) }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: async () => undefined }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: (t: string) => { m.tables.push(t); return { first: async () => ({ product_code: m.product }) }; } }) }));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: async () => ({ tenant: 't1', userId: 'u1' }) }));
vi.mock('../../../lib/co-managed/relationshipTarget', () => ({ resolveCoManagedRelationshipTarget: vi.fn() }));
vi.mock('@alga-psa/co-managed', () => ({ CoManagedPolicyError: m.PolicyError, CoManagedDelegationError: class extends Error {}, isCoManagedSharedWorkError: () => false,
  listCoManagedLiveCustomerRelationships: m.customer, listCoManagedLiveSponsoredRelationships: m.sponsor, listCoManagedDelegatedWorkspaces: m.delegated }));

import { listCoManagedAdministrationWorkspacesAction } from '../../../lib/actions/coManagedDelegatedActions';

beforeEach(() => { m.tables = []; m.product = 'co_managed'; vi.resetAllMocks(); m.delegated.mockResolvedValue([]); });

describe('listCoManagedAdministrationWorkspacesAction', () => {
  it('customer: refusal by the policy gate is an opaque empty list and the action itself reads no relationship rows', async () => {
    m.customer.mockRejectedValue(new PolicyError());
    expect(await (listCoManagedAdministrationWorkspacesAction as any)()).toEqual([]);
    expect(m.customer).toHaveBeenCalledTimes(1);
    expect(m.tables).not.toContain('co_management_relationships');
  });

  it('customer: permitted actor gets the library result in the unchanged shape, sorted by name', async () => {
    m.customer.mockResolvedValue([{ relationshipId: 'r2', sponsorTenant: 's2', name: 'Zed' }, { relationshipId: 'r1', sponsorTenant: 's1', name: 'Acme' }]);
    expect(await (listCoManagedAdministrationWorkspacesAction as any)()).toEqual([
      { relationshipId: 'r1', name: 'Acme', side: 'customer', effective: true, delegated: true },
      { relationshipId: 'r2', name: 'Zed', side: 'customer', effective: true, delegated: true }]);
  });

  it('customer: non-policy errors still surface', async () => {
    m.customer.mockRejectedValue(new Error('boom'));
    await expect((listCoManagedAdministrationWorkspacesAction as any)()).rejects.toThrow('boom');
  });

  it('sponsor: unchanged — live relationships plus delegated-only workspaces, customer library untouched', async () => {
    m.product = 'psa';
    m.sponsor.mockResolvedValue([{ relationshipId: 'r1', customerTenant: 'c1', name: 'Oz' }]);
    expect(await (listCoManagedAdministrationWorkspacesAction as any)()).toEqual([{ relationshipId: 'r1', name: 'Oz', side: 'sponsor', effective: true, delegated: false }]);
    expect(m.customer).not.toHaveBeenCalled();
  });
});
