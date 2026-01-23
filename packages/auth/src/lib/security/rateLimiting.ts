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

export async function checkAuthVerificationLimit(identifier: string): Promise<RateLimitResult> {
  try {
    const rateLimitInfo = await authVerificationLimiter.consume(identifier);
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

export async function checkPortalInvitationLimit(userId: string): Promise<RateLimitResult> {
  try {
    const rateLimitInfo = await portalInvitationLimiter.consume(userId);
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

export async function checkPasswordResetLimit(email: string): Promise<RateLimitResult> {
  try {
    const rateLimitInfo = await passwordResetLimiter.consume(email.toLowerCase());
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

