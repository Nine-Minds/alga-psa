import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

// Keep the RBAC evaluator DB-free: role resolution returns a client role and
// an internal role, each granting ticket:read, so the built-in subject rules
// (not RBAC) are what's exercised.
vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    getUserRolesWithPermissions: vi.fn(async () => [
      {
        role_id: 'role-client',
        role_name: 'Portal User',
        msp: false,
        client: true,
        permissions: [
          { permission_id: 'p1', resource: 'ticket', action: 'read', msp: false, client: true },
        ],
      },
      {
        role_id: 'role-internal',
        role_name: 'Technician',
        msp: true,
        client: false,
        permissions: [
          { permission_id: 'p2', resource: 'ticket', action: 'read', msp: true, client: false },
        ],
      },
    ]),
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-a' })),
  runWithTenant: vi.fn(async (_tenant: string, cb: () => Promise<unknown>) => cb()),
}));

import { createEnterpriseAuthorizationKernel } from '../../lib/authorization/kernel';

function stubKnex() {
  return { __stub: true } as any;
}

describe('enterprise authorization kernel shares the client same_client invariant', () => {
  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      subject: {
        tenant: 'tenant-a',
        userId: 'client-user-1',
        userType: 'client',
        clientId: 'client-a',
      },
      resource: { type: 'ticket', action: 'read' },
      ...overrides,
    };
  }

  it('allows a same-client record', async () => {
    const kernel = createEnterpriseAuthorizationKernel();
    const decision = await kernel.authorizeResource(
      baseInput({ knex: stubKnex(), record: { id: 'ticket-1', clientId: 'client-a' } }) as any
    );
    expect(decision.allowed).toBe(true);
  });

  it('denies a different-client record even though the bundle could allow it', async () => {
    const kernel = createEnterpriseAuthorizationKernel();
    const decision = await kernel.authorizeResource(
      baseInput({ knex: stubKnex(), record: { id: 'ticket-1', clientId: 'client-b' } }) as any
    );
    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
  });

  it('denies a client subject without a resolvable client scope', async () => {
    const kernel = createEnterpriseAuthorizationKernel();
    const decision = await kernel.authorizeResource(
      baseInput({
        knex: stubKnex(),
        subject: {
          tenant: 'tenant-a',
          userId: 'client-user-1',
          userType: 'client',
        },
        record: { id: 'ticket-1', clientId: 'client-a' },
      }) as any
    );
    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
  });

  it('leaves internal subjects unchanged', async () => {
    const kernel = createEnterpriseAuthorizationKernel();
    const decision = await kernel.authorizeResource({
      subject: { tenant: 'tenant-a', userId: 'internal-1', userType: 'internal' },
      resource: { type: 'ticket', action: 'read' },
      knex: stubKnex(),
    } as any);
    // Empty bundle narrowing + internal subject: builtin allows, scope not denied.
    expect(decision.allowed).toBe(true);
    expect(decision.scope.denied).toBe(false);
  });
});
