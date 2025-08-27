'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { auditLog } from 'server/src/lib/logging/auditLog';

// Rate limiters for different operations
const registrationLimiter = new RateLimiterMemory({
  points: 5, // 5 attempts
  duration: 3600, // per hour
});

// Add new auth verification limiter
const authVerificationLimiter = new RateLimiterMemory({
  points: 5, // 5 attempts
  duration: 60, // per 60 seconds
  blockDuration: 300, // Block for 5 minutes after limit exceeded
});

// Portal invitation limiter
const portalInvitationLimiter = new RateLimiterMemory({
  points: 3, // 3 invitations
  duration: 300, // per 5 mins
  blockDuration: 300, // Block for 5 min after limit exceeded
});

// Password reset limiter
const passwordResetLimiter = new RateLimiterMemory({
  points: 3, // 3 reset attempts
  duration: 900, // per 15 minutes
  blockDuration: 900, // Block for 15 minutes after limit exceeded
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

// Email verification rate limiting functions removed - no longer needed

// Add new function for auth verification rate limiting
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

// Portal invitation rate limiting (per user)
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

// Password reset rate limiting (per email)
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

// Helper to format rate limit error message
export async function formatRateLimitError(msBeforeNext?: number): Promise<string> {
  if (!msBeforeNext) {
    return 'Too many attempts. Please try again later.';
  }

  const minutes = Math.ceil(msBeforeNext / 1000 / 60);
  return `Too many attempts. Please try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`;
}

// Audit logging for security events
export async function logSecurityEvent(
  tenant: string,
  eventType: string,
  eventDetails: Record<string, any>
): Promise<void> {
  const { knex } = await createTenantKnex();
  
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
