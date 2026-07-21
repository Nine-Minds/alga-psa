import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings,
} from '../../../../test-utils/billingTestHelpers';

// P0 journey (docs: journey-first testing pivot): the through-line an MSP
// actually walks — client exists, admin runs the contract wizard with the
// optional fields filled (PO, end date, proration, multiple services), the
// system materializes recurring periods, and the month's invoice generates
// with the wizard's numbers on it. The bricks (wizard writes, invoice timing)
// are covered elsewhere; this asserts the seams between them.

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;

function tenantTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, tenant).table<Row>(tableExpression);
}

function tenantRows(connection: Knex): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  return tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

function dateOnly(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return null;
}

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: 'journey-test-user',
          tenant: tenantId,
          roles: [{ role_name: 'Admin' }],
        } as any,
        { tenant: tenantId },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

const HOOK_TIMEOUT = 180_000;

const DECEMBER_START = '2024-12-01';
const JANUARY_START = '2025-01-01';
const FEBRUARY_START = '2025-02-01';
const DECEMBER_END = Temporal.PlainDate.from(JANUARY_START).subtract({ days: 1 }).toString();

describe('journey: contract wizard → monthly invoice', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureTenant(db);
    setupCommonMocks({ tenantId, userId: 'journey-test-user', permissionCheck: () => true });
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('bills the wizard-authored contract (PO, proration, end date, two services) on the next monthly invoice', async () => {
    // --- a client with billing cycles, tax config, and a billing address ---
    const clientId = uuidv4();
    await tenantTable(db, tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Journey MSP Client ${clientId.slice(0, 8)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    await tenantTable(db, tenantId, 'client_locations').insert({
      location_id: uuidv4(),
      tenant: tenantId,
      client_id: clientId,
      location_name: 'Billing',
      address_line1: '1 Journey Way',
      city: 'Testville',
      state_province: 'NY',
      postal_code: '10001',
      country_code: 'US',
      country_name: 'United States',
      email: `${clientId.slice(0, 8)}@journey.test`,
      is_default: true,
      is_billing_address: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const contextLike = { db, tenantId, clientId } as const;
    await ensureDefaultBillingSettings(contextLike as any);
    await ensureClientPlanBundlesTable(contextLike as any);
    await setupClientTaxConfiguration(contextLike as any, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'New York Tax',
      startDate: '2024-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });

    const januaryCycleId = uuidv4();
    await tenantTable(db, tenantId, 'client_billing_cycles').insert({
      billing_cycle_id: januaryCycleId,
      tenant: tenantId,
      client_id: clientId,
      billing_cycle: 'monthly',
      effective_date: `${JANUARY_START}T00:00:00Z`,
      period_start_date: `${JANUARY_START}T00:00:00Z`,
      period_end_date: `${FEBRUARY_START}T00:00:00Z`,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // --- a small service catalog, as settings UI would have built it ---
    const serviceTypeId = uuidv4();
    await tenantTable(db, tenantId, 'service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: `Managed Services ${serviceTypeId.slice(0, 8)}`,
      order_number: Math.floor(Math.random() * 1000000),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const makeService = async (name: string, rateCents: number) => {
      const serviceId = uuidv4();
      await tenantTable(db, tenantId, 'service_catalog').insert({
        tenant: tenantId,
        service_id: serviceId,
        service_name: name,
        description: 'journey catalog item',
        default_rate: rateCents,
        unit_of_measure: 'month',
        billing_method: 'fixed',
        custom_service_type_id: serviceTypeId,
        tax_rate_id: null,
        category_id: null
      });
      return serviceId;
    };
    const monitoringServiceId = await makeService('Journey Monitoring', 15000);
    const backupServiceId = await makeService('Journey Backup', 5000);
    // The services were created after the initial '*' assignment — pick them up.
    await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });

    // --- the wizard, optional fields filled ---
    const BASE_RATE_CENTS = 25000;
    const wizardResult = await createClientContractFromWizard({
      contract_name: 'Journey Managed Services',
      description: 'wizard journey with optional fields filled',
      client_id: clientId,
      // Fixed lines bill arrears by default: December's service period lands
      // on the January cycle's invoice window.
      start_date: DECEMBER_START,
      end_date: '2025-06-30',
      billing_frequency: 'monthly',
      enable_proration: true,
      fixed_base_rate: BASE_RATE_CENTS,
      fixed_services: [
        { service_id: monitoringServiceId, quantity: 1 },
        { service_id: backupServiceId, quantity: 2 }
      ],
      hourly_services: [],
      usage_services: [],
      po_required: true,
      po_number: 'PO-JOURNEY-001',
      po_amount: 300000
    });

    expect(wizardResult.contract_id).toBeDefined();
    expect(wizardResult.contract_line_id).toBeDefined();

    // Seam 1: the assignment the wizard created is active and carries the PO.
    const assignment = await tenantTable(db, tenantId, 'client_contracts')
      .where({ tenant: tenantId, client_id: clientId, contract_id: wizardResult.contract_id })
      .first();
    expect(assignment).toBeTruthy();
    expect(assignment?.is_active).toBe(true);
    expect(assignment?.po_required).toBe(true);
    expect(assignment?.po_number).toBe('PO-JOURNEY-001');
    expect(Number(assignment?.po_amount)).toBe(300000);

    // Seam 2: recurring periods materialize for the wizard's line (production
    // runs this sync from the contract actions after line changes).
    await db.transaction(async (trx) => {
      await syncRecurringServicePeriodsForContractLine(trx, {
        tenant: tenantId,
        contractLineId: wizardResult.contract_line_id!,
        sourceRunPrefix: 'journey-test',
      });
    });

    // Seam 3: the January invoice picks the wizard's line up.
    const invoice = await generateInvoice(januaryCycleId);
    expect(invoice).toBeTruthy();
    expect(invoice?.invoice_id).toBeDefined();

    expect(Number(invoice?.subtotal)).toBe(BASE_RATE_CENTS);
    expect(Number(invoice?.tax)).toBeGreaterThan(0);
    expect(Number(invoice?.total_amount)).toBe(Number(invoice?.subtotal) + Number(invoice?.tax));

    const charges = await tenantTable(db, tenantId, 'invoice_charges')
      .where({ tenant: tenantId, invoice_id: invoice!.invoice_id });
    expect(charges.length).toBeGreaterThan(0);
    const chargeTotal = charges.reduce((sum, row) => sum + Number(row.net_amount ?? row.total_price ?? 0), 0);
    expect(chargeTotal).toBe(BASE_RATE_CENTS);

    // Detail rows carry the service period the money is for — the arrears
    // month the wizard's line started in, not some default window.
    const detailRows = await tenantDb(db, tenantId)
      .tenantJoin(
        tenantTable(db, tenantId, 'invoice_charge_details as iid'),
        'invoice_charges as ii',
        'iid.item_id',
        'ii.item_id'
      )
      .where('ii.invoice_id', invoice!.invoice_id)
      .andWhere('iid.tenant', tenantId)
      .select(['iid.service_id', 'iid.service_period_start', 'iid.service_period_end']);
    expect(detailRows.length).toBeGreaterThan(0);
    const serviceIds = detailRows.map((row) => row.service_id);
    expect(serviceIds).toContain(monitoringServiceId);
    expect(serviceIds).toContain(backupServiceId);
    for (const row of detailRows) {
      expect(dateOnly(row.service_period_start)).toBe(DECEMBER_START);
      expect(dateOnly(row.service_period_end)).toBe(DECEMBER_END);
    }
  }, HOOK_TIMEOUT);
});

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantRows(connection).first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }
  const newTenantId = uuidv4();
  await tenantRows(connection).insert({
    tenant: newTenantId,
    client_name: 'Journey Integration Tenant',
    email: 'journeys@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}
