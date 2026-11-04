import { z } from 'zod';
import { uuidSchema } from './common';
import { isUnitOfMeasureCode } from '@alga-psa/core/unitOfMeasure';
import {
  DEFAULT_RATE_CONFLICT_MESSAGE,
  defaultRateConflictsWithPrimaryPrice,
  scheduledServicePricesInputSchema,
  servicePricesInputSchema,
} from '@alga-psa/billing/lib/catalog/serviceCatalogPricing';

const billingMethodSchema = z.enum(['fixed', 'hourly', 'usage']);

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

// Price write fields (alga0002016). `prices` replaces the current window and
// `scheduled_prices` the future window; `prices[0]` is primary and drives
// `default_rate`. A top-level `currency_code` has no meaning here (currency
// lives on each price), so it is rejected instead of silently dropped.
const priceWriteShape = {
  prices: servicePricesInputSchema.optional().describe('Full set of current prices, rate in integer minor units (e.g. cents), currency_code from the supported currency list. Replaces the entire current price window; omitted currencies are removed and prices: [] clears it. prices[0] is the primary price and is mirrored into default_rate. Currencies must be unique.'),
  scheduled_prices: scheduledServicePricesInputSchema.optional().describe('Full set of future-dated prices (each effective_date must be after today). Replaces the entire future price window; scheduled_prices: [] clears it. Does not change the current prices or default_rate.'),
  currency_code: z.unknown().optional().describe('Not accepted. Send prices[].currency_code instead; a top-level currency_code returns 400.'),
} as const;

const serviceShape = {
  service_name: z.string().min(1).max(255),
  custom_service_type_id: uuidSchema,
  billing_method: billingMethodSchema,
  default_rate: defaultRateSchema,
  unit_of_measure: z.string().trim().min(1).max(128).optional(),
  unit_code: z.string().refine(isUnitOfMeasureCode, 'Unknown unit of measure code').optional(),
  category_id: nullableUuidSchema.optional(),
  tax_rate_id: nullableUuidSchema.optional(),
  description: descriptionSchema.optional(),
  is_active: z.boolean().optional(),
  ...priceWriteShape
} as const;

function refinePriceWrites(
  data: { default_rate?: number; prices?: Array<{ rate: number }>; currency_code?: unknown },
  ctx: z.RefinementCtx,
) {
  if (data.currency_code !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['currency_code'], message: 'currency_code is not accepted at the top level; use prices[].currency_code' });
  }
  if (defaultRateConflictsWithPrimaryPrice(data.default_rate, data.prices)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['default_rate'], message: DEFAULT_RATE_CONFLICT_MESSAGE });
  }
}

// `default_rate` is derived from `prices[0]` on create, so it is only required
// when there are no prices to derive it from.
export const createServiceSchema = z.object({
  ...serviceShape,
  default_rate: defaultRateSchema.optional(),
}).superRefine((data, ctx) => {
  refinePriceWrites(data, ctx);
  if (data.default_rate === undefined && !(data.prices && data.prices.length > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['default_rate'], message: 'default_rate is required unless prices is a non-empty array' });
  }
  if (data.billing_method === 'usage' && !data.unit_of_measure && !data.unit_code) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['unit_of_measure'], message: 'Usage services require a unit of measure' });
  }
});

export const updateServiceSchema = z.object(serviceShape)
  .partial()
  .superRefine((data, ctx) => {
    refinePriceWrites(data, ctx);
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
  // Clamp rather than reject, matching the opportunities list page_size: an
  // oversized limit gets a full page, not a 400.
  limit: z.coerce.number().int().min(1).optional().default(25).transform((value) => Math.min(value, 100)),
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
