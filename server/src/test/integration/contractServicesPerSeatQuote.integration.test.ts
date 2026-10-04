import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import {
  createSeatCatalog,
  createSeatClient,
  ensureFixtureTenant,
  tenantTable,
  type SeatCatalogService,
} from '../../../test-utils/perSeatFixtures';

// Per-seat recurring services through QUOTE -> CONTRACT conversion: a
// recurring catalog service becomes a unit-priced fixed service (quantity =
// quoted quantity, unit rate = quoted unit price).

let db: Knex;
let tenantId: string;
let convertQuoteToDraftContract: typeof import('../../../../packages/billing/src/services/quoteConversionService').convertQuoteToDraftContract;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
let Quote: any;
let QuoteItem: any;

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    // A real transaction, so a rejected submission rolls back like production.
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      (knexOrTrx as Knex).transaction((trx) => callback(trx)),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        { user_id: 'per-seat-test-user', tenant: tenantId, roles: [{ role_name: 'Admin' }] } as any,
        { tenant: tenantId },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  const { withAuth } = await import('@alga-psa/auth/withAuth');
  return { ...createAuthModuleMock(), withAuth };
});

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

const HOOK_TIMEOUT = 180_000;
const JANUARY_START = '2025-01-01';
const FEBRUARY_START = '2025-02-01';

type QuoteSpec = {
  serviceId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
};

async function acceptedQuote(clientId: string, currencyCode: string, specs: QuoteSpec[]) {
  const quote = await Quote.create(db, tenantId, {
    client_id: clientId,
    title: `Seat quote ${uuidv4().slice(0, 6)}`,
    description: 'Per-seat quote',
    quote_date: '2024-12-10T00:00:00.000Z',
    valid_until: '2024-12-25T00:00:00.000Z',
    subtotal: 0,
    discount_total: 0,
    tax: 0,
    total_amount: 0,
    currency_code: currencyCode,
    is_template: false,
  } as any);
  for (const spec of specs) {
    await QuoteItem.create(db, tenantId, {
      quote_id: quote.quote_id,
      service_id: spec.serviceId ?? undefined,
      description: spec.description,
      quantity: spec.quantity,
      unit_price: spec.unitPrice,
      is_optional: false,
      is_selected: true,
      is_recurring: true,
      billing_frequency: 'monthly',
      billing_method: 'fixed',
      is_discount: false,
      is_taxable: false,
    } as any);
  }
  await tenantTable(db, tenantId, 'quotes')
    .where({ tenant: tenantId, quote_id: quote.quote_id })
    .update({ status: 'accepted', accepted_at: '2024-12-15T12:00:00.000Z' });
  return quote.quote_id as string;
}

async function convert(quoteId: string) {
  const result = await db.transaction((trx) => convertQuoteToDraftContract(trx, tenantId, quoteId, null));
  const lines = await tenantTable(db, tenantId, 'contract_lines')
    .where({ tenant: tenantId, contract_id: result.contract.contract_id })
    .orderBy('display_order');
  const configs = await tenantTable(db, tenantId, 'contract_line_service_configuration as c')
    .leftJoin('contract_line_service_fixed_config as f', function join() {
      this.on('f.config_id', 'c.config_id').andOn('f.tenant', 'c.tenant');
    })
    .whereIn('c.contract_line_id', lines.map((line: any) => line.contract_line_id))
    .select('c.contract_line_id', 'c.service_id', 'c.quantity', 'c.custom_rate as config_rate', 'f.base_rate', 'f.pricing_basis', 'f.rate_provenance');
  return { result, lines, configs };
}

describe('quote conversion: per-seat recurring services', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    setupCommonMocks({ tenantId, userId: 'per-seat-test-user', permissionCheck: () => true });
    ({ convertQuoteToDraftContract } = await import('../../../../packages/billing/src/services/quoteConversionService'));
    Quote = (await import('../../../../packages/billing/src/models/quote')).default;
    QuoteItem = (await import('../../../../packages/billing/src/models/quoteItem')).default;
    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('converts recurring services to unit-priced fixed services and bills quantity x unit price', async () => {
    const [user, endpoint, location] = await createSeatCatalog(db, tenantId, [
      { name: 'Managed User', rateCents: 10000 },
      { name: 'Managed Endpoint', rateCents: 5000 },
      { name: 'Managed Location', rateCents: 20000 },
    ]);
    const client = await createSeatClient(db, tenantId);
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);
    // The quoted price, not the catalog price, is the unit rate.
    const quoteId = await acceptedQuote(client.clientId, 'USD', [
      { serviceId: user.serviceId, description: 'Users', quantity: 20, unitPrice: 10000 },
      { serviceId: endpoint.serviceId, description: 'Endpoints', quantity: 30, unitPrice: 5000 },
      { serviceId: location.serviceId, description: 'Locations', quantity: 2, unitPrice: 20000 },
    ]);

    const { result, lines, configs } = await convert(quoteId);

    expect(lines).toHaveLength(3);
    for (const line of lines as any[]) {
      // Per-unit lines carry no bundle total.
      expect(line.custom_rate).toBeNull();
    }
    const byService = new Map(configs.map((row: any) => [row.service_id as string, row]));
    const expected: Array<[typeof user, number, number]> = [
      [user, 20, 10000],
      [endpoint, 30, 5000],
      [location, 2, 20000],
    ];
    for (const [service, quantity, rate] of expected) {
      const row: any = byService.get(service.serviceId);
      expect(row).toMatchObject({ pricing_basis: 'unit', rate_provenance: 'custom' });
      expect(Number(row.quantity)).toBe(quantity);
      expect(Number(row.base_rate)).toBe(rate);
    }

    // Activate the draft (what accepting the draft contract does) and invoice.
    await tenantTable(db, tenantId, 'contracts')
      .where({ tenant: tenantId, contract_id: result.contract.contract_id })
      .update({ status: 'active', is_active: true });
    await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_id: result.contract.contract_id })
      .update({ is_active: true });
    await tenantTable(db, tenantId, 'client_contracts')
      .where({ tenant: tenantId, contract_id: result.contract.contract_id })
      .update({ start_date: '2024-12-01', is_active: true });
    for (const line of lines as any[]) {
      await db.transaction((trx) =>
        syncRecurringServicePeriodsForContractLine(trx, {
          tenant: tenantId,
          contractLineId: line.contract_line_id,
          sourceRunPrefix: 'per-seat-quote-test',
        }),
      );
    }
    const invoice: any = await generateInvoice(januaryCycle);
    expect(invoice).toBeTruthy();
    // 20 x $100 + 30 x $50 + 2 x $200
    expect(Number(invoice.subtotal)).toBe(390000);
  }, HOOK_TIMEOUT);

  it('a quoted quantity of one is still a unit service at the quoted price', async () => {
    const [support] = await createSeatCatalog(db, tenantId, [{ name: 'Support Plan', rateCents: 9900 }]);
    const client = await createSeatClient(db, tenantId);
    const quoteId = await acceptedQuote(client.clientId, 'USD', [
      { serviceId: support.serviceId, description: 'Support', quantity: 1, unitPrice: 12345 },
    ]);
    const { configs } = await convert(quoteId);
    expect(configs[0]).toMatchObject({ pricing_basis: 'unit' });
    expect(Number(configs[0].base_rate)).toBe(12345);
    expect(Number(configs[0].quantity)).toBe(1);
  }, HOOK_TIMEOUT);

  it('keeps bundle pricing for products and custom items', async () => {
    const [service, product] = await createSeatCatalog(db, tenantId, [
      { name: 'Managed Service', rateCents: 5000 },
      { name: 'Router', rateCents: 30000 },
    ]);
    await tenantTable(db, tenantId, 'service_catalog')
      .where({ tenant: tenantId, service_id: product.serviceId })
      .update({ item_kind: 'product', sku: `SKU-${product.serviceId.slice(0, 8)}` });
    const client = await createSeatClient(db, tenantId);
    const quoteId = await acceptedQuote(client.clientId, 'USD', [
      { serviceId: product.serviceId, description: 'Hosted router', quantity: 3, unitPrice: 30000 },
      { serviceId: null, description: 'Custom retainer', quantity: 1, unitPrice: 70000 },
    ]);
    const { lines, configs } = await convert(quoteId);

    const productLine: any = lines.find((line: any) => line.contract_line_name?.includes('router') || line.description === 'Hosted router');
    const customLine: any = lines.find((line: any) => line.description === 'Custom retainer');
    // Exactly what conversion wrote before this change.
    expect(Number(productLine.custom_rate)).toBe(30000);
    expect(Number(customLine.custom_rate)).toBe(70000);
    expect(configs).toHaveLength(1);
    expect(configs[0].pricing_basis ?? 'bundle').toBe('bundle');
    expect(Number(configs[0].base_rate)).toBe(30000);
    expect(service.serviceId).toBeTruthy();
  }, HOOK_TIMEOUT);
});
