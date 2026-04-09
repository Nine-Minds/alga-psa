import { afterEach, describe, expect, it } from 'vitest';
import { AUTHORED_RUNTIME_TASK_QUEUE, getWorkerConfig } from '../workerConfig.js';

const ORIGINAL_ENV = { ...process.env };

describe('temporal worker queue ownership', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('excludes authored runtime queue from temporal-worker defaults', () => {
    delete process.env.TEMPORAL_TASK_QUEUES;
    delete process.env.TEMPORAL_TASK_QUEUE;

    const config = getWorkerConfig();

    expect(config.taskQueues).not.toContain(AUTHORED_RUNTIME_TASK_QUEUE);
    expect(config.taskQueues).toContain('tenant-workflows');
    expect(config.taskQueues).toContain('portal-domain-workflows');
    expect(config.taskQueues).toContain('email-domain-workflows');
    expect(config.taskQueues).toContain('alga-jobs');
    expect(config.taskQueues).toContain('sla-workflows');
  });

  it('fails fast when authored runtime queue is explicitly configured on temporal-worker', () => {
    process.env.TEMPORAL_TASK_QUEUES = `tenant-workflows,${AUTHORED_RUNTIME_TASK_QUEUE}`;

    expect(() => getWorkerConfig()).toThrow(
      `temporal-worker is not allowed to poll authored runtime queue "${AUTHORED_RUNTIME_TASK_QUEUE}"`,
    );
  });
});
