import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ schedule: vi.fn(), initialize: vi.fn(), run: vi.fn() }));
vi.mock('../../../lib/jobs/index', () => ({ initializeScheduler: state.initialize }));
vi.mock('@alga-psa/jobs/fanout', () => ({ runMaintenanceJob: state.run }));
vi.mock('@alga-psa/jobs/handlers/portableRestoreUploadCleanupHandler', () => ({ PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB: 'portable-restore-upload-cleanup' }));
import { schedulePortableRestoreUploadCleanupJob, portableRestoreUploadCleanupJobHandler } from '../../../lib/jobs/handlers/portableRestoreUploadCleanupHandler';

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('EDITION', 'community'); vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');
  state.initialize.mockResolvedValue({ scheduleRecurringJob: state.schedule }); state.schedule.mockResolvedValue('global-sweep');
});
afterEach(() => vi.unstubAllEnvs());
it('registers one PG Boss installation sweep with no tenant identity', async () => {
  expect(await schedulePortableRestoreUploadCleanupJob()).toBe('global-sweep');
  expect(state.schedule).toHaveBeenCalledWith('portable-restore-upload-cleanup', '*/15 * * * *', {});
  await portableRestoreUploadCleanupJobHandler();
  expect(state.run).toHaveBeenCalledWith('portable-restore-upload-cleanup');
});
it.each(['enterprise', 'ee'])('leaves %s scheduling to Temporal', async edition => {
  vi.stubEnv('EDITION', edition);
  expect(await schedulePortableRestoreUploadCleanupJob()).toBeNull(); expect(state.initialize).not.toHaveBeenCalled();
});
it('honors the enterprise public-edition configuration without creating a second schedule', async () => {
  vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
  expect(await schedulePortableRestoreUploadCleanupJob()).toBeNull(); expect(state.schedule).not.toHaveBeenCalled();
});
