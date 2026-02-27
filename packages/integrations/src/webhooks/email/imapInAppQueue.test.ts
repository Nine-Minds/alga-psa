import { afterEach, describe, expect, it, vi } from 'vitest';

const processInboundEmailInAppMock = vi.fn();
const publishEventMock = vi.fn();

vi.mock('@alga-psa/shared/services/email/processInboundEmailInApp', () => ({
  processInboundEmailInApp: (...args: any[]) => processInboundEmailInAppMock(...args),
}));

vi.mock('@alga-psa/shared/events/publisher', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
}));

const queueModulePromise = import('./imapInAppQueue');

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('imapInAppQueue', () => {
  afterEach(async () => {
    const queueModule = await queueModulePromise;
    queueModule.__resetImapInAppQueueForTests();
    process.env.IMAP_INBOUND_EMAIL_IN_APP_ASYNC_WORKERS = '';
    process.env.IMAP_INBOUND_EMAIL_IN_APP_EVENT_BUS_FALLBACK_ENABLED = '';
    processInboundEmailInAppMock.mockReset();
    publishEventMock.mockReset();
  });

  it('T235: queue mode accepts payload and returns immediately while processing continues asynchronously', async () => {
    const queueModule = await queueModulePromise;
    const gate = deferred<{ outcome: 'created'; ticketId: string; commentId: string }>();
    processInboundEmailInAppMock.mockReturnValue(gate.promise);

    const startedAt = Date.now();
    const enqueueResult = queueModule.enqueueImapInAppJob({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: {
        id: 'msg-1',
        provider: 'imap',
        providerId: 'provider-1',
        tenant: 'tenant-1',
        receivedAt: new Date().toISOString(),
        from: { email: 'sender@example.com' },
        to: [{ email: 'support@example.com' }],
        subject: 'Subject',
        body: { text: 'Body', html: undefined },
        attachments: [],
      } as any,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(enqueueResult.jobId).toMatch(/^imap-inapp-/);
    expect(elapsedMs).toBeLessThan(100);
    expect(processInboundEmailInAppMock).toHaveBeenCalledTimes(1);
    expect(queueModule.__getImapInAppQueueStateForTests()).toMatchObject({
      activeWorkers: 1,
    });

    gate.resolve({ outcome: 'created', ticketId: 't-1', commentId: 'c-1' });
    await Promise.resolve();
    await Promise.resolve();
    expect(queueModule.__getImapInAppQueueStateForTests().activeWorkers).toBe(0);
  });

  it('T236: async queue worker concurrency is bounded by configured limits', async () => {
    const queueModule = await queueModulePromise;
    process.env.IMAP_INBOUND_EMAIL_IN_APP_ASYNC_WORKERS = '99';

    const deferredJobs = Array.from({ length: 12 }, () =>
      deferred<{ outcome: 'created'; ticketId: string; commentId: string }>()
    );
    let callIndex = 0;
    processInboundEmailInAppMock.mockImplementation(() => {
      const next = deferredJobs[callIndex];
      callIndex += 1;
      return next.promise;
    });

    for (let index = 0; index < 12; index += 1) {
      queueModule.enqueueImapInAppJob({
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        emailData: {
          id: `msg-${index + 1}`,
          provider: 'imap',
          providerId: 'provider-1',
          tenant: 'tenant-1',
          receivedAt: new Date().toISOString(),
          from: { email: 'sender@example.com' },
          to: [{ email: 'support@example.com' }],
          subject: `Subject ${index + 1}`,
          body: { text: 'Body', html: undefined },
          attachments: [],
        } as any,
      });
    }

    const stateWhileBlocked = queueModule.__getImapInAppQueueStateForTests();
    expect(stateWhileBlocked.activeWorkers).toBe(8);
    expect(stateWhileBlocked.queueDepth).toBe(4);

    deferredJobs.forEach((job, idx) => {
      job.resolve({ outcome: 'created', ticketId: `t-${idx}`, commentId: `c-${idx}` });
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const state = queueModule.__getImapInAppQueueStateForTests();
      if (state.activeWorkers === 0 && state.queueDepth === 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(queueModule.__getImapInAppQueueStateForTests()).toEqual({
      activeWorkers: 0,
      queueDepth: 0,
    });
  });
});
