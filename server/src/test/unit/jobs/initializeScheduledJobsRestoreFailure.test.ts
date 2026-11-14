import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  initializeScheduler: vi.fn(),
  initializeJobRunner: vi.fn(),
  converge: vi.fn(),
  getConnection: vi.fn(),
  tenantRows: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../lib/jobs/index', () => ({
  initializeScheduler: state.initializeScheduler,
}));
vi.mock('../../../lib/jobs/initializeJobRunner', () => ({ initializeJobRunner: state.initializeJobRunner }));
vi.mock('../../../lib/jobs/convergeCeMaintenanceSchedules', () => ({ convergeCeMaintenanceSchedules: state.converge }));
vi.mock('../../../lib/jobs/portableRestoreJobs', () => {
  throw new Error('portable restore module unavailable');
});
vi.mock('server/src/lib/db/db', () => ({ getConnection: state.getConnection }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    unscoped: vi.fn(() => ({ whereNull: vi.fn().mockReturnThis(), select: state.tenantRows })),
  })),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: state.warn, error: vi.fn() } }));
vi.mock('@alga-psa/core/capability', () => ({ forcedValue: vi.fn(() => 'default') }));

describe('CE scheduled jobs when optional portable restore registration fails', () => {
  const originalEdition = process.env.EDITION;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EDITION = 'community';
    state.initializeScheduler.mockResolvedValue(undefined);
    state.initializeJobRunner.mockResolvedValue({});
    state.converge.mockResolvedValue(undefined);
    state.getConnection.mockResolvedValue({});
    state.tenantRows.mockResolvedValue([]);
  });

  afterAll(() => {
    if (originalEdition === undefined) delete process.env.EDITION;
    else process.env.EDITION = originalEdition;
  });

  it('reports the restore import failure and still converges native CE schedules', async () => {
    const { initializeScheduledJobs } = await import('../../../lib/jobs/initializeScheduledJobs');

    await initializeScheduledJobs();

    expect(state.converge).toHaveBeenCalledOnce();
    expect(state.warn).toHaveBeenCalledOnce();
    expect(state.warn.mock.calls[0]?.[0]).toContain('Portable restore maintenance registration failed');
    expect(state.warn.mock.calls[0]?.[1]?.error).toBeTruthy();
    expect(state.getConnection).toHaveBeenCalledOnce();
  });
});
