import { requireTenantId, tenantDb } from '@alga-psa/db';
import type { IService, IServicePrice } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { validateData } from '@alga-psa/core';
import { Knex } from 'knex';

// Use a constant for environment check
const IS_DEVELOPMENT = typeof window !== 'undefined' &&
  globalThis.window.location.hostname === 'localhost';

const log = {
  info: (message: string, ...args: unknown[]) => {
    if (IS_DEVELOPMENT) {
      globalThis.console.log(message, ...args);
    }
  },
  warn: (message: string, ...args: unknown[]) => {
    globalThis.console.warn(message, ...args);
  },
  error: (message: string, ...args: unknown[]) => {
    globalThis.console.error(message, ...args);
  }
};

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(tableExpression);
}

function serviceCatalogWithType(conn: Knex | Knex.Transaction, tenant: string): Knex.QueryBuilder {
  const db = tenantDb(conn, tenant);
  const query = db.table('service_catalog as sc');
  db.tenantJoin(query, 'service_types as ct', 'sc.custom_service_type_id', 'ct.id', { type: 'left' });
  return query;
}

type ServiceCatalogWithTypeRow = IService;

type DefaultBillingSettingsCurrencyRow = {
  tenant: string;
  default_currency_code: string | null;
};

type ServicePriceAvailabilityRow = {
  service_id: string;
  service_name: string;
  price_id: string | null;
};

// Schema for service prices
const servicePriceSchema = z.object({
  price_id: z.string().uuid(),
  tenant: z.string().min(1, 'Tenant is required'),
  service_id: z.string().uuid(),
  currency_code: z.string().length(3),
  rate: z.union([z.string(), z.number()]).transform(val =>
    typeof val === 'string' ? parseFloat(val) || 0 : val
  ),
  created_at: z.union([z.string(), z.date()]).transform(val =>
    val instanceof Date ? val.toISOString() : val
  ).optional(),
  updated_at: z.union([z.string(), z.date()]).transform(val =>
    val instanceof Date ? val.toISOString() : val
  ).optional()
});

// Base schema definition - aligns closely with DB nullability where appropriate
const baseServiceSchema = z.object({
  service_id: z.string().uuid(),
  tenant: z.string().min(1, 'Tenant is required'),
  service_name: z.string(),
  custom_service_type_id: z.string().uuid(),   // Now required, not nullable
  billing_method: z.enum(['fixed', 'hourly', 'usage']),
  default_rate: z.union([z.string(), z.number()]).transform(val =>
    typeof val === 'string' ? parseFloat(val) || 0 : val
  ),
  unit_of_measure: z.string(),
  category_id: z.string().uuid().nullable(), // Matches DB FK (nullable) - IService allows string | null
  item_kind: z.enum(['service', 'product']).default('service'),
  is_active: z.union([z.boolean(), z.number()]).transform((val) => Boolean(val)).default(true),
  sku: z.string().nullable().optional(),
  cost: z.union([z.string(), z.number()]).transform(val =>
    typeof val === 'string' ? parseFloat(val) || 0 : val
  ).nullable().optional(),
  // DD-2/F-2: `.default('USD')` is kept for the READ path only. This schema does double
  // duty (validates DB-read rows AND create input); dropping the default would make rows
  // storing NULL cost_currency surface as null instead of 'USD'. For the CREATE path,
  // Service.create resolves the tenant's configured default currency
  // (default_billing_settings.default_currency_code) from the RAW input before insert, so a
  // service created without an explicit cost_currency inherits the tenant default rather than
  // this literal. ProductCatalogService.create resolves the tenant default independently (it
  // does not use this schema).
  cost_currency: z.string().length(3).nullable().optional().default('USD'),
  vendor: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  product_category: z.string().nullable().optional(),
  is_license: z.union([z.boolean(), z.number()]).transform((val) => Boolean(val)).default(false),
  license_term: z.string().nullable().optional(),
  license_billing_cadence: z.string().nullable().optional(),
  tax_rate_id: z.union([z.string().uuid(), z.null()]).optional(), // Accept string, null, or undefined
  description: z.string().nullable(), // Added: Description field from the database
  service_type_name: z.string().optional(), // Add service_type_name to the schema
  prices: z.array(servicePriceSchema).optional(), // Multi-currency prices
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});

// No need for refine check anymore since we only have custom_service_type_id
export const refinedServiceSchema = baseServiceSchema;

// Final schema for validation, transforming nulls to match IService interface
// IService uses string | null for category_id, tax_region
// IService uses string | undefined, number | undefined for others
export const serviceSchema = refinedServiceSchema.transform((data) => {
  // Explicitly type the input 'data' to the transform based on the refined schema
  const inputData = data as z.infer<typeof refinedServiceSchema>;
  return {
    ...inputData,
    // Keep null for fields that are string | null in IService
    category_id: inputData.category_id,
    description: inputData.description,
    tax_rate_id: inputData.tax_rate_id,   // Keep null for string | null
    custom_service_type_id: inputData.custom_service_type_id,
  };
});

// Infer the final type matching IService structure
export type ServiceSchemaType = z.infer<typeof serviceSchema>;

type ServiceReadRow = { service_id: string; billing_method?: string | null };

/**
 * The single legacy `billing_method` that billing's `IService` cannot represent.
 *
 * `serviceSchema.billing_method` is deliberately the canonical billing vocabulary
 * (`fixed | hourly | usage`) — the T013 hard cutover purged `per_unit` from billing's
 * `IService` contract (guarded by billingInterfacesCutover.static.test). Migration
 * 20260323120000_normalize_per_unit_to_usage rewrote existing `service_catalog` rows,
 * but it added no CHECK constraint there, so pre-migration or externally-written rows
 * can still carry `per_unit`.
 */
const UNREPRESENTABLE_BILLING_METHOD = 'per_unit';

/**
 * Validate service_catalog rows for the read/list path.
 *
 * A single `per_unit` row used to throw from `.map(schema.parse(...))` and take down every
 * consumer of getServices (Sales Order line picker, Manual Invoice client+service load).
 * Such rows are skipped — and *only* such rows: every other validation failure is a real
 * data defect and still throws, per the repo's fail-fast standard. Widening the skip to any
 * `safeParse` failure would let a malformed row silently vanish from a billing list.
 *
 * Skipped rows are logged, not silently swallowed: a `per_unit` product will not appear in
 * billing-sourced service pickers by design. Surfacing those products for sale is a separate
 * inventory concern (an inventory-owned product reader), not a widening of billing's contract.
 */
export function parseServiceReadRows(
  rows: ServiceReadRow[],
  pricesByService: Record<string, IServicePrice[]>
): IService[] {
  const validatedServices: IService[] = [];
  const skipped: string[] = [];

  for (const service of rows) {
    if (service.billing_method === UNREPRESENTABLE_BILLING_METHOD) {
      skipped.push(service.service_id);
      continue;
    }

    // Anything else that fails validation is a genuine defect: let it throw.
    validatedServices.push(
      serviceSchema.parse({
        ...service,
        prices: pricesByService[service.service_id] || []
      }) as IService
    );
  }

  if (skipped.length > 0) {
    log.warn(
      `[parseServiceReadRows] Skipped ${skipped.length} service_catalog row(s) with ` +
        `billing_method='${UNREPRESENTABLE_BILLING_METHOD}', which billing's IService cannot represent; ` +
        `they are excluded from billing-sourced service lists. service_ids: ${skipped.join(', ')}`
    );
  }

  return validatedServices;
}

// Create schema: Omit service_id and tenant from the *base* schema first
// We omit tenant because it will be added by the server-side code after validation
const baseCreateServiceSchema = baseServiceSchema.omit({ service_id: true, tenant: true, created_at: true, updated_at: true });

// No need for refine check anymore
const refinedCreateServiceSchema = baseCreateServiceSchema;

// Apply the same transformation logic to the create schema
export const createServiceSchema = refinedCreateServiceSchema.transform((data) => {
  // Explicitly type the input 'data'
  const inputData = data as z.infer<typeof refinedCreateServiceSchema>;
  return {
    ...inputData,
    category_id: inputData.category_id,
    description: inputData.description,
    tax_rate_id: inputData.tax_rate_id,   // Keep null for string | null
    custom_service_type_id: inputData.custom_service_type_id,
  };
});

// Infer the creation type
export type CreateServiceSchemaType = z.infer<typeof createServiceSchema>;

const Service = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<IService[]> => {
    const tenant = await requireTenantId(knexOrTrx);

    log.info(`[Service.getAll] Fetching all services for tenant: ${tenant}`);


    try {
      // Fetch services, joining with custom service types to get type names
      const servicesData = await serviceCatalogWithType(knexOrTrx, tenant)
        .select<ServiceCatalogWithTypeRow[]>(
          'sc.service_id as service_id',
          'sc.service_name as service_name',
          'sc.custom_service_type_id as custom_service_type_id',
          'sc.billing_method as billing_method',
          knexOrTrx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure as unit_of_measure',
          'sc.category_id as category_id',
          'sc.description as description',
          'sc.tax_rate_id as tax_rate_id',
          'sc.item_kind as item_kind',
          'sc.is_active as is_active',
          'sc.sku as sku',
          knexOrTrx.raw('CAST(sc.cost AS FLOAT) as cost'),
          'sc.cost_currency as cost_currency',
          'sc.vendor as vendor',
          'sc.manufacturer as manufacturer',
          'sc.product_category as product_category',
          'sc.is_license as is_license',
          'sc.license_term as license_term',
          'sc.license_billing_cadence as license_billing_cadence',
          'sc.tenant as tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        )
        .orderBy('sc.service_name', 'asc');
      log.info(`[Service.getAll] Found ${servicesData.length} services`);

      // Fetch all prices for these services
      const serviceIds = servicesData.map(s => s.service_id);
      const allPrices = serviceIds.length > 0
        ? await tenantScopedTable<IServicePrice>(knexOrTrx, tenant, 'service_prices')
            .whereIn('service_id', serviceIds)
            .select('*')
        : [];

      // Group prices by service_id
      const pricesByService = allPrices.reduce((acc: Record<string, IServicePrice[]>, price: IServicePrice) => {
        if (!acc[price.service_id]) {
          acc[price.service_id] = [];
        }
        acc[price.service_id].push(price);
        return acc;
      }, {} as Record<string, IServicePrice[]>);

      const validatedServices = parseServiceReadRows(servicesData, pricesByService);

      log.info(`[Service.getAll] Services data validated successfully`);
      return validatedServices;
    } catch (error) {
      log.error(`[Service.getAll] Error fetching services:`, error);
      throw error;
    }
  },

  getById: async (knexOrTrx: Knex | Knex.Transaction, service_id: string): Promise<IService | null> => {
    const tenant = await requireTenantId(knexOrTrx);

    log.info(`[Service.getById] Fetching service with ID: ${service_id} for tenant: ${tenant}`);

    try {
      // Fetch service by ID, joining with custom service types
      const serviceData = await serviceCatalogWithType(knexOrTrx, tenant)
        .where({
          'sc.service_id': service_id
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.custom_service_type_id',
          'sc.billing_method',
          knexOrTrx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.description',
          'sc.tax_rate_id',
          'sc.item_kind',
          'sc.is_active',
          'sc.sku',
          knexOrTrx.raw('CAST(sc.cost AS FLOAT) as cost'),
          'sc.cost_currency',
          'sc.vendor',
          'sc.manufacturer',
          'sc.product_category',
          'sc.is_license',
          'sc.license_term',
          'sc.license_billing_cadence',
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        )
        .first(); // Use .first() as we expect only one

      if (!serviceData) {
        log.info(`[Service.getById] No service found with ID: ${service_id} for tenant: ${tenant}`);
        return null;
      }

      // Fetch prices for this service
      const prices = await tenantScopedTable<IServicePrice>(knexOrTrx, tenant, 'service_prices')
        .where({ service_id })
        .select('*');

      log.info(`[Service.getById] Found service: ${serviceData.service_name} with ${prices.length} price(s)`);
      // Validate and transform using the final schema's parse method
      const validatedService = serviceSchema.parse({
        ...serviceData,
        prices
      }) as IService;
      log.info(`[Service.getById] Service data validated successfully`);

      return validatedService;
    } catch (error) {
      log.error(`[Service.getById] Error fetching service ${service_id}:`, error);
      throw error;
    }
  },

  // Note: Input type validation (exactly one ID) is expected to be handled by the caller (e.g., serviceAction)
  // or potentially by refining createServiceSchema further if desired.
  create: async (knexOrTrx: Knex | Knex.Transaction, serviceData: Omit<IService, 'service_id'> & { tenant?: string }): Promise<IService> => {
    const dbTenant = await requireTenantId(knexOrTrx);

    // Use the tenant from the serviceData if provided, otherwise use the one from getCurrentTenantId
    const effectiveTenant = serviceData.tenant || dbTenant;

    if (!effectiveTenant) {
      throw new Error('Tenant context is required for creating a service');
    }

    // Remove service_type_name from the input data as it's a virtual field
    const { service_type_name, ...dataWithoutTypeName } = serviceData;
    
    // Ensure all nullable fields are properly set to null instead of undefined
    const cleanedData = {
      ...dataWithoutTypeName,
      tax_rate_id: dataWithoutTypeName.tax_rate_id ?? null,
      category_id: dataWithoutTypeName.category_id ?? null,
      description: dataWithoutTypeName.description ?? null,
    };

    // Validate the input data using the updated creation schema
    // The refine check in the schema ensures one ID is present.
    // Explicitly type validatedData using the inferred type
    // Validate against the create schema expecting nulls
    // Note: We use the validated data *before* transformation to build the DB object
    // Validate against the refined create schema (expects nulls)
    // Validate and transform the input using the final create schema
    // The result 'validatedData' will match CreateServiceSchemaType
    // Ensure default_rate is a number before validation
    const dataToValidate = {
      ...cleanedData,
      default_rate: typeof cleanedData.default_rate === 'string'
        ? parseFloat(cleanedData.default_rate) || 0
        : cleanedData.default_rate,
    };

    const validatedData = createServiceSchema.parse(dataToValidate);

    const normalizedDefaultRate = Math.round(Number(validatedData.default_rate || 0));
    if (!Number.isFinite(normalizedDefaultRate) || normalizedDefaultRate < 0) {
      throw new Error('default_rate must be a non-negative number');
    }

    const normalizedCost =
      validatedData.cost === null || validatedData.cost === undefined
        ? null
        : Math.round(Number(validatedData.cost));
    if (normalizedCost !== null && (!Number.isFinite(normalizedCost) || normalizedCost < 0)) {
      throw new Error('cost must be a non-negative number');
    }

    // Resolve cost currency: a caller-provided value wins; otherwise inherit the tenant's
    // configured default currency (default_billing_settings.default_currency_code), and only
    // then fall back to 'USD'. We read the RAW input (cleanedData) rather than validatedData
    // because the schema's .default('USD') — kept for the read path — would otherwise mask
    // "not provided".
    let resolvedCostCurrency = cleanedData.cost_currency ?? null;
    if (resolvedCostCurrency == null) {
      const billingSettings = await tenantScopedTable<DefaultBillingSettingsCurrencyRow>(knexOrTrx, effectiveTenant, 'default_billing_settings')
        .select('default_currency_code')
        .first();
      resolvedCostCurrency = billingSettings?.default_currency_code || 'USD';
    }

    const newService = {
      service_id: uuidv4(),
      tenant: effectiveTenant,
      service_name: validatedData.service_name,
      custom_service_type_id: validatedData.custom_service_type_id,
      billing_method: validatedData.billing_method,
      default_rate: normalizedDefaultRate,
      unit_of_measure: validatedData.unit_of_measure,
      category_id: validatedData.category_id ?? null, // category_id is string | null in IService
      tax_rate_id: validatedData.tax_rate_id ?? null, // Corrected: Use tax_rate_id
      description: validatedData.description ?? '', // Add description field with default empty string
      item_kind: validatedData.item_kind ?? 'service',
      is_active: validatedData.is_active ?? true,
      sku: validatedData.sku ?? null,
      cost: normalizedCost,
      cost_currency: resolvedCostCurrency,
      vendor: validatedData.vendor ?? null,
      manufacturer: validatedData.manufacturer ?? null,
      product_category: validatedData.product_category ?? null,
      is_license: validatedData.is_license ?? false,
      license_term: validatedData.license_term ?? null,
      license_billing_cadence: validatedData.license_billing_cadence ?? null,
    };

    log.info('[Service.create] Constructed newService object:', newService);

    try {
      // Insert into service_catalog (assuming this is the correct table name)
      const [createdService] = await tenantScopedTable<IService>(knexOrTrx, effectiveTenant, 'service_catalog')
        .insert(newService)
        .returning('*'); // Return all columns to match IService

      log.info('[Service.create] Successfully created service:', createdService);
      
      // After creation, fetch the complete service with type name by joining with type tables
      const completeService = await serviceCatalogWithType(knexOrTrx, effectiveTenant)
        .where({
          'sc.service_id': createdService.service_id,
          'sc.tenant': effectiveTenant
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.custom_service_type_id',
          'sc.billing_method',
          knexOrTrx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.description',
          'sc.tax_rate_id',
          'sc.item_kind',
          'sc.is_active',
          'sc.sku',
          knexOrTrx.raw('CAST(sc.cost AS FLOAT) as cost'),
          'sc.cost_currency',
          'sc.vendor',
          'sc.manufacturer',
          'sc.product_category',
          'sc.is_license',
          'sc.license_term',
          'sc.license_billing_cadence',
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        )
        .first();

      if (!completeService) {
        log.info(`[Service.create] Failed to fetch complete service after creation: ${createdService.service_id}`);
        return serviceSchema.parse({ ...createdService, prices: [] }) as IService; // Fall back to the original service data
      }

      // No prices exist yet for a newly created service
      // Validate and transform the DB result using the final schema's parse method
      return serviceSchema.parse({ ...completeService, prices: [] }) as IService;
    } catch (error) {
      log.error('[Service.create] Database error:', error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, service_id: string, serviceData: Partial<IService>): Promise<IService | null> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      // Remove tenant, service_type_name, and prices from update data to prevent modification
      // service_type_name is a virtual field from JOIN and doesn't exist in the table
      // prices is stored in a separate service_prices table
      const { tenant: _, service_type_name, prices: _prices, ...updateData } = serviceData;

      // No need to handle type ID changes anymore
      const finalUpdateData: Partial<IService> = { ...updateData };

      if (finalUpdateData.default_rate !== undefined) {
        const numericRate =
          typeof finalUpdateData.default_rate === 'string'
            ? parseFloat(finalUpdateData.default_rate)
            : finalUpdateData.default_rate;

        if (Number.isNaN(numericRate)) {
          delete finalUpdateData.default_rate;
        } else if (numericRate < 0) {
          throw new Error('default_rate must be a non-negative number');
        } else {
          finalUpdateData.default_rate = Math.round(numericRate);
        }
      }

      if (finalUpdateData.cost !== undefined && finalUpdateData.cost !== null) {
        const numericCost =
          typeof finalUpdateData.cost === 'string'
            ? parseFloat(finalUpdateData.cost)
            : finalUpdateData.cost;

        if (Number.isNaN(numericCost)) {
          delete finalUpdateData.cost;
        } else if (numericCost < 0) {
          throw new Error('cost must be a non-negative number');
        } else {
          finalUpdateData.cost = Math.round(numericCost);
        }
      }

      // Knex `update()` does not reliably ignore `undefined` values; strip them so we don't
      // generate invalid bindings (optional fields are allowed to be omitted entirely).
      const cleanedUpdateData = Object.fromEntries(
        Object.entries(finalUpdateData).filter(([, value]) => value !== undefined)
      ) as Partial<IService>;

      // Ensure updateData conforms to Partial<IService> based on the *new* interface
      // Zod validation could be added here too if needed for partial updates.
      const [updatedServiceData] = await tenantScopedTable<IService>(knexOrTrx, tenant, 'service_catalog')
        .where({
          service_id
        })
        .update(cleanedUpdateData)
        .returning('*'); // Return all fields to validate against the schema

      if (!updatedServiceData) {
        log.info(`[Service.update] No service found with ID: ${service_id} or tenant mismatch`);
        return null;
      }

      // After update, fetch the complete service with type name by joining with type tables
      const completeService = await serviceCatalogWithType(knexOrTrx, tenant)
        .where({
          'sc.service_id': service_id,
          'sc.tenant': tenant
        })
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.custom_service_type_id',
          'sc.billing_method',
          knexOrTrx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure',
          'sc.category_id',
          'sc.description',
          'sc.tax_rate_id',
          'sc.item_kind',
          'sc.is_active',
          'sc.sku',
          knexOrTrx.raw('CAST(sc.cost AS FLOAT) as cost'),
          'sc.cost_currency',
          'sc.vendor',
          'sc.manufacturer',
          'sc.product_category',
          'sc.is_license',
          'sc.license_term',
          'sc.license_billing_cadence',
          'sc.tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        )
        .first();

      if (!completeService) {
        log.info(`[Service.update] Failed to fetch complete service after update: ${service_id}`);
        return null;
      }

      // Fetch prices for this service
      const prices = await tenantScopedTable<IServicePrice>(knexOrTrx, tenant, 'service_prices')
        .where({ service_id })
        .select('*');

      // Validate and transform the DB result using the final schema's parse method
      return serviceSchema.parse({ ...completeService, prices }) as IService;
    } catch (error) {
      log.error(`[Service.update] Error updating service ${service_id}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, service_id: string): Promise<boolean> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      // If we're already in a transaction, use it directly
      if (knexOrTrx.isTransaction) {
        const db = tenantDb(knexOrTrx, tenant);
        const updatedDetails = await db.table('invoice_charge_details')
          .where({
            service_id
          })
          .update({
            service_id: null
          });

        log.info(`[Service.delete] Updated ${updatedDetails} invoice_charge_details records for service ${service_id}`);

        // Clear service_id from project_tasks (replaces ON DELETE SET NULL)
        const updatedTasks = await db.table('project_tasks')
          .where({
            service_id
          })
          .update({
            service_id: null
          });

        log.info(`[Service.delete] Updated ${updatedTasks} project_tasks records for service ${service_id}`);

        // Clear service_id from project_template_tasks (replaces ON DELETE SET NULL)
        const updatedTemplateTasks = await db.table('project_template_tasks')
          .where({
            service_id
          })
          .update({
            service_id: null
          });

        log.info(`[Service.delete] Updated ${updatedTemplateTasks} project_template_tasks records for service ${service_id}`);

        // Clear linked_service_id from service_request_definitions (replaces ON DELETE SET NULL)
        const updatedRequestDefs = await db.table('service_request_definitions')
          .where({ linked_service_id: service_id })
          .update({ linked_service_id: null, linked_service_name_snapshot: null });

        log.info(`[Service.delete] Updated ${updatedRequestDefs} service_request_definitions records for service ${service_id}`);

        // Then delete the service
        const deletedCount = await db.table('service_catalog')
          .where({
            service_id
          })
          .del();

        log.info(`[Service.delete] Deleted service ${service_id} for tenant ${tenant}. Affected rows: ${deletedCount}`);
        return deletedCount > 0;
      } else {
        // Otherwise create a transaction
        return await knexOrTrx.transaction(async (trx) => {
          const db = tenantDb(trx, tenant);
          const updatedDetails = await db.table('invoice_charge_details')
            .where({
              service_id
            })
            .update({
              service_id: null
            });

          log.info(`[Service.delete] Updated ${updatedDetails} invoice_charge_details records for service ${service_id}`);

          // Clear service_id from project_tasks (replaces ON DELETE SET NULL)
          const updatedTasks = await db.table('project_tasks')
            .where({
              service_id
            })
            .update({
              service_id: null
            });

          log.info(`[Service.delete] Updated ${updatedTasks} project_tasks records for service ${service_id}`);

          // Clear service_id from project_template_tasks (replaces ON DELETE SET NULL)
          const updatedTemplateTasks = await db.table('project_template_tasks')
            .where({
              service_id
            })
            .update({
              service_id: null
            });

          log.info(`[Service.delete] Updated ${updatedTemplateTasks} project_template_tasks records for service ${service_id}`);

          // Clear linked_service_id from service_request_definitions (replaces ON DELETE SET NULL)
          const updatedRequestDefs = await db.table('service_request_definitions')
            .where({ linked_service_id: service_id })
            .update({ linked_service_id: null, linked_service_name_snapshot: null });

          log.info(`[Service.delete] Updated ${updatedRequestDefs} service_request_definitions records for service ${service_id}`);

          // Then delete the service
          const deletedCount = await db.table('service_catalog')
            .where({
              service_id
            })
            .del();

          log.info(`[Service.delete] Deleted service ${service_id} for tenant ${tenant}. Affected rows: ${deletedCount}`);
          return deletedCount > 0;
        });
      }
    } catch (error) {
      log.error(`[Service.delete] Error deleting service ${service_id}:`, error);
      throw error;
    }
  },

  getByCategoryId: async (knexOrTrx: Knex | Knex.Transaction, category_id: string): Promise<IService[]> => {
    const tenant = await requireTenantId(knexOrTrx);

    try {
      // Fetch services by category ID, joining with custom service types
      const servicesData = await serviceCatalogWithType(knexOrTrx, tenant)
        .where({
          'sc.category_id': category_id,
          'sc.tenant': tenant
        })
        .select<ServiceCatalogWithTypeRow[]>(
          'sc.service_id as service_id',
          'sc.service_name as service_name',
          'sc.custom_service_type_id as custom_service_type_id',
          'sc.billing_method as billing_method',
          knexOrTrx.raw('CAST(sc.default_rate AS FLOAT) as default_rate'),
          'sc.unit_of_measure as unit_of_measure',
          'sc.category_id as category_id',
          'sc.description as description',
          'sc.tax_rate_id as tax_rate_id',
          'sc.item_kind as item_kind',
          'sc.is_active as is_active',
          'sc.sku as sku',
          knexOrTrx.raw('CAST(sc.cost AS FLOAT) as cost'),
          'sc.cost_currency as cost_currency',
          'sc.vendor as vendor',
          'sc.manufacturer as manufacturer',
          'sc.product_category as product_category',
          'sc.is_license as is_license',
          'sc.license_term as license_term',
          'sc.license_billing_cadence as license_billing_cadence',
          'sc.tenant as tenant',
          // Select the service type name from custom type
          'ct.name as service_type_name'
        );

      log.info(`[Service.getByCategoryId] Found ${servicesData.length} services for category ${category_id}`);

      // Fetch all prices for these services
      const serviceIds = servicesData.map(s => s.service_id);
      const allPrices = serviceIds.length > 0
        ? await tenantScopedTable<IServicePrice>(knexOrTrx, tenant, 'service_prices')
            .whereIn('service_id', serviceIds)
            .select('*')
        : [];

      // Group prices by service_id
      const pricesByService = allPrices.reduce((acc: Record<string, IServicePrice[]>, price: IServicePrice) => {
        if (!acc[price.service_id]) {
          acc[price.service_id] = [];
        }
        acc[price.service_id].push(price);
        return acc;
      }, {} as Record<string, IServicePrice[]>);

      return parseServiceReadRows(servicesData, pricesByService);
    } catch (error) {
      log.error(`[Service.getByCategoryId] Error fetching services for category ${category_id}:`, error);
      throw error;
    }
  },

  // ========== Service Price CRUD Operations ==========

  /**
   * Get all prices for a service
   */
  getPrices: async (knexOrTrx: Knex | Knex.Transaction, service_id: string): Promise<IServicePrice[]> => {
    const tenant = await requireTenantId(knexOrTrx);

    const prices = await tenantScopedTable<IServicePrice>(knexOrTrx, tenant, 'service_prices')
      .where({ service_id })
      .select('*')
      .orderBy('currency_code', 'asc');

    return prices;
  },

  /**
   * Get a specific price for a service in a given currency
   */
  getPrice: async (
    knexOrTrx: Knex | Knex.Transaction,
    service_id: string,
    currency_code: string
  ): Promise<IServicePrice | null> => {
    const tenant = await requireTenantId(knexOrTrx);

    const price = await tenantScopedTable<IServicePrice>(knexOrTrx, tenant, 'service_prices')
      .where({ service_id, currency_code })
      .first();

    return price || null;
  },

  /**
   * Set a price for a service in a given currency (upsert)
   */
  setPrice: async (
    knexOrTrx: Knex | Knex.Transaction,
    service_id: string,
    currency_code: string,
    rate: number
  ): Promise<IServicePrice> => {
    const tenant = await requireTenantId(knexOrTrx);

    const normalizedRate = Math.round(Number(rate || 0));
    if (!Number.isFinite(normalizedRate) || normalizedRate < 0) {
      throw new Error('rate must be a non-negative number');
    }

    // Check if price already exists
    const existingPrice = await tenantScopedTable<IServicePrice>(knexOrTrx, tenant, 'service_prices')
      .where({ service_id, currency_code })
      .first();

    if (existingPrice) {
      // Update existing price
      const [updatedPrice] = await tenantScopedTable<IServicePrice>(knexOrTrx, tenant, 'service_prices')
        .where({ price_id: existingPrice.price_id })
        .update({
          rate: normalizedRate,
          updated_at: knexOrTrx.fn.now()
        })
        .returning('*');

      log.info(`[Service.setPrice] Updated price for service ${service_id} in ${currency_code}: ${normalizedRate}`);
      return updatedPrice;
    } else {
      // Insert new price
      const [newPrice] = await tenantScopedTable<IServicePrice>(knexOrTrx, tenant, 'service_prices')
        .insert({
          price_id: uuidv4(),
          tenant,
          service_id,
          currency_code,
          rate: normalizedRate
        })
        .returning('*');

      log.info(`[Service.setPrice] Created price for service ${service_id} in ${currency_code}: ${normalizedRate}`);
      return newPrice;
    }
  },

  /**
   * Set multiple prices for a service at once (replaces all existing prices)
   */
  setPrices: async (
    knexOrTrx: Knex | Knex.Transaction,
    service_id: string,
    prices: Array<{ currency_code: string; rate: number }>
  ): Promise<IServicePrice[]> => {
    const tenant = await requireTenantId(knexOrTrx);

    // Delete existing prices
    await tenantScopedTable(knexOrTrx, tenant, 'service_prices')
      .where({ service_id })
      .del();

    if (prices.length === 0) {
      return [];
    }

    // Insert new prices
    const pricesToInsert = prices.map(p => ({
      price_id: uuidv4(),
      tenant,
      service_id,
      currency_code: p.currency_code,
      rate: (() => {
        const normalizedRate = Math.round(Number(p.rate || 0));
        if (!Number.isFinite(normalizedRate) || normalizedRate < 0) {
          throw new Error('rate must be a non-negative number');
        }
        return normalizedRate;
      })()
    }));

    const insertedPrices = await tenantScopedTable<IServicePrice>(knexOrTrx, tenant, 'service_prices')
      .insert(pricesToInsert)
      .returning('*');

    log.info(`[Service.setPrices] Set ${prices.length} price(s) for service ${service_id}`);
    return insertedPrices;
  },

  /**
   * Remove a specific price for a service
   */
  removePrice: async (
    knexOrTrx: Knex | Knex.Transaction,
    service_id: string,
    currency_code: string
  ): Promise<boolean> => {
    const tenant = await requireTenantId(knexOrTrx);

    const deletedCount = await tenantScopedTable(knexOrTrx, tenant, 'service_prices')
      .where({ service_id, currency_code })
      .del();

    log.info(`[Service.removePrice] Removed price for service ${service_id} in ${currency_code}. Affected: ${deletedCount}`);
    return deletedCount > 0;
  },

  /**
   * Check if services have prices in the required currency
   * Returns services that are missing the required currency price
   */
  validateCurrencyPrices: async (
    knexOrTrx: Knex | Knex.Transaction,
    service_ids: string[],
    required_currency: string
  ): Promise<{ valid: boolean; missingServices: Array<{ service_id: string; service_name: string }> }> => {
    const tenant = await requireTenantId(knexOrTrx);

    if (service_ids.length === 0) {
      return { valid: true, missingServices: [] };
    }

    // Get all services with their prices for the required currency
    const query = tenantScopedTable(knexOrTrx, tenant, 'service_catalog as sc')
      .whereIn('sc.service_id', service_ids);
    tenantDb(knexOrTrx, tenant).tenantJoin(query, 'service_prices as sp', 'sc.service_id', 'sp.service_id', {
      type: 'left',
      on(join) {
        join.andOn('sp.currency_code', '=', knexOrTrx.raw('?', [required_currency]));
      }
    });

    const servicesWithPrices = await query
      .select<ServicePriceAvailabilityRow[]>(
        'sc.service_id as service_id',
        'sc.service_name as service_name',
        'sp.price_id as price_id'
      );

    // Find services that don't have a price in the required currency
    const missingServices = servicesWithPrices
      .filter(s => !s.price_id)
      .map(s => ({ service_id: s.service_id, service_name: s.service_name }));

    return {
      valid: missingServices.length === 0,
      missingServices
    };
  },
};

export default Service;
