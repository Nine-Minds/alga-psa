import { z } from 'zod';
import { ISO8601String } from 'server/src/types/types.d';
import { Temporal } from '@js-temporal/polyfill';

// Basic validation utilities

/**
 * Simple email format validation - null-safe wrapper
 * Use this for quick email checks before sending notifications
 */
export function isValidEmail(email: string | undefined | null): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed);
}

export function validateData<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    console.error('Validation error:', error);
    throw error;
  }
}

export function validateArray<T>(schema: z.ZodSchema<T>, data: unknown[]): T[] {
  try {
    return z.array(schema).parse(data);
  } catch (error) {
    console.error('Array validation error:', error);
    throw error;
  }
}

// Shared schema utilities
export const iso8601Schema = z.string().refine((val): val is ISO8601String => {
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?([+-]\d{2}:?\d{2}|Z)$/;
  return iso8601Regex.test(val);
}, "Invalid ISO8601 date string");

// Schema for Temporal.PlainDate
export const plainDateSchema = z.instanceof(Temporal.PlainDate);

// Common schema patterns
export const tenantSchema = z.object({
  tenant: z.string().optional()
});

/**
 * Validate tenant access for a user
 */
export async function validateTenantAccess(
  tenantId: string,
  userId?: string
): Promise<void> {
  // TODO: Implement actual tenant access validation
  // This should check if the user has access to the specified tenant
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }
  
  // For now, just validate the format
  if (!isValidUUID(tenantId)) {
    throw new Error('Invalid tenant ID format');
  }
  
  console.warn(`Tenant access validation not fully implemented for tenant: ${tenantId}`);
}

/**
 * Check if a string is a valid UUID
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}
