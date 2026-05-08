const RETRY_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;

export function computeBackoff(attemptNumber: number): number {
  if (!Number.isFinite(attemptNumber) || attemptNumber < 1) {
    return RETRY_BACKOFF_MS[0];
  }

  const index = Math.min(Math.floor(attemptNumber), RETRY_BACKOFF_MS.length) - 1;
  return RETRY_BACKOFF_MS[index];
}

