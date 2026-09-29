import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import {
  createSeatCatalog,
  createSeatClient,
  dateOnly,
  ensureFixtureTenant,
  tenantTable,
  type SeatCatalogService,
  type SeatClient,
} from '../../../test-utils/perSeatFixtures';

// Per-seat recurring services in contract TEMPLATES, end to end: what the
// template wizard persists, what the snapshot hands the client wizard, and
// what every template -> contract copy path preserves.

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
let createContractTemplateFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createContractTemplateFromWizard;
let getContractTemplateSnapshotForClientWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').getContractTemplateSnapshotForClientWizard;
let getServiceCatalogRatesForCurrency: typeof import('@alga-psa/billing/actions/serviceActions').getServiceCatalogRatesForCurrency;
let sharedCloneTemplateContractLine: typeof import('@alga-psa/shared/billingClients/templateClone').cloneTemplateContractLine;
let billingCloneTemplateContractLine: typeof import('@alga-psa/billing/lib/billing/utils/templateClone').cloneTemplateContractLine;
let getContractOverview: typeof import('@alga-psa/billing/actions/contractActions').getContractOverview;
let addContractLine: typeof import('@alga-psa/billing/repositories/contractLineRepository').addContractLine;

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

const DECEMBER_START = '2024-12-01';
const JANUARY_START = '2025-01-01';
const FEBRUARY_START = '2025-02-01';

type Catalog = { user: SeatCatalogService; endpoint: SeatCatalogService; location: SeatCatalogService };

async function seatCatalog(): Promise<Catalog> {
  const [user, endpoint, location] = await createSeatCatalog(db, tenantId, [
    { name: 'Managed User', rateCents: 10000, prices: { EUR: 9000 } },
    { name: 'Managed Endpoint', rateCents: 5000, prices: { EUR: 4500 } },
    { name: 'Managed Location', rateCents: 20000, prices: { EUR: 18000 } },
  ]);
  return { user, endpoint, location };
}

function ok<T>(result: T): T {
  expect(result, JSON.stringify(result)).toBeTruthy();
  expect(result).not.toHaveProperty('error');
  expect(result).not.toHaveProperty('actionError');
  return result;
}

async function createTemplate(fixedServices: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return ok(
    await createContractTemplateFromWizard({
      contract_name: `Seat template ${uuidv4().slice(0, 6)}`,
      billing_frequency: 'monthly',
      fixed_services: fixedServices as any,
      ...extra,
    } as any),
  ) as { contract_id: string; contract_line_id?: string };
}

async function templateFixedConfigs(templateLineId: string) {
  const rows = await tenantTable(db, tenantId, 'contract_template_line_service_configuration as c')
    .leftJoin('contract_template_line_service_fixed_config as f', function join() {
      this.on('f.config_id', 'c.config_id').andOn('f.tenant', 'c.tenant');
    })
    .where({ 'c.tenant': tenantId, 'c.template_line_id': templateLineId })
    .select('c.config_id', 'c.service_id', 'c.quantity', 'f.base_rate', 'f.pricing_basis');
  return new Map(rows.map((row: any) => [row.service_id as string, row]));
}

async function lineFixedConfigs(contractLineId: string) {
  const rows = await tenantTable(db, tenantId, 'contract_line_service_configuration as c')
    .leftJoin('contract_line_service_fixed_config as f', function join() {
      this.on('f.config_id', 'c.config_id').andOn('f.tenant', 'c.tenant');
    })
    .where({ 'c.tenant': tenantId, 'c.contract_line_id': contractLineId })
    .select('c.config_id', 'c.service_id', 'c.quantity', 'f.base_rate', 'f.pricing_basis', 'f.rate_provenance');
  return new Map(rows.map((row: any) => [row.service_id as string, row]));
}

async function templateLineCustomRate(templateLineId: string) {
  const row = await tenantTable(db, tenantId, 'contract_template_lines')
    .where({ tenant: tenantId, template_line_id: templateLineId })
    .first();
  return row?.custom_rate == null ? null : Number(row.custom_rate);
}

async function lineCustomRate(contractLineId: string) {
  const row = await tenantTable(db, tenantId, 'contract_lines')
    .where({ tenant: tenantId, contract_line_id: contractLineId })
    .first();
  return row?.custom_rate == null ? null : Number(row.custom_rate);
}

async function syncLine(contractLineId: string) {
  await db.transaction(async (trx) => {
    await syncRecurringServicePeriodsForContractLine(trx, {
      tenant: tenantId,
      contractLineId,
      sourceRunPrefix: 'per-seat-template-test',
    });
  });
}

// Andrew's package as a template: the User rate is a default, the Endpoint
// rate is left empty (follows the catalog in the contract currency).
const templatePackage = (catalog: Catalog) => [
  { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 20, unit_rate: 10000 },
  { service_id: catalog.endpoint.serviceId, pricing_basis: 'unit', quantity: 30, unit_rate: null },
  { service_id: catalog.location.serviceId, pricing_basis: 'unit', quantity: 2, unit_rate: 20000 },
];

describe('contract templates: per-seat recurring services', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    setupCommonMocks({ tenantId, userId: 'per-seat-test-user', permissionCheck: () => true });
    ({ createClientContractFromWizard, createContractTemplateFromWizard, getContractTemplateSnapshotForClientWizard } =
      await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
    ({ getServiceCatalogRatesForCurrency } = await import('@alga-psa/billing/actions/serviceActions'));
    ({ cloneTemplateContractLine: sharedCloneTemplateContractLine } = await import('@alga-psa/shared/billingClients/templateClone'));
    ({ cloneTemplateContractLine: billingCloneTemplateContractLine } = await import('@alga-psa/billing/lib/billing/utils/templateClone'));
    ({ addContractLine } = await import('@alga-psa/billing/repositories/contractLineRepository'));
    ({ getContractOverview } = await import('@alga-psa/billing/actions/contractActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('persists basis, default quantity and unit rate per service, with no allocation total', async () => {
    const catalog = await seatCatalog();
    const template = await createTemplate(templatePackage(catalog));

    const configs = await templateFixedConfigs(template.contract_line_id!);
    expect(configs.size).toBe(3);
    const user: any = configs.get(catalog.user.serviceId);
    const endpoint: any = configs.get(catalog.endpoint.serviceId);
    const location: any = configs.get(catalog.location.serviceId);
    expect(user.pricing_basis).toBe('unit');
    expect(Number(user.quantity)).toBe(20);
    expect(Number(user.base_rate)).toBe(10000);
    expect(endpoint.pricing_basis).toBe('unit');
    expect(Number(endpoint.quantity)).toBe(30);
    expect(endpoint.base_rate).toBeNull();
    expect(Number(location.quantity)).toBe(2);
    expect(Number(location.base_rate)).toBe(20000);
  }, HOOK_TIMEOUT);

  it('the template overview reads each seat service as quantity x unit rate; a catalog-following rate has no fixed amount', async () => {
    const catalog = await seatCatalog();
    const template = await createTemplate(templatePackage(catalog));

    const overview: any = await getContractOverview(template.contract_id);
    expect(overview, JSON.stringify(overview)).not.toHaveProperty('error');
    const services = new Map<string, any>(overview.contractLines.flatMap((line: any) => line.services).map((svc: any) => [svc.service_id, svc]));
    expect(services.get(catalog.user.serviceId)).toMatchObject({ pricing_basis: 'unit', quantity: 20, unit_rate: 10000 });
    expect(services.get(catalog.location.serviceId)).toMatchObject({ pricing_basis: 'unit', quantity: 2, unit_rate: 20000 });
    // A template is currency-neutral: no stored rate means "catalog price in the
    // contract's currency", which a template cannot price, so it is left out of
    // the total rather than valued at a guess.
    expect(services.get(catalog.endpoint.serviceId)).toMatchObject({ pricing_basis: 'unit', quantity: 30, unit_rate: null });
    // 20 x $100 + 2 x $200 (the 30 catalog-priced endpoints are excluded).
    expect(overview.totalEstimatedMonthlyValue).toBe(200000 + 40000);
  }, HOOK_TIMEOUT);

  it('round-trips through the snapshot; a contract created from it adjusts a quantity and bills the unit rates', async () => {
    const catalog = await seatCatalog();
    const template = await createTemplate(templatePackage(catalog));

    const snapshot: any = ok(await getContractTemplateSnapshotForClientWizard(template.contract_id));
    const byService = new Map<string, any>(snapshot.fixed_services.map((s: any) => [s.service_id, s]));
    expect(byService.get(catalog.user.serviceId)).toMatchObject({ pricing_basis: 'unit', quantity: 20, unit_rate: 10000 });
    expect(byService.get(catalog.location.serviceId)).toMatchObject({ pricing_basis: 'unit', quantity: 2, unit_rate: 20000 });
    const endpointSnapshot = byService.get(catalog.endpoint.serviceId);
    expect(endpointSnapshot).toMatchObject({ pricing_basis: 'unit', quantity: 30 });
    expect(endpointSnapshot.unit_rate ?? null).toBeNull();

    // The wizard fills an empty template rate from the catalog in the
    // contract currency, then the author adjusts a quantity: 20 -> 23.
    const client = await createSeatClient(db, tenantId);
    const catalogRates = await getServiceCatalogRatesForCurrency([catalog.endpoint.serviceId], 'USD');
    const fixedServices = snapshot.fixed_services.map((service: any) => ({
      ...service,
      unit_rate: service.unit_rate ?? catalogRates[service.service_id],
      quantity: service.service_id === catalog.user.serviceId ? 23 : service.quantity,
    }));
    const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);
    const result = ok(
      await createClientContractFromWizard({
        contract_name: `From template ${uuidv4().slice(0, 6)}`,
        client_id: client.clientId,
        start_date: DECEMBER_START,
        end_date: '2025-06-30',
        billing_frequency: 'monthly',
        enable_proration: false,
        template_id: template.contract_id,
        fixed_services: fixedServices,
        hourly_services: [],
        usage_services: [],
      } as any),
    ) as { contract_id: string; contract_line_id: string };

    const configs = await lineFixedConfigs(result.contract_line_id);
    for (const [service, quantity] of [
      [catalog.user, 23],
      [catalog.endpoint, 30],
      [catalog.location, 2],
    ] as Array<[SeatCatalogService, number]>) {
      const config: any = configs.get(service.serviceId);
      expect(config.pricing_basis, service.name).toBe('unit');
      expect(Number(config.quantity)).toBe(quantity);
    }
    expect(await lineCustomRate(result.contract_line_id)).toBeNull();

    await syncLine(result.contract_line_id);
    const invoice: any = ok(await generateInvoice(januaryCycle));
    // 23 x $100 + 30 x $50 + 2 x $200
    expect(Number(invoice.subtotal)).toBe(420000);
  }, HOOK_TIMEOUT);

  it('a mixed template keeps its allocation members as bundle and stores no unit row for them', async () => {
    const catalog = await seatCatalog();
    const template = await createTemplate([
      { service_id: catalog.endpoint.serviceId, pricing_basis: 'bundle', quantity: 1 },
      { service_id: catalog.location.serviceId, quantity: 3 },
      { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 5, unit_rate: 10000 },
    ]);
    const configs = await templateFixedConfigs(template.contract_line_id!);
    expect((configs.get(catalog.endpoint.serviceId) as any).pricing_basis ?? null).not.toBe('unit');
    expect((configs.get(catalog.location.serviceId) as any).pricing_basis ?? null).not.toBe('unit');
    expect((configs.get(catalog.user.serviceId) as any).pricing_basis).toBe('unit');

    const snapshot: any = ok(await getContractTemplateSnapshotForClientWizard(template.contract_id));
    const byService = new Map<string, any>(snapshot.fixed_services.map((s: any) => [s.service_id, s]));
    expect(byService.get(catalog.user.serviceId).pricing_basis).toBe('unit');
    expect(byService.get(catalog.endpoint.serviceId).pricing_basis ?? 'bundle').toBe('bundle');
    expect(byService.get(catalog.location.serviceId).pricing_basis ?? 'bundle').toBe('bundle');
  }, HOOK_TIMEOUT);

  it('an existing bundle template is unchanged: no fixed-config rows, bundle snapshot', async () => {
    const catalog = await seatCatalog();
    const template = await createTemplate(
      [
        { service_id: catalog.endpoint.serviceId, quantity: 1 },
        { service_id: catalog.location.serviceId, quantity: 3 },
      ],
      { fixed_base_rate: 40000 },
    );
    const rows = await tenantTable(db, tenantId, 'contract_template_line_service_fixed_config as f')
      .join('contract_template_line_service_configuration as c', function join() {
        this.on('f.config_id', 'c.config_id').andOn('f.tenant', 'c.tenant');
      })
      .where({ 'c.tenant': tenantId, 'c.template_line_id': template.contract_line_id });
    expect(rows).toHaveLength(0);

    const snapshot: any = ok(await getContractTemplateSnapshotForClientWizard(template.contract_id));
    for (const service of snapshot.fixed_services) {
      expect(service.pricing_basis ?? 'bundle').toBe('bundle');
    }
  }, HOOK_TIMEOUT);

  it('rejects a fractional or negative seat count and writes no template', async () => {
    const catalog = await seatCatalog();
    for (const quantity of [2.5, -1]) {
      const name = `Bad seat template ${uuidv4().slice(0, 6)}`;
      await expect(
        createContractTemplateFromWizard({
          contract_name: name,
          billing_frequency: 'monthly',
          fixed_services: [{ service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity, unit_rate: 10000 }],
        } as any),
      ).rejects.toThrow(/whole number|quantity/i);
      const rows = await tenantTable(db, tenantId, 'contract_templates').where({ tenant: tenantId, template_name: name });
      expect(rows).toHaveLength(0);
    }
  }, HOOK_TIMEOUT);

  describe('every template -> contract copy path keeps per-seat services', () => {
    async function templateWithSeats() {
      const catalog = await seatCatalog();
      const template = await createTemplate(templatePackage(catalog));
      return { catalog, template };
    }

    function expectSeatsPreserved(configs: Map<string, any>, catalog: Catalog) {
      expect(configs.size).toBe(3);
      const user = configs.get(catalog.user.serviceId);
      const endpoint = configs.get(catalog.endpoint.serviceId);
      const location = configs.get(catalog.location.serviceId);
      expect(user).toMatchObject({ pricing_basis: 'unit', rate_provenance: 'custom' });
      expect(Number(user.quantity)).toBe(20);
      expect(Number(user.base_rate)).toBe(10000);
      // A template without a stored rate follows the live catalog.
      expect(endpoint).toMatchObject({ pricing_basis: 'unit', rate_provenance: 'inherited' });
      expect(endpoint.base_rate).toBeNull();
      expect(Number(endpoint.quantity)).toBe(30);
      expect(location).toMatchObject({ pricing_basis: 'unit', rate_provenance: 'custom' });
      expect(Number(location.base_rate)).toBe(20000);
    }

    async function emptyContractWithLine() {
      const contractId = uuidv4();
      const lineId = uuidv4();
      await tenantTable(db, tenantId, 'contracts').insert({
        tenant: tenantId,
        contract_id: contractId,
        contract_name: `clone target ${contractId.slice(0, 6)}`,
        billing_frequency: 'monthly',
        currency_code: 'USD',
        is_active: true,
        status: 'active',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      await tenantTable(db, tenantId, 'contract_lines').insert({
        tenant: tenantId,
        contract_line_id: lineId,
        contract_id: contractId,
        contract_line_name: 'clone target line',
        contract_line_type: 'Fixed',
        billing_frequency: 'monthly',
        is_custom: true,
        is_active: true,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      return { contractId, lineId };
    }

    it('shared cloneTemplateContractLine', async () => {
      const { catalog, template } = await templateWithSeats();
      const target = await emptyContractWithLine();
      await db.transaction((trx) =>
        sharedCloneTemplateContractLine(trx, {
          tenant: tenantId,
          templateContractLineId: template.contract_line_id!,
          contractLineId: target.lineId,
          templateContractId: template.contract_id,
        } as any),
      );
      expectSeatsPreserved(await lineFixedConfigs(target.lineId), catalog);
    }, HOOK_TIMEOUT);

    it('billing utils cloneTemplateContractLine', async () => {
      const { catalog, template } = await templateWithSeats();
      const target = await emptyContractWithLine();
      await db.transaction((trx) =>
        billingCloneTemplateContractLine(trx, {
          tenant: tenantId,
          templateContractLineId: template.contract_line_id!,
          contractLineId: target.lineId,
          templateContractId: template.contract_id,
        } as any),
      );
      expectSeatsPreserved(await lineFixedConfigs(target.lineId), catalog);
    }, HOOK_TIMEOUT);

    it('contractLineRepository addContractLine (template line -> new contract line)', async () => {
      const { catalog, template } = await templateWithSeats();
      const target = await emptyContractWithLine();
      const mapping: any = await db.transaction((trx) =>
        addContractLine(trx as any, tenantId, target.contractId, template.contract_line_id!),
      );
      expectSeatsPreserved(await lineFixedConfigs(mapping.contract_line_id), catalog);
    }, HOOK_TIMEOUT);

    it('a line added from a template bills the unit members only (no allocation total, inherited rate follows the catalog)', async () => {
      const { catalog, template } = await templateWithSeats();
      const client = await createSeatClient(db, tenantId);
      const januaryCycle = await client.addMonthlyCycle(JANUARY_START, FEBRUARY_START);
      // A contract to attach the template line to: a zero-seat placeholder bills nothing.
      const host = ok(
        await createClientContractFromWizard({
          contract_name: `Host ${uuidv4().slice(0, 6)}`,
          client_id: client.clientId,
          start_date: DECEMBER_START,
          end_date: '2025-06-30',
          billing_frequency: 'monthly',
          enable_proration: false,
          fixed_services: [
            { service_id: catalog.user.serviceId, pricing_basis: 'unit', quantity: 0, unit_rate: 10000 },
          ],
          hourly_services: [],
          usage_services: [],
        } as any),
      ) as { contract_id: string; contract_line_id: string };

      const mapping: any = await db.transaction((trx) =>
        addContractLine(trx as any, tenantId, host.contract_id, template.contract_line_id!),
      );
      await syncLine(mapping.contract_line_id);
      await syncLine(host.contract_line_id);

      const invoice: any = ok(await generateInvoice(januaryCycle));
      // 20 x $100 + 30 x $50 (catalog) + 2 x $200
      expect(Number(invoice.subtotal)).toBe(390000);
    }, HOOK_TIMEOUT);
  });
});
