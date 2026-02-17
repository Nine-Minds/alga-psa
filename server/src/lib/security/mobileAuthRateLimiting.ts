import { RateLimiterMemory } from 'rate-limiter-flexible';
import { TooManyRequestsError } from '../api/middleware/apiMiddleware';

const ottIssueLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60,
  blockDuration: 300,
});

const exchangeLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60,
  blockDuration: 300,
});

const refreshLimiter = new RateLimiterMemory({
  points: 30,
  duration: 60,
  blockDuration: 300,
});

function getMsBeforeNext(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'msBeforeNext' in error) {
    const ms = (error as any).msBeforeNext;
    return typeof ms === 'number' ? ms : undefined;
  }
  return undefined;
}

async function consumeOrThrow(limiter: RateLimiterMemory, key: string, message: string): Promise<void> {
  try {
    await limiter.consume(key);
  } catch (error) {
    throw new TooManyRequestsError(message, { msBeforeNext: getMsBeforeNext(error) });
  }
}

export async function enforceMobileOttIssueLimit(key: string): Promise<void> {
  await consumeOrThrow(ottIssueLimiter, key, 'Too many mobile login attempts. Please try again shortly.');
}

export async function enforceMobileOttExchangeLimit(key: string): Promise<void> {
  await consumeOrThrow(exchangeLimiter, key, 'Too many mobile login attempts. Please try again shortly.');
}

export async function enforceMobileRefreshLimit(key: string): Promise<void> {
  await consumeOrThrow(refreshLimiter, key, 'Too many refresh attempts. Please try again shortly.');
}

