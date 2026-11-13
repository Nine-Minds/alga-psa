import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getConnection: vi.fn(),
  tenantRows: vi.fn(),
  scheduleReindex: vi.fn(),
  perTenant: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../lib/jobs/index', () => ({
  initializeScheduler: vi.fn(async () => undefined),
  scheduleSearchClientScopeReindexJob: state.scheduleReindex,
  scheduleOpportunityDisciplineJob: state.perTenant,
  scheduleOpportunityGeneratorsJob: state.perTenant,
  scheduleProjectDateReadinessJob: state.perTenant,
  scheduleOpportunityWeeklyDigestJob: state.perTenant,
  scheduleDateTriggerScanJob: state.perTenant,
  scheduleGenerateRecurringTicketsJob: state.perTenant,
  scheduleQuoteAutoExpirationJob: state.perTenant,
  scheduleMarketingFlipDuePostsJob: state.perTenant,
  scheduleMarketingExpireStaleTargetsJob: state.perTenant,
  scheduleMarketingSendSequenceStepsJob: state.perTenant,
}));
vi.mock('../../../lib/jobs/marketingScheduleCutover', () => ({ scheduleMarketingJobsForTenant: vi.fn(async () => undefined) }));
vi.mock('../../../lib/jobs/initializeJobRunner', () => ({ initializeJobRunner: vi.fn(async () => ({})) }));
vi.mock('../../../lib/jobs/convergeCeMaintenanceSchedules', () => ({ convergeCeMaintenanceSchedules: vi.fn(async () => undefined) }));
vi.mock('../../../lib/jobs/portableRestoreJobs', () => ({ registerPortableRestoreJobs: vi.fn(async () => undefined) }));
vi.mock('server/src/lib/db/db', () => ({ getConnection: state.getConnection }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    unscoped: vi.fn(() => ({ whereNull: vi.fn().mockReturnThis(), select: state.tenantRows })),
  })),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: state.error } }));
vi.mock('@alga-psa/core/capability', () => ({ forcedValue: vi.fn(() => 'off') }));

describe('scheduled-job boot enumerates tenants once and shares the list', () => {
  const originalEdition = process.env.EDITION;

  beforeEach(() => {
    vi.clearAllMocks();
    state.getConnection.mockResolvedValue({});
    state.tenantRows.mockResolvedValue([{ tenant: 't-1' }, { tenant: 't-2' }]);
    state.scheduleReindex.mockResolvedValue('job');
    state.perTenant.mockResolvedValue('job');
  });

  afterAll(() => {
    if (originalEdition === undefined) delete process.env.EDITION;
    else process.env.EDITION = originalEdition;
  });

  it('CE: one tenant read feeds both the search re-index queue and the per-tenant schedules', async () => {
    process.env.EDITION = 'community';
    const { initializeScheduledJobs } = await import('../../../lib/jobs/initializeScheduledJobs');

    await initializeScheduledJobs();

    expect(state.tenantRows).toHaveBeenCalledOnce();
    expect(state.getConnection).toHaveBeenCalledOnce();
    expect(state.scheduleReindex.mock.calls.map((call) => call[0])).toEqual(['t-1', 't-2']);
    expect(state.perTenant).toHaveBeenCalledWith('t-1', expect.anything());
    expect(state.perTenant).toHaveBeenCalledWith('t-2', expect.anything());
  });

  it('EE: queues the re-index for every tenant from a single read', async () => {
    process.env.EDITION = 'enterprise';
    const { initializeScheduledJobs } = await import('../../../lib/jobs/initializeScheduledJobs');

    await initializeScheduledJobs();

    expect(state.tenantRows).toHaveBeenCalledOnce();
    expect(state.scheduleReindex.mock.calls.map((call) => call[0])).toEqual(['t-1', 't-2']);
    expect(state.perTenant).not.toHaveBeenCalled();
  });

  it('EE: a failed tenant read skips only the re-index and boot still succeeds', async () => {
    process.env.EDITION = 'enterprise';
    state.tenantRows.mockRejectedValue(new Error('db down'));
    const { initializeScheduledJobs } = await import('../../../lib/jobs/initializeScheduledJobs');

    await expect(initializeScheduledJobs()).resolves.toBeUndefined();
    expect(state.scheduleReindex).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith('Failed to enumerate tenants for search client-scope re-index', expect.any(Error));
  });
});
