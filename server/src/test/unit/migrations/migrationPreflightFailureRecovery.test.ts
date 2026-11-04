import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(),
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  preflight: vi.fn(),
  table: vi.fn(),
  where: vi.fn(),
  first: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@alga-psa/db', async importOriginal => ({
  ...await importOriginal<any>(),
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: mocks.tenantDb,
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@alga-psa/auth', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@/lib/jobs/initializeJobRunner', () => ({ initializeJobRunner: vi.fn() }));
vi.mock('@/lib/jobs/JobRunnerFactory', () => ({ getJobRunner: vi.fn() }));
vi.mock('../../../lib/migrations/MigrationPlanner', () => ({
  MigrationPlanner: class {
    preflight = mocks.preflight;
  },
  parseConfiguration: vi.fn(),
}));

import { preflightMigrationJob } from '../../../lib/migrations/migrationActions';

describe('preflightMigrationJob failure recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ tenant: 'tenant-1', user_id: 'user-1' });
    mocks.hasPermission.mockResolvedValue(true);
    mocks.createTenantKnex.mockResolvedValue({ knex: { fn: { now: () => 'database-now' } } });
    mocks.tenantDb.mockReturnValue({ table: mocks.table });
    mocks.table.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ first: mocks.first, update: mocks.update });
    mocks.update.mockResolvedValue(1);
  });

  it('reverts the job out of preflighting and rethrows when the planner fails', async () => {
    mocks.first.mockResolvedValue({ migration_job_id: 'job-1', state: 'ready', updated_at: new Date() });
    mocks.preflight.mockRejectedValue(new Error('remaining connection slots are reserved'));

    await expect(preflightMigrationJob('job-1')).rejects.toThrow('remaining connection slots');

    expect(mocks.update).toHaveBeenNthCalledWith(1, { state: 'preflighting', updated_at: 'database-now' });
    expect(mocks.update).toHaveBeenNthCalledWith(2, {
      state: 'needs_configuration',
      preflighted_at: null,
      updated_at: 'database-now',
    });
  });

  it('refuses a job that is actively preflighting', async () => {
    mocks.first.mockResolvedValue({ migration_job_id: 'job-1', state: 'preflighting', updated_at: new Date() });
    await expect(preflightMigrationJob('job-1')).rejects.toThrow('cannot be preflighted');
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it('re-runs a job stuck in preflighting past the stale window', async () => {
    mocks.first.mockResolvedValue({
      migration_job_id: 'job-1',
      state: 'preflighting',
      updated_at: new Date(Date.now() - 10 * 60 * 1000),
    });
    mocks.preflight.mockResolvedValue({ state: 'ready', issues: [], plan: [], preflightedAt: 'now' });

    await expect(preflightMigrationJob('job-1')).resolves.toMatchObject({ state: 'ready' });
    expect(mocks.preflight).toHaveBeenCalledOnce();
  });
});
