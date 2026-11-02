/**
 * Thrown by processInboundEmailInApp when a message cannot be evaluated *in this process* but
 * could be in another (for example a cm1:/cm2: reply token in a process with no co-managed
 * provider registered). It is the "keep this message recoverable" signal:
 *  - the v1 queue processor removes the message's processing record before failing the job, so
 *    the retry re-runs the message instead of being deduped against a 'failed' row;
 *  - the v2 durable path already rolls back and re-leases on any throw.
 * When retries are exhausted the job lands in the queue's own dead-letter state, never in a
 * silent native write or a dedupe.
 */
export class InboundRetryLaterError extends Error {
  readonly retryLater = true as const;
  constructor(message: string) {
    super(message);
    this.name = 'InboundRetryLaterError';
  }
}

export function isInboundRetryLaterError(error: unknown): error is InboundRetryLaterError {
  return error instanceof InboundRetryLaterError || (error as { retryLater?: unknown } | null)?.retryLater === true;
}
