import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(),
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  initializeJobRunner: vi.fn(),
  getJobRunner: vi.fn(),
  scheduleJob: vi.fn(),
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
vi.mock('@/lib/jobs/initializeJobRunner', () => ({ initializeJobRunner: mocks.initializeJobRunner }));
vi.mock('@/lib/jobs/JobRunnerFactory', () => ({ getJobRunner: mocks.getJobRunner }));

import { executeMigrationJob } from '../../../lib/migrations/migrationActions';

describe('executeMigrationJob dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ tenant: 'tenant-1', user_id: 'user-1' });
    mocks.hasPermission.mockResolvedValue(true);
    mocks.createTenantKnex.mockResolvedValue({ knex: { fn: { now: () => 'database-now' } } });
    mocks.tenantDb.mockReturnValue({ table: mocks.table });
    mocks.table.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ first: mocks.first, update: mocks.update });
    mocks.first.mockResolvedValue({ migration_job_id: 'migration-1', state: 'ready' });
    mocks.update.mockResolvedValue(1);
    mocks.initializeJobRunner.mockResolvedValue(undefined);
    mocks.getJobRunner.mockResolvedValue({ scheduleJob: mocks.scheduleJob });
  });

  it('schedules the migration payload and records/returns the runner job ID', async () => {
    mocks.scheduleJob.mockResolvedValue({ jobId: 'runner-job-42', externalId: 'temporal-workflow-42' });

    await expect(executeMigrationJob('migration-1')).resolves.toEqual({ jobId: 'runner-job-42' });

    expect(mocks.initializeJobRunner).toHaveBeenCalledOnce();
    expect(mocks.scheduleJob).toHaveBeenCalledOnce();
    expect(mocks.scheduleJob).toHaveBeenCalledWith('migration_apply', {
      tenantId: 'tenant-1',
      metadata: { user_id: 'user-1', migrationJobId: 'migration-1' },
      migrationJobId: 'migration-1',
      userId: 'user-1',
    });
    expect(mocks.update).toHaveBeenCalledWith({
      state: 'queued',
      job_id: 'runner-job-42',
      queued_at: 'database-now',
      updated_at: 'database-now',
    });
  });

  it('leaves the migration unqueued when runner scheduling fails', async () => {
    mocks.scheduleJob.mockRejectedValue(new Error('Temporal unavailable'));

    await expect(executeMigrationJob('migration-1')).rejects.toThrow('Temporal unavailable');

    expect(mocks.scheduleJob).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
