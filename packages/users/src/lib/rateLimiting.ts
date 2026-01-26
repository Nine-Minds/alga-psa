'use server'

import { RateLimiterMemory } from 'rate-limiter-flexible';

// TODO: Consolidate with @alga-psa/auth rate limiting after circular dependency is resolved
// This is a temporary duplication to break the auth <-> users cycle

const registrationLimiter = new RateLimiterMemory({
  points: 5,
  duration: 3600,
});

export interface RateLimitResult {
  success: boolean;
  remainingPoints?: number;
  msBeforeNext?: number;
}

export async function checkRegistrationLimit(email: string): Promise<RateLimitResult> {
  try {
    const rateLimitInfo = await registrationLimiter.consume(email);
    return {
      success: true,
      remainingPoints: rateLimitInfo.remainingPoints,
      msBeforeNext: rateLimitInfo.msBeforeNext,
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        success: false,
        msBeforeNext: error.message ? parseInt(error.message) : undefined,
      };
    }
    return { success: false };
  }
}

export async function formatRateLimitError(msBeforeNext?: number): Promise<string> {
  if (!msBeforeNext) {
    return 'Too many attempts. Please try again later.';
  }

  const minutes = Math.ceil(msBeforeNext / 1000 / 60);
  return `Too many attempts. Please try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`;
}
