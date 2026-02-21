import { describe, expect, it } from 'vitest';
import { serializeEntraSyncRunProgress } from '@ee/lib/integrations/entra/sync/syncResultSerializer';
import type { EntraSyncRunProgressResult } from '@ee/lib/integrations/entra/entraWorkflowClient';

describe('serializeEntraSyncRunProgress', () => {
  it('T112: keeps a stable DTO shape for success and failure run states', () => {
    const successInput: EntraSyncRunProgressResult = {
      run: {
        runId: 'run-success',
        status: 'succeeded',
        runType: 'all_tenants',
        startedAt: '2026-02-20T00:00:00.000Z',
        completedAt: '2026-02-20T00:05:00.000Z',
        totalTenants: 5 as unknown as number,
        processedTenants: 5 as unknown as number,
        succeededTenants: 5 as unknown as number,
        failedTenants: 0 as unknown as number,
        summary: { created: 10, linked: 2 },
      },
      tenantResults: [
        {
          managedTenantId: 'managed-success',
          clientId: 'client-success',
          status: 'succeeded',
          created: 2 as unknown as number,
          linked: 1 as unknown as number,
          updated: 0 as unknown as number,
          ambiguous: 0 as unknown as number,
          inactivated: 0 as unknown as number,
          errorMessage: null,
          startedAt: '2026-02-20T00:00:00.000Z',
          completedAt: '2026-02-20T00:01:00.000Z',
        },
      ],
    };

    const failureInput: EntraSyncRunProgressResult = {
      run: {
        runId: 'run-failure',
        status: 'failed',
        runType: 'single_tenant',
        startedAt: '2026-02-20T01:00:00.000Z',
        completedAt: null,
        totalTenants: Number('1'),
        processedTenants: Number('1'),
        succeededTenants: Number('0'),
        failedTenants: Number('1'),
        summary: 'not-an-object' as unknown as Record<string, unknown>,
      },
      tenantResults: [
        {
          managedTenantId: null,
          clientId: null,
          status: 'failed',
          created: Number.NaN,
          linked: Number.NaN,
          updated: Number.NaN,
          ambiguous: Number.NaN,
          inactivated: Number.NaN,
          errorMessage: 'adapter timeout',
          startedAt: null,
          completedAt: undefined as unknown as string | null,
        },
      ],
    };

    const success = serializeEntraSyncRunProgress(successInput);
    const failure = serializeEntraSyncRunProgress(failureInput);

    expect(Object.keys(success.run || {})).toEqual(Object.keys(failure.run || {}));
    expect(Object.keys(success.tenantResults[0] || {})).toEqual(
      Object.keys(failure.tenantResults[0] || {})
    );

    expect(success.run).toMatchObject({
      status: 'succeeded',
      totalTenants: 5,
      processedTenants: 5,
      failedTenants: 0,
      summary: { created: 10, linked: 2 },
    });
    expect(failure.run).toMatchObject({
      status: 'failed',
      totalTenants: 1,
      processedTenants: 1,
      failedTenants: 1,
      summary: {},
    });
    expect(failure.tenantResults[0]).toMatchObject({
      status: 'failed',
      created: 0,
      linked: 0,
      updated: 0,
      ambiguous: 0,
      inactivated: 0,
      errorMessage: 'adapter timeout',
      startedAt: null,
      completedAt: null,
    });
  });
});
