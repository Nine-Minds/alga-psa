import { describe, expect, it, vi } from 'vitest';
import { resolveRmmSyncTransport, runRmmSyncWithTransport } from '../../../../lib/integrations/rmm/sync/syncOrchestration';

describe('RMM sync orchestration transport seam', () => {
  it('T009: runs provider sync through a single transport seam without duplicating business logic', async () => {
    const directExecutor = vi.fn(async () => ({ source: 'direct', ok: true }));
    const temporalExecutor = vi.fn(async () => ({ source: 'temporal', ok: true }));

    const result = await runRmmSyncWithTransport({
      context: {
        provider: 'tanium',
        operation: 'full_inventory_sync',
        input: { tenant: 'tenant_1' },
      },
      transportOverride: 'direct',
      directExecutor,
      temporalExecutor,
    });

    expect(result).toEqual({ source: 'direct', ok: true });
    expect(directExecutor).toHaveBeenCalledTimes(1);
    expect(temporalExecutor).not.toHaveBeenCalled();
  });

  it('resolves provider-specific transport override from env when present', () => {
    process.env.TANIUM_SYNC_TRANSPORT = 'temporal';
    expect(resolveRmmSyncTransport('tanium')).toBe('temporal');
    delete process.env.TANIUM_SYNC_TRANSPORT;
  });
});
