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
