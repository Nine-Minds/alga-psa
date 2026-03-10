import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const enqueueWorkflowMock = vi.fn(async () => ({ enqueued: true, alreadyRunning: false }));

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) => fn({ id: 'user-1', user_type: 'internal', roles: [] }, { tenant: 'tenant-123' }, ...args),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@/lib/email-domains/workflowClient', () => ({
  enqueueManagedEmailDomainWorkflow: vi.fn((args) => enqueueWorkflowMock(args)),
}));

vi.mock('@/lib/observability/logging', () => ({
  observabilityLogger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type InsertBuilder = {
  onConflict: ReturnType<typeof vi.fn>;
};

function createKnexHarness(options: {
  tenantColumn?: 'tenant' | 'tenant_id';
  existingRow?: Record<string, unknown> | undefined;
}) {
  const tenantColumn = options.tenantColumn ?? 'tenant';
  const firstMock = vi.fn(async () => options.existingRow);
  const updateMock = vi.fn(async () => 1);
  const insertFallbackMock = vi.fn(async () => 1);
  const transactionMock = vi.fn(async (callback: (trx: any) => Promise<void>) => {
    const trx = vi.fn((_table: string) => ({
      where: vi.fn(() => ({
        first: firstMock,
        update: updateMock,
      })),
      insert: insertFallbackMock,
    })) as any;

    await callback(trx);
  });

  const onConflictMock = vi.fn(() => ({
    merge: vi.fn(async () => {
      throw { code: '42P10' };
    }),
  }));
  const insertMock = vi.fn((): InsertBuilder => ({
    onConflict: onConflictMock,
  }));

  const schemaHasColumnMock = vi.fn(async (_table: string, column: string) => column === tenantColumn);

  const knexMock = vi.fn((_table: string) => ({
    insert: insertMock,
  })) as any;
  knexMock.schema = {
    hasColumn: schemaHasColumnMock,
  };
  knexMock.transaction = transactionMock;

  createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: 'tenant-123' });

  return {
    firstMock,
    updateMock,
    insertFallbackMock,
    insertMock,
    onConflictMock,
    schemaHasColumnMock,
    transactionMock,
  };
}

describe('requestManagedEmailDomain conflict fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    enqueueWorkflowMock.mockClear();
  });

  it('updates the existing email domain row when ON CONFLICT is unavailable', async () => {
    const harness = createKnexHarness({
      existingRow: { domain_name: 'example.com', tenant: 'tenant-123' },
    });

    const { requestManagedEmailDomain } = await import('@/lib/actions/email-actions/managedDomainActions');
    const result = await requestManagedEmailDomain('EXAMPLE.COM');

    expect(harness.onConflictMock).toHaveBeenCalledWith(['tenant', 'domain_name']);
    expect(harness.firstMock).toHaveBeenCalled();
    expect(harness.updateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      failure_reason: null,
    }));
    expect(harness.insertFallbackMock).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, alreadyRunning: false });
    expect(enqueueWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-123',
      domain: 'example.com',
      trigger: 'register',
    }));
  });

  it('inserts a new email domain row when ON CONFLICT is unavailable and no row exists', async () => {
    const harness = createKnexHarness({
      tenantColumn: 'tenant_id',
      existingRow: undefined,
    });

    const { requestManagedEmailDomain } = await import('@/lib/actions/email-actions/managedDomainActions');
    await requestManagedEmailDomain('example.com');

    expect(harness.onConflictMock).toHaveBeenCalledWith(['tenant_id', 'domain_name']);
    expect(harness.insertFallbackMock).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-123',
      domain_name: 'example.com',
      status: 'pending',
    }));
    expect(harness.updateMock).not.toHaveBeenCalled();
  });
});
