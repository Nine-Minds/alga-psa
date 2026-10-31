import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import {
  createTestService,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings,
} from '../../../../test-utils/billingTestHelpers';
import { seedBillingCycle } from '../../../../test-utils/billingProfileTestHelpers';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { AccountingExportInvoiceSelector } from '@alga-psa/billing/services/accountingExportInvoiceSelector';
import Invoice from '@alga-psa/billing/models/invoice';
import { loadPreviousBundlePeriods } from '@alga-psa/billing/lib/invoiceBundleComponents';
import { buildBundleComponents } from '@alga-psa/billing/lib/invoiceBundleComponents';
import { buildBundleChildRowsPreset } from '@alga-psa/billing/lib/invoice-template-ast/bundleChildRows';


/**
 * Invoice bundle component rows (plan 2026-10-14-invoice-bundle-component-presentation)
 * T001-T005 + T016 on a real, fully migrated database.
 */

const { authRef, authWrapper } = vi.hoisted(() => {
  const ref = {
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: 'test-user',
    extra: {} as Record<string, unknown>,
  };
  return {
    authRef: ref,
    authWrapper:
      (fn: (...args: any[]) => any) =>
      (...args: any[]) =>
        fn({ user_id: ref.userId, tenant: ref.tenantId, roles: [], ...ref.extra }, { tenant: ref.tenantId }, ...args),
  };
});

let db: Knex;
let tenantId: string;

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(() => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(() => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
    withTransaction: vi.fn(async (_knex: unknown, fn: (trx: Knex) => Promise<any>) => fn(db)),
    requireTenantId: vi.fn(async () => tenantId),
    auditLog: vi.fn(async () => undefined),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: authWrapper,
  withOptionalAuth: authWrapper,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: authWrapper,
  withOptionalAuth: authWrapper,
  // test-utils/testMocks.ts re-points these via vi.mocked(...) in setupCommonMocks.
  hasPermission: vi.fn(async () => true),
  getCurrentUser: vi.fn(async () => null),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: { capture: vi.fn(), identify: vi.fn(), trackPerformance: vi.fn(), getClient: () => null },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowEventModel: { create: vi.fn() },
}));

vi.mock('@alga-psa/workflow-streams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/workflow-streams')>()),
  getRedisStreamClient: () => ({ publishEvent: vi.fn() }),
  toStreamEvent: (event: unknown) => event,
}));

const HOOK_TIMEOUT = 180_000;
const DEC = '2024-12-01';
const JAN = '2025-01-01';
const FEB = '2025-02-01';
const MAR = '2025-03-01';

let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions')['createClientContractFromWizard'];
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration')['generateInvoice'];
let previewInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration')['previewInvoice'];
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync')['syncRecurringServicePeriodsForContractLine'];

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates the tenant row')
    .first<{ tenant: string }>('tenant');
  if (existing?.tenant) return existing.tenant;
  const created = uuidv4();
  await tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates the tenant row')
    .insert({
      tenant: created,
      client_name: 'Bundle Component Rows Tenant',
      email: 'bundle-rows@test.co',
      created_at: connection.fn.now(),
      updated_at: connection.fn.now(),
    });
  return created;
}

function unwrap<T>(result: T): any {
  if (result && typeof result === 'object' && ('actionError' in result || 'permissionError' in result)) {
    throw new Error(JSON.stringify(result));
  }
  return result;
}

async function createClientWithCycles(name: string, starts: string[]) {
  const clientId = uuidv4();
  await table('clients').insert({
    tenant: tenantId, client_id: clientId, client_name: name, billing_cycle: 'monthly',
    is_tax_exempt: true, default_currency_code: 'USD', created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  await table('client_locations').insert({
    location_id: uuidv4(), tenant: tenantId, client_id: clientId, location_name: 'Billing',
    address_line1: '1 Billing Way', city: 'Testville', state_province: 'NY', postal_code: '10001',
    country_code: 'US', country_name: 'United States', email: `${clientId.slice(0, 8)}@billing.test`,
    is_default: true, is_billing_address: true, created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  const fixture = { db, tenantId, clientId } as any;
  await ensureDefaultBillingSettings(fixture);
  await ensureClientPlanBundlesTable(fixture);
  const cycleIds: string[] = [];
  for (let i = 0; i < starts.length - 1; i += 1) {
    const id = uuidv4();
    cycleIds.push(id);
    await seedBillingCycle(db, tenantId, {
      billing_cycle_id: id, tenant: tenantId, client_id: clientId, billing_cycle: 'monthly',
      effective_date: `${starts[i]}T00:00:00Z`, period_start_date: `${starts[i]}T00:00:00Z`,
      period_end_date: `${starts[i + 1]}T00:00:00Z`, created_at: db.fn.now(), updated_at: db.fn.now(),
    });
  }
  return { fixture, clientId, cycleIds };
}

/** Wizard-built Fixed line: antivirus (qty 1, bundle basis), seats (qty 5), backup (qty 0 configured). */
async function createBundleLine(fixture: any, clientId: string, prefix: string, quantities = { seats: 5, av: 1 }) {
  const mk = (suffix: string, rate = 0) => createTestService(fixture, {
    service_name: `${prefix} ${suffix}`, billing_method: 'fixed', default_rate: rate, unit_of_measure: 'seat',
  });
  const av = await mk('Antivirus');
  const seats = await mk('Seats');
  const FEE = 100000;
  const created = unwrap(await createClientContractFromWizard({
    contract_name: `${prefix} Managed`, description: 'bundle', client_id: clientId, start_date: DEC, end_date: null,
    billing_frequency: 'monthly', currency_code: 'USD', enable_proration: false, fixed_base_rate: FEE,
    fixed_services: [
      { service_id: av, quantity: quantities.av },
      { service_id: seats, quantity: quantities.seats },
    ],
    hourly_services: [], usage_services: [], po_required: false,
  } as any));
  const contractLineId = created.contract_line_id as string;
  await db.transaction(async (trx) => {
    await syncRecurringServicePeriodsForContractLine(trx, { tenant: tenantId, contractLineId, sourceRunPrefix: 'bundle-it' });
  });
  return { av, seats, FEE, contractLineId, contractId: created.contract_id as string };
}

async function parentCharges(invoiceId: string) {
  return table('invoice_charges').where({ invoice_id: invoiceId }).orderBy('item_id');
}

describe('invoice bundle component rows (DB)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.E2E_AUTH_BYPASS = 'true';
    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
    authRef.tenantId = tenantId;
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ generateInvoice, previewInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
  }, HOOK_TIMEOUT);

  afterAll(async () => { await db?.destroy(); }, HOOK_TIMEOUT);

  it('T001: snapshot carries subtitle, names, raw quantities, basis and order; amounts equal persisted rows', async () => {
    setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
    const { fixture, clientId, cycleIds } = await createClientWithCycles('T001 Client', [DEC, JAN, FEB]);
    const line = await createBundleLine(fixture, clientId, 'T001');
    await table('contract_lines').where({ contract_line_id: line.contractLineId })
      .update({ invoice_line_description: 'Managed services', invoice_line_subtitle: 'All-inclusive' });

    const generated = unwrap(await generateInvoice(cycleIds[1]));
    const parents = await parentCharges(generated.invoice_id);
    expect(parents).toHaveLength(1);
    const parent = parents[0];
    expect(parent.description).toBe('Managed services');
    expect(Number(parent.net_amount)).toBe(line.FEE);
    expect(Number(parent.quantity)).toBe(1);

    const snapshot = typeof parent.bundle_presentation === 'string' ? JSON.parse(parent.bundle_presentation) : parent.bundle_presentation;
    expect(snapshot.version).toBe(1);
    expect(snapshot.subtitle).toBe('All-inclusive');
    const names = snapshot.components.map((c: any) => c.name);
    expect(names).toEqual(expect.arrayContaining(['T001 Antivirus', 'T001 Seats']));
    expect(snapshot.components.find((c: any) => c.name === 'T001 Seats').quantity).toBe(5);
    expect(snapshot.components.map((c: any) => c.order)).toEqual([...snapshot.components.map((c: any) => c.order)].sort((a: number, b: number) => a - b));
    // The snapshot holds names/quantities only — never money.
    expect(JSON.stringify(snapshot)).not.toMatch(/allocated_amount|unitPrice|"total"/);

    const details = await table('invoice_charge_details').where({ item_id: parent.item_id });
    const fixed = await table('invoice_charge_fixed_details').whereIn('item_detail_id', details.map((d: any) => d.item_detail_id));
    expect(fixed.reduce((s: number, r: any) => s + Number(r.allocated_amount), 0)).toBe(line.FEE);
    for (const component of snapshot.components) {
      for (const id of component.detailItemIds) expect(details.map((d: any) => d.item_detail_id)).toContain(id);
    }
    const header = await table('invoices').where({ invoice_id: generated.invoice_id }).first();
    expect(Number(header.subtotal)).toBe(line.FEE);
  }, HOOK_TIMEOUT);

  it('T002: +/- change against the prior period; first period has no_prior_period; cancelled prior ignored', async () => {
    setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
    const { fixture, clientId, cycleIds } = await createClientWithCycles('T002 Client', [DEC, JAN, FEB, MAR]);
    const line = await createBundleLine(fixture, clientId, 'T002');

    const first = unwrap(await generateInvoice(cycleIds[1]));
    const firstSnap = (await parentCharges(first.invoice_id))[0].bundle_presentation;
    const s1 = typeof firstSnap === 'string' ? JSON.parse(firstSnap) : firstSnap;
    expect(s1.components.every((c: any) => c.comparison === 'no_prior_period')).toBe(true);

    await table('contract_line_service_configuration')
      .where({ contract_line_id: line.contractLineId, service_id: line.seats }).update({ quantity: 7 });
    await table('contract_line_service_configuration')
      .where({ contract_line_id: line.contractLineId, service_id: line.av }).update({ quantity: 1 });

    const second = unwrap(await generateInvoice(cycleIds[2]));
    const secondRaw = (await parentCharges(second.invoice_id))[0].bundle_presentation;
    const s2 = typeof secondRaw === 'string' ? JSON.parse(secondRaw) : secondRaw;
    const seats2 = s2.components.find((c: any) => c.serviceId === line.seats);
    expect(seats2.quantity).toBe(7);
    expect(seats2.previousQuantity).toBe(5);
    expect(seats2.comparison).toBe('compared');
    const av2 = s2.components.find((c: any) => c.serviceId === line.av);
    expect(av2.previousQuantity).toBe(1);

    // Cancelling the earlier invoice (and the later one) leaves nothing to compare to.
    await table('invoices').whereIn('invoice_id', [first.invoice_id, second.invoice_id]).update({ status: 'Cancelled' });
    const previous = await loadPreviousBundlePeriods(db, tenantId, uuidv4(), [{ contractLineId: line.contractLineId, earliestPeriodStart: MAR }]);
    expect(previous.get(line.contractLineId) ?? null).toBeNull();
  }, HOOK_TIMEOUT);

  it('T003: editing line text after issuing leaves the issued snapshot untouched', async () => {
    setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
    const { fixture, clientId, cycleIds } = await createClientWithCycles('T003 Client', [DEC, JAN, FEB]);
    const line = await createBundleLine(fixture, clientId, 'T003');
    await table('contract_lines').where({ contract_line_id: line.contractLineId })
      .update({ invoice_line_description: 'Original title', invoice_line_subtitle: 'Original subtitle' });
    const generated = unwrap(await generateInvoice(cycleIds[1]));
    await table('invoices').where({ invoice_id: generated.invoice_id }).update({ status: 'sent', finalized_at: db.fn.now() });
    await table('contract_lines').where({ contract_line_id: line.contractLineId })
      .update({ invoice_line_description: 'Renamed', invoice_line_subtitle: 'Renamed subtitle' });
    await table('contract_line_service_configuration')
      .where({ contract_line_id: line.contractLineId, service_id: line.seats }).update({ quantity: 99 });

    const parent = (await parentCharges(generated.invoice_id))[0];
    const snap = typeof parent.bundle_presentation === 'string' ? JSON.parse(parent.bundle_presentation) : parent.bundle_presentation;
    expect(parent.description).toBe('Original title');
    expect(snap.subtitle).toBe('Original subtitle');
    expect(snap.components.find((c: any) => c.serviceId === line.seats).quantity).toBe(5);
  }, HOOK_TIMEOUT);

  it('T004: contract line text persists on lines with invoices (schema columns + template clone)', async () => {
    setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
    const { addContractLine } = await import('@alga-psa/billing/repositories/contractLineRepository');
    const { fixture, clientId, cycleIds } = await createClientWithCycles('T004 Client', [DEC, JAN, FEB]);
    const line = await createBundleLine(fixture, clientId, 'T004');
    unwrap(await generateInvoice(cycleIds[1]));
    await table('contract_lines').where({ contract_line_id: line.contractLineId })
      .update({ invoice_line_description: 'After invoicing', invoice_line_subtitle: 'Still editable' });
    const row = await table('contract_lines').where({ contract_line_id: line.contractLineId }).first();
    expect(row.invoice_line_description).toBe('After invoicing');
    expect(row.invoice_line_subtitle).toBe('Still editable');

    const templateId = uuidv4();
    const templateLineId = uuidv4();
    await table('contract_templates').insert({ tenant: tenantId, template_id: templateId, template_name: `T ${templateId.slice(0, 6)}` });
    await table('contract_template_lines').insert({
      tenant: tenantId, template_line_id: templateLineId, template_id: templateId,
      template_line_name: 'Tpl', billing_frequency: 'monthly', line_type: 'Fixed', custom_rate: 5000, display_order: 0,
      invoice_line_description: 'Tpl title', invoice_line_subtitle: 'Tpl subtitle',
    });
    await table('contract_template_line_services').insert({ tenant: tenantId, template_line_id: templateLineId, service_id: line.av, quantity: 1 });
    await table('contract_template_line_service_configuration').insert({
      tenant: tenantId, config_id: uuidv4(), template_line_id: templateLineId, service_id: line.av, configuration_type: 'Fixed', quantity: 1,
    });
    const mapping = await addContractLine(db as any, tenantId, line.contractId, templateLineId);
    const cloned = await table('contract_lines').where({ contract_line_id: mapping.contract_line_id }).first();
    expect(cloned.invoice_line_description).toBe('Tpl title');
    expect(cloned.invoice_line_subtitle).toBe('Tpl subtitle');
  }, HOOK_TIMEOUT);

  it('T005: accounting export selector and /items loader are identical with or without snapshots', async () => {
    setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
    const { fixture, clientId, cycleIds } = await createClientWithCycles('T005 Client', [DEC, JAN, FEB]);
    await createBundleLine(fixture, clientId, 'T005');
    const generated = unwrap(await generateInvoice(cycleIds[1]));
    const selector = new AccountingExportInvoiceSelector(db, tenantId);
    const filters = { invoiceIds: [generated.invoice_id], adapterType: 'xero' } as any;

    const withSnapshot = await selector.previewInvoiceLines(filters);
    const itemsWith = await Invoice.getInvoiceCharges(db, tenantId, generated.invoice_id);
    expect(withSnapshot.length).toBeGreaterThan(0);
    expect(itemsWith).toHaveLength(1);
    expect('bundle_presentation' in itemsWith[0]).toBe(false);
    expect('bundle_component_amounts' in itemsWith[0]).toBe(false);

    await table('invoice_charges').where({ invoice_id: generated.invoice_id }).update({ bundle_presentation: null });
    const withoutSnapshot = await selector.previewInvoiceLines(filters);
    const itemsWithout = await Invoice.getInvoiceCharges(db, tenantId, generated.invoice_id);
    expect(withSnapshot).toEqual(withoutSnapshot);
    expect(itemsWith).toEqual(itemsWithout);
  }, HOOK_TIMEOUT);

  it('T016: draft preview bundle item and components equal the persisted invoice; dialog path unchanged', async () => {
    setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
    const { fixture, clientId, cycleIds } = await createClientWithCycles('T016 Client', [DEC, JAN, FEB]);
    const line = await createBundleLine(fixture, clientId, 'T016');
    await table('contract_lines').where({ contract_line_id: line.contractLineId })
      .update({ invoice_line_description: 'Preview title', invoice_line_subtitle: 'Preview sub' });

    const preview = unwrap(await previewInvoice(cycleIds[1]));
    expect(preview.success, JSON.stringify(preview).slice(0, 800)).toBe(true);
    const generated = unwrap(await generateInvoice(cycleIds[1]));
    const persisted = await Invoice.getInvoiceCharges(db, tenantId, generated.invoice_id, { includeBundlePresentation: true, includeBundleComponentAmounts: true });
    const persistedParent = persisted[0] as any;
    const persistedComponents = buildBundleComponents(persistedParent.bundle_presentation, { includePricing: true, amounts: persistedParent.bundle_component_amounts });

    const previewItems = preview.data.items.filter((item: any) => item.bundle_components || item.bundleComponents || item.components);
    expect(previewItems).toHaveLength(1);
    const previewItem = previewItems[0];
    const previewComponents = previewItem.components ?? previewItem.bundleComponents ?? previewItem.bundle_components;
    const strip = (rows: any[]) => rows.map((r) => ({ name: r.name, quantity: r.quantity, change: r.change ?? null, unitPrice: r.unitPrice ?? null, total: r.total ?? null }));
    expect(strip(previewComponents)).toEqual(strip(persistedComponents!.components));
    expect(Number(previewItem.total)).toBe(Number(persistedParent.net_amount));
    expect(previewItem.description).toBe(persistedParent.description);
    expect(preview.data.items.some((item: any) => String(item.description ?? '').startsWith('Contract:'))).toBe(false);
  }, HOOK_TIMEOUT);

  describe('T010/T017: client price gate on the real read path', () => {
    async function seedIssuedBundleInvoice(prefix: string) {
      const { fixture, clientId, cycleIds } = await createClientWithCycles(`${prefix} Client`, [DEC, JAN, FEB]);
      await createBundleLine(fixture, clientId, prefix);
      const generated = unwrap(await generateInvoice(cycleIds[1]));
      await table('invoices').where({ invoice_id: generated.invoice_id }).update({ status: 'sent', finalized_at: db.fn.now() });
      return { clientId, invoiceId: generated.invoice_id as string };
    }
    const asClient = (clientId: string) => { authRef.extra = { user_type: 'client', clientId }; };
    const asMsp = () => { authRef.extra = { user_type: 'internal' }; };
    const componentsOf = (viewModel: any) => (viewModel.items ?? []).flatMap((item: any) => item.components ?? item.bundleComponents ?? []);

    async function standardBundleTemplateId() {
      const row = await tenantDb(db, '__test_tenant_fixture__')
        .unscoped('standard_invoice_templates', 'look up seeded standard template')
        .where({ standard_invoice_template_code: 'standard-bundle-quantities' }).first('template_id', 'templateAst');
      expect(row, 'standard-bundle-quantities must be seeded by migration').toBeTruthy();
      return row as { template_id: string; templateAst: any };
    }

    it('client on standard-bundle-quantities gets presentation but no prices (view model and dialog payload)', async () => {
      setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
      const { getEnrichedInvoiceViewModel, getInvoiceForRendering } = await import('@alga-psa/billing/actions/invoiceQueries');
      const { clientId, invoiceId } = await seedIssuedBundleInvoice('T010a');
      const standard = await standardBundleTemplateId();
      await table('clients').where({ client_id: clientId }).update({ invoice_template_id: standard.template_id });

      asClient(clientId);
      const viewModel: any = await getEnrichedInvoiceViewModel(invoiceId);
      const comps = componentsOf(viewModel);
      expect(comps.length).toBeGreaterThan(0);
      expect(comps.some((c: any) => c.name?.includes('Seats') && c.quantity === 5)).toBe(true);
      const serialized = JSON.stringify(viewModel);
      expect(serialized).not.toMatch(/"allocated_amount"|bundle_component_amounts/);
      for (const c of comps) { expect(c).not.toHaveProperty('unitPrice'); expect(c).not.toHaveProperty('total'); }

      const dialogPayload: any = await getInvoiceForRendering(invoiceId);
      const charge = dialogPayload.invoice_charges.find((ch: any) => ch.bundle_presentation);
      expect(charge, 'bundle_presentation must reach the client').toBeTruthy();
      expect(JSON.stringify(dialogPayload)).not.toMatch(/bundle_component_amounts|allocated_amount/);
    }, HOOK_TIMEOUT);

    it('client on a price-binding template gets component prices; MSP always does', async () => {
      setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
      const { getEnrichedInvoiceViewModel, getInvoiceForRendering } = await import('@alga-psa/billing/actions/invoiceQueries');
      const { clientId, invoiceId } = await seedIssuedBundleInvoice('T010b');
      const standard = await standardBundleTemplateId();
      const ast = JSON.parse(JSON.stringify(standard.templateAst));
      const visit = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'dynamic-table' && node.childRows) node.childRows = buildBundleChildRowsPreset({ prices: true, showChange: true });
        Object.values(node).forEach(visit);
      };
      visit(ast);
      const pricedId = uuidv4();
      await table('invoice_templates').insert({
        tenant: tenantId, template_id: pricedId, name: `Priced ${pricedId.slice(0, 6)}`, version: 1, is_default: false, templateAst: JSON.stringify(ast),
      });
      await table('clients').where({ client_id: clientId }).update({ invoice_template_id: pricedId });

      asClient(clientId);
      const priced: any = await getEnrichedInvoiceViewModel(invoiceId);
      const pricedComps = componentsOf(priced);
      expect(pricedComps.length).toBeGreaterThan(0);
      expect(pricedComps.every((c: any) => typeof c.total === 'number')).toBe(true);
      expect(Math.round(pricedComps.reduce((sum: number, c: any) => sum + c.total, 0))).toBe(100000);

      // Same client but quantity-only template again: MSP still gets everything.
      await table('clients').where({ client_id: clientId }).update({ invoice_template_id: standard.template_id });
      asMsp();
      const msp: any = await getEnrichedInvoiceViewModel(invoiceId);
      expect(componentsOf(msp).every((c: any) => typeof c.total === 'number')).toBe(true);
      const mspDialog: any = await getInvoiceForRendering(invoiceId);
      expect(mspDialog.invoice_charges.find((ch: any) => ch.bundle_component_amounts)).toBeTruthy();
      authRef.extra = {};
    }, HOOK_TIMEOUT);
  });
});
