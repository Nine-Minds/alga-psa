import { z } from 'zod';
import { uuidSchema } from './common';

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
// DD-2/F-2: no static 'USD' default. Products are tenant-scoped (no client_id),
// so ProductCatalogService.create resolves the currency from the tenant's
// default_billing_settings.default_currency_code (falling back to 'USD' only as
// a last resort) and sets cost_currency explicitly before insert.
const currencyCodeSchema = z.string().length(3); // ISO 4217 currency code

const priceSchema = z.object({
  currency_code: z.string().length(3),
  rate: z.number().min(0)
});

const productShape = {
  service_name: z.string().min(1).max(255),
  custom_service_type_id: uuidSchema,
  billing_method: billingMethodSchema.optional().default('usage'),
  default_rate: defaultRateSchema.optional().default(0),
  currency_code: currencyCodeSchema.optional(),
  unit_of_measure: z.string().min(1, 'Unit of measure is required').max(128),
  category_id: nullableUuidSchema.optional(),
  tax_rate_id: nullableUuidSchema.optional(),
  description: descriptionSchema.optional(),

  sku: z.union([z.string().max(128), z.null()]).optional(),
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

  prices: z.array(priceSchema).optional()
} as const;

export const createProductSchema = z.object(productShape);

export const updateProductSchema = z.object(productShape)
  .partial()
  .superRefine((data, ctx) => {
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
