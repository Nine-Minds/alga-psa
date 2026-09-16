// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  describeNamespace: vi.fn(async () => ({})),
  describeTaskQueue: vi.fn(async () => ({ pollers: [{ identity: 'worker-1' }] })),
  scheduleDescribe: vi.fn(async () => ({
    scheduleId: 'entra-all-tenants-sync-schedule:tenant-1',
    // SDK shape: top-level spec, IntervalSpecDescription.every in ms.
    spec: { intervals: [{ every: 3_600_000 }] },
    state: { paused: false },
    info: { nextActionTimes: [new Date('2026-09-16T02:00:00.000Z')], recentActions: [] },
  })),
}));

vi.mock('@temporalio/client', () => {
  class Connection {
    close = vi.fn();
    static async connect() {
      return new Connection();
    }
  }
  class Client {
    workflowService = {
      describeNamespace: (...args: any[]) => hoisted.describeNamespace(...args),
      describeTaskQueue: (...args: any[]) => hoisted.describeTaskQueue(...args),
    };
    schedule = {
      getHandle: () => ({ describe: (...args: any[]) => hoisted.scheduleDescribe(...args) }),
    };
    constructor(_opts: any) {}
  }
  return { Connection, Client };
});

import {
  describeEntraSchedule,
  probeTemporalReadiness,
} from '@ee/lib/integrations/entra/diagnostics/temporalReadiness';

describe('temporalReadiness with SDK-shaped responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.describeNamespace.mockResolvedValue({});
    hoisted.describeTaskQueue.mockResolvedValue({ pollers: [{ identity: 'worker-1' }] });
    hoisted.scheduleDescribe.mockResolvedValue({
      spec: { intervals: [{ every: 3_600_000 }] },
      state: { paused: false },
      info: { nextActionTimes: [new Date('2026-09-16T02:00:00.000Z')], recentActions: [] },
    });
  });

  it('reads top-level SDK spec intervals (ms) and paused state', async () => {
    const description = await describeEntraSchedule('tenant-1');
    expect(description.configured).toBe(true);
    expect(description.lookupFailed).toBe(false);
    expect(description.intervalMinutes).toBe(60);
    expect(description.paused).toBe(false);
    expect(description.nextFireTime).toBe('2026-09-16T02:00:00.000Z');
  });

  it('reports paused schedules', async () => {
    hoisted.scheduleDescribe.mockResolvedValueOnce({
      spec: { intervals: [{ every: 1_800_000 }] },
      state: { paused: true },
      info: { nextActionTimes: [], recentActions: [] },
    });
    const description = await describeEntraSchedule('tenant-1');
    expect(description.intervalMinutes).toBe(30);
    expect(description.paused).toBe(true);
  });

  it('distinguishes a missing schedule from a lookup failure', async () => {
    hoisted.scheduleDescribe.mockRejectedValueOnce(
      Object.assign(new Error('schedule not found'), { code: 'NOT_FOUND' })
    );
    const missing = await describeEntraSchedule('tenant-1');
    expect(missing.configured).toBe(false);
    expect(missing.lookupFailed).toBe(false);

    hoisted.scheduleDescribe.mockRejectedValueOnce(new Error('permission denied'));
    const failed = await describeEntraSchedule('tenant-1');
    expect(failed.configured).toBe(false);
    expect(failed.lookupFailed).toBe(true);
  });

  it('reports worker evidence from task-queue pollers', async () => {
    const available = await probeTemporalReadiness();
    expect(available.reachable).toBe(true);
    expect(available.workerEvidence).toBe('available');

    hoisted.describeTaskQueue.mockResolvedValueOnce({ pollers: [] });
    const none = await probeTemporalReadiness();
    expect(none.reachable).toBe(true);
    expect(none.workerEvidence).toBe('none');
  });

  it('reports the frontend unreachable when the namespace describe fails', async () => {
    hoisted.describeNamespace.mockRejectedValueOnce(new Error('connection refused'));
    const result = await probeTemporalReadiness();
    expect(result.reachable).toBe(false);
    expect(result.workerEvidence).toBe('unknown');
  });
});
