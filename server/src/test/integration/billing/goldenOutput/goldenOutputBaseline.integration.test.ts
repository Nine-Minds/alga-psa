import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  createTestService,
  createFixedPlanAssignment,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings,
  unwrapInvoiceResult,
} from '../../../../../test-utils/billingTestHelpers';
import { AccountingExportInvoiceSelector } from '@alga-psa/billing/services';

// F128 / T013 — golden-output baseline harness (plan §4.1 step 0, §6.1).
//
// Captures a deterministic golden snapshot of the money-relevant output of the
// existing billing integration scenario for a single-profile client — invoice
// totals, per-line amounts, tax figures, credit application, the accounting
// export preview (including the customer/invoice identity fields the export
// maps: invoice number, client id, client name), and the portal-visible
// output (the invoice list the client portal renders via
// fetchInvoicesByClient, and the full rendering view model portal detail/PDF
// views hydrate via getInvoiceForRendering) — and diffs every later run
// against it byte-for-byte. A diff is a defect (T013), never a baseline to
// refresh; see the README in this directory and SCRATCHPAD.
//
// Modes:
//   GOLDEN_CAPTURE=1  write the committed baseline fixture(s) and pass.
//   default           run the scenario, serialize, and compare byte-for-byte
//                     against the committed fixture(s); fail with a diff on
//                     mismatch (also writing *.actual.json for inspection).
//
// Determinism: every seeded entity uses a fixed UUID and fixed dates; the
// scenario is driven through the real engine (`generateInvoice`,
// `finalizeInvoice`, prepayment credit, export preview). The serialized
// projection contains only deterministic money/structure values — generated
// UUIDs and `now()` timestamps are excluded, not pinned — so any amount, tax,
// credit, or export change surfaces as a byte diff.
//
// Schema-agnostic single-profile state: the fixture client represents "a client
// with exactly one billing profile". When the S1 schema exists (post-S1 runs),
// the harness inserts the one system-managed default profile for the client,
// mirroring the S1 backfill; on the pre-S1 tree the table does not exist and
// the insert is skipped. The profile row is not part of the serialized output,
// so the pre-S1 baseline and the post-S1 run must serialize byte-identically —
// which is exactly what T013 proves for S1 (the backfill alone perturbs
// nothing).

let db: Knex;
let tenantId: string;
let clientId: string;
let invoiceId: string;

let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let finalizeInvoice: typeof import('@alga-psa/billing/actions/invoiceModification').finalizeInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
let createPrepaymentInvoice: typeof import('@alga-psa/billing/actions/creditActions').createPrepaymentInvoice;
let fetchInvoicesByClient: typeof import('@alga-psa/billing/actions/invoiceQueries').fetchInvoicesByClient;
let getInvoiceForRendering: typeof import('@alga-psa/billing/actions/invoiceQueries').getInvoiceForRendering;

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

async function createFixedTenant(connection: Knex, fixedTenant: string): Promise<void> {
  const existing = await tenantRows(connection).where({ tenant: fixedTenant }).first();
  if (existing) return;
  await tenantRows(connection).insert({
    tenant: fixedTenant,
    client_name: 'Golden Baseline Tenant',
    email: 'golden-baseline@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
}

// When the S1 `client_billing_profiles` table exists, give the fixture client
// exactly one system-managed default profile (the state the S1 backfill leaves
// every client in). No-op on the pre-S1 schema where the table is absent.
async function ensureSingleDefaultProfile(connection: Knex, tenant: string, client: string): Promise<void> {
  const hasTable = await connection.schema.hasTable('client_billing_profiles');
  if (!hasTable) return;

  const existing = await tenantDb(connection, tenant)
    .table('client_billing_profiles')
    .where({ tenant, client_id: client })
    .first();
  if (existing) return;

  await tenantDb(connection, tenant).table('client_billing_profiles').insert({
    tenant,
    billing_profile_id: 'aaaaaaa0-0000-4000-8000-00000000000b',
    client_id: client,
    name: 'Golden Single-Profile Client',
    is_default: true,
    is_system_managed_default: true,
    is_active: true,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
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
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: 'golden-harness-user',
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

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

const HOOK_TIMEOUT = 180_000;

const DECEMBER_START = '2024-12-01';
const JANUARY_START = '2025-01-01';
const FEBRUARY_START = '2025-02-01';

const BASE_RATE_CENTS = 25000;
const PREPAYMENT_CENTS = 5000;

const FIXED_TENANT = 'aaaaaaa0-0000-4000-8000-000000000001';
const FIXED_CLIENT = 'aaaaaaa0-0000-4000-8000-000000000002';
const FIXED_LOCATION = 'aaaaaaa0-0000-4000-8000-000000000003';
const FIXED_SERVICE = 'aaaaaaa0-0000-4000-8000-000000000004';
const FIXED_CYCLE = 'aaaaaaa0-0000-4000-8000-000000000006';
const FIXED_CONTRACT = 'aaaaaaa0-0000-4000-8000-000000000007';
const FIXED_CONTRACT_LINE = 'aaaaaaa0-0000-4000-8000-000000000008';
const FIXED_CLIENT_CONTRACT = 'aaaaaaa0-0000-4000-8000-000000000009';
const FIXED_CLIENT_LINE = 'aaaaaaa0-0000-4000-8000-00000000000a';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(__dirname, 'baseline.json');

const toDateOnly = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

const toMoney = (value: unknown): number => Number(value ?? 0);

const sortBy = <T>(rows: T[], key: (row: T) => string): T[] =>
  [...rows].sort((a, b) => key(a).localeCompare(key(b), 'en'));

describe('T013 gate — F128 golden-output baseline (single-profile client)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    // Drops + recreates test_database, migrates, seeds — every run starts from
    // the identical schema and seed state (same recipe as the journeys).
    db = await createTestDbConnection();
    // Use a dedicated fixed tenant: the dev seeds create invoices for the
    // seeded tenant, which would advance its invoice-number sequence and make
    // the serialized output nondeterministic run-to-run.
    await createFixedTenant(db, FIXED_TENANT);
    tenantId = FIXED_TENANT;
    setupCommonMocks({ tenantId, userId: 'golden-harness-user', permissionCheck: () => true });

    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ finalizeInvoice } = await import('@alga-psa/billing/actions/invoiceModification'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
    ({ createPrepaymentInvoice } = await import('@alga-psa/billing/actions/creditActions'));
    ({ fetchInvoicesByClient, getInvoiceForRendering } = await import('@alga-psa/billing/actions/invoiceQueries'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('runs the single-profile billing scenario and diffs its golden output against the committed baseline', async () => {
    clientId = await seedScenario();

    const actualBytes = JSON.stringify(await buildGoldenSnapshot(), null, 2) + '\n';

    if (process.env.GOLDEN_CAPTURE === '1') {
      fs.writeFileSync(BASELINE_PATH, actualBytes);
      console.info(`[goldenOutputBaseline] wrote baseline fixture: ${BASELINE_PATH}`);
      return;
    }

    const committed = fs.readFileSync(BASELINE_PATH, 'utf8');
    if (committed !== actualBytes) {
      fs.writeFileSync(path.join(__dirname, 'baseline.actual.json'), actualBytes);
      expect(actualBytes, 'T013 golden-output diff — see baseline.actual.json').toBe(committed);
    }
    expect(actualBytes).toBe(committed);
  }, HOOK_TIMEOUT);
});

async function seedScenario(): Promise<string> {
  clientId = FIXED_CLIENT;
  const contextLike = { db, tenantId, clientId } as const;

  await tenantTable(db, tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: FIXED_CLIENT,
    client_name: 'Golden Single-Profile Client',
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await ensureSingleDefaultProfile(db, tenantId, FIXED_CLIENT);
  await tenantTable(db, tenantId, 'client_locations').insert({
    location_id: FIXED_LOCATION,
    tenant: tenantId,
    client_id: FIXED_CLIENT,
    location_name: 'Billing',
    address_line1: '1 Golden Way',
    city: 'Testville',
    state_province: 'NY',
    postal_code: '10001',
    country_code: 'US',
    country_name: 'United States',
    email: 'billing@golden.test',
    is_default: true,
    is_billing_address: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await ensureDefaultBillingSettings(contextLike as any);
  await ensureClientPlanBundlesTable(contextLike as any);
  await setupClientTaxConfiguration(contextLike as any, {
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'New York Tax',
    startDate: '2024-01-01T00:00:00.000Z',
    taxPercentage: 8.875,
  });

  const monitoringServiceId = await createTestService(contextLike as any, {
    service_id: FIXED_SERVICE,
    service_name: 'Golden Monitoring',
    billing_method: 'fixed',
    default_rate: 15000,
    unit_of_measure: 'month',
    tax_region: 'US-NY',
  });
  await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });

  const januaryCycleId = FIXED_CYCLE;
  await tenantTable(db, tenantId, 'client_billing_cycles').insert({
    billing_cycle_id: januaryCycleId,
    tenant: tenantId,
    client_id: FIXED_CLIENT,
    billing_cycle: 'monthly',
    effective_date: `${JANUARY_START}T00:00:00Z`,
    period_start_date: `${JANUARY_START}T00:00:00Z`,
    period_end_date: `${FEBRUARY_START}T00:00:00Z`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  const line = await createFixedPlanAssignment(contextLike as any, monitoringServiceId, {
    planId: FIXED_CONTRACT_LINE,
    clientBillingPlanId: FIXED_CLIENT_LINE,
    contractId: FIXED_CONTRACT,
    clientContractId: FIXED_CLIENT_CONTRACT,
    planName: 'Golden Support Plan',
    billingFrequency: 'monthly',
    baseRateCents: BASE_RATE_CENTS,
    startDate: DECEMBER_START,
    endDate: null,
    billingTiming: 'arrears',
    clientId: FIXED_CLIENT,
    enableProration: false,
  });

  await db.transaction(async (trx) => {
    await syncRecurringServicePeriodsForContractLine(trx, {
      tenant: tenantId,
      contractLineId: line.contractLineId,
      sourceRunPrefix: 'golden-baseline',
    });
  });

  // Credit is created first (a finalized prepayment issues credit_tracking),
  // so finalizing the generated invoice auto-applies it (invoiceModification).
  const prepayment = await createPrepaymentInvoice(FIXED_CLIENT, PREPAYMENT_CENTS);
  const prepaymentId = (prepayment as { invoice_id?: string }).invoice_id ?? (prepayment as any).invoice?.invoice_id;
  if (!prepaymentId) {
    throw new Error('createPrepaymentInvoice returned no prepayment invoice id');
  }
  await finalizeInvoice(prepaymentId);

  const generated = unwrapInvoiceResult<{ invoice_id: string }>(await generateInvoice(januaryCycleId));
  invoiceId = generated.invoice_id;
  const finalized = await finalizeInvoice(invoiceId);
  expect(finalized, JSON.stringify(finalized)).toEqual({ success: true });

  return FIXED_CLIENT;
}

async function buildGoldenSnapshot(): Promise<Record<string, unknown>> {
  const invoice = await tenantTable(db, tenantId, 'invoices')
    .where({ invoice_id: invoiceId, tenant: tenantId })
    .first();
  if (!invoice) throw new Error(`invoice ${invoiceId} not found`);

  const charges = await tenantTable(db, tenantId, 'invoice_charges')
    .where({ invoice_id: invoiceId, tenant: tenantId });
  const detailRows = await tenantDb(db, tenantId)
    .tenantJoin(
      tenantTable(db, tenantId, 'invoice_charge_details as iid'),
      'invoice_charges as ii',
      'iid.item_id',
      'ii.item_id'
    )
    .where('ii.invoice_id', invoiceId)
    .andWhere('iid.tenant', tenantId)
    .select(['iid.item_id', 'iid.service_period_start', 'iid.service_period_end']);
  const detailByItem = new Map(
    detailRows.map((row) => [
      String(row.item_id),
      { start: toDateOnly(row.service_period_start), end: toDateOnly(row.service_period_end) },
    ])
  );

  const chargeLines = sortBy(charges, (row) => String(row.description)).map((row) => ({
    description: String(row.description),
    quantity: String(row.quantity),
    unit_price: toMoney(row.unit_price),
    total_price: toMoney(row.total_price),
    net_amount: toMoney(row.net_amount),
    tax_amount: toMoney(row.tax_amount),
    tax_rate: String(row.tax_rate),
    tax_region: row.tax_region ?? null,
    service_period_start: detailByItem.get(String(row.item_id))?.start ?? null,
    service_period_end: detailByItem.get(String(row.item_id))?.end ?? null,
  }));

  const creditTracking = await tenantTable(db, tenantId, 'credit_tracking')
    .where({ client_id: FIXED_CLIENT, tenant: tenantId })
    .select('amount', 'remaining_amount', 'currency_code');
  const creditAllocations = await tenantTable(db, tenantId, 'credit_allocations')
    .where({ invoice_id: invoiceId, tenant: tenantId })
    .select('amount');

  const selector = new AccountingExportInvoiceSelector(db, tenantId);
  const previewLines = await selector.previewInvoiceLines({ invoiceIds: [invoiceId] });
  const normalizedPreview = sortBy(previewLines, (line) => `${line.amountCents}|${line.servicePeriodStart ?? ''}`).map(
    (line) => ({
      // Identity fields the accounting export maps to the ledger customer —
      // exactly what must stay a plain (non-sub-customer) identity for
      // single-profile clients (plan exit criterion S11).
      invoice_number: line.invoiceNumber,
      client_id: line.clientId,
      client_name: line.clientName,
      invoice_status: line.invoiceStatus,
      amount_cents: line.amountCents,
      currency_code: line.currencyCode,
      service_period_start: line.servicePeriodStart ?? null,
      service_period_end: line.servicePeriodEnd ?? null,
      service_period_source: line.servicePeriodSource,
      is_manual_invoice: line.isManualInvoice,
      is_manual_charge: line.isManualCharge,
      is_credit: line.isCredit,
      is_zero_amount: line.isZeroAmount,
    })
  );

  // Portal-visible output (plan exit criterion S12 / T013 "portal views"):
  // the invoice list the client portal renders (getClientInvoices delegates to
  // fetchInvoicesByClient and filters to finalized invoices) and the full
  // rendering view model portal detail and PDF views hydrate through
  // getInvoiceForRendering. Only deterministic fields are projected —
  // generated ids and now()-derived dates (invoice_date, due_date,
  // finalized_at) are excluded, not pinned.
  const portalListRaw = await fetchInvoicesByClient(clientId);
  if (!Array.isArray(portalListRaw)) {
    throw new Error(`fetchInvoicesByClient returned a non-list: ${JSON.stringify(portalListRaw)}`);
  }
  const portalList = sortBy(
    portalListRaw.filter((row) => row.finalized_at != null),
    (row) => String(row.invoice_number)
  ).map((row) => ({
    invoice_number: String(row.invoice_number),
    status: String(row.status),
    invoice_type: row.invoice_type ?? null,
    is_prepayment: Boolean(row.is_prepayment),
    currency_code: String(row.currencyCode ?? (row as Record<string, unknown>).currency_code ?? ''),
    subtotal: toMoney(row.subtotal),
    tax: toMoney(row.tax),
    total_amount: toMoney(row.total_amount),
    credit_applied: toMoney(row.credit_applied),
    service_period_start: toDateOnly(row.service_period_start),
    service_period_end: toDateOnly(row.service_period_end),
  }));

  const rendered = await getInvoiceForRendering(invoiceId);
  if (!rendered || typeof rendered !== 'object' || !('invoice_number' in rendered)) {
    throw new Error(`getInvoiceForRendering returned no view model: ${JSON.stringify(rendered)}`);
  }
  const portalDetail = {
    invoice_number: String(rendered.invoice_number),
    status: String(rendered.status),
    currency_code: String(rendered.currencyCode),
    subtotal: toMoney(rendered.subtotal),
    tax: toMoney(rendered.tax),
    total: toMoney(rendered.total),
    total_amount: toMoney(rendered.total_amount),
    credit_applied: toMoney(rendered.credit_applied),
    client: {
      name: String(rendered.client?.name ?? ''),
      address: String(rendered.client?.address ?? ''),
    },
    has_multiple_locations: Boolean(rendered.has_multiple_locations),
    charges: sortBy(rendered.invoice_charges ?? [], (item) => String(item.description ?? '')).map((item) => ({
      description: String(item.description ?? ''),
      quantity: toMoney(item.quantity),
      unit_price: toMoney(item.unit_price),
      total_price: toMoney(item.total_price),
      net_amount: toMoney(item.net_amount),
      tax_amount: toMoney(item.tax_amount),
    })),
  };

  const totalAmount = toMoney(invoice.total_amount);
  const creditApplied = toMoney(invoice.credit_applied);

  return {
    schemaVersion: 2,
    scenario: 'single-profile-client',
    invoice: {
      status: String(invoice.status),
      invoice_type: String(invoice.invoice_type),
      currency_code: String(invoice.currency_code),
      subtotal: toMoney(invoice.subtotal),
      tax: toMoney(invoice.tax),
      total_amount: totalAmount,
      credit_applied: creditApplied,
      balance_due: totalAmount - creditApplied,
    },
    charges: chargeLines,
    credit: {
      tracking: sortBy(creditTracking, (row) => `${row.currency_code}|${toMoney(row.amount)}`).map((row) => ({
        amount: toMoney(row.amount),
        remaining_amount: toMoney(row.remaining_amount),
        currency_code: String(row.currency_code),
      })),
      allocations: sortBy(creditAllocations, (row) => `${toMoney(row.amount)}`).map((row) => ({
        amount: toMoney(row.amount),
      })),
    },
    export: {
      preview_lines: normalizedPreview,
    },
    portal: {
      invoice_list: portalList,
      invoice_detail: portalDetail,
    },
  };
}
