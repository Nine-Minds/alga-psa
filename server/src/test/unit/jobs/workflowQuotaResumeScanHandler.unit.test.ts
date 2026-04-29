import { beforeEach, describe, expect, it, vi } from 'vitest';

type WaitRow = {
  wait_id: string;
  run_id: string;
  step_path: string;
  tenant_id: string;
  engine: string | null;
  status: 'WAITING' | 'RESOLVED';
};

const mocks = vi.hoisted(() => ({
  getAdminConnection: vi.fn(),
  resolveQuotaSummary: vi.fn(),
  executeRun: vi.fn(),
  createRunLog: vi.fn(),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: mocks.getAdminConnection,
}));

vi.mock('@alga-psa/workflows/runtime/core', () => ({
  WorkflowRuntimeV2: class WorkflowRuntimeV2 {
    executeRun = mocks.executeRun;
  },
  workflowStepQuotaService: {
    resolveQuotaSummary: mocks.resolveQuotaSummary,
  },
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowRunLogModelV2: {
    create: mocks.createRunLog,
  },
}));

function buildMockKnex(initialWaits: WaitRow[]) {
  const waits = new Map(initialWaits.map((wait) => [wait.wait_id, { ...wait }]));
  let selectedWaitIds: string[] = [];

  const selectCandidates = () => {
    const candidates = Array.from(waits.values()).filter((w) => w.status === 'WAITING');
    return candidates.map((w) => ({
      wait_id: w.wait_id,
      run_id: w.run_id,
      step_path: w.step_path,
      tenant_id: w.tenant_id,
      engine: w.engine,
    }));
  };

  const trx = ((table: string) => {
    if (table === 'workflow_run_waits as w') {
      const chain: any = {
        join: () => chain,
        where: () => chain,
        whereNotNull: () => chain,
        orderBy: () => chain,
        forUpdate: () => chain,
        skipLocked: () => chain,
        limit: () => chain,
        select: async () => selectCandidates(),
      };
      return chain;
    }

    if (table === 'workflow_run_waits') {
      const chain: any = {
        whereIn: (_col: string, ids: string[]) => {
          selectedWaitIds = ids;
          return chain;
        },
        andWhere: () => chain,
        update: async () => {
          for (const id of selectedWaitIds) {
            const row = waits.get(id);
            if (row) row.status = 'RESOLVED';
          }
        },
      };
      return chain;
    }

    if (table === 'workflow_runs') {
      const chain: any = {
        whereIn: () => chain,
        andWhere: () => chain,
        update: async () => undefined,
      };
      return chain;
    }

    throw new Error(`Unexpected table ${table}`);
  }) as any;

  const knex: any = {
    transaction: async (fn: (tx: any) => Promise<any>) => fn(trx),
  };

  return { knex, waits };
}

describe('workflowQuotaResumeScanHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRunLog.mockResolvedValue(undefined);
    mocks.executeRun.mockResolvedValue(undefined);
  });

  it('resumes only eligible tenants and sets runs back to RUNNING without pre-consuming quota', async () => {
    const { knex } = buildMockKnex([
      { wait_id: 'wait-a1', run_id: 'run-a1', step_path: 'root.steps[1]', tenant_id: 'tenant-a', engine: 'db', status: 'WAITING' },
      { wait_id: 'wait-b1', run_id: 'run-b1', step_path: 'root.steps[2]', tenant_id: 'tenant-b', engine: 'db', status: 'WAITING' },
    ]);
    mocks.getAdminConnection.mockResolvedValue(knex);
    mocks.resolveQuotaSummary.mockImplementation(async (_trx: unknown, tenant: string) => {
      if (tenant === 'tenant-a') {
        return { effectiveLimit: 1, usedCount: 1, periodStart: '2026-04-01T00:00:00.000Z', periodEnd: '2026-05-01T00:00:00.000Z' };
      }
      return { effectiveLimit: 5, usedCount: 2, periodStart: '2026-04-01T00:00:00.000Z', periodEnd: '2026-05-01T00:00:00.000Z' };
    });

    const { workflowQuotaResumeScanHandler } = await import('../../../lib/jobs/handlers/workflowQuotaResumeScanHandler');
    await workflowQuotaResumeScanHandler({ tenantId: 'ignored', batchSize: 10 });

    expect(mocks.executeRun).toHaveBeenCalledTimes(1);
    expect(mocks.executeRun).toHaveBeenCalledWith(expect.anything(), 'run-b1', 'job:workflow-quota-resume-scan');
    expect(mocks.createRunLog).toHaveBeenCalledTimes(1);
    expect(mocks.createRunLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ run_id: 'run-b1' }),
    );
  });

  it('does not resolve the same wait twice across repeated scans', async () => {
    const { knex, waits } = buildMockKnex([
      { wait_id: 'wait-1', run_id: 'run-1', step_path: 'root.steps[1]', tenant_id: 'tenant-1', engine: 'db', status: 'WAITING' },
    ]);
    mocks.getAdminConnection.mockResolvedValue(knex);
    mocks.resolveQuotaSummary.mockResolvedValue({
      effectiveLimit: null,
      usedCount: 0,
      periodStart: '2026-04-01T00:00:00.000Z',
      periodEnd: '2026-05-01T00:00:00.000Z',
    });

    const { workflowQuotaResumeScanHandler } = await import('../../../lib/jobs/handlers/workflowQuotaResumeScanHandler');
    await workflowQuotaResumeScanHandler({ tenantId: 'ignored', batchSize: 10 });
    await workflowQuotaResumeScanHandler({ tenantId: 'ignored', batchSize: 10 });

    expect(waits.get('wait-1')?.status).toBe('RESOLVED');
    expect(mocks.executeRun).toHaveBeenCalledTimes(1);
    expect(mocks.createRunLog).toHaveBeenCalledTimes(1);
  });
});
