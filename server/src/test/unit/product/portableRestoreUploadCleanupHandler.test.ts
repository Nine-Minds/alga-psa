import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ hasTable: vi.fn(), cleanup: vi.fn(), provider: vi.fn(), db: {} as any }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => state.db }));
vi.mock('@alga-psa/co-managed', () => ({ cleanupPortableRestoreUploadsForInstallation: state.cleanup }));
vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({ StorageProviderFactory: { createProvider: state.provider } }));
import { portableRestoreUploadCleanupHandler } from '@alga-psa/jobs/handlers/portableRestoreUploadCleanupHandler';

beforeEach(() => {
  vi.clearAllMocks(); state.db = { schema: { hasTable: state.hasTable } };
  state.hasTable.mockResolvedValue(true); state.provider.mockResolvedValue({ location: 'current' });
  state.cleanup.mockResolvedValue({ destinations: 1, cleaned: 1, failed: 0, skipped: 0 });
});
it('defers a rolling schema without initializing storage', async () => {
  state.hasTable.mockResolvedValue(false);
  expect(await portableRestoreUploadCleanupHandler()).toEqual({ schemaReady: false });
  expect(state.provider).not.toHaveBeenCalled(); expect(state.cleanup).not.toHaveBeenCalled();
});
it('uses installation-wide recovery rather than active tenant enumeration', async () => {
  expect(await portableRestoreUploadCleanupHandler()).toMatchObject({ schemaReady: true, destinations: 1, cleaned: 1 });
  expect(state.cleanup).toHaveBeenCalledWith(state.db, { location: 'current' });
});
it('reports failed cleanup to the job runner instead of marking the sweep successful', async () => {
  state.cleanup.mockResolvedValue({ destinations: 2, cleaned: 1, failed: 1, skipped: 0 });
  await expect(portableRestoreUploadCleanupHandler()).rejects.toThrow('failed attempts');
});
