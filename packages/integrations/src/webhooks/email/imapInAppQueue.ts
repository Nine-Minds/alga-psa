import type { EmailMessageDetails } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { processInboundEmailInApp } from '@alga-psa/shared/services/email/processInboundEmailInApp';
import { publishEvent } from '@alga-psa/shared/events/publisher';
import { isImapInboundEmailInAppEventBusFallbackEnabled } from '@alga-psa/shared/services/email/inboundEmailInAppFeatureFlag';

interface ImapInAppQueueJob {
  jobId: string;
  tenantId: string;
  providerId: string;
  emailData: EmailMessageDetails;
}

const queue: ImapInAppQueueJob[] = [];
let activeWorkers = 0;
let sequence = 0;

function getWorkerCount(): number {
  const raw = process.env.IMAP_INBOUND_EMAIL_IN_APP_ASYNC_WORKERS;
  if (!raw) return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

function nextJobId(): string {
  sequence += 1;
  return `imap-inapp-${Date.now()}-${sequence}`;
}

async function processJob(job: ImapInAppQueueJob): Promise<void> {
  try {
    await processInboundEmailInApp({
      tenantId: job.tenantId,
      providerId: job.providerId,
      emailData: job.emailData,
    });
  } catch (error) {
    console.error('IMAP in-app async queue job failed', {
      jobId: job.jobId,
      tenantId: job.tenantId,
      providerId: job.providerId,
      emailId: job.emailData?.id,
      error: error instanceof Error ? error.message : String(error),
    });

    if (isImapInboundEmailInAppEventBusFallbackEnabled()) {
      try {
        await publishEvent({
          eventType: 'INBOUND_EMAIL_RECEIVED',
          tenant: job.tenantId,
          payload: {
            tenantId: job.tenantId,
            tenant: job.tenantId,
            providerId: job.providerId,
            emailData: job.emailData,
          },
        });
        console.warn('IMAP in-app async queue fallback published to event bus', {
          jobId: job.jobId,
          tenantId: job.tenantId,
          providerId: job.providerId,
          emailId: job.emailData?.id,
        });
      } catch (fallbackError) {
        console.error('IMAP in-app async queue fallback publish failed', {
          jobId: job.jobId,
          tenantId: job.tenantId,
          providerId: job.providerId,
          emailId: job.emailData?.id,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }
  }
}

function pumpQueue(): void {
  const maxWorkers = getWorkerCount();
  while (activeWorkers < maxWorkers && queue.length > 0) {
    const job = queue.shift();
    if (!job) return;
    activeWorkers += 1;
    void processJob(job).finally(() => {
      activeWorkers -= 1;
      pumpQueue();
    });
  }
}

export function enqueueImapInAppJob(input: {
  tenantId: string;
  providerId: string;
  emailData: EmailMessageDetails;
}): { jobId: string; queueDepth: number; activeWorkers: number } {
  const job: ImapInAppQueueJob = {
    jobId: nextJobId(),
    tenantId: input.tenantId,
    providerId: input.providerId,
    emailData: input.emailData,
  };
  queue.push(job);
  pumpQueue();
  return {
    jobId: job.jobId,
    queueDepth: queue.length,
    activeWorkers,
  };
}

export function __getImapInAppQueueStateForTests(): {
  queueDepth: number;
  activeWorkers: number;
} {
  return {
    queueDepth: queue.length,
    activeWorkers,
  };
}

export function __resetImapInAppQueueForTests(): void {
  queue.length = 0;
  activeWorkers = 0;
  sequence = 0;
}
