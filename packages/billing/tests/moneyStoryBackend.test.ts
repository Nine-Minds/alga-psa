/**
 * S5 money-story backend tests against the real local `server` DB.
 * Every test runs inside a transaction that is ALWAYS rolled back.
 *
 * Run: (cd packages/billing && npx vitest run src/actions/moneyStoryBackend.test.ts)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import knexLib, { Knex } from 'knex';

let mockedTenant: string | null = null;
let mockedKnex: Knex.Transaction | null = null;

// The actions module under test imports the auth stack; stub it so vitest never
// resolves next-auth (the tests call the *ForTenant cores directly).
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => {
    if (!mockedKnex || !mockedTenant) {
      throw new Error('mocked tenant DB context not initialized');
    }
    return { knex: mockedKnex, tenant: mockedTenant };
  }),
  withTransaction: vi.fn(async (knex: Knex.Transaction, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
    callback(knex),
  ),
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<unknown>) => callback()),
}));

const qboQuery = vi.fn();
const qboCreate = vi.fn();
const qboRead = vi.fn();
const qboUpdate = vi.fn();
const qboClient = {
  query: qboQuery,
  create: qboCreate,
  read: qboRead,
  update: qboUpdate,
  fetchChanges: vi.fn(),
};

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: {
    create: vi.fn(async () => qboClient),
  },
  getDefaultQboRealmId: vi.fn(async () => 'realm-money-story'),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
}));

import { getInvoiceLineCogsForTenant } from '../src/actions/invoiceCogsActions';
import { contractProfitabilityReport } from '@alga-psa/reporting/lib/reports/definitions/contracts/profitability';
import { QueryBuilder } from '@alga-psa/reporting/lib/reports/builders/QueryBuilder';
import { AccountingExportService } from '../src/services/accountingExportService';
import { AccountingExportRepository } from '../src/repositories/accountingExportRepository';
import { AccountingAdapterRegistry } from '../src/adapters/accounting/registry';
import { QuickBooksOnlineAdapter } from '../src/adapters/accounting/quickBooksOnlineAdapter';

function readEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, '../../../server/.env.local');
  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

let knex: Knex;
let trx: Knex.Transaction;
let TENANT: string;
let CLIENT: string;
let USER: string | null;
let SERVICE_A: string;
let SERVICE_B: string;
let TICKET: string;

beforeAll(async () => {
  const env = readEnv();
  knex = knexLib({
    client: 'pg',
    connection: {
      host: 'localhost',
      port: 5432,
      user: env.DB_USER_ADMIN,
      password: env.DB_PASSWORD_ADMIN,
      database: 'server',
    },
    pool: { min: 1, max: 4 },
  });

  TENANT = (await knex('tenants').select('tenant').first()).tenant;
  const ticket = await knex('tickets')
    .where({ tenant: TENANT })
    .whereNotNull('client_id')
    .select('ticket_id', 'client_id')
    .first();
  if (!ticket) {
    throw new Error('money-story tests require a seeded ticket with client_id');
  }
  TICKET = ticket.ticket_id;
  CLIENT = ticket.client_id;
  USER = (await knex('users').where({ tenant: TENANT }).select('user_id').first())?.user_id ?? null;

  const services = await knex('service_catalog')
    .where({ tenant: TENANT })
    .orderBy('service_id')
    .limit(2)
    .select('service_id');
  if (services.length < 2) {
    throw new Error('money-story tests require at least two seeded services');
  }
  SERVICE_A = services[0].service_id;
  SERVICE_B = services[1].service_id;
});

beforeEach(async () => {
  trx = await knex.transaction();
  mockedTenant = TENANT;
  mockedKnex = trx;
  qboQuery.mockReset();
  qboCreate.mockReset();
  qboRead.mockReset();
  qboUpdate.mockReset();
});

afterEach(async () => {
  mockedTenant = null;
  mockedKnex = null;
  await trx.rollback();
});

afterAll(async () => {
  await knex?.destroy();
});

async function insertFiltered(table: string, data: Record<string, unknown>): Promise<void> {
  const info = await trx(table).columnInfo();
  const filtered = Object.fromEntries(Object.entries(data).filter(([key]) => key in info));
  await trx(table).insert(filtered);
}

async function setAccountingSyncSettings(settings: Record<string, unknown>): Promise<void> {
  const existing = await trx('tenant_settings').where({ tenant: TENANT }).select('settings').first();
  const nextSettings = {
    ...(existing?.settings ?? {}),
    accountingSync: {
      ...((existing?.settings as any)?.accountingSync ?? {}),
      ...settings,
    },
  };
  if (existing) {
    await trx('tenant_settings').where({ tenant: TENANT }).update({ settings: nextSettings });
  } else {
    await insertFiltered('tenant_settings', { tenant: TENANT, settings: nextSettings });
  }
}

async function createInvoice(params: {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  clientContractId?: string | null;
}): Promise<void> {
  await insertFiltered('invoices', {
    tenant: TENANT,
    invoice_id: params.invoiceId,
    client_id: CLIENT,
    company_id: CLIENT,
    invoice_number: params.invoiceNumber,
    invoice_date: params.invoiceDate,
    due_date: params.invoiceDate,
    total_amount: params.totalAmount,
    subtotal: params.totalAmount,
    tax: 0,
    credit_applied: 0,
    status: 'open',
    currency_code: 'USD',
    is_manual: true,
    tax_source: 'internal',
    client_contract_id: params.clientContractId ?? null,
  });
}

async function createInvoiceCharge(params: {
  itemId: string;
  invoiceId: string;
  serviceId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  netAmount: number;
  soLineId?: string | null;
}): Promise<void> {
  await insertFiltered('invoice_charges', {
    tenant: TENANT,
    item_id: params.itemId,
    invoice_id: params.invoiceId,
    service_id: params.serviceId,
    description: params.description,
    quantity: params.quantity,
    unit_price: params.unitPrice,
    net_amount: params.netAmount,
    tax_amount: 0,
    tax_rate: 0,
    total_price: params.netAmount,
    is_manual: false,
    is_discount: false,
    is_taxable: false,
    so_line_id: params.soLineId ?? null,
    created_by: USER,
  });
}

async function seedTicketMaterialInvoice(params: {
  invoiceId: string;
  materialId: string;
  itemId: string;
  serviceId: string;
  description: string;
  quantity: number;
  rate: number;
  cogsCost: number;
  createdAt: string;
}): Promise<void> {
  await insertFiltered('ticket_materials', {
    tenant: TENANT,
    ticket_material_id: params.materialId,
    ticket_id: TICKET,
    client_id: CLIENT,
    service_id: params.serviceId,
    quantity: params.quantity,
    rate: params.rate,
    currency_code: 'USD',
    description: params.description,
    is_billed: true,
    billed_invoice_id: params.invoiceId,
    billed_at: params.createdAt,
    created_at: params.createdAt,
  });
  await insertFiltered('stock_movements', {
    tenant: TENANT,
    movement_id: randomUUID(),
    movement_type: 'consume',
    service_id: params.serviceId,
    quantity: params.quantity,
    cogs_cost: params.cogsCost,
    source_doc_type: 'ticket_material',
    source_doc_id: params.materialId,
    performed_by: USER,
    created_at: params.createdAt,
  });
  await createInvoiceCharge({
    itemId: params.itemId,
    invoiceId: params.invoiceId,
    serviceId: params.serviceId,
    description: `Product: ${params.description}`,
    quantity: params.quantity,
    unitPrice: params.rate,
    netAmount: params.quantity * params.rate,
  });
}

describe('S5 money story backend', () => {
  it('T015: getInvoiceLineCogs returns SO COGS, material COGS, and nulls for lines without COGS', async () => {
    const label = randomUUID().slice(0, 8);
    const invoiceId = randomUUID();
    const soId = randomUUID();
    const soLineId = randomUUID();
    const soItemId = randomUUID();
    const materialItemId = randomUUID();
    const noCogsItemId = randomUUID();
    const materialId = randomUUID();
    const createdAt = '2036-02-03T00:00:00.000Z';

    await createInvoice({
      invoiceId,
      invoiceNumber: `INV-S5-${label}`,
      invoiceDate: createdAt,
      totalAmount: 31_234,
    });
    await insertFiltered('sales_orders', {
      tenant: TENANT,
      so_id: soId,
      so_number: `SO-S5-${label}`,
      client_id: CLIENT,
      status: 'fulfilled',
      order_date: createdAt,
      currency_code: 'USD',
      invoice_mode: 'on_fulfillment',
      allocation_mode: 'soft',
      created_by: USER,
    });
    await insertFiltered('sales_order_lines', {
      tenant: TENANT,
      so_line_id: soLineId,
      so_id: soId,
      service_id: SERVICE_A,
      quantity_ordered: 1,
      quantity_fulfilled: 1,
      quantity_invoiced: 1,
      unit_price: 20_000,
      fulfillment_type: 'from_stock',
    });
    await insertFiltered('stock_movements', {
      tenant: TENANT,
      movement_id: randomUUID(),
      movement_type: 'consume',
      service_id: SERVICE_A,
      quantity: 1,
      cogs_cost: 7_000,
      source_doc_type: 'sales_order',
      source_doc_id: soId,
      performed_by: USER,
      created_at: createdAt,
    });
    await createInvoiceCharge({
      itemId: soItemId,
      invoiceId,
      serviceId: SERVICE_A,
      description: 'SO hardware',
      quantity: 1,
      unitPrice: 20_000,
      netAmount: 20_000,
      soLineId,
    });
    await seedTicketMaterialInvoice({
      invoiceId,
      materialId,
      itemId: materialItemId,
      serviceId: SERVICE_B,
      description: `Material ${label}`,
      quantity: 2,
      rate: 5_000,
      cogsCost: 6_000,
      createdAt,
    });
    await createInvoiceCharge({
      itemId: noCogsItemId,
      invoiceId,
      serviceId: SERVICE_A,
      description: 'No COGS line',
      quantity: 1,
      unitPrice: 1_234,
      netAmount: 1_234,
    });

    const rows = await getInvoiceLineCogsForTenant(trx, TENANT, invoiceId);
    const byItem = new Map(rows.map((row) => [row.item_id, row]));

    expect(byItem.get(soItemId)).toMatchObject({
      so_id: soId,
      so_number: `SO-S5-${label}`,
      so_line_id: soLineId,
      cogs_total: 7_000,
      line_amount: 20_000,
    });
    expect(byItem.get(soItemId)?.margin_ratio).toBeCloseTo(0.65);
    expect(byItem.get(materialItemId)).toMatchObject({
      cogs_total: 6_000,
      line_amount: 10_000,
    });
    expect(byItem.get(materialItemId)?.margin_ratio).toBeCloseTo(0.4);
    expect(byItem.get(noCogsItemId)).toMatchObject({
      cogs_total: null,
      margin_ratio: null,
    });
  });

  it('T016: contract profitability hardware COGS metric includes material COGS and labor-only periods stay unchanged', async () => {
    const label = randomUUID().slice(0, 8);
    const hardwareInvoiceId = randomUUID();
    const laborOnlyInvoiceId = randomUUID();
    const hardwareDate = '2037-03-04T00:00:00.000Z';
    const laborOnlyDate = '2038-03-04T00:00:00.000Z';

    await createInvoice({
      invoiceId: hardwareInvoiceId,
      invoiceNumber: `INV-HW-${label}`,
      invoiceDate: hardwareDate,
      totalAmount: 10_000,
    });
    await seedTicketMaterialInvoice({
      invoiceId: hardwareInvoiceId,
      materialId: randomUUID(),
      itemId: randomUUID(),
      serviceId: SERVICE_B,
      description: `Profitability material ${label}`,
      quantity: 1,
      rate: 10_000,
      cogsCost: 4_321,
      createdAt: hardwareDate,
    });
    await createInvoice({
      invoiceId: laborOnlyInvoiceId,
      invoiceNumber: `INV-LABOR-${label}`,
      invoiceDate: laborOnlyDate,
      totalAmount: 10_000,
    });

    const hardwareMetric = contractProfitabilityReport.metrics.find((metric) => metric.id === 'ytd_total_hardware_cogs');
    const profitMetric = contractProfitabilityReport.metrics.find((metric) => metric.id === 'ytd_gross_profit');
    expect(hardwareMetric).toBeDefined();
    expect(profitMetric).toBeDefined();

    const hardwareResult = await QueryBuilder.build(trx, hardwareMetric!.query, {
      tenant: TENANT,
      start_of_year: '2037-01-01T00:00:00.000Z',
      end_of_year: '2038-01-01T00:00:00.000Z',
    } as any);
    const hardwareRows = Array.isArray(hardwareResult) ? hardwareResult : hardwareResult.rows;
    expect(Number(hardwareRows[0].sum)).toBe(4_321);

    const hardwareProfitResult = await QueryBuilder.build(trx, profitMetric!.query, {
      tenant: TENANT,
      start_of_year: '2037-01-01T00:00:00.000Z',
      end_of_year: '2038-01-01T00:00:00.000Z',
    } as any);
    const hardwareProfitRows = Array.isArray(hardwareProfitResult) ? hardwareProfitResult : hardwareProfitResult.rows;
    expect(Math.round(Number(hardwareProfitRows[0].sum))).toBe(5_679);

    const laborOnlyProfitResult = await QueryBuilder.build(trx, profitMetric!.query, {
      tenant: TENANT,
      start_of_year: '2038-01-01T00:00:00.000Z',
      end_of_year: '2039-01-01T00:00:00.000Z',
    } as any);
    const laborOnlyProfitRows = Array.isArray(laborOnlyProfitResult) ? laborOnlyProfitResult : laborOnlyProfitResult.rows;
    expect(Math.round(Number(laborOnlyProfitRows[0].sum))).toBe(10_000);
  });

  it('T017: vendor_bill export builds a QBO Bill payload, records line status, and is mapping-idempotent', async () => {
    const label = randomUUID().slice(0, 8);
    const vendorId = randomUUID();
    const billId = randomUUID();
    const billLineId = randomUUID();
    const vendorName = `Vendor S5 ${label}`;
    const billNumber = `VB-S5-${label}`;

    qboQuery.mockResolvedValue([]);
    qboCreate.mockImplementation(async (entityType: string, payload: any) => {
      if (entityType === 'Vendor') {
        return { Id: 'qbo-vendor-1', DisplayName: payload.DisplayName };
      }
      if (entityType === 'Bill') {
        return { Id: 'qbo-bill-1', SyncToken: '0', DocNumber: payload.DocNumber, TotalAmt: 125 };
      }
      throw new Error(`Unexpected QBO create ${entityType}`);
    });

    await setAccountingSyncSettings({
      defaultExpenseAccountRef: { value: 'expense-1', name: 'Hardware Expense' },
    });
    await insertFiltered('vendors', {
      tenant: TENANT,
      vendor_id: vendorId,
      vendor_name: vendorName,
      is_active: true,
    });
    await insertFiltered('vendor_bills', {
      tenant: TENANT,
      bill_id: billId,
      vendor_id: vendorId,
      bill_number: billNumber,
      bill_date: '2039-04-05T00:00:00.000Z',
      due_date: '2039-05-05T00:00:00.000Z',
      currency_code: 'USD',
      status: 'open',
      total_amount: 12_500,
    });
    await insertFiltered('vendor_bill_lines', {
      tenant: TENANT,
      bill_line_id: billLineId,
      bill_id: billId,
      service_id: SERVICE_A,
      description: `Bill line ${label}`,
      quantity: 1,
      unit_cost: 12_500,
      amount: 12_500,
    });

    const service = new AccountingExportService(
      new AccountingExportRepository(trx, TENANT),
      new AccountingAdapterRegistry([await QuickBooksOnlineAdapter.create()]),
    );
    const batch = await service.createBatch({
      adapter_type: 'quickbooks_online',
      target_realm: 'realm-money-story',
      export_type: 'vendor_bill',
      filters: { billIds: [billId] },
      origin: 'manual',
    });
    await service.appendLines(batch.batch_id, {
      lines: [{
        batch_id: batch.batch_id,
        document_id: billId,
        document_line_id: null,
        client_id: null,
        amount_cents: 12_500,
        currency_code: 'USD',
      }],
    });

    await service.executeBatch(batch.batch_id);

    expect(qboQuery).toHaveBeenCalledWith(`SELECT Id, DisplayName FROM Vendor WHERE DisplayName = '${vendorName}'`);
    expect(qboCreate).toHaveBeenCalledWith('Vendor', { DisplayName: vendorName });
    const billCall = qboCreate.mock.calls.find(([entityType]) => entityType === 'Bill');
    expect(billCall).toBeDefined();
    const billPayload = billCall?.[1];
    expect(billPayload).toMatchObject({
      DocNumber: billNumber,
      TxnDate: '2039-04-05',
      DueDate: '2039-05-05',
      VendorRef: { value: 'qbo-vendor-1', name: vendorName },
      CurrencyRef: { value: 'USD' },
    });
    expect(billPayload.Line[0]).toMatchObject({
      Amount: 125,
      DetailType: 'AccountBasedExpenseLineDetail',
      Description: `Bill line ${label}`,
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: 'expense-1', name: 'Hardware Expense' },
      },
    });

    const line = await trx('accounting_export_lines')
      .where({ tenant: TENANT, batch_id: batch.batch_id, document_id: billId })
      .first();
    expect(line.status).toBe('delivered');
    expect(line.external_document_ref).toBe('qbo-bill-1');

    const mapping = await trx('tenant_external_entity_mappings')
      .where({
        tenant: TENANT,
        integration_type: 'quickbooks_online',
        alga_entity_type: 'vendor_bill',
        alga_entity_id: billId,
      })
      .first();
    expect(mapping.external_entity_id).toBe('qbo-bill-1');

    qboCreate.mockClear();
    const secondBatch = await service.createBatch({
      adapter_type: 'quickbooks_online',
      target_realm: 'realm-money-story',
      export_type: 'vendor_bill',
      filters: { billIds: [billId], attempt: 'idempotent' },
      origin: 'manual',
    });
    await service.appendLines(secondBatch.batch_id, {
      lines: [{
        batch_id: secondBatch.batch_id,
        document_id: billId,
        document_line_id: null,
        client_id: null,
        amount_cents: 12_500,
        currency_code: 'USD',
      }],
    });
    await service.executeBatch(secondBatch.batch_id);

    expect(qboCreate).not.toHaveBeenCalled();
    const secondLine = await trx('accounting_export_lines')
      .where({ tenant: TENANT, batch_id: secondBatch.batch_id, document_id: billId })
      .first();
    expect(secondLine.status).toBe('delivered');
    expect(secondLine.external_document_ref).toBe('qbo-bill-1');
  });
});
