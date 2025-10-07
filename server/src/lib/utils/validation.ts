import { z } from 'zod';
import { ISO8601String } from 'server/src/types/types.d';
import { Temporal } from '@js-temporal/polyfill';

// Basic validation utilities
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

// Business-appropriate field validation utilities
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Simple emoji detection function
 * Checks for basic emoji patterns without complex Unicode ranges
 */
function containsEmojis(text: string): boolean {
  // Simple pattern for common emojis - avoids complex Unicode issues
  const simpleEmojiPattern = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]/u;
  
  // Fallback check for surrogate pairs (most emojis)
  const surrogatePattern = /[\uD800-\uDBFF][\uDC00-\uDFFF]/;
  
  return simpleEmojiPattern.test(text) || surrogatePattern.test(text);
}

/**
 * Validate business-appropriate name fields (first name, last name)
 * Flags emojis and inappropriate characters but allows international names
 */
export function validateBusinessName(name: string, fieldName: string = 'Name'): ValidationResult {
  const errors: string[] = [];
  
  if (!name || name.trim().length === 0) {
    errors.push(`${fieldName} is required`);
    return { isValid: false, errors };
  }

  // Check for emojis
  if (containsEmojis(name)) {
    errors.push(`${fieldName} cannot contain emojis`);
  }

  // Check for inappropriate business characters (but allow international characters)
  const inappropriateChars = /[<>{}[\]\\|`~!@#$%^&*()+=?";]/;
  if (inappropriateChars.test(name)) {
    errors.push(`${fieldName} contains invalid characters`);
  }

  // Check reasonable length
  if (name.trim().length > 50) {
    errors.push(`${fieldName} must be 50 characters or less`);
  }

  if (name.trim().length < 1) {
    errors.push(`${fieldName} must be at least 1 character`);
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Validate business email addresses
 * More permissive than strict RFC validation but flags obvious issues
 */
export function validateBusinessEmail(email: string): ValidationResult {
  const errors: string[] = [];
  
  if (!email || email.trim().length === 0) {
    errors.push('Email address is required');
    return { isValid: false, errors };
  }

  // Basic email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    errors.push('Please enter a valid email address');
  }

  // Check for emojis
  if (containsEmojis(email)) {
    errors.push('Email address cannot contain emojis');
  }

  // Check for suspicious patterns
  if (email.includes('..')) {
    errors.push('Email address format is invalid');
  }

  if (email.length > 254) {
    errors.push('Email address is too long');
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Validate client names or other business text fields
 * Allows more flexibility than personal names
 */
export function validateBusinessText(text: string, fieldName: string = 'Field', options: { required?: boolean; maxLength?: number } = {}): ValidationResult {
  const errors: string[] = [];
  const { required = false, maxLength = 100 } = options;
  
  if (required && (!text || text.trim().length === 0)) {
    errors.push(`${fieldName} is required`);
    return { isValid: false, errors };
  }

  if (!text || text.trim().length === 0) {
    return { isValid: true, errors }; // Optional field, empty is OK
  }

  // Check for emojis
  if (containsEmojis(text)) {
    errors.push(`${fieldName} cannot contain emojis`);
  }

  // Check for potentially problematic characters (but allow business-appropriate punctuation)
  const inappropriateChars = /[<>{}[\]\\|`~]/;
  if (inappropriateChars.test(text)) {
    errors.push(`${fieldName} contains invalid characters`);
  }

  // Check length
  if (text.trim().length > maxLength) {
    errors.push(`${fieldName} must be ${maxLength} characters or less`);
  }

  return { isValid: errors.length === 0, errors };
}
