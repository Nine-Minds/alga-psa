import { faker } from '@faker-js/faker';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

type BillingMethod = 'fixed' | 'hourly' | 'usage';

export interface ServiceRequestPayload {
  service_name: string;
  custom_service_type_id: string;
  billing_method: BillingMethod;
  default_rate: number;
  unit_of_measure: string;
  category_id: string | null;
  tax_rate_id: string | null;
  description: string | null;
}

/**
 * Ensure a service type exists for the provided billing method.
 * Creates a new service type when one is not already present.
 */
export async function ensureServiceType(
  db: Knex,
  tenantId: string,
  billingMethod: BillingMethod = 'fixed',
  overrides: Partial<{
    id: string;
    name: string;
    is_active: boolean;
    order_number: number;
    description: string | null;
  }> = {}
): Promise<string> {
  const schemaBillingMethod = billingMethod === 'fixed' ? 'fixed' : 'per_unit';

  const existing = await db<{ id: string }>('service_types')
    .where({ tenant: tenantId, billing_method: schemaBillingMethod })
    .first();

  if (existing?.id) {
    return existing.id;
  }

  const serviceTypeId = overrides.id ?? uuidv4();
  const { max: existingMaxOrder } = (await db<{ max: number | null }>('service_types')
    .where({ tenant: tenantId })
    .max('order_number as max')
    .first()) ?? { max: null };

  const nextOrderNumber = overrides.order_number ?? ((existingMaxOrder ?? 0) + 1);

  const insertData: Record<string, unknown> = {
    id: serviceTypeId,
    tenant: tenantId,
    name: overrides.name ?? `${billingMethod.toUpperCase()} API Test Type`,
    billing_method: schemaBillingMethod,
    is_active: overrides.is_active ?? true,
    order_number: nextOrderNumber
  };

  if (overrides.description !== undefined) {
    insertData.description = overrides.description;
  }

  await db('service_types').insert(insertData);
  return serviceTypeId;
}

/**
 * Build a service creation payload suitable for the Services API.
 */
export async function createServiceRequestData(
  db: Knex,
  tenantId: string,
  overrides: Partial<{
    service_name: string;
    custom_service_type_id: string;
    billing_method: BillingMethod;
    default_rate: number;
    unit_of_measure: string;
    category_id: string | null;
    tax_rate_id: string | null;
    description: string | null;
  }> = {}
): Promise<ServiceRequestPayload> {
  const billingMethod = overrides.billing_method ?? 'fixed';
  const serviceTypeId =
    overrides.custom_service_type_id ??
    (await ensureServiceType(db, tenantId, billingMethod));

  const defaultRate =
    overrides.default_rate ??
    faker.number.int({ min: 5000, max: 20000 });

  return {
    service_name:
      overrides.service_name ??
      `${faker.commerce.productAdjective()} ${faker.commerce.product()} Service`,
    custom_service_type_id: serviceTypeId,
    billing_method: billingMethod,
    default_rate: defaultRate,
    unit_of_measure: overrides.unit_of_measure ?? 'hour',
    category_id: overrides.category_id ?? null,
    tax_rate_id: overrides.tax_rate_id ?? null,
    description:
      overrides.description ??
      faker.lorem.sentence({ min: 6, max: 12 })
  };
}
