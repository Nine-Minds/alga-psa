/**
 * alga-2026-0002371: creating a client contract from a contract template must
 * reproduce the template faithfully, on the server, in the client's currency.
 *
 * Real DB (see the integration-testing skill). The wizard actions run through the
 * same auth/tenant mocks as contractTemplateWizardCurrency.integration.test.ts.
 */
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let listContractTemplatesForWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').listContractTemplatesForWizard;
let getContractTemplateLinesForClientWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').getContractTemplateLinesForClientWizard;
let getDraftContractForResume: typeof import('@alga-psa/billing/actions/contractWizardActions').getDraftContractForResume;
let addContractLine: typeof import('@alga-psa/billing/repositories/contractLineRepository').addContractLine;

const t = (table: string) => tenantDb(db, tenantId).table(table);

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

// The wizard actions are withAuth-wrapped via @alga-psa/auth; without this the
// real wrapper throws AuthenticationError under the test session. Inline (not
// createAuthModuleMock): the dynamic-import factory deadlocks at collect when
// testMocks is also imported statically.
const authRef: { user: any; tenant: string } = { user: null, tenant: '' };
vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: vi.fn(async () => authRef.user),
  getSession: vi.fn(async () =>
    authRef.user ? { user: { id: authRef.user.user_id, tenant: authRef.tenant } } : null
  ),
  hasPermission: vi.fn(async () => true),
  throwPermissionError: (action: string, additionalInfo?: string): never => {
    throw new Error(`Permission denied: Cannot ${action}${additionalInfo ? `. ${additionalInfo}` : ''}`);
  },
  withAuth: (action: any) => async (...args: any[]) => {
    if (!authRef.user) throw new Error('User not authenticated');
    return action(authRef.user, { tenant: authRef.tenant }, ...args);
  },
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(authRef.user ?? null, authRef.user ? { tenant: authRef.tenant } : null, ...args),
  withAuthCheck: (action: any) => async (...args: any[]) => {
    if (!authRef.user) throw new Error('User not authenticated');
    return action(authRef.user, ...args);
  },
}));

// contractWizardActions imports withAuth from the subpath, not the bare module.
// Like the real wrapper, run the action inside runWithTenant so requireTenantId
// finds the AsyncLocalStorage tenant context.
vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: any) => async (...args: any[]) => {
    if (!authRef.user) throw new Error('User not authenticated');
    const { runWithTenant } = await import('@alga-psa/db');
    return runWithTenant(authRef.tenant, () => action(authRef.user, { tenant: authRef.tenant }, ...args));
  },
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(authRef.user ?? null, authRef.user ? { tenant: authRef.tenant } : null, ...args),
  withAuthCheck: (action: any) => async (...args: any[]) => {
    if (!authRef.user) throw new Error('User not authenticated');
    return action(authRef.user, ...args);
  },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null)
  };
});

type Seeded = {
  serviceTypeId: string;
  templateId: string;
  serviceIds: Record<string, string>;
  lineIds: Record<string, string>;
};

const created = {
  templateIds: [] as string[],
  contractIds: [] as string[],
  clientIds: [] as string[],
  serviceIds: [] as string[],
  serviceTypeIds: [] as string[],
};

async function insertService(serviceTypeId: string, name: string, billingMethod: string, defaultRate: number) {
  const serviceId = uuidv4();
  await t('service_catalog').insert({
    tenant: tenantId,
    service_id: serviceId,
    service_name: `${name} ${serviceId.slice(0, 6)}`,
    description: name,
    default_rate: defaultRate,
    unit_of_measure: billingMethod === 'usage' ? 'GB' : billingMethod === 'hourly' ? 'hour' : 'month',
    billing_method: billingMethod,
    custom_service_type_id: serviceTypeId,
    tax_rate_id: null,
    category_id: null,
  });
  created.serviceIds.push(serviceId);
  return serviceId;
}

async function insertClient(name: string, currency: string) {
  const clientId = uuidv4();
  await t('clients').insert({
    client_id: clientId,
    tenant: tenantId,
    client_name: `${name} ${clientId.slice(0, 6)}`,
    default_currency_code: currency,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  created.clientIds.push(clientId);
  return clientId;
}

async function insertTemplate(status: 'draft' | 'published', name: string) {
  const templateId = uuidv4();
  await t('contract_templates').insert({
    tenant: tenantId,
    template_id: templateId,
    template_name: `${name} ${templateId.slice(0, 6)}`,
    template_description: `${name} description`,
    default_billing_frequency: 'monthly',
    template_status: status,
  });
  created.templateIds.push(templateId);
  return templateId;
}

async function insertTemplateLine(templateId: string, row: Record<string, unknown>) {
  const lineId = uuidv4();
  await t('contract_template_lines').insert({
    tenant: tenantId,
    template_line_id: lineId,
    template_id: templateId,
    ...row,
  });
  return lineId;
}

async function insertTemplateMember(
  lineId: string,
  serviceId: string,
  type: 'Fixed' | 'Hourly' | 'Usage',
  member: { quantity?: number; rate?: number | null; order?: number },
) {
  await t('contract_template_line_services').insert({
    tenant: tenantId,
    template_line_id: lineId,
    service_id: serviceId,
    quantity: member.quantity ?? 1,
    custom_rate: type === 'Fixed' ? (member.rate ?? null) : null,
    display_order: member.order ?? 0,
  });
  const configId = uuidv4();
  await t('contract_template_line_service_configuration').insert({
    tenant: tenantId,
    config_id: configId,
    template_line_id: lineId,
    service_id: serviceId,
    configuration_type: type,
    custom_rate: type === 'Fixed' ? (member.rate ?? null) : null,
    quantity: member.quantity ?? 1,
  });
  return configId;
}

/**
 * Template shaped like the work order's key case: two FIXED lines that differ
 * in name / frequency / base rate / per-service rates, an HOURLY line (custom
 * rate, min time, round-up, overtime, after-hours), a USAGE line, a BUCKET
 * (prepaid-hours) line, and template line defaults.
 */
async function seedFullTemplate(): Promise<Seeded> {
  const serviceTypeId = uuidv4();
  await t('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Clone Type ${serviceTypeId.slice(0, 6)}`,
    order_number: Math.floor(Math.random() * 1_000_000),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  created.serviceTypeIds.push(serviceTypeId);

  const serviceIds = {
    fixedA1: await insertService(serviceTypeId, 'Core Monitoring', 'fixed', 111),
    fixedA2: await insertService(serviceTypeId, 'Core Patching', 'fixed', 222),
    fixedB1: await insertService(serviceTypeId, 'Security Add-on', 'fixed', 333),
    hourly1: await insertService(serviceTypeId, 'Service Desk', 'hourly', 444),
    usage1: await insertService(serviceTypeId, 'Backup Storage', 'usage', 555),
    bucketHourly: await insertService(serviceTypeId, 'Prepaid Support', 'hourly', 666),
  };

  const templateId = await insertTemplate('published', 'Full Template');
  const lineIds: Record<string, string> = {};

  // Fixed line A: monthly, base rate 2500.00 = 2 x 1000.00 + 1 x 500.00, proration on.
  lineIds.fixedA = await insertTemplateLine(templateId, {
    template_line_name: 'Managed Services - Core',
    billing_frequency: 'monthly',
    line_type: 'Fixed',
    display_order: 0,
    custom_rate: 250000,
    billing_timing: 'advance',
    cadence_owner: 'contract',
  });
  await t('contract_template_line_fixed_config').insert({
    tenant: tenantId,
    template_line_id: lineIds.fixedA,
    base_rate: 250000,
    enable_proration: true,
  });
  await insertTemplateMember(lineIds.fixedA, serviceIds.fixedA1, 'Fixed', { quantity: 2, rate: 100000, order: 0 });
  await insertTemplateMember(lineIds.fixedA, serviceIds.fixedA2, 'Fixed', { quantity: 1, rate: 50000, order: 1 });

  // Fixed line B: quarterly, different name and rates, proration off.
  lineIds.fixedB = await insertTemplateLine(templateId, {
    template_line_name: 'Security Add-on Bundle',
    billing_frequency: 'quarterly',
    line_type: 'Fixed',
    display_order: 1,
    custom_rate: 90000,
    billing_timing: 'arrears',
    cadence_owner: 'client',
  });
  await t('contract_template_line_fixed_config').insert({
    tenant: tenantId,
    template_line_id: lineIds.fixedB,
    base_rate: 90000,
    enable_proration: false,
  });
  await insertTemplateMember(lineIds.fixedB, serviceIds.fixedB1, 'Fixed', { quantity: 1, rate: 90000 });

  // Hourly line: rate 140.00, min 30, round-up 15, overtime + after-hours.
  lineIds.hourly = await insertTemplateLine(templateId, {
    template_line_name: 'Service Desk Hourly',
    billing_frequency: 'monthly',
    line_type: 'Hourly',
    display_order: 2,
    minimum_billable_time: 30,
    round_up_to_nearest: 15,
    enable_overtime: true,
    overtime_rate: 21000,
    overtime_threshold: 40,
    enable_after_hours_rate: true,
    after_hours_multiplier: 1.5,
    billing_timing: 'arrears',
    cadence_owner: 'client',
  });
  const hourlyConfigId = await insertTemplateMember(lineIds.hourly, serviceIds.hourly1, 'Hourly', {});
  await t('contract_template_line_service_hourly_config').insert({
    tenant: tenantId,
    config_id: hourlyConfigId,
    hourly_rate: 14000,
    minimum_billable_time: 30,
    round_up_to_nearest: 15,
    enable_overtime: true,
    overtime_rate: 21000,
    overtime_threshold: 40,
    enable_after_hours_rate: true,
    after_hours_multiplier: 1.5,
  });

  // Usage line: unit rate 3.50 GB, tiered flag on (templates store NO tiers).
  lineIds.usage = await insertTemplateLine(templateId, {
    template_line_name: 'Backup Usage',
    billing_frequency: 'monthly',
    line_type: 'Usage',
    display_order: 3,
    billing_timing: 'arrears',
    cadence_owner: 'client',
  });
  const usageConfigId = await insertTemplateMember(lineIds.usage, serviceIds.usage1, 'Usage', {});
  await t('contract_template_line_service_usage_config').insert({
    tenant: tenantId,
    config_id: usageConfigId,
    unit_of_measure: 'GB',
    enable_tiered_pricing: true,
    base_rate: 350,
    minimum_usage: 5,
  });

  // Bucket line: hourly line with a 10h prepaid pool (rollover, 95.00 overage).
  lineIds.bucket = await insertTemplateLine(templateId, {
    template_line_name: 'Prepaid Support Block',
    billing_frequency: 'monthly',
    line_type: 'Hourly',
    display_order: 4,
    minimum_billable_time: 15,
    round_up_to_nearest: 15,
    billing_timing: 'arrears',
    cadence_owner: 'client',
  });
  const bucketConfigId = await insertTemplateMember(lineIds.bucket, serviceIds.bucketHourly, 'Hourly', {});
  await t('contract_template_line_service_hourly_config').insert({
    tenant: tenantId,
    config_id: bucketConfigId,
    hourly_rate: 12000,
    minimum_billable_time: 15,
    round_up_to_nearest: 15,
  });
  const templateBucketId = uuidv4();
  await t('contract_template_line_buckets').insert({
    tenant: tenantId,
    bucket_id: templateBucketId,
    template_line_id: lineIds.bucket,
    bucket_name: 'Support Hours',
    total_minutes: 600,
    overage_rate: 9500,
    allow_rollover: true,
    billing_period: 'monthly',
    covers_all_services: false,
  });
  await t('contract_template_line_bucket_services').insert({
    tenant: tenantId,
    bucket_id: templateBucketId,
    service_id: serviceIds.bucketHourly,
    template_line_id: lineIds.bucket,
    burn_multiplier: 1,
  });

  // Template line defaults.
  await t('contract_template_line_defaults').insert({
    tenant: tenantId,
    template_line_id: lineIds.fixedA,
    service_id: serviceIds.fixedA1,
    line_type: 'Fixed',
    default_tax_behavior: 'taxable',
    metadata: JSON.stringify({ source: 'template-default' }),
  });

  return { serviceTypeId, templateId, serviceIds, lineIds };
}

const today = () => new Date().toISOString().split('T')[0];

async function liveLinesByName(contractId: string) {
  const rows = await t('contract_lines').where({ contract_id: contractId }).orderBy('display_order', 'asc');
  return new Map<string, any>(rows.map((r: any) => [r.contract_line_name, r]));
}

async function memberRows(contractLineId: string) {
  const services = await t('contract_line_services').where({ contract_line_id: contractLineId });
  const configs = await t('contract_line_service_configuration').where({ contract_line_id: contractLineId });
  return { services, configs };
}

describe('create a client contract from a template (alga-2026-0002371)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
    process.env.E2E_AUTH_BYPASS = 'true';

    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
    const { createUser } = await import('../../../test-utils/testDataFactory');
    const userId = await createUser(db, tenantId, { username: 'create-from-template-user' });
    authRef.user = { user_id: userId, tenant: tenantId, user_type: 'internal', roles: [] };
    authRef.tenant = tenantId;
    setupCommonMocks({ tenantId, userId, permissionCheck: () => true });
    ({
      createClientContractFromWizard,
      listContractTemplatesForWizard,
      getContractTemplateLinesForClientWizard,
      getDraftContractForResume,
    } = await import('@alga-psa/billing/actions/contractWizardActions'));
    ({ addContractLine } = await import('@alga-psa/billing/repositories/contractLineRepository'));
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    // Best effort: unique names/ids per test, so leftovers cannot collide.
    const safe = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch {
        /* ignore cleanup issues */
      }
    };
    for (const contractId of created.contractIds) {
      const lines = (await t('contract_lines').where({ contract_id: contractId }).select('contract_line_id')) as any[];
      const lineIds = lines.map((l) => l.contract_line_id);
      if (lineIds.length) {
        for (const table of [
          'contract_line_service_rate_tiers',
          'contract_line_service_usage_config',
          'contract_line_service_hourly_configs',
          'contract_line_service_hourly_config',
          'contract_line_service_fixed_config',
        ]) {
          await safe(async () => {
            const cfg = await t('contract_line_service_configuration').whereIn('contract_line_id', lineIds).select('config_id');
            await t(table).whereIn('config_id', cfg.map((c: any) => c.config_id)).del();
          });
        }
        for (const table of [
          'contract_line_bucket_services',
          'contract_line_buckets',
          'contract_line_service_defaults',
          'contract_line_service_configuration',
          'contract_line_services',
        ]) {
          await safe(() => t(table).whereIn('contract_line_id', lineIds).del());
        }
        await safe(() => t('contract_lines').whereIn('contract_line_id', lineIds).del());
      }
      await safe(() => t('client_contracts').where({ contract_id: contractId }).del());
      await safe(() => t('contracts').where({ contract_id: contractId }).del());
    }
    for (const templateId of created.templateIds) {
      const lines = (await t('contract_template_lines').where({ template_id: templateId }).select('template_line_id')) as any[];
      const lineIds = lines.map((l) => l.template_line_id);
      if (lineIds.length) {
        const cfg = (await t('contract_template_line_service_configuration').whereIn('template_line_id', lineIds).select('config_id')) as any[];
        const cfgIds = cfg.map((c) => c.config_id);
        for (const table of ['contract_template_line_service_hourly_config', 'contract_template_line_service_usage_config']) {
          await safe(() => t(table).whereIn('config_id', cfgIds).del());
        }
        for (const table of [
          'contract_template_line_bucket_services',
          'contract_template_line_buckets',
          'contract_template_line_defaults',
          'contract_template_line_service_configuration',
          'contract_template_line_services',
          'contract_template_line_fixed_config',
        ]) {
          await safe(() => t(table).whereIn('template_line_id', lineIds).del());
        }
        await safe(() => t('contract_template_lines').whereIn('template_line_id', lineIds).del());
      }
      await safe(() => t('contract_templates').where({ template_id: templateId }).del());
    }
    for (const clientId of created.clientIds) await safe(() => t('clients').where({ client_id: clientId }).del());
    for (const serviceId of created.serviceIds) {
      await safe(() => t('service_prices').where({ service_id: serviceId }).del());
      await safe(() => t('service_catalog_mode_defaults').where({ service_id: serviceId }).del());
      await safe(() => t('service_catalog').where({ service_id: serviceId }).del());
    }
    for (const id of created.serviceTypeIds) await safe(() => t('service_types').where({ id }).del());
    created.templateIds = [];
    created.contractIds = [];
    created.clientIds = [];
    created.serviceIds = [];
    created.serviceTypeIds = [];
  });

  it('clones every template line faithfully for a non-USD client and records template_contract_id', async () => {
    const seeded = await seedFullTemplate();
    const clientId = await insertClient('EUR Client', 'EUR');

    const result = await createClientContractFromWizard({
      contract_name: 'Contract from Full Template',
      client_id: clientId,
      start_date: today(),
      billing_frequency: 'monthly',
      currency_code: 'USD', // ignored for a new contract: the client's currency wins
      fixed_services: [],
      hourly_services: [],
      usage_services: [],
      enable_proration: true,
      template_id: seeded.templateId,
      template_lines: [],
    });
    expect((result as any).contract_id).toBeDefined();
    const { contract_id: contractId, contract_line_ids: lineIds } = result as any;
    created.contractIds.push(contractId);

    // Currency + provenance.
    const contract = await t('contracts').where({ contract_id: contractId }).first();
    expect(contract.currency_code).toBe('EUR');
    const clientContract = await t('client_contracts').where({ contract_id: contractId }).first();
    expect(clientContract.template_contract_id).toBe(seeded.templateId);

    // One live line per template line: no merging by type.
    expect(lineIds).toHaveLength(5);
    const lines = await liveLinesByName(contractId);
    expect([...lines.keys()].sort()).toEqual(
      [
        'Backup Usage',
        'Managed Services - Core',
        'Prepaid Support Block',
        'Security Add-on Bundle',
        'Service Desk Hourly',
      ].sort(),
    );

    // Fixed A: own frequency/rate/proration/cadence + per-service rates & quantities.
    const fixedA = lines.get('Managed Services - Core');
    expect(fixedA).toMatchObject({
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      enable_proration: true,
      billing_timing: 'advance',
      cadence_owner: 'contract',
    });
    expect(Number(fixedA.custom_rate)).toBe(250000);
    expect(fixedA.rate_provenance ?? 'custom').toBe('custom');
    const fixedAMembers = await memberRows(fixedA.contract_line_id);
    const a1 = fixedAMembers.services.find((s: any) => s.service_id === seeded.serviceIds.fixedA1);
    const a2 = fixedAMembers.services.find((s: any) => s.service_id === seeded.serviceIds.fixedA2);
    expect([Number(a1.custom_rate), a1.quantity]).toEqual([100000, 2]);
    expect([Number(a2.custom_rate), a2.quantity]).toEqual([50000, 1]);
    const a1Config = fixedAMembers.configs.find((c: any) => c.service_id === seeded.serviceIds.fixedA1);
    const a1Fixed = await t('contract_line_service_fixed_config').where({ config_id: a1Config.config_id }).first();
    expect(Number(a1Fixed.base_rate)).toBe(100000);

    // Fixed B: distinct name/frequency/rate, proration off.
    const fixedB = lines.get('Security Add-on Bundle');
    expect(fixedB).toMatchObject({
      contract_line_type: 'Fixed',
      billing_frequency: 'quarterly',
      enable_proration: false,
      billing_timing: 'arrears',
      cadence_owner: 'client',
    });
    expect(Number(fixedB.custom_rate)).toBe(90000);
    const fixedBMembers = await memberRows(fixedB.contract_line_id);
    expect(fixedBMembers.services).toHaveLength(1);
    expect(Number(fixedBMembers.services[0].custom_rate)).toBe(90000);

    // Hourly: rate, min time, round-up, overtime, after-hours (both live tables).
    const hourly = lines.get('Service Desk Hourly');
    expect(hourly).toMatchObject({
      contract_line_type: 'Hourly',
      minimum_billable_time: 30,
      round_up_to_nearest: 15,
      enable_overtime: true,
      enable_after_hours_rate: true,
    });
    expect(Number(hourly.overtime_rate)).toBe(21000);
    expect(Number(hourly.after_hours_multiplier)).toBe(1.5);
    const hourlyMembers = await memberRows(hourly.contract_line_id);
    const hourlyConfigId = hourlyMembers.configs[0].config_id;
    const hourlyRate = await t('contract_line_service_hourly_configs').where({ config_id: hourlyConfigId }).first();
    expect(Number(hourlyRate.hourly_rate)).toBe(14000);
    expect([hourlyRate.minimum_billable_time, hourlyRate.round_up_to_nearest]).toEqual([30, 15]);
    const hourlyTerms = await t('contract_line_service_hourly_config').where({ config_id: hourlyConfigId }).first();
    expect(hourlyTerms).toMatchObject({ enable_overtime: true, overtime_threshold: 40, enable_after_hours_rate: true });
    expect(Number(hourlyTerms.overtime_rate)).toBe(21000);
    expect(Number(hourlyTerms.after_hours_multiplier)).toBe(1.5);

    // Usage: unit rate + unit + tiered flag. Templates have NO tier storage, so
    // no tiers can be cloned (asserted so nobody mistakes the empty set for a bug).
    const usage = lines.get('Backup Usage');
    expect(usage.contract_line_type).toBe('Usage');
    const usageMembers = await memberRows(usage.contract_line_id);
    const usageConfigId = usageMembers.configs[0].config_id;
    const usageConfig = await t('contract_line_service_usage_config').where({ config_id: usageConfigId }).first();
    expect(Number(usageConfig.base_rate)).toBe(350);
    expect(usageConfig.unit_of_measure).toBe('GB');
    expect(usageConfig.enable_tiered_pricing).toBe(true);
    expect(usageConfig.minimum_usage).toBe(5);
    expect(await t('contract_line_service_rate_tiers').where({ config_id: usageConfigId })).toHaveLength(0);

    // Bucket pool: the pool config and its members are copied to the bucket line.
    const bucketLine = lines.get('Prepaid Support Block');
    const pools = await t('contract_line_buckets').where({ contract_line_id: bucketLine.contract_line_id });
    expect(pools).toHaveLength(1);
    expect(pools[0]).toMatchObject({ bucket_name: 'Support Hours', total_minutes: 600, allow_rollover: true });
    expect(Number(pools[0].overage_rate)).toBe(9500);
    const poolMembers = await t('contract_line_bucket_services').where({ bucket_id: pools[0].bucket_id });
    expect(poolMembers.map((m: any) => m.service_id)).toEqual([seeded.serviceIds.bucketHourly]);
    const bucketHourlyConfig = await memberRows(bucketLine.contract_line_id);
    const bucketRate = await t('contract_line_service_hourly_configs')
      .where({ config_id: bucketHourlyConfig.configs[0].config_id })
      .first();
    expect(Number(bucketRate.hourly_rate)).toBe(12000);

    // Template line defaults.
    const defaults = await t('contract_line_service_defaults').where({ contract_line_id: fixedA.contract_line_id });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]).toMatchObject({
      service_id: seeded.serviceIds.fixedA1,
      line_type: 'Fixed',
      default_tax_behavior: 'taxable',
    });
    expect(defaults[0].metadata).toEqual({ source: 'template-default' });

    // The template itself is untouched.
    expect(await t('contract_template_lines').where({ template_id: seeded.templateId })).toHaveLength(5);
  });

  it('applies per-line edits keyed by template line id on top of the clone (and only to that line)', async () => {
    const seeded = await seedFullTemplate();
    const clientId = await insertClient('CAD Client', 'CAD');

    const result = await createClientContractFromWizard({
      contract_name: 'Edited Clone',
      client_id: clientId,
      start_date: today(),
      billing_frequency: 'monthly',
      currency_code: 'CAD',
      fixed_services: [],
      hourly_services: [],
      usage_services: [],
      enable_proration: true,
      template_id: seeded.templateId,
      template_lines: [
        {
          template_line_id: seeded.lineIds.fixedB,
          line_name: 'Security Add-on (Renamed)',
          billing_frequency: 'monthly',
          fixed_base_rate: 120000,
        },
        {
          template_line_id: seeded.lineIds.hourly,
          minimum_billable_time: 60,
          services: [{ service_id: seeded.serviceIds.hourly1, rate: 16500 }],
        },
      ],
    });
    const { contract_id: contractId } = result as any;
    created.contractIds.push(contractId);
    expect((await t('contracts').where({ contract_id: contractId }).first()).currency_code).toBe('CAD');

    const lines = await liveLinesByName(contractId);
    // Edited fixed line.
    const fixedB = lines.get('Security Add-on (Renamed)');
    expect(fixedB).toBeTruthy();
    expect(fixedB.billing_frequency).toBe('monthly');
    expect(Number(fixedB.custom_rate)).toBe(120000);
    // Edited hourly line.
    const hourly = lines.get('Service Desk Hourly');
    expect(hourly.minimum_billable_time).toBe(60);
    const cfg = (await memberRows(hourly.contract_line_id)).configs[0];
    const rate = await t('contract_line_service_hourly_configs').where({ config_id: cfg.config_id }).first();
    expect(Number(rate.hourly_rate)).toBe(16500);
    expect(rate.minimum_billable_time).toBe(60);
    // Untouched lines keep the template values.
    expect(Number(lines.get('Managed Services - Core').custom_rate)).toBe(250000);
    expect(lines.get('Backup Usage')).toBeTruthy();
  });

  it('resolves un-rated members in the client currency only, and rejects (rolling back) when none exists', async () => {
    const serviceTypeId = uuidv4();
    await t('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: `Unrated Type ${serviceTypeId.slice(0, 6)}`,
      order_number: Math.floor(Math.random() * 1_000_000),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    created.serviceTypeIds.push(serviceTypeId);
    // Legacy default_rate (untagged, effectively USD) must NEVER be used.
    const serviceId = await insertService(serviceTypeId, 'Unrated Hourly', 'hourly', 99999);
    const templateId = await insertTemplate('published', 'Unrated Template');
    const lineId = await insertTemplateLine(templateId, {
      template_line_name: 'Unrated Hourly Line',
      billing_frequency: 'monthly',
      line_type: 'Hourly',
      display_order: 0,
    });
    const configId = await insertTemplateMember(lineId, serviceId, 'Hourly', {});
    await t('contract_template_line_service_hourly_config').insert({
      tenant: tenantId,
      config_id: configId,
      minimum_billable_time: 15,
      round_up_to_nearest: 15,
    });

    const cadClient = await insertClient('CAD No Price', 'CAD');
    const contractsBefore = await t('contracts').where({ is_template: false }).count<{ count: string }[]>({ count: '*' }).first();

    await expect(
      createClientContractFromWizard({
        contract_name: 'Should Not Exist',
        client_id: cadClient,
        start_date: today(),
        billing_frequency: 'monthly',
        currency_code: 'CAD',
        fixed_services: [],
        hourly_services: [],
        usage_services: [],
        enable_proration: false,
        template_id: templateId,
      }),
    ).resolves.toMatchObject({ actionError: expect.stringMatching(/Cannot create contract in CAD.*Unrated Hourly/) });

    // One transaction: nothing was left behind by the failed create.
    const contractsAfter = await t('contracts').where({ is_template: false }).count<{ count: string }[]>({ count: '*' }).first();
    expect(contractsAfter?.count).toBe(contractsBefore?.count);
    expect(await t('contracts').where({ contract_name: 'Should Not Exist' })).toHaveLength(0);

    // A price in the CLIENT currency resolves it (a USD price does not count).
    await t('service_prices').insert({ tenant: tenantId, service_id: serviceId, currency_code: 'USD', rate: 77700 });
    await expect(
      createClientContractFromWizard({
        contract_name: 'Still Should Not Exist',
        client_id: cadClient,
        start_date: today(),
        billing_frequency: 'monthly',
        currency_code: 'CAD',
        fixed_services: [],
        hourly_services: [],
        usage_services: [],
        enable_proration: false,
        template_id: templateId,
      }),
    ).resolves.toMatchObject({ actionError: expect.stringMatching(/Cannot create contract in CAD/) });

    await t('service_prices').insert({ tenant: tenantId, service_id: serviceId, currency_code: 'CAD', rate: 8800 });
    const ok = (await createClientContractFromWizard({
      contract_name: 'CAD Priced Clone',
      client_id: cadClient,
      start_date: today(),
      billing_frequency: 'monthly',
      currency_code: 'CAD',
      fixed_services: [],
      hourly_services: [],
      usage_services: [],
      enable_proration: false,
      template_id: templateId,
    })) as any;
    created.contractIds.push(ok.contract_id);
    const line = (await liveLinesByName(ok.contract_id)).get('Unrated Hourly Line');
    const cfg = (await memberRows(line.contract_line_id)).configs[0];
    const rate = await t('contract_line_service_hourly_configs').where({ config_id: cfg.config_id }).first();
    expect(Number(rate.hourly_rate)).toBe(8800);
  });

  it('the picker lists published templates only, and drafts cannot be instantiated', async () => {
    const published = await insertTemplate('published', 'Picker Published');
    const draft = await insertTemplate('draft', 'Picker Draft');
    const archived = await insertTemplate('archived', 'Picker Archived');

    const options = (await listContractTemplatesForWizard()) as any[];
    const ids = options.map((o) => o.contract_id);
    expect(ids).toContain(published);
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(archived);

    const clientId = await insertClient('Draft Template Client', 'USD');
    await expect(
      createClientContractFromWizard({
        contract_name: 'From Draft Template',
        client_id: clientId,
        start_date: today(),
        billing_frequency: 'monthly',
        currency_code: 'USD',
        fixed_services: [],
        hourly_services: [],
        usage_services: [],
        enable_proration: false,
        template_id: draft,
      }),
    ).resolves.toMatchObject({ actionError: 'Template not found' });
  });

  it('per-line view exposes template rate, client-currency rate and per-line cadence; resume rebuilds the edits', async () => {
    const seeded = await seedFullTemplate();
    const clientId = await insertClient('View Client', 'EUR');
    await t('service_prices').insert({
      tenant: tenantId,
      service_id: seeded.serviceIds.hourly1,
      currency_code: 'EUR',
      rate: 13000,
    });

    const view = (await getContractTemplateLinesForClientWizard(seeded.templateId, clientId)) as any;
    expect(view.currency_code).toBe('EUR');
    expect(view.lines).toHaveLength(5);
    const fixedA = view.lines.find((l: any) => l.template_line_id === seeded.lineIds.fixedA);
    expect(fixedA).toMatchObject({
      line_name: 'Managed Services - Core',
      billing_frequency: 'monthly',
      fixed_base_rate: 250000,
      cadence_owner: 'contract',
      billing_timing: 'advance',
    });
    const hourly = view.lines.find((l: any) => l.template_line_id === seeded.lineIds.hourly);
    expect(hourly.services[0]).toMatchObject({ template_rate: 14000, currency_rate: 13000, has_currency_price: true });

    // Draft create with an edit, then resume: the edit round-trips.
    const draft = (await createClientContractFromWizard(
      {
        contract_name: 'Draft From Template',
        client_id: clientId,
        start_date: today(),
        billing_frequency: 'monthly',
        currency_code: 'EUR',
        fixed_services: [],
        hourly_services: [],
        usage_services: [],
        enable_proration: false,
        template_id: seeded.templateId,
        template_lines: [{ template_line_id: seeded.lineIds.fixedB, line_name: 'Renamed In Draft' }],
      },
      { isDraft: true },
    )) as any;
    created.contractIds.push(draft.contract_id);

    const resumed = (await getDraftContractForResume(draft.contract_id)) as any;
    expect(resumed.template_id).toBe(seeded.templateId);
    const edit = resumed.template_lines.find((e: any) => e.template_line_id === seeded.lineIds.fixedB);
    expect(edit.line_name).toBe('Renamed In Draft');
    expect(edit.billing_frequency).toBe('quarterly');
    expect(resumed.template_lines).toHaveLength(5);

    // Re-saving the draft with the resumed edits does not duplicate lines.
    const resaved = (await createClientContractFromWizard(
      {
        contract_id: draft.contract_id,
        contract_name: 'Draft From Template',
        client_id: clientId,
        start_date: today(),
        billing_frequency: 'monthly',
        currency_code: 'EUR',
        fixed_services: [],
        hourly_services: [],
        usage_services: [],
        enable_proration: false,
        template_id: resumed.template_id,
        template_lines: resumed.template_lines,
      },
      { isDraft: true },
    )) as any;
    expect(resaved.contract_id).toBe(draft.contract_id);
    const lines = await liveLinesByName(draft.contract_id);
    expect(lines.size).toBe(5);
    expect(lines.has('Renamed In Draft')).toBe(true);
  });

  describe('addContractLine / cloneTemplateLineToContract (the shared clone path)', () => {
    it('copies hourly and usage rates and the fixed config, in the contract currency', async () => {
      const seeded = await seedFullTemplate();
      const clientId = await insertClient('AddLine Client', 'EUR');
      // A plain, non-template contract to attach lines to.
      const contractId = uuidv4();
      await t('contracts').insert({
        tenant: tenantId,
        contract_id: contractId,
        contract_name: `AddLine Contract ${contractId.slice(0, 6)}`,
        billing_frequency: 'monthly',
        is_template: false,
        status: 'draft',
        currency_code: 'EUR',
        owner_client_id: clientId,
      });
      created.contractIds.push(contractId);

      await db.transaction(async (trx) => {
        await addContractLine(trx, tenantId, contractId, seeded.lineIds.hourly);
        await addContractLine(trx, tenantId, contractId, seeded.lineIds.usage);
        await addContractLine(trx, tenantId, contractId, seeded.lineIds.fixedA);
      });

      const lines = await liveLinesByName(contractId);
      expect(lines.size).toBe(3);

      const hourly = lines.get('Service Desk Hourly');
      const hourlyCfg = (await memberRows(hourly.contract_line_id)).configs[0];
      const hourlyRate = await t('contract_line_service_hourly_configs').where({ config_id: hourlyCfg.config_id }).first();
      expect(Number(hourlyRate.hourly_rate)).toBe(14000);
      expect([hourlyRate.minimum_billable_time, hourlyRate.round_up_to_nearest]).toEqual([30, 15]);
      const terms = await t('contract_line_service_hourly_config').where({ config_id: hourlyCfg.config_id }).first();
      expect(terms).toMatchObject({ enable_overtime: true, enable_after_hours_rate: true });

      const usage = lines.get('Backup Usage');
      const usageCfg = (await memberRows(usage.contract_line_id)).configs[0];
      const usageRate = await t('contract_line_service_usage_config').where({ config_id: usageCfg.config_id }).first();
      expect(Number(usageRate.base_rate)).toBe(350);
      expect(usageRate.enable_tiered_pricing).toBe(true);

      const fixedA = lines.get('Managed Services - Core');
      expect(Number(fixedA.custom_rate)).toBe(250000);
      expect(fixedA.enable_proration).toBe(true);
      const fixedMembers = await memberRows(fixedA.contract_line_id);
      expect(fixedMembers.services.map((s: any) => Number(s.custom_rate)).sort((a, b) => a - b)).toEqual([50000, 100000]);
      const fixedCfg = fixedMembers.configs.find((c: any) => c.service_id === seeded.serviceIds.fixedA1);
      const fixedConfigRow = await t('contract_line_service_fixed_config').where({ config_id: fixedCfg.config_id }).first();
      expect(Number(fixedConfigRow.base_rate)).toBe(100000);
      expect(await t('contract_line_service_defaults').where({ contract_line_id: fixedA.contract_line_id })).toHaveLength(1);
    });

    it('an explicit customRate still overrides the template line rate (API argument preserved)', async () => {
      const seeded = await seedFullTemplate();
      const contractId = uuidv4();
      await t('contracts').insert({
        tenant: tenantId,
        contract_id: contractId,
        contract_name: `Override Contract ${contractId.slice(0, 6)}`,
        billing_frequency: 'monthly',
        is_template: false,
        status: 'draft',
        currency_code: 'EUR',
      });
      created.contractIds.push(contractId);
      await db.transaction(async (trx) => {
        await addContractLine(trx, tenantId, contractId, seeded.lineIds.fixedB, 45000);
      });
      const line = (await liveLinesByName(contractId)).get('Security Add-on Bundle');
      expect(Number(line.custom_rate)).toBe(45000);
    });
  });
});

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture reads tenant rows')
    .first<{ tenant: string }>('tenant');
  if (existing?.tenant) return existing.tenant;
  const newTenantId = uuidv4();
  await tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates tenant rows')
    .insert({
      tenant: newTenantId,
      client_name: 'Create From Template Integration Test Tenant',
      email: 'create-from-template@test.co',
      created_at: connection.fn.now(),
      updated_at: connection.fn.now(),
    });
  return newTenantId;
}
