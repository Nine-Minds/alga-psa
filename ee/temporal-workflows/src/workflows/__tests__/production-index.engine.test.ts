import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Worker } from '@temporalio/worker';
import { TestWorkflowEnvironment } from '@temporalio/testing';

it.each(['index.ts', 'non-authored-index.ts'])('executes registered workflows from %s', async index => {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `production-index-${randomUUID()}`;
  const calls: Array<{ tenantId: string; jobName: string }> = [];
  try {
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue,
      workflowsPath: path.resolve(import.meta.dirname, '..', index),
      // Temporal bundles workflows in webpack outside Vitest's resolver. Match
      // the worker tsconfig source mapping instead of relying on ignored dist
      // files left by a previous local build (production uses tsc-alias).
      bundlerOptions: { webpackConfigHook: config => ({
        ...config,
        resolve: { ...config.resolve, alias: {
          ...config.resolve?.alias,
          '@alga-psa/workflows': path.resolve(import.meta.dirname, '../../../../packages/workflows/src'),
        } },
      }) },
      activities: {
        listMarketingTenantIds: async () => ['tenant-a', 'tenant-b'],
        runMarketingJobForTenant: async (input: { tenantId: string; jobName: string }) => {
          calls.push(input);
          return { flipped: 2 };
        },
      } });
    await worker.runUntil(async () => {
      const echo = randomUUID();
      expect(await environment.client.workflow.execute('readinessWorkflow', {
        taskQueue, workflowId: randomUUID(), workflowExecutionTimeout: '30s', args: [{ echo }],
      })).toEqual({ ok: true, echo });
      const jobName = 'marketing:flip-due-posts';
      expect(await environment.client.workflow.execute('marketingFanoutWorkflow', {
        taskQueue, workflowId: randomUUID(), workflowExecutionTimeout: '30s', args: [{ jobName }],
      })).toEqual({ jobName, total: 2, succeeded: 2, failed: 0, results: [
        { tenantId: 'tenant-a', status: 'succeeded', result: { flipped: 2 } },
        { tenantId: 'tenant-b', status: 'succeeded', result: { flipped: 2 } },
      ] });
      expect(calls.sort((a, b) => a.tenantId.localeCompare(b.tenantId))).toEqual([
        { tenantId: 'tenant-a', jobName }, { tenantId: 'tenant-b', jobName },
      ]);
    });
  } finally { await environment.teardown(); }
});
