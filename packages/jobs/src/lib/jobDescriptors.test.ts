import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const tenantQueryCalls: string[] = [];
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  tenantDb: vi.fn(() => ({
    unscoped: () => {
      const q: any = {
        whereNull: (c: string) => { tenantQueryCalls.push(`whereNull:${c}`); return q; },
        select: async () => [{ tenant: 'a' }, { tenant: 'b' }],
      };
      return q;
    },
  })),
}));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn(async () => ({})) }));
vi.mock('@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization', () => ({ replenishContractCadenceServicePeriodsSweep: vi.fn() }));

import { defineJob, resetJobDescriptors } from './jobDescriptors';
import { isKnownMaintenanceJob, listMaintenanceJobNames, runMaintenanceJob } from './maintenanceJobFanout';

afterEach(() => { resetJobDescriptors(); tenantQueryCalls.length = 0; });

describe('jobDescriptors', () => {
  it('with no descriptors the name list is the native list and an unknown job still throws', async () => {
    const names = listMaintenanceJobNames();
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(isKnownMaintenanceJob('co-managed-test-job')).toBe(false);
    await expect(runMaintenanceJob('co-managed-test-job')).rejects.toThrow('Unknown maintenance job');
  });

  it('registration is additive: native names first, descriptor names after', async () => {
    const native = listMaintenanceJobNames();
    const run = vi.fn(async () => ({ total: 2, succeeded: 2, failed: 0 }));
    defineJob({ name: 'ext-job', scope: 'system', run, schedule: { cron: '*/5 * * * *' } });
    expect(listMaintenanceJobNames()).toEqual([...native, 'ext-job']);
    expect(isKnownMaintenanceJob('ext-job')).toBe(true);
    await expect(runMaintenanceJob('ext-job')).resolves.toMatchObject({ jobName: 'ext-job', scope: 'system', total: 2 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a native job name wins over a descriptor of the same name', () => {
    const [first] = listMaintenanceJobNames();
    defineJob({ name: first, scope: 'system', run: async () => undefined });
    expect(listMaintenanceJobNames().filter((n) => n === first)).toHaveLength(1);
  });

  it('rejects duplicate names and malformed crons', () => {
    defineJob({ name: 'dup', scope: 'system', run: async () => undefined });
    expect(() => defineJob({ name: 'dup', scope: 'system', run: async () => undefined })).toThrow('duplicate');
    expect(() => defineJob({ name: 'bad', scope: 'system', run: async () => undefined, schedule: { cron: 'every day' } })).toThrow('malformed cron');
    expect(() => defineJob({ name: 'bad2', scope: 'system', run: async () => undefined, schedule: { cron: '* * * *' } })).toThrow('malformed cron');
  });

  it('includeSuspended only changes the tenant query when set', async () => {
    const seen: string[] = [];
    defineJob({ name: 'plain', scope: 'tenant', run: async (t) => { seen.push(t); } });
    await runMaintenanceJob('plain');
    expect(tenantQueryCalls).toEqual(['whereNull:suspended_at']);
    tenantQueryCalls.length = 0;
    defineJob({ name: 'all', scope: 'tenant', includeSuspended: true, run: async () => undefined });
    await runMaintenanceJob('all');
    expect(tenantQueryCalls).toEqual([]);
    expect(seen).toEqual(['a', 'b']);
  });
});
