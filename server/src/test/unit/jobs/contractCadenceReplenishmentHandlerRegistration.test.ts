import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sweep: vi.fn(async () => ({ tenantsProcessed: 0, tenantsFailed: 0, summaries: [] })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('server/src/lib/jobs/handlers/replenishContractCadenceServicePeriodsHandler', () => ({
  CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME: 'replenishContractCadenceServicePeriods',
  CONTRACT_CADENCE_REPLENISHMENT_SOURCE_RUN_PREFIX: 'nightly-contract-cadence-replenishment',
  CONTRACT_CADENCE_REPLENISHMENT_TENANT_ENUMERATION:
    '__contract_cadence_replenishment_tenant_enumeration__',
  replenishContractCadenceServicePeriodsSweep: mocks.sweep,
  summarizeContractCadenceReplenishment: vi.fn(),
}));

import { JobHandlerRegistry } from 'server/src/lib/jobs/jobHandlerRegistry';
import { registerAllJobHandlers } from 'server/src/lib/jobs/registerAllHandlers';

/**
 * The durable pg-boss schedule (and the Temporal maintenance fan-out, whose
 * server-side subscriber executes the same registry entry) can only run the
 * sweep if the handler is registered on every boot. This exercises the real
 * `registerAllJobHandlers` path and executes the registry entry, proving the
 * registered handler is the shared sweep rather than merely importing a name.
 */
describe('contract-cadence replenishment handler registration', () => {
  beforeEach(() => {
    JobHandlerRegistry.clear();
    mocks.sweep.mockClear();
  });

  it('registers on boot and executes the shared sweep exactly once', async () => {
    await registerAllJobHandlers({
      jobService: {} as any,
      storageService: {} as any,
      includeEnterprise: false,
      force: true,
    });

    expect(JobHandlerRegistry.has('replenishContractCadenceServicePeriods')).toBe(true);

    await JobHandlerRegistry.execute('replenishContractCadenceServicePeriods', 'job-1', {} as any);

    expect(mocks.sweep).toHaveBeenCalledTimes(1);
  });
});
