'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { auditLog } from 'server/src/lib/logging/auditLog';

// Rate limiters for different operations
const registrationLimiter = new RateLimiterMemory({
  points: 5, // 5 attempts
  duration: 3600, // per hour
});

const verificationLimiter = new RateLimiterMemory({
  points: 3, // 3 attempts
  duration: 300, // per 5 minutes
});

const emailLimiter = new RateLimiterMemory({
  points: 3, // 3 emails
  duration: 3600, // per hour
});

interface RateLimitResult {
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

export async function checkVerificationLimit(token: string): Promise<RateLimitResult> {
  try {
    const rateLimitInfo = await verificationLimiter.consume(token);
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

export async function checkEmailLimit(email: string): Promise<RateLimitResult> {
  try {
    const rateLimitInfo = await emailLimiter.consume(email);
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
    tableName: 'pending_registrations',
    recordId: eventDetails.registrationId || 'unknown',
    changedData: {},
    details: {
      ...eventDetails,
      tenant
    }
  });
}
