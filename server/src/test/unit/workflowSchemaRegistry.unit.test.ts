import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user_1', tenant: 'tenant_1' })),
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} as any, tenant: 'tenant_1' })),
}));

vi.mock('@alga-psa/workflows/runtime', async () => {
  const actual = await vi.importActual<any>('@alga-psa/workflows/runtime');
  return {
    ...actual,
    initializeWorkflowRuntimeV2: vi.fn(),
    getSchemaRegistry: vi.fn(() => ({
      listRefs: () => ['payload.EmailWorkflowPayload.v1', 'payload.ExamplePayload.v1'],
      has: () => true,
      toJsonSchema: () => ({}),
    })),
  };
});

import { listWorkflowSchemaRefsAction } from '@alga-psa/workflows/actions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getSchemaRegistry } from '@alga-psa/workflows/runtime';

describe('workflow schema registry actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists schema refs from registry', async () => {
    const result = await listWorkflowSchemaRefsAction();
    expect(result.refs).toEqual(['payload.EmailWorkflowPayload.v1', 'payload.ExamplePayload.v1']);
    expect(getSchemaRegistry).toHaveBeenCalledTimes(1);
    expect(hasPermission).toHaveBeenCalled();
  });
});

