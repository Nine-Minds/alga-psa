import { beforeEach, describe, expect, it, vi } from 'vitest';

// The job (moved to @alga-psa/jobs in c2d783aa61) now reads its connection from
// @alga-psa/db and issues the batched delete through the tenantDb facade
// (9e48b0af01), so that facade is the seam to fake: `unscoped()` returns a
// chainable builder whose awaited terminal resolves to the next queued batch.
const dbState = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  limitMock: vi.fn(),
  rawMock: vi.fn(),
}));

vi.mock('@alga-psa/db', () => {
  const makeBuilder = () => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'where', 'orderBy', 'with', 'using', 'delete', 'returning']) {
      builder[method] = () => builder;
    }
    builder.limit = (n: number) => {
      dbState.limitMock(n);
      return builder;
    };
    // Only the delete chain is awaited (the doomed-rows chain is embedded as a
    // subquery), so the thenable resolves one queued delete batch per await.
    builder.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => {
      return new Promise((res) => res(dbState.deleteMock())).then(resolve, reject);
    };
    return builder;
  };

  return {
    getConnection: vi.fn(async () => ({
      raw: (...args: unknown[]) => dbState.rawMock(...args),
      ref: (identifier: string) => identifier,
    })),
    tenantDb: vi.fn(() => ({
      unscoped: () => makeBuilder(),
    })),
  };
});

import { cleanupWebhookDeliveriesJob } from '@alga-psa/jobs/handlers/cleanupWebhookDeliveriesJob';

describe('cleanupWebhookDeliveriesJob (T035)', () => {
  beforeEach(() => {
    dbState.deleteMock.mockReset();
    dbState.limitMock.mockReset();
    dbState.rawMock.mockReset();
  });

  it('deletes rows older than 30 days in batches of 10000 and stops when a partial batch returns', async () => {
    const BATCH_SIZE = 10_000;

    // Three batches: full, full, partial.
    dbState.deleteMock
      .mockResolvedValueOnce(Array.from({ length: BATCH_SIZE }, (_, i) => ({ delivery_id: `d-${i}` })))
      .mockResolvedValueOnce(
        Array.from({ length: BATCH_SIZE }, (_, i) => ({ delivery_id: `d-${BATCH_SIZE + i}` })),
      )
      .mockResolvedValueOnce(
        Array.from({ length: 137 }, (_, i) => ({ delivery_id: `d-${2 * BATCH_SIZE + i}` })),
      );

    const result = await cleanupWebhookDeliveriesJob();

    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(2 * BATCH_SIZE + 137);
    expect(dbState.deleteMock).toHaveBeenCalledTimes(3);

    // Each scan is capped at the batch size and bounded to the 30-day retention window.
    expect(dbState.limitMock.mock.calls).toEqual([[BATCH_SIZE], [BATCH_SIZE], [BATCH_SIZE]]);
    expect(dbState.rawMock).toHaveBeenCalledTimes(3);
    for (const call of dbState.rawMock.mock.calls) {
      expect(String(call[0])).toMatch(/interval '1 day'/);
      expect(call[1]).toEqual([30]);
    }
  });

  it('returns success=false on a thrown error and does not crash the scheduler', async () => {
    dbState.deleteMock.mockRejectedValue(new Error('connection lost'));
    const result = await cleanupWebhookDeliveriesJob();
    expect(result).toEqual({ success: false, deletedCount: 0 });
  });

  it('exits cleanly when there is nothing to delete', async () => {
    dbState.deleteMock.mockResolvedValueOnce([]);
    const result = await cleanupWebhookDeliveriesJob();
    expect(result).toEqual({ success: true, deletedCount: 0 });
    expect(dbState.deleteMock).toHaveBeenCalledTimes(1);
  });
});
