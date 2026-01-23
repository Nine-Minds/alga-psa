import type { RetryPolicy } from '../types';

export function computeBackoffMs(
  policy: RetryPolicy,
  attempt: number,
  random: () => number = Math.random
): number {
  const multiplier = policy.backoffMultiplier ?? 2;
  let backoff = policy.backoffMs * Math.pow(multiplier, Math.max(0, attempt - 1));
  if (policy.jitter ?? true) {
    const factor = 0.8 + random() * 0.4;
    backoff = backoff * factor;
  }
  if (policy.maxDelayMs && backoff > policy.maxDelayMs) {
    backoff = policy.maxDelayMs;
  }
  return backoff;
}

export function scheduleRetryAt(
  policy: RetryPolicy,
  attempt: number,
  nowMs: number = Date.now(),
  random: () => number = Math.random
): string {
  const delayMs = computeBackoffMs(policy, attempt, random);
  return new Date(nowMs + delayMs).toISOString();
}
