import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ClaimedUnifiedInboundEmailQueueJob,
  FailUnifiedInboundEmailQueueJobResult,
} from '../unifiedInboundEmailQueue';
import { UnifiedInboundEmailQueueConsumer } from '../unifiedInboundEmailQueueConsumer';

const claimUnifiedInboundEmailQueueJobMock = vi.fn();
const ackUnifiedInboundEmailQueueJobMock = vi.fn();
const failUnifiedInboundEmailQueueJobMock = vi.fn();
const reclaimExpiredUnifiedInboundEmailQueueJobsMock = vi.fn();

vi.mock('../unifiedInboundEmailQueue', () => ({
  claimUnifiedInboundEmailQueueJob: (...args: any[]) => claimUnifiedInboundEmailQueueJobMock(...args),
  ackUnifiedInboundEmailQueueJob: (...args: any[]) => ackUnifiedInboundEmailQueueJobMock(...args),
  failUnifiedInboundEmailQueueJob: (...args: any[]) => failUnifiedInboundEmailQueueJobMock(...args),
  reclaimExpiredUnifiedInboundEmailQueueJobs: (...args: any[]) =>
    reclaimExpiredUnifiedInboundEmailQueueJobsMock(...args),
}));

function buildClaimedJob(provider: 'microsoft' | 'google' | 'imap'): ClaimedUnifiedInboundEmailQueueJob {
  const base = {
    jobId: `job-${provider}-1`,
    schemaVersion: 1 as const,
    tenantId: 'tenant-1',
    providerId: `provider-${provider}-1`,
    enqueuedAt: new Date().toISOString(),
    attempt: 0,
    maxAttempts: 5,
    provider,
  };

  const job =
    provider === 'microsoft'
      ? {
          ...base,
          pointer: {
            subscriptionId: 'sub-ms-1',
            messageId: 'ms-msg-1',
            resource: '/users/user/messages/ms-msg-1',
            changeType: 'created',
          },
        }
      : provider === 'google'
        ? {
            ...base,
            pointer: {
              historyId: '200',
              emailAddress: 'support@example.com',
              pubsubMessageId: 'pubsub-1',
            },
          }
        : {
            ...base,
            pointer: {
              mailbox: 'INBOX',
              uid: '300',
              uidValidity: '400',
              messageId: '<imap-msg-1@example.com>',
            },
          };

  return {
    job,
    originalPayload: JSON.stringify(job),
    consumerId: 'consumer-test-1',
    claimedAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  } as ClaimedUnifiedInboundEmailQueueJob;
}

describe('UnifiedInboundEmailQueueConsumer provider claim/processing flow', () => {
  beforeEach(() => {
    claimUnifiedInboundEmailQueueJobMock.mockReset();
    ackUnifiedInboundEmailQueueJobMock.mockReset();
    failUnifiedInboundEmailQueueJobMock.mockReset();
    reclaimExpiredUnifiedInboundEmailQueueJobsMock.mockReset();

    reclaimExpiredUnifiedInboundEmailQueueJobsMock.mockResolvedValue(0);
    ackUnifiedInboundEmailQueueJobMock.mockResolvedValue(undefined);
    failUnifiedInboundEmailQueueJobMock.mockResolvedValue({
      action: 'retried',
      attempt: 1,
      queueDepth: 1,
    } as FailUnifiedInboundEmailQueueJobResult);
  });

  it('T009: consumer claims and processes queued Microsoft pointer jobs', async () => {
    const claim = buildClaimedJob('microsoft');
    claimUnifiedInboundEmailQueueJobMock.mockResolvedValue(claim);
    const handleJobMock = vi.fn(async () => ({ outcome: 'processed' }));
    const consumer = new UnifiedInboundEmailQueueConsumer({ handleJob: handleJobMock });

    const processed = await consumer.runOnce();

    expect(processed).toBe(true);
    expect(handleJobMock).toHaveBeenCalledTimes(1);
    expect(handleJobMock).toHaveBeenCalledWith(claim.job);
    expect(ackUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    expect(ackUnifiedInboundEmailQueueJobMock).toHaveBeenCalledWith(claim);
    expect(failUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('T010: consumer claims and processes queued Google pointer jobs', async () => {
    const claim = buildClaimedJob('google');
    claimUnifiedInboundEmailQueueJobMock.mockResolvedValue(claim);
    const handleJobMock = vi.fn(async () => ({ outcome: 'processed' }));
    const consumer = new UnifiedInboundEmailQueueConsumer({ handleJob: handleJobMock });

    const processed = await consumer.runOnce();

    expect(processed).toBe(true);
    expect(handleJobMock).toHaveBeenCalledTimes(1);
    expect(handleJobMock).toHaveBeenCalledWith(claim.job);
    expect(ackUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    expect(failUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('T011: consumer claims and processes queued IMAP pointer jobs', async () => {
    const claim = buildClaimedJob('imap');
    claimUnifiedInboundEmailQueueJobMock.mockResolvedValue(claim);
    const handleJobMock = vi.fn(async () => ({ outcome: 'processed' }));
    const consumer = new UnifiedInboundEmailQueueConsumer({ handleJob: handleJobMock });

    const processed = await consumer.runOnce();

    expect(processed).toBe(true);
    expect(handleJobMock).toHaveBeenCalledTimes(1);
    expect(handleJobMock).toHaveBeenCalledWith(claim.job);
    expect(ackUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    expect(failUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });
});
