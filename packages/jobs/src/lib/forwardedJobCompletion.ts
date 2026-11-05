export type ForwardedJobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export interface ForwardedJobExecutionOutcome {
  executionId: string;
  status: ForwardedJobStatus;
  error?: string;
}

export function beginForwardedJobExecution(
  metadata: Record<string, unknown>,
  executionId: string,
): Record<string, unknown> & {
  serverExecution: { executionId: string; status: ForwardedJobStatus; error?: string };
} {
  const current = metadata.serverExecution as { executionId?: unknown; status?: unknown } | undefined;
  if (current?.executionId === executionId) {
    return metadata as Record<string, unknown> & {
      serverExecution: { executionId: string; status: ForwardedJobStatus; error?: string };
    };
  }
  if (current?.status === 'processing') {
    return metadata as Record<string, unknown> & {
      serverExecution: { executionId: string; status: ForwardedJobStatus; error?: string };
    };
  }
  return { ...metadata, serverExecution: { executionId, status: 'queued' } };
}

/** Claim a queued execution exactly once. Processing executions are deliberately
 * not lease-reclaimed: the handler may already have sent an email before a crash.
 * A timed-out run stays indeterminate and requires a new explicit resend job. */
export function claimForwardedJobExecution(
  metadata: Record<string, unknown>,
  executionId: string,
): { metadata: Record<string, unknown>; claimed: boolean; status?: ForwardedJobStatus } {
  const current = metadata.serverExecution as { executionId?: unknown; status?: unknown } | undefined;
  if (current?.executionId !== executionId) return { metadata, claimed: false };
  if (current.status !== 'queued') {
    return { metadata, claimed: false, status: current.status as ForwardedJobStatus };
  }
  return {
    metadata: { ...metadata, serverExecution: { executionId, status: 'processing' } },
    claimed: true,
    status: 'processing',
  };
}

export function recordForwardedJobExecutionOutcome(
  metadata: Record<string, unknown>,
  executionId: string,
  outcome: { status: 'completed' | 'failed'; error?: string },
): { metadata: Record<string, unknown>; recorded: boolean } {
  const activeExecution = metadata.serverExecution as { executionId?: unknown; status?: unknown } | undefined;
  const canComplete = outcome.status === 'completed' && activeExecution?.status === 'processing';
  const canFail = outcome.status === 'failed'
    && (activeExecution?.status === 'queued' || activeExecution?.status === 'processing');
  if (activeExecution?.executionId !== executionId || (!canComplete && !canFail)) {
    return { metadata, recorded: false };
  }
  return {
    recorded: true,
    metadata: {
      ...metadata,
      serverExecution: {
        executionId,
        status: outcome.status,
        ...(outcome.error ? { error: outcome.error } : {}),
        completedAt: new Date().toISOString(),
      },
    },
  };
}

/**
 * Wait for the application subscriber to finish a forwarded job. Event
 * publication only means Redis accepted the request; the server persists its
 * execution outcome after the registered handler returns. Temporal owns the
 * job's terminal status transition.
 */
export async function waitForForwardedJobCompletion(
  readStatus: () => Promise<ForwardedJobExecutionOutcome | undefined>,
  executionId: string,
  options: { timeoutMs?: number; pollIntervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 9 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const job = await readStatus();
    if (job?.executionId !== executionId) {
      if (job?.executionId) throw new Error(`Forwarded job execution ${executionId} was superseded by ${job.executionId}`);
    } else if (job.status === 'completed') return;
    else if (job.status === 'failed') {
      throw new Error(job.error || 'Forwarded application job failed');
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }

  throw new Error('Timed out waiting for the application server to complete the forwarded job');
}
