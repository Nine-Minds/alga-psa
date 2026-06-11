import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Module mocks (hoisted) ──────────────────────────────────────────────────
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getDefaultQboRealmId: vi.fn(async () => 'realm-1')
}));

vi.mock('./accountingSyncSettings', () => ({
  getAccountingSyncSettings: vi.fn(async () => ({
    autoSyncEnabled: true,
    autoSyncStartDate: null
  }))
}));

vi.mock('./syncOperationsRepository', () => ({
  SyncOperationsRepository: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn(async () => ({})),
    satisfyPending: vi.fn(async () => 1)
  }))
}));

import { enqueueInvoiceAutoExport, satisfyExportOpsForManualBatch } from './syncProducers';
import { getDefaultQboRealmId } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { getAccountingSyncSettings } from './accountingSyncSettings';
import { SyncOperationsRepository } from './syncOperationsRepository';

const mockGetRealm = vi.mocked(getDefaultQboRealmId);
const mockGetSettings = vi.mocked(getAccountingSyncSettings);

describe('enqueueInvoiceAutoExport', () => {
  const knex = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default happy-path mocks
    mockGetRealm.mockResolvedValue('realm-1');
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does nothing when not enterprise edition', async () => {
    vi.stubEnv('EDITION', 'community');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');

    await enqueueInvoiceAutoExport(knex, 't1', 'inv-1');

    expect(mockGetSettings).not.toHaveBeenCalled();
    expect(mockGetRealm).not.toHaveBeenCalled();
  });

  it('does nothing when autoSyncEnabled=false', async () => {
    vi.stubEnv('EDITION', 'ee');
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: false, autoSyncStartDate: null });

    await enqueueInvoiceAutoExport(knex, 't1', 'inv-1');

    expect(mockGetRealm).not.toHaveBeenCalled();
  });

  it('does nothing when today is before autoSyncStartDate cutoff', async () => {
    vi.stubEnv('EDITION', 'ee');
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: futureDate });

    await enqueueInvoiceAutoExport(knex, 't1', 'inv-1');

    expect(mockGetRealm).not.toHaveBeenCalled();
  });

  it('does nothing when getDefaultQboRealmId returns null', async () => {
    vi.stubEnv('EDITION', 'ee');
    mockGetRealm.mockResolvedValue(null);

    await enqueueInvoiceAutoExport(knex, 't1', 'inv-1');

    const opsInstance = vi.mocked(SyncOperationsRepository).mock.instances[0];
    // If SyncOperationsRepository was constructed, enqueue should not have been called
    // (or the repo was never constructed at all)
    if (opsInstance) {
      expect((opsInstance as any).enqueue).not.toHaveBeenCalled();
    } else {
      // repo was never instantiated — test passes
      expect(true).toBe(true);
    }
  });

  it('enqueues the invoice when all gates pass (EE + autoSync + past cutoff + realm found)', async () => {
    vi.stubEnv('EDITION', 'ee');
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: pastDate });

    // Capture the enqueue call via a dedicated mock before calling
    const enqueueMock = vi.fn(async () => ({}));
    vi.mocked(SyncOperationsRepository).mockImplementationOnce(() => ({
      enqueue: enqueueMock,
      satisfyPending: vi.fn(async () => 0)
    } as any));

    await enqueueInvoiceAutoExport(knex, 't1', 'inv-42');

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        algaEntityId: 'inv-42',
        operation: 'export_invoice',
        adapterType: 'quickbooks_online'
      })
    );
  });

  it('swallows errors without throwing (fire-and-forget)', async () => {
    vi.stubEnv('EDITION', 'ee');
    mockGetSettings.mockRejectedValue(new Error('db error'));

    await expect(enqueueInvoiceAutoExport(knex, 't1', 'inv-1')).resolves.toBeUndefined();
  });
});

describe('satisfyExportOpsForManualBatch', () => {
  const knex = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing for non-quickbooks adapterType', async () => {
    await satisfyExportOpsForManualBatch(knex, 't1', 'xero', ['inv-1']);
    const instances = vi.mocked(SyncOperationsRepository).mock.instances;
    // No instances should have been created, or satisfyPending not called
    for (const inst of instances) {
      expect((inst as any).satisfyPending).not.toHaveBeenCalled();
    }
  });

  it('does nothing for empty invoiceIds', async () => {
    await satisfyExportOpsForManualBatch(knex, 't1', 'quickbooks_online', []);
    // SyncOperationsRepository should not be called with satisfyPending
    const instances = vi.mocked(SyncOperationsRepository).mock.instances;
    for (const inst of instances) {
      expect((inst as any).satisfyPending).not.toHaveBeenCalled();
    }
  });
});
