import { beforeEach, expect, it, vi } from 'vitest';
import { MAINTENANCE_FANOUT_SCHEDULES } from '@alga-psa/types';
const state = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@alga-psa/jobs/fanout', () => ({ runMaintenanceJob: state.run }));
vi.mock('@alga-psa/jobs/handlers/portableRestoreUploadCleanupHandler', () => ({ PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB: 'portable-restore-upload-cleanup' }));
import { portableRestoreUploadCleanupJobHandler } from '../../../lib/jobs/handlers/portableRestoreUploadCleanupHandler';

beforeEach(() => vi.clearAllMocks());
it('declares one installation sweep in the converged maintenance schedules', () => {
  expect(MAINTENANCE_FANOUT_SCHEDULES.filter(s => s.jobName === 'portable-restore-upload-cleanup')).toEqual([{ jobName: 'portable-restore-upload-cleanup', cron: '*/15 * * * *' }]);
});
it('runs the sweep through the maintenance fan-out', async () => {
  await portableRestoreUploadCleanupJobHandler();
  expect(state.run).toHaveBeenCalledWith('portable-restore-upload-cleanup');
});
