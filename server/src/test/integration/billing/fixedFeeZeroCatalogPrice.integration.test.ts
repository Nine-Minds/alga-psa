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
import { BillingEngine } from '@alga-psa/billing/services';
import { getContractMonthlyFixedValuesByContract } from '@alga-psa/shared/billingClients/contractMonthlyValue';

/**
 * alga-2026-0002499 — a fixed-fee contract line whose services have a $0
 * catalog `default_rate` and NO `service_prices` row in the contract currency
 * used to vanish from the invoice while "Estimated monthly" still showed it.
 *
 * For each way such a line comes into existence — the contract wizard, a Quick
 * Add preset and a template clone — this proves that, whatever the services'
 * catalog prices are:
 *   - the invoice carries the FULL fee,
 *   - the per-service allocation follows what the path actually stored
 *     (stored shares → quantity), and
 *   - the invoice agrees with the contract's estimated monthly value.
 * It also proves an unpriceable fixed line is refused with a coded reason in
 * preview and generation, instead of being dropped silently.
 */

const { authRef, authWrapper } = vi.hoisted(() => {
  const ref = {
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: 'test-user',
  };
  return {
    authRef: ref,
    authWrapper:
      (fn: (...args: any[]) => any) =>
      (...args: any[]) =>
        fn({ user_id: ref.userId, tenant: ref.tenantId, roles: [] }, { tenant: ref.tenantId }, ...args),
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
const PREVIOUS_START = '2024-12-01';
const CURRENT_START = '2025-01-01';
const NEXT_START = '2025-02-01';

type Currency = 'USD' | 'EUR';

let addContractLine: typeof import('@alga-psa/billing/repositories/contractLineRepository')['addContractLine'];
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions')['createClientContractFromWizard'];
let copyPresetToContractLine: typeof import('@alga-psa/billing/actions/contractLinePresetActions')['copyPresetToContractLine'];
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
      client_name: 'Fixed Fee Zero Catalog Price Tenant',
      email: 'fixed-fee-zero-catalog@test.co',
      created_at: connection.fn.now(),
      updated_at: connection.fn.now(),
    });
  return created;
}

/** A client with a billing address, default billing settings and two monthly cycles. */
async function createBillableClient(name: string, currency: Currency) {
  const clientId = uuidv4();
  await table('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: name,
    billing_cycle: 'monthly',
    is_tax_exempt: true,
    default_currency_code: currency,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await table('client_locations').insert({
    location_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    location_name: 'Billing',
    address_line1: '1 Billing Way',
    city: 'Testville',
    state_province: 'NY',
    postal_code: '10001',
    country_code: 'US',
    country_name: 'United States',
    email: `${clientId.slice(0, 8)}@billing.test`,
    is_default: true,
    is_billing_address: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const fixture = { db, tenantId, clientId } as any;
  await ensureDefaultBillingSettings(fixture);
  await ensureClientPlanBundlesTable(fixture);

  await seedBillingCycle(db, tenantId, {
    billing_cycle_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    billing_cycle: 'monthly',
    effective_date: `${PREVIOUS_START}T00:00:00Z`,
    period_start_date: `${PREVIOUS_START}T00:00:00Z`,
    period_end_date: `${CURRENT_START}T00:00:00Z`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const cycleId = uuidv4();
  await seedBillingCycle(db, tenantId, {
    billing_cycle_id: cycleId,
    tenant: tenantId,
    client_id: clientId,
    billing_cycle: 'monthly',
    effective_date: `${CURRENT_START}T00:00:00Z`,
    period_start_date: `${CURRENT_START}T00:00:00Z`,
    period_end_date: `${NEXT_START}T00:00:00Z`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return { fixture, clientId, cycleId };
}

/** Two fixed services priced $0 in the catalog, with no service_prices row at all. */
async function createZeroPricedServices(fixture: any, prefix: string) {
  const serviceA = await createTestService(fixture, {
    service_name: `${prefix} ADDON`,
    billing_method: 'fixed',
    default_rate: 0,
    unit_of_measure: 'seat',
  });
  const serviceB = await createTestService(fixture, {
    service_name: `${prefix} BLKHR`,
    billing_method: 'fixed',
    default_rate: 0,
    unit_of_measure: 'seat',
  });
  await table('service_prices').whereIn('service_id', [serviceA, serviceB]).delete();
  const priced = await table('service_prices').whereIn('service_id', [serviceA, serviceB]);
  expect(priced).toHaveLength(0);
  return { serviceA, serviceB };
}

/** A contract header assigned to the client, for the paths that add lines to an existing contract. */
async function createAssignedContract(clientId: string, name: string, currency: Currency) {
  const contractId = uuidv4();
  await table('contracts').insert({
    tenant: tenantId,
    contract_id: contractId,
    contract_name: name,
    billing_frequency: 'monthly',
    is_active: true,
    status: 'active',
    is_template: false,
    currency_code: currency,
    owner_client_id: clientId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await table('client_contracts').insert({
    tenant: tenantId,
    client_contract_id: uuidv4(),
    client_id: clientId,
    contract_id: contractId,
    start_date: PREVIOUS_START,
    end_date: null,
    is_active: true,
    status: 'pending',
  });
  return contractId;
}

async function syncPeriods(contractLineId: string) {
  await db.transaction(async (trx) => {
    await syncRecurringServicePeriodsForContractLine(trx, {
      tenant: tenantId,
      contractLineId,
      sourceRunPrefix: 'integration-fixture',
    });
  });
}

async function fixedChargesFor(clientId: string, cycleId: string) {
  const result = await new BillingEngine().calculateBilling(clientId, CURRENT_START, NEXT_START, cycleId);
  return {
    result,
    fixed: result.charges.filter((charge) => charge.type === 'fixed'),
  };
}

async function estimatedMonthlyCents(contractId: string): Promise<number> {
  const values = await getContractMonthlyFixedValuesByContract(db, tenantId, [contractId], PREVIOUS_START);
  return values.get(contractId)?.monthlyValueCents ?? 0;
}

function unwrap<T>(result: T): Exclude<T, { actionError: unknown } | { permissionError: unknown }> {
  if (result && typeof result === 'object' && ('actionError' in result || 'permissionError' in result)) {
    throw new Error(JSON.stringify(result));
  }
  return result as any;
}

const sum = (values: Array<number | undefined>) => values.reduce<number>((acc, value) => acc + (value ?? 0), 0);

describe('fixed-fee line with $0 catalog services and no contract-currency price (alga-2026-0002499)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.E2E_AUTH_BYPASS = 'true';
    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
    authRef.tenantId = tenantId;
    ({ addContractLine } = await import('@alga-psa/billing/repositories/contractLineRepository'));
    ({ createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ copyPresetToContractLine } = await import('@alga-psa/billing/actions/contractLinePresetActions'));
    ({ generateInvoice, previewInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  describe.each<Currency>(['USD', 'EUR'])('contract wizard (%s)', (currency) => {
    it('invoices the full fixed rate, allocated by the stored per-service shares, matching estimated monthly', async () => {
      setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
      const { fixture, clientId, cycleId } = await createBillableClient(`Wizard ${currency} Client`, currency);
      const { serviceA, serviceB } = await createZeroPricedServices(fixture, `Wizard ${currency}`);

      const FEE = 100000;
      const created = unwrap(
        await createClientContractFromWizard({
          contract_name: `Wizard ${currency} Essentials`,
          description: 'zero-catalog fixed fee',
          client_id: clientId,
          start_date: PREVIOUS_START,
          end_date: null,
          billing_frequency: 'monthly',
          currency_code: currency,
          enable_proration: false,
          fixed_base_rate: FEE,
          fixed_services: [
            { service_id: serviceA, quantity: 1 },
            { service_id: serviceB, quantity: 1 },
          ],
          hourly_services: [],
          usage_services: [],
          po_required: false,
        } as any),
      );
      const contractLineId = created.contract_line_id as string;
      const contractId = created.contract_id as string;
      expect(contractLineId).toBeTruthy();
      await syncPeriods(contractLineId);

      // What the wizard stored: the line rate and one share per service.
      const line = await table('contract_lines').where({ contract_line_id: contractLineId }).first();
      expect(Number(line.custom_rate)).toBe(FEE);
      const shares = await table('contract_line_service_configuration as c')
        .join('contract_line_service_fixed_config as f', function () {
          this.on('f.config_id', 'c.config_id').andOn('f.tenant', 'c.tenant');
        })
        .where('c.contract_line_id', contractLineId)
        .select('c.service_id', 'f.base_rate');
      expect(shares).toHaveLength(2);
      expect(sum(shares.map((row: any) => Number(row.base_rate)))).toBe(FEE);

      const { result, fixed } = await fixedChargesFor(clientId, cycleId);
      expect(result.fixedLineBlockers).toBeUndefined();
      expect(sum(fixed.map((charge) => charge.total))).toBe(FEE);
      for (const share of shares as any[]) {
        const charge = fixed.find((candidate) => candidate.serviceId === share.service_id);
        expect(charge?.total).toBe(Number(share.base_rate));
      }
      expect(await estimatedMonthlyCents(contractId)).toBe(FEE);

      const invoice = await generateInvoice(cycleId);
      const generated = unwrap(invoice) as any;
      expect(generated).toBeTruthy();
      const persisted = await table('invoices').where({ invoice_id: generated.invoice_id }).first();
      expect(Number(persisted.subtotal)).toBe(FEE);
      expect(persisted.currency_code).toBe(currency);
    }, HOOK_TIMEOUT);

    it('bills the full rate for uneven quantities without inflating it by quantity', async () => {
      setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
      const { fixture, clientId, cycleId } = await createBillableClient(`Wizard qty ${currency} Client`, currency);
      const { serviceA, serviceB } = await createZeroPricedServices(fixture, `WizardQty ${currency}`);

      const FEE = 100000;
      const created = unwrap(
        await createClientContractFromWizard({
          contract_name: `Wizard qty ${currency}`,
          description: 'uneven quantities',
          client_id: clientId,
          start_date: PREVIOUS_START,
          end_date: null,
          billing_frequency: 'monthly',
          currency_code: currency,
          enable_proration: false,
          fixed_base_rate: FEE,
          fixed_services: [
            { service_id: serviceA, quantity: 1 },
            { service_id: serviceB, quantity: 3 },
          ],
          hourly_services: [],
          usage_services: [],
          po_required: false,
        } as any),
      );
      await syncPeriods(created.contract_line_id as string);

      const { fixed } = await fixedChargesFor(clientId, cycleId);
      expect(sum(fixed.map((charge) => charge.total))).toBe(FEE);
      expect(await estimatedMonthlyCents(created.contract_id as string)).toBe(FEE);
    }, HOOK_TIMEOUT);
  });

  describe('Quick Add preset', () => {
    it('invoices the full fixed rate, allocated by quantity (no per-service shares are stored), matching estimated monthly', async () => {
      setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
      const { fixture, clientId, cycleId } = await createBillableClient('Preset Client', 'USD');
      const { serviceA, serviceB } = await createZeroPricedServices(fixture, 'Preset');
      const contractId = await createAssignedContract(clientId, 'Preset Essentials', 'USD');

      const FEE = 90000;
      const presetId = uuidv4();
      await table('contract_line_presets').insert({
        tenant: tenantId,
        preset_id: presetId,
        preset_name: 'Essentials preset',
        contract_line_type: 'Fixed',
        billing_frequency: 'monthly',
        billing_timing: 'arrears',
        cadence_owner: 'client',
      });
      await table('contract_line_preset_services').insert([
        { tenant: tenantId, preset_id: presetId, service_id: serviceA, quantity: 1 },
        { tenant: tenantId, preset_id: presetId, service_id: serviceB, quantity: 2 },
      ]);
      await table('contract_line_preset_fixed_config').insert({
        tenant: tenantId,
        preset_id: presetId,
        base_rate: FEE,
        enable_proration: false,
        billing_cycle_alignment: 'start',
      });

      const contractLineId = unwrap(await copyPresetToContractLine(contractId, presetId, undefined)) as string;
      expect(typeof contractLineId).toBe('string');
      await syncPeriods(contractLineId);

      const line = await table('contract_lines').where({ contract_line_id: contractLineId }).first();
      expect(Number(line.custom_rate)).toBe(FEE);
      // Reported uncertainty, pinned: the preset path stores no per-service share.
      const storedShares = await table('contract_line_service_configuration as c')
        .join('contract_line_service_fixed_config as f', function () {
          this.on('f.config_id', 'c.config_id').andOn('f.tenant', 'c.tenant');
        })
        .where('c.contract_line_id', contractLineId)
        .whereNotNull('f.base_rate');
      expect(storedShares).toHaveLength(0);

      const { result, fixed } = await fixedChargesFor(clientId, cycleId);
      expect(result.fixedLineBlockers).toBeUndefined();
      expect(sum(fixed.map((charge) => charge.total))).toBe(FEE);
      // No stored shares: allocation falls back to quantity (1:2).
      expect(fixed.find((charge) => charge.serviceId === serviceA)?.total).toBe(30000);
      expect(fixed.find((charge) => charge.serviceId === serviceB)?.total).toBe(60000);
      expect(await estimatedMonthlyCents(contractId)).toBe(FEE);

      const generated = unwrap(await generateInvoice(cycleId)) as any;
      const persisted = await table('invoices').where({ invoice_id: generated.invoice_id }).first();
      expect(Number(persisted.subtotal)).toBe(FEE);
    }, HOOK_TIMEOUT);
  });

  describe('template clone', () => {
    it('invoices the full fixed rate for a cloned template line, matching estimated monthly', async () => {
      setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
      const { fixture, clientId, cycleId } = await createBillableClient('Template Client', 'USD');
      const { serviceA, serviceB } = await createZeroPricedServices(fixture, 'Template');
      const contractId = await createAssignedContract(clientId, 'Template Essentials', 'USD');

      const FEE = 120000;
      const templateId = uuidv4();
      const templateLineId = uuidv4();
      await table('contract_templates').insert({
        tenant: tenantId,
        template_id: templateId,
        template_name: `Template ${templateId.slice(0, 6)}`,
      });
      await table('contract_template_lines').insert({
        tenant: tenantId,
        template_line_id: templateLineId,
        template_id: templateId,
        template_line_name: 'Template Fixed line',
        billing_frequency: 'monthly',
        line_type: 'Fixed',
        custom_rate: FEE,
        display_order: 0,
      });
      for (const [serviceId, quantity] of [
        [serviceA, 1],
        [serviceB, 3],
      ] as const) {
        await table('contract_template_line_services').insert({
          tenant: tenantId,
          template_line_id: templateLineId,
          service_id: serviceId,
          quantity,
        });
        await table('contract_template_line_service_configuration').insert({
          tenant: tenantId,
          config_id: uuidv4(),
          template_line_id: templateLineId,
          service_id: serviceId,
          configuration_type: 'Fixed',
          quantity,
        });
      }

      const mapping = await addContractLine(db as any, tenantId, contractId, templateLineId);
      const contractLineId = mapping.contract_line_id as string;
      await syncPeriods(contractLineId);

      const line = await table('contract_lines').where({ contract_line_id: contractLineId }).first();
      expect(Number(line.custom_rate)).toBe(FEE);
      const storedShares = await table('contract_line_service_configuration as c')
        .join('contract_line_service_fixed_config as f', function () {
          this.on('f.config_id', 'c.config_id').andOn('f.tenant', 'c.tenant');
        })
        .where('c.contract_line_id', contractLineId)
        .whereNotNull('f.base_rate');
      expect(storedShares).toHaveLength(0);

      const { result, fixed } = await fixedChargesFor(clientId, cycleId);
      expect(result.fixedLineBlockers).toBeUndefined();
      expect(sum(fixed.map((charge) => charge.total))).toBe(FEE);
      expect(fixed.find((charge) => charge.serviceId === serviceA)?.total).toBe(30000);
      expect(fixed.find((charge) => charge.serviceId === serviceB)?.total).toBe(90000);
      expect(await estimatedMonthlyCents(contractId)).toBe(FEE);

      const generated = unwrap(await generateInvoice(cycleId)) as any;
      const persisted = await table('invoices').where({ invoice_id: generated.invoice_id }).first();
      expect(Number(persisted.subtotal)).toBe(FEE);
    }, HOOK_TIMEOUT);
  });

  describe('unpriceable fixed line', () => {
    it('is refused with a coded reason in preview and generation, never dropped silently', async () => {
      setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
      const { fixture, clientId, cycleId } = await createBillableClient('Unpriceable Client', 'USD');
      const { serviceA } = await createZeroPricedServices(fixture, 'Unpriceable');
      const contractId = await createAssignedContract(clientId, 'Unpriceable Contract', 'USD');

      // A fixed line with NO rate anywhere: no line rate, no share, $0 catalog.
      const templateLineId = uuidv4();
      const templateId = uuidv4();
      await table('contract_templates').insert({
        tenant: tenantId,
        template_id: templateId,
        template_name: `Unpriceable ${templateId.slice(0, 6)}`,
      });
      await table('contract_template_lines').insert({
        tenant: tenantId,
        template_line_id: templateLineId,
        template_id: templateId,
        template_line_name: 'Unpriceable Fixed line',
        billing_frequency: 'monthly',
        line_type: 'Fixed',
        custom_rate: null,
        display_order: 0,
      });
      await table('contract_template_line_services').insert({
        tenant: tenantId,
        template_line_id: templateLineId,
        service_id: serviceA,
        quantity: 1,
      });
      await table('contract_template_line_service_configuration').insert({
        tenant: tenantId,
        config_id: uuidv4(),
        template_line_id: templateLineId,
        service_id: serviceA,
        configuration_type: 'Fixed',
        quantity: 1,
      });
      const mapping = await addContractLine(db as any, tenantId, contractId, templateLineId);
      await syncPeriods(mapping.contract_line_id as string);

      const { result, fixed } = await fixedChargesFor(clientId, cycleId);
      expect(fixed).toHaveLength(0);
      expect(result.fixedLineBlockers).toEqual([
        expect.objectContaining({
          code: 'FIXED_LINE_RATE_UNRESOLVED',
          contractLineId: mapping.contract_line_id,
          contractLineName: 'Unpriceable Fixed line',
        }),
      ]);

      const preview = (await previewInvoice(cycleId)) as any;
      expect(preview.success).toBe(false);
      expect(preview.code).toBe('FIXED_LINE_RATE_UNRESOLVED');
      expect(String(preview.error)).toContain('Unpriceable Fixed line');
      expect(String(preview.error)).not.toBe('Nothing to bill');

      const generation = await generateInvoice(cycleId).catch((error: unknown) => error);
      const generationText = JSON.stringify(generation instanceof Error ? { message: generation.message } : generation);
      expect(generationText).toContain('Unpriceable Fixed line');
      const invoiceCount = await table('invoices').where({ client_id: clientId });
      expect(invoiceCount).toHaveLength(0);
    }, HOOK_TIMEOUT);

    it('does not block a legitimate $0 fixed rate', async () => {
      setupCommonMocks({ tenantId, userId: authRef.userId, permissionCheck: () => true });
      const { fixture, clientId, cycleId } = await createBillableClient('Zero Rate Client', 'USD');
      const { serviceA } = await createZeroPricedServices(fixture, 'ZeroRate');
      const contractId = await createAssignedContract(clientId, 'Zero Rate Contract', 'USD');

      const templateLineId = uuidv4();
      const templateId = uuidv4();
      await table('contract_templates').insert({
        tenant: tenantId,
        template_id: templateId,
        template_name: `Zero ${templateId.slice(0, 6)}`,
      });
      await table('contract_template_lines').insert({
        tenant: tenantId,
        template_line_id: templateLineId,
        template_id: templateId,
        template_line_name: 'Zero Fixed line',
        billing_frequency: 'monthly',
        line_type: 'Fixed',
        custom_rate: 0,
        display_order: 0,
      });
      await table('contract_template_line_services').insert({
        tenant: tenantId,
        template_line_id: templateLineId,
        service_id: serviceA,
        quantity: 1,
      });
      await table('contract_template_line_service_configuration').insert({
        tenant: tenantId,
        config_id: uuidv4(),
        template_line_id: templateLineId,
        service_id: serviceA,
        configuration_type: 'Fixed',
        quantity: 1,
      });
      const mapping = await addContractLine(db as any, tenantId, contractId, templateLineId);
      await syncPeriods(mapping.contract_line_id as string);

      const { result } = await fixedChargesFor(clientId, cycleId);
      expect(result.fixedLineBlockers).toBeUndefined();
    }, HOOK_TIMEOUT);
  });
});
