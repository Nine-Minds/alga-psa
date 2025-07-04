/**
 * Common API Schemas
 * Shared validation schemas and utilities for API endpoints
 */

import { z } from 'zod';

// Common field types
export const uuidSchema = z.string().uuid();
export const emailSchema = z.string().email();
export const urlSchema = z.string().url().optional();
export const phoneSchema = z.string().optional();
export const dateSchema = z.string().datetime().optional();
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Pagination schemas
export const paginationQuerySchema = z.object({
  page: z.string().transform(val => parseInt(val)).pipe(z.number().min(1)).optional().default('1'),
  limit: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).optional().default('25'),
  sort: z.string().optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc')
});

// Common filter schemas
export const baseFilterSchema = z.object({
  search: z.string().optional(),
  created_from: dateSchema,
  created_to: dateSchema,
  updated_from: dateSchema,
  updated_to: dateSchema,
  is_active: z.string().transform(val => val === 'true').optional()
});

// Response schemas
export const successResponseSchema = z.object({
  data: z.any(),
  meta: z.object({}).optional()
});

export const paginatedResponseSchema = z.object({
  data: z.array(z.any()),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
    hasNext: z.boolean(),
    hasPrev: z.boolean()
  }),
  meta: z.object({}).optional()
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional()
  })
});

// Metadata schemas
export const metadataSchema = z.object({
  tags: z.array(z.string()).optional(),
  properties: z.record(z.any()).optional(),
  notes: z.string().optional()
});

// Address schema
export const addressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional()
});

// Contact information schema
export const contactInfoSchema = z.object({
  email: emailSchema.optional(),
  phone: phoneSchema,
  mobile: phoneSchema,
  fax: phoneSchema,
  website: urlSchema
});

// Common entity fields
export const baseEntitySchema = z.object({
  created_at: dateSchema,
  updated_at: dateSchema,
  tenant: uuidSchema
});

// ID parameter schema for route parameters
export const idParamSchema = z.object({
  id: uuidSchema
});

// Bulk operation schemas
export const bulkDeleteSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(100)
});

export const bulkUpdateSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(100),
  data: z.record(z.any())
});

// Search and filter utilities
export const createSearchFilter = (searchableFields: string[]) => {
  return z.object({
    search: z.string().optional(),
    fields: z.array(z.enum(searchableFields as [string, ...string[]])).optional()
  });
};

export const createDateRangeFilter = (field: string) => {
  return z.object({
    [`${field}_from`]: dateSchema,
    [`${field}_to`]: dateSchema
  });
};

// Validation helpers
export function createListQuerySchema(additionalFilters?: z.ZodObject<any>) {
  const base = paginationQuerySchema.merge(baseFilterSchema);
  return additionalFilters ? base.merge(additionalFilters) : base;
}

export function createUpdateSchema(createSchema: z.ZodObject<any>) {
  // Make all fields optional for updates
  return createSchema.partial();
}

// Common validation functions
export function validateUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

export function validateEmail(value: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value);
}

export function validateUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// Transform utilities
export const booleanTransform = z.string().transform(val => {
  if (val === 'true') return true;
  if (val === 'false') return false;
  throw new Error('Invalid boolean value');
});

export const arrayTransform = <T extends z.ZodTypeAny>(schema: T) =>
  z.string().transform((val) => {
    try {
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) {
        throw new Error('Not an array');
      }
      return parsed;
    } catch {
      // If not JSON, try comma-separated
      return val.split(',').map(v => v.trim());
    }
  }).pipe(z.array(schema));

export const numberTransform = z.string().transform(val => {
  const num = Number(val);
  if (isNaN(num)) throw new Error('Invalid number value');
  return num;
});

export const dateTransform = z.string().transform(val => {
  const date = new Date(val);
  if (isNaN(date.getTime())) throw new Error('Invalid date value');
  return date.toISOString();
});

// Export utility type for extracting schema types
export type SchemaType<T extends z.ZodSchema> = z.infer<T>;