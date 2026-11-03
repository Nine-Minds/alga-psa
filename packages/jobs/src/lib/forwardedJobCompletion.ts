export type ForwardedJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | string;

/**
 * Wait for the application subscriber to finish a forwarded job. Event
 * publication only means Redis accepted the request; the server persists its
 * execution outcome after the registered handler returns. Temporal owns the
 * job's terminal status transition.
 */
export async function waitForForwardedJobCompletion(
  readStatus: () => Promise<{ status: ForwardedJobStatus; error?: string } | undefined>,
  options: { timeoutMs?: number; pollIntervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 9 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const job = await readStatus();
    if (job?.status === 'completed') return;
    if (job?.status === 'failed') {
      throw new Error(job.error || 'Forwarded application job failed');
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }

  throw new Error('Timed out waiting for the application server to complete the forwarded job');
}
