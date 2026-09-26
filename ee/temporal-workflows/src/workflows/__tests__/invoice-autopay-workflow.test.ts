import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { invoiceAutopayWorkflow } from '../invoice-autopay-workflow.js';

const input = { tenantId: 'tenant-1', invoiceId: 'invoice-1' };
const attempt = (attemptId: string, scheduledFor = new Date().toISOString()) => ({ attemptId, scheduledFor });

async function setup(overrides: Record<string, any> = {}) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `test-autopay-${Date.now()}-${Math.random()}`;
  const calls: Array<{ name: string; args: any }> = [];
  const activities = {
    prepareInvoiceAutopay: async () => { calls.push({ name: 'prepare', args: null }); return attempt('attempt-1'); },
    executeAutopayAttempt: async (args: any) => { calls.push({ name: 'execute', args }); return { status: 'succeeded' }; },
    reconcileAutopayAttempt: async (args: any) => { calls.push({ name: 'reconcile', args }); return { status: 'succeeded' }; },
    evaluateEnrollmentForInvoice: async () => ({ status: 'unchanged' }),
    createRetryAttempt: async (args: any) => { calls.push({ name: 'retry', args }); return attempt('attempt-2', args.retryAt); },
    finishAutopayWithFallback: async (args: any) => { calls.push({ name: 'fallback', args }); },
    cancelAutopayAttempt: async (args: any) => { calls.push({ name: 'cancel', args }); },
    listAutopayReconcileWork: async () => [],
    ...overrides,
  };
  const worker = await Worker.create({ connection: env.nativeConnection, taskQueue,
    workflowsPath: path.resolve(__dirname, '../invoice-autopay-workflow.ts'), activities });
  return { env, taskQueue, worker, calls };
}

describe('invoiceAutopayWorkflow', () => {
  it('charges immediately and completes on success', async () => {
    const test = await setup();
    try {
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-success' });
        await handle.result();
      });
      expect(test.calls.map(({ name }) => name)).toEqual(['prepare', 'execute']);
    } finally { await test.env.teardown(); }
  });

  it('resumes an existing open attempt after a reconciler restart', async () => {
    const test = await setup({ prepareInvoiceAutopay: async () => attempt('existing-open-attempt') });
    try {
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-orphan-resume' });
        await handle.result();
      });
      expect(test.calls.find(({ name }) => name === 'execute')?.args.attemptId).toBe('existing-open-attempt');
    } finally { await test.env.teardown(); }
  });

  it('waits for the due-date timer before charging', async () => {
    const due = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const test = await setup({ prepareInvoiceAutopay: async () => attempt('attempt-1', due) });
    try {
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-due' });
        await handle.result();
      });
      expect(test.calls.at(-1)?.name).toBe('execute');
    } finally { await test.env.teardown(); }
  });

  it('uses the retry timer and falls back after the retry limit', async () => {
    let count = 0;
    const test = await setup({ executeAutopayAttempt: async () => {
      count += 1;
      return count < 4 ? { status: 'failed', retryAt: new Date().toISOString(), hard: false } : { status: 'failed', retryAt: null, hard: false };
    }, createRetryAttempt: async (args: any) => attempt(`attempt-${count + 1}`, args.retryAt) });
    try {
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-retries' });
        await handle.result();
      });
      expect(count).toBe(4);
      expect(test.calls.filter(({ name }) => name === 'fallback')).toHaveLength(1);
    } finally { await test.env.teardown(); }
  });

  it('cancels a retry and runs promptly on a switched card', async () => {
    let prepared!: () => void;
    const ready = new Promise<void>((resolve) => { prepared = resolve; });
    let executions = 0;
    const test = await setup({
      prepareInvoiceAutopay: async () => { prepared(); return attempt('attempt-1', new Date(Date.now() + 86400000).toISOString()); },
      evaluateEnrollmentForInvoice: async () => ({ status: 'changed', paymentMethodId: 'new-card' }),
      createRetryAttempt: async (args: any) => { test.calls.push({ name: 'retry', args }); return attempt('attempt-2'); },
      executeAutopayAttempt: async () => { executions += 1; return { status: 'succeeded' }; },
    });
    try {
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-switch' });
        await ready;
        await handle.signal('enrollmentChanged');
        await handle.result();
      });
      expect(executions).toBe(1);
      expect(test.calls.some(({ name }) => name === 'retry')).toBe(true);
    } finally { await test.env.teardown(); }
  });

  it('falls back when auto-pay is disabled during a retry wait', async () => {
    let prepared!: () => void;
    const ready = new Promise<void>((resolve) => { prepared = resolve; });
    const test = await setup({
      prepareInvoiceAutopay: async () => { prepared(); return attempt('attempt-1', new Date(Date.now() + 86400000).toISOString()); },
      evaluateEnrollmentForInvoice: async () => ({ status: 'disabled' }),
    });
    try {
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-disable' });
        await ready;
        await handle.signal('enrollmentChanged');
        await handle.result();
      });
      expect(test.calls.filter(({ name }) => name === 'execute')).toHaveLength(0);
      expect(test.calls.filter(({ name }) => name === 'fallback')).toHaveLength(1);
    } finally { await test.env.teardown(); }
  });

  it('keeps waiting after unchanged enrollment during a retry wait', async () => {
    let retryCreated!: () => void;
    const retryReady = new Promise<void>((resolve) => { retryCreated = resolve; });
    let enrollmentEvaluated!: () => void;
    const enrollmentReady = new Promise<void>((resolve) => { enrollmentEvaluated = resolve; });
    let retryAt = new Date();
    const executeTimes: number[] = [];
    let executeCount = 0;
    let test: Awaited<ReturnType<typeof setup>>;
    test = await setup({
      executeAutopayAttempt: async () => {
        executeTimes.push(await test.env.currentTimeMs());
        executeCount += 1;
        return executeCount === 1 ? { status: 'failed', retryAt: retryAt.toISOString(), hard: false } : { status: 'succeeded' };
      },
      createRetryAttempt: async () => { retryCreated(); return attempt('attempt-2', retryAt.toISOString()); },
      evaluateEnrollmentForInvoice: async () => { enrollmentEvaluated(); return { status: 'unchanged' }; },
    });
    try {
      retryAt = new Date((await test.env.currentTimeMs()) + 3 * 24 * 60 * 60 * 1000);
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-unchanged-enrollment' });
        await retryReady;
        await handle.signal('enrollmentChanged');
        await enrollmentReady;
        await handle.result();
      });
      expect(executeTimes).toHaveLength(2);
      expect(executeTimes[1]).toBeGreaterThanOrEqual(retryAt.getTime());
    } finally { await test.env.teardown(); }
  });

  it('does not run fallback when a settled invoice is cancelled while enrollment is disabled', async () => {
    const test = await setup({
      executeAutopayAttempt: async () => ({ status: 'cancelled', reason: 'invoice_settled' }),
      evaluateEnrollmentForInvoice: async () => ({ status: 'disabled' }),
    });
    try {
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-settled-disabled' });
        await handle.result();
      });
      expect(test.calls.filter(({ name }) => name === 'fallback')).toHaveLength(0);
    } finally { await test.env.teardown(); }
  });

  it('does not retry a hard decline', async () => {
    const test = await setup({ executeAutopayAttempt: async () => ({ status: 'failed', retryAt: null, hard: true }) });
    try {
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-hard-decline' });
        await handle.result();
      });
      expect(test.calls.filter(({ name }) => name === 'retry')).toHaveLength(0);
      expect(test.calls.filter(({ name }) => name === 'fallback')).toHaveLength(1);
    } finally { await test.env.teardown(); }
  });

  it('waits for paymentIntentSettled while a charge is processing', async () => {
    let processing!: () => void;
    const processingReady = new Promise<void>((resolve) => { processing = resolve; });
    const test = await setup({ executeAutopayAttempt: async () => { processing(); return { status: 'processing' }; } });
    try {
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-processing' });
        await processingReady;
        await handle.signal('paymentIntentSettled', { attemptId: 'attempt-1', status: 'succeeded' });
        await handle.result();
      });
      expect(test.calls.filter(({ name }) => name === 'reconcile')).toHaveLength(0);
    } finally { await test.env.teardown(); }
  });

  it('honours chargeNow while waiting on a timer', async () => {
    let prepared!: () => void;
    const ready = new Promise<void>((resolve) => { prepared = resolve; });
    const test = await setup({ prepareInvoiceAutopay: async () => { prepared(); return attempt('attempt-1', new Date(Date.now() + 86400000).toISOString()); } });
    try {
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-charge-now' });
        await ready;
        await handle.signal('chargeNow');
        await handle.result();
      });
      expect(test.calls.filter(({ name }) => name === 'execute')).toHaveLength(1);
    } finally { await test.env.teardown(); }
  });

  it('reconciles processing intents and marks no_intent_found after 72 hours', async () => {
    const reconcileCalls: boolean[] = [];
    const test = await setup({
      executeAutopayAttempt: async () => ({ status: 'processing' }),
      reconcileAutopayAttempt: async ({ noIntentFound }: { noIntentFound?: boolean }) => {
        reconcileCalls.push(noIntentFound === true);
        return noIntentFound ? { status: 'failed', retryAt: null, hard: false } : { status: 'unresolved' };
      },
    });
    try {
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-no-intent' });
        await handle.result();
      });
      expect(reconcileCalls).toContain(true);
      expect(test.calls.filter(({ name }) => name === 'fallback')).toHaveLength(1);
    } finally { await test.env.teardown(); }
  });

  it('honours invoice settlement while waiting and bounds workflow history', async () => {
    let prepared!: () => void;
    const ready = new Promise<void>((resolve) => { prepared = resolve; });
    const test = await setup({ prepareInvoiceAutopay: async () => { prepared(); return attempt('attempt-1', new Date(Date.now() + 86400000).toISOString()); } });
    try {
      await test.worker.runUntil(async () => {
        const handle = await test.env.client.workflow.start(invoiceAutopayWorkflow, { args: [input], taskQueue: test.taskQueue, workflowId: 'autopay-settled' });
        await ready;
        await handle.signal('invoiceSettled');
        await handle.result();
        const history = await handle.fetchHistory();
        expect(history.events.length).toBeLessThan(100);
      });
      expect(test.calls.filter(({ name }) => name === 'execute')).toHaveLength(0);
      expect(test.calls.filter(({ name }) => name === 'fallback')).toHaveLength(0);
      expect(test.calls.filter(({ name }) => name === 'cancel')).toHaveLength(1);
    } finally { await test.env.teardown(); }
  });
});
