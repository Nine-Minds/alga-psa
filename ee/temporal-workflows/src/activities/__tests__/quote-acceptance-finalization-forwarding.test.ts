import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  finalizer: vi.fn(),
  serverRequestHandler: undefined as undefined | ((event: unknown) => Promise<void>),
  pending: new Map<string, { resolve: () => void; reject: (error: Error) => void }>(),
  results: new Map<string, { success: true } | { success: false; error: string }>(),
}));

const eventBus = {
  beginRequest: vi.fn(async (requestId: string) => {
    mocks.results.delete(requestId);
  }),
  waitForRequest: vi.fn((requestId: string, timeoutMs: number) => new Promise<void>((resolve, reject) => {
    const completion = mocks.results.get(requestId);
    if (completion) {
      if (completion.success) resolve();
      else reject(new Error(completion.error));
      return;
    }
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for server execution request ${requestId}`)), timeoutMs);
    mocks.pending.set(requestId, {
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
  })),
  completeRequest: vi.fn(async (requestId: string, result: { success: true } | { success: false; error: string }) => {
    mocks.results.set(requestId, result);
    const waiting = mocks.pending.get(requestId);
    if (!waiting) return;
    mocks.pending.delete(requestId);
    if (result.success) waiting.resolve();
    else waiting.reject(new Error(result.error));
  }),
  clearRequest: vi.fn(async (requestId: string) => {
    mocks.results.delete(requestId);
  }),
  subscribe: vi.fn(async (_eventType: string, handler: (event: unknown) => Promise<void>) => {
    mocks.serverRequestHandler = handler;
  }),
  unsubscribe: vi.fn(async () => undefined),
};

vi.mock('@alga-psa/event-bus', () => ({ getEventBus: () => eventBus }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: mocks.publish,
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/jobs/fanout', () => ({ isKnownMaintenanceJob: () => false }));
vi.mock('@alga-psa/jobs/handlers/workflowScheduledRunHandlers', () => ({
  workflowOneTimeScheduledRunHandler: vi.fn(),
  workflowRecurringScheduledRunHandler: vi.fn(),
}));
vi.mock('@alga-psa/jobs/handlers/extensionScheduledInvocationHandler', () => ({ extensionScheduledInvocationHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/kbArticleImportHandler', () => ({
  KB_ARTICLE_IMPORT_JOB: 'kb-article-import',
  kbArticleImportHandler: vi.fn(),
}));
vi.mock('@alga-psa/jobs/runners/TemporalJobRunner', () => ({ TemporalJobRunner: { create: vi.fn() } }));
vi.mock('@alga-psa/workflows/lib/workflowScheduleLifecycle', () => ({
  WORKFLOW_ONE_TIME_TRIGGER_JOB: 'workflow-one-time-trigger',
  WORKFLOW_RECURRING_TRIGGER_JOB: 'workflow-recurring-trigger',
}));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(),
  withAdminTransactionRetryReadOnly: (fn: any) => fn({ raw: vi.fn() }),
}));
vi.mock('@alga-psa/db', async original => ({
  ...await original<any>(),
  isTenantSuspended: async () => false,
  getAdminConnection: vi.fn(),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@alga-psa/billing/services', () => ({
  finalizeLinkAcceptedQuote: mocks.finalizer,
}));
vi.mock('../../../../../server/src/lib/jobs/runMaintenanceJobExclusive', () => ({
  prepareMaintenanceRegistry: vi.fn(async () => undefined),
  runMaintenanceJobExclusive: vi.fn(),
}));

import { EventSchemas } from '@alga-psa/event-schemas';
import { JobHandlerRegistry } from '../../../../../server/src/lib/jobs/jobHandlerRegistry';
import { finalizeLinkAcceptedQuoteHandler } from '../../../../../server/src/lib/jobs/handlers/finalizeLinkAcceptedQuoteHandler';
import {
  registerMaintenanceJobSubscriber,
  unregisterMaintenanceJobSubscriber,
} from '../../../../../server/src/lib/eventBus/subscribers/maintenanceJobSubscriber';
import { executeJobHandler, initializeJobHandlersForWorker } from '../job-activities';

describe('quote acceptance finalization Temporal forwarding', () => {
  afterEach(async () => {
    await unregisterMaintenanceJobSubscriber();
    JobHandlerRegistry.clear();
    vi.clearAllMocks();
    mocks.pending.clear();
    mocks.results.clear();
    mocks.serverRequestHandler = undefined;
  });

  it('waits for server finalization, rejects its failure, then retries successfully without duplicate confirmation', async () => {
    await initializeJobHandlersForWorker();
    JobHandlerRegistry.register({
      name: 'finalize-link-accepted-quote',
      handler: async (_jobId, data) => finalizeLinkAcceptedQuoteHandler(data as any),
    } as any);
    await registerMaintenanceJobSubscriber();

    const tenantId = randomUUID();
    const quoteId = randomUUID();
    const decisionId = randomUUID();
    const jobId = randomUUID();
    const jobExecutionId = randomUUID();
    const data = { tenantId, quoteId, decisionId };
    let finalizerAttempts = 0;
    let confirmationsSent = 0;
    const signedDocumentId = 'signed-document-reused-on-retry';
    mocks.finalizer.mockImplementation(async () => {
      finalizerAttempts += 1;
      if (finalizerAttempts === 1) {
        return { documentId: signedDocumentId, emailSent: false, errors: ['Signer confirmation email failed: SMTP unavailable'] };
      }
      confirmationsSent += 1;
      return { documentId: signedDocumentId, emailSent: true, errors: [] };
    });

    const publishActivity = () => executeJobHandler({
      jobName: 'finalize-link-accepted-quote',
      jobId,
      tenantId,
      jobExecutionId,
      data,
    });

    let firstSettled = false;
    const firstAttempt = publishActivity().finally(() => { firstSettled = true; });
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    const firstRequest = mocks.publish.mock.calls[0][0];
    const firstValidated = EventSchemas.MAINTENANCE_JOB_REQUESTED.parse({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...firstRequest,
    });
    expect(firstValidated.payload).toMatchObject({
      tenantId,
      jobName: 'finalize-link-accepted-quote',
      jobId,
      requestId: expect.any(String),
      data,
    });
    expect(firstSettled).toBe(false);

    await expect(mocks.serverRequestHandler!(firstValidated)).rejects.toThrow('Signer confirmation email failed: SMTP unavailable');
    await expect(firstAttempt).rejects.toThrow('Signer confirmation email failed: SMTP unavailable');
    expect(confirmationsSent).toBe(0);

    mocks.publish.mockClear();
    let retrySettled = false;
    const retryAttempt = publishActivity().finally(() => { retrySettled = true; });
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1));
    const retryRequest = mocks.publish.mock.calls[0][0];
    const retryValidated = EventSchemas.MAINTENANCE_JOB_REQUESTED.parse({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...retryRequest,
    });
    expect(retryValidated.payload.requestId).not.toBe(firstValidated.payload.requestId);
    expect(retrySettled).toBe(false);

    await mocks.serverRequestHandler!(retryValidated);
    await expect(retryAttempt).resolves.toEqual({ success: true });
    expect(finalizerAttempts).toBe(2);
    expect(confirmationsSent).toBe(1);
    expect(mocks.finalizer).toHaveBeenNthCalledWith(1, tenantId, quoteId, decisionId);
    expect(mocks.finalizer).toHaveBeenNthCalledWith(2, tenantId, quoteId, decisionId);
  });
});
