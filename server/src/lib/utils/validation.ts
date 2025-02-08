import { z } from 'zod';
import { ISO8601String } from '@/types/types.d';
import { Temporal } from '@js-temporal/polyfill';

// Basic validation utilities
export function validateData<T>(schema: z.ZodSchema<T>, data: unknown): T {
  if (process.env.NODE_ENV === 'development') {
    return schema.parse(data);
  }
  return data as T;
}

export function validateArray<T>(schema: z.ZodSchema<T>, data: unknown[]): T[] {
  if (process.env.NODE_ENV === 'development') {
    return z.array(schema).parse(data);
  }
  return data as T[];
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
