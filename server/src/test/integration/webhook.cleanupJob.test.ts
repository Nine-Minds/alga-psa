import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  rawMock: vi.fn(),
}));

vi.mock('server/src/lib/db/db', () => ({
  getConnection: vi.fn(async () => ({
    raw: (...args: unknown[]) => dbState.rawMock(...args),
  })),
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => ({
    raw: (...args: unknown[]) => dbState.rawMock(...args),
  })),
}));

import { cleanupWebhookDeliveriesJob } from '@/../src/services/cleanupWebhookDeliveriesJob';

describe('cleanupWebhookDeliveriesJob (T035)', () => {
  beforeEach(() => {
    dbState.rawMock.mockReset();
  });

  afterEach(() => {
    dbState.rawMock.mockReset();
  });

  it('deletes rows older than 30 days in batches of 10000 and stops when a partial batch returns', async () => {
    const BATCH_SIZE = 10_000;

    // Three batches: full, full, partial.
    dbState.rawMock
      .mockResolvedValueOnce({
        rows: Array.from({ length: BATCH_SIZE }, (_, i) => ({ delivery_id: `d-${i}` })),
      })
      .mockResolvedValueOnce({
        rows: Array.from({ length: BATCH_SIZE }, (_, i) => ({ delivery_id: `d-${BATCH_SIZE + i}` })),
      })
      .mockResolvedValueOnce({
        rows: Array.from({ length: 137 }, (_, i) => ({ delivery_id: `d-${2 * BATCH_SIZE + i}` })),
      });

    const result = await cleanupWebhookDeliveriesJob();

    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(2 * BATCH_SIZE + 137);
    expect(dbState.rawMock).toHaveBeenCalledTimes(3);

    // Each call passes the batch size limit.
    for (const call of dbState.rawMock.mock.calls) {
      expect(call[1]).toEqual([BATCH_SIZE]);
      expect(String(call[0])).toMatch(/30 days/);
    }
  });

  it('returns success=false on a thrown error and does not crash the scheduler', async () => {
    dbState.rawMock.mockRejectedValue(new Error('connection lost'));
    const result = await cleanupWebhookDeliveriesJob();
    expect(result).toEqual({ success: false, deletedCount: 0 });
  });

  it('exits cleanly when there is nothing to delete', async () => {
    dbState.rawMock.mockResolvedValueOnce({ rows: [] });
    const result = await cleanupWebhookDeliveriesJob();
    expect(result).toEqual({ success: true, deletedCount: 0 });
    expect(dbState.rawMock).toHaveBeenCalledTimes(1);
  });
});
