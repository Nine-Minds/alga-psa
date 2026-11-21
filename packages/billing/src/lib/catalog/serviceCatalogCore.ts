/**
 * Transaction-scoped service catalog create core.
 *
 * `ServiceCatalogService` (REST) and the AMP service applier both create
 * services through `createServiceCore`, the same way `productCatalogCore`
 * serves products: one transaction-scoped create path (type check, unit and
 * tax-rate defaults, the catalog insert and the single pricing writer).
 *
 * Everything runs on a caller-owned transaction: no commit, no auth, no event
 * publication. Callers publish `SERVICE_CATALOG_*` search events after their own
 * commit using the returned `changedFields`. Pricing validation failures
 * propagate as `ServiceCatalogPricingError`.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { resolveCatalogUnitForCreate } from '@alga-psa/shared/billingClients/tenantUnitsOfMeasure';
import { resolveCatalogTaxRateIdForCreate } from '@alga-psa/shared/billingClients/defaultTaxRate';
import {
  writeServiceCatalogPricing,
  type ScheduledServicePriceInput,
  type ServicePriceInput,
} from './serviceCatalogPricing';

export type ServiceCatalogCoreErrorCode = 'validation';

export class ServiceCatalogCoreError extends Error {
  constructor(
    public readonly code: ServiceCatalogCoreErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ServiceCatalogCoreError';
  }
}

/** Free-form service fields (the `service_catalog` columns) plus the pricing inputs. */
export type ServiceCoreInput = Record<string, any> & {
  prices?: ServicePriceInput[];
  scheduled_prices?: ScheduledServicePriceInput[];
};

export interface ServiceCoreWriteResult {
  serviceId: string;
  itemKind: 'service' | 'product';
  changedFields: string[];
}

export async function createServiceCore(
  trx: Knex.Transaction,
  tenant: string,
  input: ServiceCoreInput
): Promise<ServiceCoreWriteResult> {
  const { prices, scheduled_prices: scheduledPrices, ...serviceInput } = input;
  // default_rate is the mirror of the primary price; derive it from prices[0]
  // so a create that only sends prices does not need to repeat the rate.
  if (serviceInput.default_rate === undefined && prices && prices.length > 0) {
    serviceInput.default_rate = prices[0].rate;
  }

  const customServiceTypeId = serviceInput.custom_service_type_id;
  if (customServiceTypeId) {
    const serviceType = await tenantDb(trx, tenant).table('service_types').where('id', customServiceTypeId).first();
    if (!serviceType) {
      throw new ServiceCatalogCoreError('validation', `ServiceType ID '${customServiceTypeId}' not found for tenant '${tenant}'.`);
    }
  }

  // Resolve inherited defaults and units in the transaction, holding the
  // documented rate/region locks until the catalog row is persisted.
  const serviceData = {
    category_id: serviceInput.category_id ?? null,
    ...serviceInput,
    ...(await resolveCatalogUnitForCreate(trx, tenant, serviceInput)),
    tenant,
    default_rate: typeof serviceInput.default_rate === 'string'
      ? parseFloat(serviceInput.default_rate) || 0
      : serviceInput.default_rate,
    // Omitted inherits the tenant default; explicit null stays non-taxable.
    tax_rate_id: await resolveCatalogTaxRateIdForCreate(trx, tenant, serviceInput.tax_rate_id, undefined, { lock: true }),
  };

  const [created] = await tenantDb(trx, tenant).table('service_catalog').insert(serviceData).returning('*');

  if (prices !== undefined || scheduledPrices !== undefined) {
    await writeServiceCatalogPricing(trx, tenant, created.service_id, {
      current: prices,
      scheduled: scheduledPrices,
      defaultRate: serviceInput.default_rate === undefined ? undefined : Number(serviceInput.default_rate),
    });
  }

  return {
    serviceId: created.service_id,
    itemKind: created.item_kind as 'service' | 'product',
    changedFields: [
      ...Object.keys(serviceData),
      ...(prices !== undefined ? ['prices'] : []),
      ...(scheduledPrices !== undefined ? ['scheduled_prices'] : []),
    ],
  };
}
