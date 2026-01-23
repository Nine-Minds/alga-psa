import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user_1', tenant: 'tenant_1' })),
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} as any, tenant: 'tenant_1' })),
}));

vi.mock('@shared/workflow/runtime', async () => {
  const actual = await vi.importActual<any>('@shared/workflow/runtime');
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

import { listWorkflowSchemaRefsAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getSchemaRegistry } from '@shared/workflow/runtime';

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

