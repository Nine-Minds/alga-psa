'use server'

import { createTenantKnex } from '@alga-psa/db';
import { auditLog } from '@alga-psa/db';
import { RateLimiterMemory } from 'rate-limiter-flexible';

const registrationLimiter = new RateLimiterMemory({
  points: 5,
  duration: 3600,
});

const authVerificationLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60,
  blockDuration: 300,
});

const portalInvitationLimiter = new RateLimiterMemory({
  points: 3,
  duration: 300,
  blockDuration: 300,
});

const passwordResetLimiter = new RateLimiterMemory({
  points: 3,
  duration: 900,
  blockDuration: 900,
});

export interface RateLimitResult {
  success: boolean;
  remainingPoints?: number;
  msBeforeNext?: number;
}

// rate-limiter-flexible rejects with a RateLimiterRes (not an Error) when the
// budget is spent; only an internal failure rejects with an Error.
async function consume(limiter: RateLimiterMemory, key: string): Promise<RateLimitResult> {
  try {
    const info = await limiter.consume(key);
    return { success: true, remainingPoints: info.remainingPoints, msBeforeNext: info.msBeforeNext };
  } catch (rejection) {
    const msBeforeNext = (rejection as { msBeforeNext?: unknown } | null)?.msBeforeNext;
    return { success: false, msBeforeNext: typeof msBeforeNext === 'number' ? msBeforeNext : undefined };
  }
}

export async function checkRegistrationLimit(email: string): Promise<RateLimitResult> {
  return consume(registrationLimiter, email);
}

export async function checkAuthVerificationLimit(identifier: string): Promise<RateLimitResult> {
  return consume(authVerificationLimiter, identifier);
}

export async function checkPortalInvitationLimit(userId: string): Promise<RateLimitResult> {
  return consume(portalInvitationLimiter, userId);
}

export async function checkPasswordResetLimit(email: string): Promise<RateLimitResult> {
  return consume(passwordResetLimiter, email.toLowerCase());
}

export async function formatRateLimitError(msBeforeNext?: number): Promise<string> {
  if (!msBeforeNext) {
    return 'Too many attempts. Please try again later.';
  }

  const minutes = Math.ceil(msBeforeNext / 1000 / 60);
  return `Too many attempts. Please try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`;
}

export async function logSecurityEvent(
  tenant: string,
  eventType: string,
  eventDetails: Record<string, any>
): Promise<void> {
  const { knex } = await createTenantKnex(tenant);

  await auditLog(knex, {
    operation: eventType,
    tableName: eventDetails.tableName || 'audit_log',
    recordId: eventDetails.recordId || 'unknown',
    changedData: {},
    details: {
      ...eventDetails,
      tenant
    }
  });
}

