import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { Context } from '@temporalio/activity';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { genericJobWorkflow } from '../generic-job-workflow';

async function runJob(jobName: string, recover: boolean) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `job-policy-${randomUUID()}`;
  const attempts: Array<{ attempt: number; input: any }> = [];
  const statuses: any[] = [];
  const input = { jobId: 'job-fixture', tenantId: 'tenant-fixture', jobName, data: { importId: 'import-fixture' } };
  try {
    const worker = await Worker.create({
      connection: env.nativeConnection, taskQueue,
      workflowsPath: path.resolve(__dirname, '../generic-job-workflow.ts'),
      activities: {
        executeJobHandler: async (received: any) => {
          const attempt = Context.current().info.attempt;
          attempts.push({ attempt, input: received });
          if (!recover || attempt === 1) throw new Error('Synthetic transient import failure');
          return { success: true, result: { imported: 3, skipped: 1, failed: 0 } };
        },
        updateJobStatus: async (status: any) => { statuses.push(status); },
        createJobDetail: async () => 'detail-fixture',
      },
    });
    let result: unknown;
    let failure: unknown;
    try {
      result = await worker.runUntil(env.client.workflow.execute(genericJobWorkflow, {
        args: [input], taskQueue, workflowId: `job-${randomUUID()}`,
      }));
    } catch (error) { failure = error; }
    return { result, failure, attempts, statuses, input };
  } finally {
    await env.teardown();
  }
}

it.each([['kb-article-import', 2], ['extension-scheduled-invocation', 3]] as const)(
  '%s stops after its configured %i failed attempts', async (jobName, maximumAttempts) => {
    const { result, failure, attempts, statuses, input } = await runJob(jobName, false);
    expect(result).toBeUndefined();
    expect(failure).toBeInstanceOf(Error);
    expect(attempts.map(call => call.attempt)).toEqual(Array.from({ length: maximumAttempts }, (_, i) => i + 1));
    for (const call of attempts) expect(call.input).toMatchObject(input);
    expect(new Set(attempts.map(call => call.input.jobExecutionId)).size).toBe(1);
    expect(attempts[0].input.jobExecutionId).toEqual(expect.any(String));
    expect(statuses[0]).toMatchObject({ status: 'processing', tenantId: input.tenantId, jobId: input.jobId });
    expect(statuses.at(-1)).toMatchObject({ status: 'failed' });
    expect(statuses.some(status => status.status === 'completed')).toBe(false);
  },
);

it('returns KB import totals after a successful retry with stable execution identity', async () => {
  const { result, failure, attempts, statuses } = await runJob('kb-article-import', true);
  expect(failure).toBeUndefined();
  expect(result).toMatchObject({ success: true, jobId: 'job-fixture', result: { imported: 3, skipped: 1, failed: 0 } });
  expect(attempts.map(call => call.attempt)).toEqual([1, 2]);
  expect(attempts[1].input).toEqual(attempts[0].input);
  expect(statuses.map(status => status.status)).toEqual(['processing', 'completed']);
});
