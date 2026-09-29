import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import {
  assignServiceTaxRate,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings,
  setupClientTaxConfiguration,
} from './billingTestHelpers';
import { seedBillingCycle } from './billingProfileTestHelpers';

/**
 * Fixtures for the per-seat contract-authoring tests (wizard, template, preset,
 * quote conversion). They run against the real database with real actions —
 * only auth is mocked by the callers — so each test seeds its own client and
 * catalog and never depends on another test's rows.
 */

export function tenantTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tenant: string,
  tableExpression: string,
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, tenant).table<Row>(tableExpression);
}

export function dateOnly(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return null;
}

/**
 * Every call creates a fresh tenant, so each test file owns its rows and no
 * file can see (or be broken by) another file's - or a previous run's -
 * clients, cycles, invoices or tenant-wide settings.
 */
export async function ensureFixtureTenant(connection: Knex): Promise<string> {
  const scoped = () =>
    tenantDb(connection, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');
  const newTenantId = uuidv4();
  await scoped().insert({
    tenant: newTenantId,
    client_name: `Per-seat Integration Tenant ${newTenantId.slice(0, 8)}`,
    email: 'perseat@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  return newTenantId;
}

export interface SeatClient {
  clientId: string;
  /** Adds a monthly billing cycle that invoices the service month before `periodStart`. */
  addMonthlyCycle: (periodStart: string, periodEnd: string) => Promise<string>;
}

/**
 * A billable client: monthly cycle, billing address, NY tax configuration and
 * (optionally) a non-USD default currency.
 */
export async function createSeatClient(
  db: Knex,
  tenantId: string,
  options: { currencyCode?: string; name?: string } = {},
): Promise<SeatClient> {
  const clientId = uuidv4();
  await tenantTable(db, tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: options.name ?? `Per-seat Client ${clientId.slice(0, 8)}`,
    billing_cycle: 'monthly',
    is_tax_exempt: true,
    ...(options.currencyCode ? { default_currency_code: options.currencyCode } : {}),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await tenantTable(db, tenantId, 'client_locations').insert({
    location_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    location_name: 'Billing',
    address_line1: '1 Seat Way',
    city: 'Testville',
    state_province: 'NY',
    postal_code: '10001',
    country_code: 'US',
    country_name: 'United States',
    email: `${clientId.slice(0, 8)}@perseat.test`,
    is_default: true,
    is_billing_address: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  const scope = { db, tenantId, clientId } as const;
  await ensureDefaultBillingSettings(scope as any);
  await ensureClientPlanBundlesTable(scope as any);
  await setupClientTaxConfiguration(scope as any, {
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'New York Tax',
    startDate: '2024-01-01T00:00:00.000Z',
    taxPercentage: 8.875,
  });

  return {
    clientId,
    addMonthlyCycle: async (periodStart: string, periodEnd: string) => {
      const billingCycleId = uuidv4();
      await seedBillingCycle(db, tenantId, {
        billing_cycle_id: billingCycleId,
        tenant: tenantId,
        client_id: clientId,
        billing_cycle: 'monthly',
        effective_date: `${periodStart}T00:00:00Z`,
        period_start_date: `${periodStart}T00:00:00Z`,
        period_end_date: `${periodEnd}T00:00:00Z`,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      return billingCycleId;
    },
  };
}

export interface SeatCatalogService {
  serviceId: string;
  name: string;
}

/**
 * Catalog services (billing_method 'fixed') with an optional per-currency
 * price row, as the settings UI would have built them.
 */
export async function createSeatCatalog(
  db: Knex,
  tenantId: string,
  services: Array<{ name: string; rateCents: number; prices?: Record<string, number> }>,
): Promise<SeatCatalogService[]> {
  const serviceTypeId = uuidv4();
  await tenantTable(db, tenantId, 'service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Seat Services ${serviceTypeId.slice(0, 8)}`,
    order_number: Math.floor(Math.random() * 1_000_000),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  const created: SeatCatalogService[] = [];
  for (const service of services) {
    const serviceId = uuidv4();
    await tenantTable(db, tenantId, 'service_catalog').insert({
      tenant: tenantId,
      service_id: serviceId,
      service_name: `${service.name} ${serviceId.slice(0, 6)}`,
      description: 'per-seat fixture item',
      default_rate: service.rateCents,
      unit_of_measure: 'unit',
      billing_method: 'fixed',
      custom_service_type_id: serviceTypeId,
      tax_rate_id: null,
      category_id: null,
    });
    // Rate resolution reads currency-tagged, effective-dated service_prices.
    const prices = { USD: service.rateCents, ...(service.prices ?? {}) };
    for (const [currencyCode, rate] of Object.entries(prices)) {
      await tenantTable(db, tenantId, 'service_prices').insert({
        tenant: tenantId,
        service_id: serviceId,
        currency_code: currencyCode,
        rate,
        effective_date: '1970-01-01',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
    }
    created.push({ serviceId, name: service.name });
  }
  // Services created after the initial '*' assignment need a tax rate too.
  await assignServiceTaxRate({ db, tenantId } as any, '*', 'US-NY', { onlyUnset: true });
  return created;
}
