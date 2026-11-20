import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BuiltinAuthorizationKernelProvider, builtinClosedFields, builtinClosedOperations, createAuthorizationKernel,
  isBuiltinOperationClosed, registerBuiltinRuleResolver, resetBuiltinRuleResolversForTests, type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import {
  CO_MANAGED_SEAT_RESOLVER_ID, SEAT_AUTHORITY_POLICY, SEAT_AUTHORITY_PROJECTION, coManagedSeatResolver,
} from '../seatAuthority';

// Slice S30 (T039): the seat projection is declarative data next to the policy and the kernel applies it.

const facts = {
  assignments: [{ arrangement_id: 'arr-1', state: 'active' }],
  arrangements: [{ arrangement_id: 'arr-1', client_id: 'client-own', state: 'active' }],
  boards: [], projects: [],
};
const subject = (resolverFacts?: Record<string, unknown>): AuthorizationSubject => ({
  tenant: 't1', userId: 'u1', userType: 'internal', roleIds: [], teamIds: [], managedUserIds: [], clientId: null,
  portfolioClientIds: [], ...(resolverFacts ? { resolverFacts } : {}),
});
const seat = subject({ [CO_MANAGED_SEAT_RESOLVER_ID]: facts });
const msp = subject();
const input = (s: AuthorizationSubject, type: string, action = 'read') => ({ subject: s, resource: { type, action } });

beforeAll(() => {
  resetBuiltinRuleResolversForTests();
  registerBuiltinRuleResolver(coManagedSeatResolver);
});
afterAll(() => resetBuiltinRuleResolversForTests());

describe('seat projection', () => {
  it('only names resource types the seat policy grants', () => {
    for (const resource of Object.keys(SEAT_AUTHORITY_PROJECTION)) {
      expect(SEAT_AUTHORITY_POLICY[resource], resource).toHaveProperty('granted');
    }
    expect(Object.isFrozen(SEAT_AUTHORITY_PROJECTION)).toBe(true);
  });

  it('closes purchase cost and the billing profile of an asset to a seat subject, and nothing to MSP staff', () => {
    expect(builtinClosedFields(input(seat, 'asset'))).toEqual(
      ['billing_profile_id', 'billing_profile_name', 'purchase_cost', 'purchase_cost_currency']);
    expect(builtinClosedFields(input(msp, 'asset'))).toEqual([]);
    expect(builtinClosedFields(input(seat, 'ticket'))).toEqual([]);
  });

  // Slice S29 (T038): shared projects. Budget, billing and rate columns of a project, its phases and its tasks.
  it('closes the budget, billing and rate columns of a project to a seat subject, and nothing to MSP staff', () => {
    expect(builtinClosedFields(input(seat, 'project'))).toEqual(['billing_profile_id', 'budgeted_hours', 'service_id']);
    expect(builtinClosedFields(input(seat, 'project', 'update'))).toEqual(['billing_profile_id', 'budgeted_hours', 'service_id']);
    expect(builtinClosedFields(input(msp, 'project'))).toEqual([]);
    expect(SEAT_AUTHORITY_PROJECTION.project.closedFields).not.toContain('estimated_hours');
  });

  it('closes the service catalog, project materials, project billing and project management to a seat subject only', () => {
    for (const operation of ['service_catalog', 'project_materials', 'project_billing', 'project_manage']) {
      expect(isBuiltinOperationClosed(input(seat, 'project', operation)), operation).toBe(true);
      expect(isBuiltinOperationClosed(input(msp, 'project', operation)), operation).toBe(false);
    }
    expect(isBuiltinOperationClosed(input(seat, 'project', 'read'))).toBe(false);
    expect(builtinClosedOperations(input(msp, 'project'))).toEqual([]);
  });

  it('adds the project closed fields to the project read decision', async () => {
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
      rbacEvaluator: async () => true,
    });
    const shared = subject({ [CO_MANAGED_SEAT_RESOLVER_ID]: { ...facts, projects: [{ arrangement_id: 'arr-1', project_id: 'p1' }] } });
    const read = await kernel.authorizeResource({ ...input(shared, 'project'), record: { id: 'p1', clientId: 'client-own' } });
    expect(read.allowed).toBe(true);
    expect(read.redactedFields).toEqual(expect.arrayContaining(['budgeted_hours', 'billing_profile_id', 'service_id']));
    const unshared = await kernel.authorizeResource({ ...input(shared, 'project'), record: { id: 'p2', clientId: 'client-own' } });
    expect(unshared.allowed).toBe(false);
  });

  it('closes the remote and RMM operations to a seat subject only', () => {
    for (const operation of ['remote_access', 'rmm_command', 'rmm_refresh', 'rmm_mapping']) {
      expect(isBuiltinOperationClosed(input(seat, 'asset', operation)), operation).toBe(true);
      expect(isBuiltinOperationClosed(input(msp, 'asset', operation)), operation).toBe(false);
    }
    expect(isBuiltinOperationClosed(input(seat, 'asset', 'read'))).toBe(false);
    expect(builtinClosedOperations(input(msp, 'asset'))).toEqual([]);
  });

  it('adds the closed fields to the read decision, so every record projection hides them', async () => {
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
      rbacEvaluator: async () => true,
    });
    const record = { clientId: 'client-own' };
    const seatRead = await kernel.authorizeResource({ ...input(seat, 'asset'), record });
    expect(seatRead.allowed).toBe(true);
    expect(seatRead.redactedFields).toEqual(expect.arrayContaining(['purchase_cost', 'billing_profile_id']));
    expect((await kernel.authorizeResource({ ...input(msp, 'asset'), record })).redactedFields).toEqual([]);
  });
});
