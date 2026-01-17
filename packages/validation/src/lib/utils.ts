/**
 * @alga-psa/validation - Validation Utilities
 *
 * Common validation functions and utilities for Alga PSA.
 */

import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';

// Type alias for ISO8601 date strings
export type ISO8601String = string;

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

/**
 * Validate data against a Zod schema
 */
export function validateData<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    console.error('Validation error:', error);
    throw error;
  }
}

/**
 * Validate an array against a Zod schema
 */
export function validateArray<T>(schema: z.ZodSchema<T>, data: unknown[]): T[] {
  try {
    return z.array(schema).parse(data);
  } catch (error) {
    console.error('Array validation error:', error);
    throw error;
  }
}

/**
 * Check if a string is a valid UUID
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate tenant access for a user
 */
export async function validateTenantAccess(
  tenantId: string,
  _userId?: string
): Promise<void> {
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }

  if (!isValidUUID(tenantId)) {
    throw new Error('Invalid tenant ID format');
  }

  // TODO: Implement actual tenant access validation
  // This should check if the user has access to the specified tenant
  console.warn(`Tenant access validation not fully implemented for tenant: ${tenantId}`);
}

// =====================================
// Shared Zod Schemas
// =====================================

/**
 * ISO 8601 date string schema
 */
export const iso8601Schema = z.string().refine((val): val is ISO8601String => {
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?([+-]\d{2}:?\d{2}|Z)$/;
  return iso8601Regex.test(val);
}, "Invalid ISO8601 date string");

/**
 * Schema for Temporal.PlainDate
 */
export const plainDateSchema = z.instanceof(Temporal.PlainDate);

/**
 * Common tenant schema pattern
 */
export const tenantSchema = z.object({
  tenant: z.string().optional()
});

/**
 * UUID schema
 */
export const uuidSchema = z.string().uuid();

/**
 * Non-empty string schema
 */
export const nonEmptyStringSchema = z.string().min(1, "String cannot be empty");

/**
 * Email schema
 */
export const emailSchema = z.string().email("Invalid email format");

/**
 * Optional email schema (allows empty string or valid email)
 */
export const optionalEmailSchema = z.string().optional().refine(
  (val) => !val || isValidEmail(val),
  "Invalid email format"
);

/**
 * Phone number schema (basic format validation)
 */
export const phoneSchema = z.string().regex(
  /^[\d\s\-\+\(\)]+$/,
  "Invalid phone number format"
);

/**
 * Currency code schema (ISO 4217)
 */
export const currencyCodeSchema = z.string().length(3).regex(
  /^[A-Z]{3}$/,
  "Invalid currency code format (must be 3 uppercase letters)"
);

/**
 * Pagination schema
 */
export const paginationSchema = z.object({
  page: z.number().int().positive().optional().default(1),
  pageSize: z.number().int().positive().max(100).optional().default(20),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(100).optional()
});
