import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { autopayReconcileWorkflow } from '../invoice-autopay-workflow.js';

async function runReconciler(items: Array<{ tenantId: string; invoiceId: string }>) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `test-autopay-reconcile-${Date.now()}-${Math.random()}`;
  const starts: Array<{ tenantId: string; invoiceId: string }> = [];
  const stripeCalls: string[] = [];
  const worker = await Worker.create({ connection: env.nativeConnection, taskQueue,
    workflowsPath: path.resolve(__dirname, '../invoice-autopay-workflow.ts'),
    activities: {
      listAutopayReconcileWork: async () => items,
      startInvoiceAutopayWorkflow: async (input: { tenantId: string; invoiceId: string }) => { starts.push(input); },
      executeAutopayAttempt: async () => { stripeCalls.push('charge'); return { status: 'succeeded' }; },
      reconcileAutopayAttempt: async () => { stripeCalls.push('lookup'); return { status: 'unresolved' }; },
      prepareInvoiceAutopay: async () => ({ status: 'skip', reason: 'test' }),
      evaluateEnrollmentForInvoice: async () => ({ status: 'unchanged' }),
      createRetryAttempt: async () => ({ attemptId: 'retry', scheduledFor: new Date().toISOString() }),
      finishAutopayWithFallback: async () => {},
      cancelAutopayAttempt: async () => {},
    },
  });
  try {
    await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(autopayReconcileWorkflow, { args: [], taskQueue, workflowId: 'autopay-reconcile-test' });
      await handle.result();
    });
    return { starts, stripeCalls };
  } finally { await env.teardown(); }
}

describe('autopayReconcileWorkflow', () => {
  it('starts a workflow for a lost start', async () => {
    const result = await runReconciler([{ tenantId: 'tenant-1', invoiceId: 'lost-invoice' }]);
    expect(result.starts).toEqual([{ tenantId: 'tenant-1', invoiceId: 'lost-invoice' }]);
    expect(result.stripeCalls).toEqual([]);
  });

  it('restarts an orphaned workflow and does not call Stripe', async () => {
    const result = await runReconciler([{ tenantId: 'tenant-2', invoiceId: 'orphan-invoice' }]);
    expect(result.starts).toEqual([{ tenantId: 'tenant-2', invoiceId: 'orphan-invoice' }]);
    expect(result.stripeCalls).toEqual([]);
  });
});
