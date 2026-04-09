import fs from 'node:fs';
import path from 'node:path';
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

  it('uses non-authored workflow and activity entrypoints and excludes authored runtime modules', () => {
    const workflowsSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/workflows/non-authored-index.ts'),
      'utf8',
    );
    const activitiesSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/activities/non-authored-index.ts'),
      'utf8',
    );
    const workerSource = fs.readFileSync(path.resolve(process.cwd(), 'src/worker.ts'), 'utf8');

    expect(workflowsSource).not.toContain('workflow-runtime-v2-run-workflow');
    expect(activitiesSource).not.toContain('workflow-runtime-v2-activities');
    expect(workerSource).toContain('./workflows/non-authored-index.js');
    expect(workerSource).toContain('./activities/non-authored-index.js');
  });
});
