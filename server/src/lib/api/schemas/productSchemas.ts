import { z } from 'zod';
import { uuidSchema } from './common';
import { isUnitOfMeasureCode } from '@alga-psa/core/unitOfMeasure';
import {
  currencyCodeSchema as supportedCurrencyCodeSchema,
  minorUnitRateSchema,
  scheduledServicePricesInputSchema,
  servicePricesInputSchema,
} from '@alga-psa/billing/lib/catalog/serviceCatalogPricing';

const billingMethodSchema = z.enum(['usage']);

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
const productShape = {
  service_name: z.string().min(1).max(255),
  custom_service_type_id: uuidSchema,
  billing_method: billingMethodSchema.optional().default('usage'),
  // No schema default: the service applies 0 when neither default_rate nor
  // prices is sent, so `currency_code` without `default_rate` is detectable (400).
  default_rate: defaultRateSchema.optional(),
  // Shorthand for a single price: `{ currency_code, default_rate }` is the same as
  // `prices: [{ currency_code, rate: default_rate }]`. Never a service_catalog column.
  currency_code: supportedCurrencyCodeSchema.optional().describe('Shorthand for one price: with default_rate it upserts a single prices entry { currency_code, rate: default_rate } (default_rate is integer minor units, same as prices[].rate) and never writes a catalog column. Must be from the supported currency list. default_rate is required with it. On create it creates that one price; on update it sets that currency as the primary price (prices[0], mirrored into default_rate), replaces its rate if present or adds it, and leaves the other current prices untouched. Cannot be combined with prices (400).'),
  unit_of_measure: z.string().trim().min(1).max(128).optional(),
  unit_code: z.string().refine(isUnitOfMeasureCode, 'Unknown unit of measure code').optional(),
  category_id: nullableUuidSchema.optional(),
  tax_rate_id: nullableUuidSchema.optional(),
  description: descriptionSchema.optional(),

  sku: z.union([z.string().max(128), z.null()]).optional(),
  barcode: z.union([z.string().max(255), z.null()]).optional(),
  cost: z.union([z.number().min(0), z.null()]).optional(),
  // DD-2/F-2: no static 'USD' default. ProductCatalogService.create resolves
  // cost_currency from the tenant default (default_billing_settings) and sets it
  // explicitly before insert (service_catalog.cost_currency DB column DEFAULTs
  // to 'USD', so an unset value would otherwise silently become USD).
  cost_currency: z.union([z.string().length(3), z.null()]).optional(),
  vendor: z.union([z.string().max(255), z.null()]).optional(),
  manufacturer: z.union([z.string().max(255), z.null()]).optional(),
  product_category: z.union([z.string().max(255), z.null()]).optional(),
  is_license: z.boolean().optional().default(false),
  license_term: z.union([z.string().max(64), z.null()]).optional(),
  license_billing_cadence: z.union([z.string().max(64), z.null()]).optional(),
  is_active: z.boolean().optional().default(true),

  // Shared with the services API: validated against CURRENCY_OPTIONS, integer
  // minor units, `prices[0]` is primary. `prices` replaces the current window,
  // `scheduled_prices` the future window.
  prices: servicePricesInputSchema.optional().describe('Full set of current prices, rate in integer minor units (e.g. cents), currency_code from the supported currency list. Replaces the entire current price window; omitted currencies are removed and prices: [] clears it. prices[0] is the primary price and is mirrored into default_rate. Currencies must be unique.'),
  scheduled_prices: scheduledServicePricesInputSchema.optional().describe('Full set of future-dated prices (each effective_date must be after today). Replaces the entire future price window; scheduled_prices: [] clears it. Does not change the current prices or default_rate.')
} as const;

/** `currency_code` is a single-price shorthand: needs `default_rate`, excludes `prices`. */
function refineCurrencyShorthand(
  data: { currency_code?: string; default_rate?: number; prices?: unknown },
  ctx: z.RefinementCtx,
) {
  if (data.currency_code === undefined) return;
  if (data.prices !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['currency_code'], message: 'currency_code cannot be combined with prices; send either the currency_code + default_rate shorthand or prices[]' });
  }
  if (data.default_rate === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['default_rate'], message: 'default_rate is required when currency_code is sent' });
  } else if (!minorUnitRateSchema.safeParse(data.default_rate).success) {
    // default_rate mirrors prices[0].rate, so both are integer minor units (no conversion).
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['default_rate'], message: 'default_rate must be an integer number of minor units (e.g. cents) when currency_code is sent' });
  }
}

export const createProductSchema = z.object(productShape).superRefine(refineCurrencyShorthand);

export const updateProductSchema = z.object(productShape)
  .partial()
  .superRefine((data, ctx) => {
    refineCurrencyShorthand(data, ctx);
    if (Object.keys(data).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field must be provided to update a product'
      });
    }
  });

const productSortSchema = z.enum(['service_name', 'default_rate']);

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  sort: productSortSchema.optional().default('service_name'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
  search: z.string().optional(),
  is_active: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .optional(),
  category_id: z
    .union([uuidSchema, z.literal('null')])
    .transform((value) => (value === 'null' ? null : value))
    .optional(),
  is_license: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .optional()
});

export type ProductListQueryParams = z.infer<typeof productListQuerySchema>;
export type CreateProductRequest = z.infer<typeof createProductSchema>;
export type UpdateProductRequest = z.infer<typeof updateProductSchema>;
