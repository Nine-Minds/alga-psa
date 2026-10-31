import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ hasTable: vi.fn(), cleanup: vi.fn(), provider: vi.fn(), db: {} as any, jobs: new Map<string, any>() }));
vi.mock('@alga-psa/jobs/fanout', () => ({ defineJob: (d: any) => { state.jobs.set(d.name, d); return d; }, getJobDescriptor: (n: string) => state.jobs.get(n) }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => state.db }));
vi.mock('@alga-psa/co-managed', () => ({ cleanupPortableRestoreUploadsForInstallation: state.cleanup }));
vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({ StorageProviderFactory: { createProvider: state.provider } }));
import { getJobDescriptor } from '@alga-psa/jobs/fanout';
const resetJobDescriptors = () => state.jobs.clear();
import { portableRestoreUploadCleanup, registerPortableRestoreJobs, PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB } from '../../../lib/jobs/portableRestoreJobs';

beforeEach(() => {
  vi.clearAllMocks(); delete process.env.FORCE_CAPABILITIES; resetJobDescriptors();
  state.db = { schema: { hasTable: state.hasTable } };
  state.hasTable.mockResolvedValue(true); state.provider.mockResolvedValue({ location: 'current' });
  state.cleanup.mockResolvedValue({ destinations: 1, cleaned: 1, failed: 0, skipped: 0 });
});
it('defers a rolling schema without initializing storage', async () => {
  state.hasTable.mockResolvedValue(false);
  expect(await portableRestoreUploadCleanup()).toEqual({ schemaReady: false });
  expect(state.provider).not.toHaveBeenCalled(); expect(state.cleanup).not.toHaveBeenCalled();
});
it('uses installation-wide recovery rather than active tenant enumeration', async () => {
  expect(await portableRestoreUploadCleanup()).toMatchObject({ schemaReady: true, destinations: 1, cleaned: 1 });
  expect(state.cleanup).toHaveBeenCalledWith(state.db, { location: 'current' });
});
it('reports failed cleanup to the job runner instead of marking the sweep successful', async () => {
  state.cleanup.mockResolvedValue({ destinations: 2, cleaned: 1, failed: 1, skipped: 0 });
  await expect(portableRestoreUploadCleanup()).rejects.toThrow('failed attempts');
});
it('is a no-op, touching neither database nor storage, when co-managed is forced off', async () => {
  process.env.FORCE_CAPABILITIES = 'co-managed:off';
  expect(await portableRestoreUploadCleanup()).toEqual({ disabled: true });
  expect(state.hasTable).not.toHaveBeenCalled(); expect(state.provider).not.toHaveBeenCalled();
});
const journal = (rows: boolean) => {
  state.db = Object.assign(() => ({ select: () => ({ first: async () => (rows ? { '?column?': 1 } : undefined) }) }), { schema: { hasTable: state.hasTable }, raw: (sql: string) => sql });
};
it('registers one idempotent system job with a schedule once the upload journal has rows', async () => {
  journal(true);
  expect(await registerPortableRestoreJobs()).toBe(true);
  expect(await registerPortableRestoreJobs()).toBe(false);
  expect(getJobDescriptor(PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB)).toMatchObject({ scope: 'system', schedule: { cron: '*/15 * * * *' } });
});
it('schedules nothing while dark: an empty journal, a missing table, or the kill switch', async () => {
  journal(false);
  expect(await registerPortableRestoreJobs()).toBe(false);
  expect(getJobDescriptor(PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB)).toBeUndefined();
  journal(true); state.hasTable.mockResolvedValue(false);
  expect(await registerPortableRestoreJobs()).toBe(false);
  state.hasTable.mockResolvedValue(true); process.env.FORCE_CAPABILITIES = 'co-managed:off';
  expect(await registerPortableRestoreJobs()).toBe(false);
  expect(getJobDescriptor(PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB)).toBeUndefined();
  process.env.FORCE_CAPABILITIES = 'co-managed:bogus'; // malformed also fails closed
  expect(await registerPortableRestoreJobs()).toBe(false);
});
