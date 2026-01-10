import { z } from 'zod';
import { uuidSchema } from './common';

const billingMethodSchema = z.enum(['fixed', 'hourly', 'usage', 'per_unit']);

const defaultRateSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return value;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }

  return value;
}, z.number().min(0));

const nullableUuidSchema = z.union([uuidSchema, z.null()]);

const descriptionSchema = z.union([z.string().max(2048), z.null()]);

const currencyCodeSchema = z.string().length(3).default('USD'); // ISO 4217 currency code

const serviceShape = {
  service_name: z.string().min(1).max(255),
  custom_service_type_id: uuidSchema,
  billing_method: billingMethodSchema,
  default_rate: defaultRateSchema,
  currency_code: currencyCodeSchema.optional(), // Currency of default_rate (defaults to USD)
  unit_of_measure: z.string().min(1).max(128),
  category_id: nullableUuidSchema.optional(),
  tax_rate_id: nullableUuidSchema.optional(),
  description: descriptionSchema.optional()
} as const;

export const createServiceSchema = z.object(serviceShape);

export const updateServiceSchema = z.object(serviceShape)
  .partial()
  .superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field must be provided to update a service'
      });
    }
  });

const nullableUuidQuerySchema = z
  .union([uuidSchema, z.literal('null')])
  .transform((value) => (value === 'null' ? null : value));

const serviceSortSchema = z.enum(['service_name', 'billing_method', 'default_rate']);

export const serviceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  sort: serviceSortSchema.optional().default('service_name'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
  search: z.string().optional(),
  item_kind: z.enum(['service', 'product', 'any']).optional(),
  is_active: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .optional(),
  billing_method: billingMethodSchema.optional(),
  category_id: nullableUuidQuerySchema.optional(),
  custom_service_type_id: uuidSchema.optional()
});

export type ServiceListQueryParams = z.infer<typeof serviceListQuerySchema>;
export type CreateServiceRequest = z.infer<typeof createServiceSchema>;
export type UpdateServiceRequest = z.infer<typeof updateServiceSchema>;
