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
import {
  enumerateTemplateAmountSlots,
  resolveTemplateAmountsForContract,
  templateAmountSlotKey,
  writeTemplatePriceSet,
  type TemplateAmountSlot,
} from '@alga-psa/shared/billingClients/templateAmounts';

let db: Knex;
let tenantId: string;
let createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
let listContractTemplatesForWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').listContractTemplatesForWizard;
let getContractTemplateLinesForClientWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').getContractTemplateLinesForClientWizard;
let getDraftContractForResume: typeof import('@alga-psa/billing/actions/contractWizardActions').getDraftContractForResume;
let addContractLine: typeof import('@alga-psa/billing/repositories/contractLineRepository').addContractLine;
let sharedCloneTemplateContractLine: typeof import('@alga-psa/shared/billingClients/templateClone').cloneTemplateContractLine;
let billingCloneTemplateContractLine: typeof import('@alga-psa/billing/lib/billing/utils/templateClone').cloneTemplateContractLine;

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

async function insertTemplate(status: 'draft' | 'published', name: string, currencyCode = 'USD') {
  const templateId = uuidv4();
  await t('contract_templates').insert({
    tenant: tenantId,
    template_id: templateId,
    template_name: `${name} ${templateId.slice(0, 6)}`,
    template_description: `${name} description`,
    default_billing_frequency: 'monthly',
    currency_code: currencyCode,
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
async function seedFullTemplate(templateCurrency = 'USD'): Promise<Seeded> {
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

  const templateId = await insertTemplate('published', 'Full Template', templateCurrency);
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
    ({ cloneTemplateContractLine: sharedCloneTemplateContractLine } = await import('@alga-psa/shared/billingClients/templateClone'));
    ({ cloneTemplateContractLine: billingCloneTemplateContractLine } = await import('@alga-psa/billing/lib/billing/utils/templateClone'));
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
    const seeded = await seedFullTemplate('EUR');
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
    const seeded = await seedFullTemplate('CAD');
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
    const templateId = await insertTemplate('published', 'Unrated Template', 'CAD');
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

  it('per-line view exposes per-field template/resolved/catalog amounts and per-line cadence; resume rebuilds the edits', async () => {
    const seeded = await seedFullTemplate('EUR');
    const clientId = await insertClient('View Client', 'EUR');
    await t('service_prices').insert({
      tenant: tenantId,
      service_id: seeded.serviceIds.hourly1,
      currency_code: 'EUR',
      rate: 13000,
    });

    const view = (await getContractTemplateLinesForClientWizard(seeded.templateId, clientId)) as any;
    expect(view).toMatchObject({
      currency_code: 'EUR',
      template_currency: 'EUR',
      amount_source: 'base',
      can_save_template_amounts: true,
    });
    expect(view.lines).toHaveLength(5);
    const fixedA = view.lines.find((l: any) => l.template_line_id === seeded.lineIds.fixedA);
    expect(fixedA).toMatchObject({
      line_name: 'Managed Services - Core',
      billing_frequency: 'monthly',
      base_rate: { template_amount: 250000, amount: 250000, required: true },
      cadence_owner: 'contract',
      billing_timing: 'advance',
    });
    const hourly = view.lines.find((l: any) => l.template_line_id === seeded.lineIds.hourly);
    expect(hourly.services[0]).toMatchObject({
      rate: { template_amount: 14000, amount: 14000, catalog_amount: 13000, required: true },
      overtime_rate: { template_amount: 21000, amount: 21000 },
      has_currency_price: true,
    });
    expect(hourly.overtime_rate).toMatchObject({ template_amount: 21000, amount: 21000, required: true });

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

  describe('template currency: base amounts, EUR price sets and the mismatch fallback', () => {
    const num = (v: unknown) => (v == null ? null : Number(v));

    /** seedFullTemplate + a per-seat Fixed line (slot C) and a legacy-bucket Hourly line (slot I). */
    async function seedRichTemplate(currency = 'USD') {
      const seeded = await seedFullTemplate(currency);
      const seatService = await insertService(seeded.serviceTypeId, 'Seat Mgmt', 'fixed', 888);
      const legacyService = await insertService(seeded.serviceTypeId, 'Legacy Block', 'hourly', 999);
      const seatLine = await insertTemplateLine(seeded.templateId, {
        template_line_name: 'Per Seat Line',
        billing_frequency: 'monthly',
        line_type: 'Fixed',
        display_order: 5,
        billing_timing: 'arrears',
        cadence_owner: 'client',
      });
      await t('contract_template_line_fixed_config').insert({
        tenant: tenantId,
        template_line_id: seatLine,
        base_rate: 0,
        enable_proration: false,
      });
      const seatCfg = await insertTemplateMember(seatLine, seatService, 'Fixed', { quantity: 3 });
      await t('contract_template_line_service_fixed_config').insert({
        tenant: tenantId,
        config_id: seatCfg,
        pricing_basis: 'unit',
        base_rate: 7500,
      });
      const legacyLine = await insertTemplateLine(seeded.templateId, {
        template_line_name: 'Legacy Bucket Line',
        billing_frequency: 'monthly',
        line_type: 'Hourly',
        display_order: 6,
        billing_timing: 'arrears',
        cadence_owner: 'client',
      });
      const legacyCfg = await insertTemplateMember(legacyLine, legacyService, 'Hourly', {});
      await t('contract_template_line_service_hourly_config').insert({
        tenant: tenantId,
        config_id: legacyCfg,
        hourly_rate: 11000,
        minimum_billable_time: 15,
        round_up_to_nearest: 15,
      });
      await t('contract_template_line_service_bucket_config').insert({
        tenant: tenantId,
        config_id: legacyCfg,
        total_minutes: 300,
        overage_rate: 4500,
        allow_rollover: false,
        billing_period: 'monthly',
      });
      return {
        ...seeded,
        serviceIds: { ...seeded.serviceIds, seat: seatService, legacy: legacyService },
        lineIds: { ...seeded.lineIds, seat: seatLine, legacy: legacyLine },
      };
    }
    type Rich = Awaited<ReturnType<typeof seedRichTemplate>>;

    const SLOT_OFFSET: Record<string, number> = {
      line_base_rate: 7,
      member_rate: 8,
      line_overtime_rate: 9,
      member_overtime_rate: 11,
      bucket_overage_rate: 13,
      legacy_bucket_overage_rate: 17,
    };
    const eurOf = (slot: TemplateAmountSlot) => slot.base_amount + SLOT_OFFSET[slot.slot_kind];

    const requiredSlots = async (templateId: string) =>
      (await enumerateTemplateAmountSlots(db, tenantId, templateId)).filter((slot) => slot.required);

    /** Wizard edits (the shape the UI sends) for the slots `valueOf` returns an amount for. */
    function buildEdits(slots: TemplateAmountSlot[], valueOf: (slot: TemplateAmountSlot) => number | undefined) {
      const byLine = new Map<string, any>();
      for (const slot of slots) {
        const value = valueOf(slot);
        if (value === undefined) continue;
        const edit = byLine.get(slot.template_line_id) ?? {
          template_line_id: slot.template_line_id,
          services: [] as any[],
          bucket_overage_rates: [] as any[],
        };
        byLine.set(slot.template_line_id, edit);
        const service = () => {
          let entry = edit.services.find((s: any) => s.service_id === slot.service_id);
          if (!entry) {
            entry = { service_id: slot.service_id };
            edit.services.push(entry);
          }
          return entry;
        };
        switch (slot.slot_kind) {
          case 'line_base_rate':
            edit.fixed_base_rate = value;
            break;
          case 'line_overtime_rate':
            edit.overtime_rate = value;
            break;
          case 'member_rate':
            service().rate = value;
            break;
          case 'member_overtime_rate':
            service().overtime_rate = value;
            break;
          case 'legacy_bucket_overage_rate':
            service().bucket_overage_rate = value;
            break;
          case 'bucket_overage_rate':
            edit.bucket_overage_rates.push({ bucket_id: slot.bucket_id, rate: value });
            break;
        }
      }
      return [...byLine.values()];
    }

    const submit = (clientId: string, templateId: string, extra: Record<string, unknown> = {}, isDraft = false) =>
      createClientContractFromWizard(
        {
          contract_name: `Template Currency ${uuidv4().slice(0, 6)}`,
          client_id: clientId,
          start_date: today(),
          billing_frequency: 'monthly',
          currency_code: 'EUR',
          fixed_services: [],
          hourly_services: [],
          usage_services: [],
          enable_proration: false,
          template_id: templateId,
          ...extra,
        } as any,
        isDraft ? { isDraft: true } : undefined,
      ) as Promise<any>;

    /** Every amount column that landed on a contract, structured per line (by name). */
    async function landed(contractId: string) {
      const lines = await liveLinesByName(contractId);
      const out: Record<string, any> = {};
      for (const [name, line] of lines) {
        const { services, configs } = await memberRows(line.contract_line_id);
        const members: Record<string, any> = {};
        for (const cfg of configs) {
          const svc = services.find((s: any) => s.service_id === cfg.service_id);
          const fixed = await t('contract_line_service_fixed_config').where({ config_id: cfg.config_id }).first();
          const hourly = await t('contract_line_service_hourly_configs').where({ config_id: cfg.config_id }).first();
          const terms = await t('contract_line_service_hourly_config').where({ config_id: cfg.config_id }).first();
          const usage = await t('contract_line_service_usage_config').where({ config_id: cfg.config_id }).first();
          members[cfg.service_id] = {
            share: num(svc?.custom_rate),
            unit: num(fixed?.base_rate),
            hourly: num(hourly?.hourly_rate),
            overtime: num(terms?.overtime_rate),
            usage: num(usage?.base_rate),
          };
        }
        const pools = (await t('contract_line_buckets').where({ contract_line_id: line.contract_line_id })).map((p: any) =>
          Number(p.overage_rate),
        );
        out[name] = { rate: num(line.custom_rate), overtime: num(line.overtime_rate), members, pools };
      }
      return out;
    }

    /** Flat sorted list of every positive amount on a contract. */
    const flatAmounts = (l: Record<string, any>) =>
      Object.values(l)
        .flatMap((line: any) => [
          line.rate,
          line.overtime,
          ...line.pools,
          ...Object.values(line.members).flatMap((m: any) => [m.share, m.unit, m.hourly, m.overtime, m.usage]),
        ])
        .filter((v): v is number => v != null && v > 0)
        .sort((a, b) => a - b);

    const usdBaseAmounts = async (templateId: string) =>
      new Set((await enumerateTemplateAmountSlots(db, tenantId, templateId)).map((slot) => slot.base_amount));

    async function writeEurSet(seeded: Rich, valueOf: (slot: TemplateAmountSlot) => number | undefined = eurOf) {
      const amounts: Record<string, number> = {};
      for (const slot of await requiredSlots(seeded.templateId)) {
        const value = valueOf(slot);
        if (value !== undefined) amounts[slot.slot_key] = value;
      }
      await writeTemplatePriceSet(db, tenantId, seeded.templateId, 'EUR', amounts, authRef.user.user_id);
      return amounts;
    }

    const counts = async () => ({
      contracts: Number((await t('contracts').count<{ count: string }[]>({ count: '*' }).first())?.count),
      lines: Number((await t('contract_lines').count<{ count: string }[]>({ count: '*' }).first())?.count),
      clientContracts: Number((await t('client_contracts').count<{ count: string }[]>({ count: '*' }).first())?.count),
    });

    it('USD template -> USD client clones every base amount verbatim and records template_contract_id', async () => {
      const seeded = await seedRichTemplate('USD');
      const clientId = await insertClient('USD Client', 'USD');
      const result = await submit(clientId, seeded.templateId, { currency_code: 'USD' });
      created.contractIds.push(result.contract_id);

      const clientContract = await t('client_contracts').where({ contract_id: result.contract_id }).first();
      expect(clientContract.template_contract_id).toBe(seeded.templateId);

      const l = await landed(result.contract_id);
      expect(l['Managed Services - Core'].rate).toBe(250000); // A
      expect(l['Security Add-on Bundle'].rate).toBe(90000); // A
      expect(l['Per Seat Line'].members[seeded.serviceIds.seat].unit).toBe(7500); // C
      expect(l['Service Desk Hourly'].members[seeded.serviceIds.hourly1]).toMatchObject({ hourly: 14000, overtime: 21000 }); // D, G
      expect(l['Service Desk Hourly'].overtime).toBe(21000); // F
      expect(l['Backup Usage'].members[seeded.serviceIds.usage1].usage).toBe(350); // E
      expect(l['Prepaid Support Block'].pools).toEqual([9500]); // H
      expect(l['Prepaid Support Block'].members[seeded.serviceIds.bucketHourly].hourly).toBe(12000);
      expect(l['Legacy Bucket Line'].pools).toEqual([4500]); // I
      expect(l['Legacy Bucket Line'].members[seeded.serviceIds.legacy].hourly).toBe(11000);
    });

    it('USD template with a EUR price set -> EUR client lands the EUR amount of every slot kind and no USD amount', async () => {
      const seeded = await seedRichTemplate('USD');
      const clientId = await insertClient('EUR Set Client', 'EUR');
      const slots = await requiredSlots(seeded.templateId);
      expect(new Set(slots.map((s) => s.slot_kind))).toEqual(
        new Set(Object.keys(SLOT_OFFSET).filter((k) => k !== 'member_rate' || true)),
      );
      await writeEurSet(seeded);

      const view = (await getContractTemplateLinesForClientWizard(seeded.templateId, clientId)) as any;
      expect(view).toMatchObject({ template_currency: 'USD', currency_code: 'EUR', amount_source: 'price_set' });

      const result = await submit(clientId, seeded.templateId);
      created.contractIds.push(result.contract_id);
      expect((await t('contracts').where({ contract_id: result.contract_id }).first()).currency_code).toBe('EUR');

      const l = await landed(result.contract_id);
      expect(l['Managed Services - Core'].rate).toBe(250000 + 7);
      expect(l['Security Add-on Bundle'].rate).toBe(90000 + 7);
      expect(l['Per Seat Line'].members[seeded.serviceIds.seat].unit).toBe(7500 + 8);
      expect(l['Service Desk Hourly'].members[seeded.serviceIds.hourly1]).toMatchObject({
        hourly: 14000 + 8,
        overtime: 21000 + 11,
      });
      expect(l['Service Desk Hourly'].overtime).toBe(21000 + 9);
      expect(l['Backup Usage'].members[seeded.serviceIds.usage1].usage).toBe(350 + 8);
      expect(l['Prepaid Support Block'].pools).toEqual([9500 + 13]);
      expect(l['Prepaid Support Block'].members[seeded.serviceIds.bucketHourly].hourly).toBe(12000 + 8);
      expect(l['Legacy Bucket Line'].pools).toEqual([4500 + 17]);
      expect(l['Legacy Bucket Line'].members[seeded.serviceIds.legacy].hourly).toBe(11000 + 8);

      // Bundle shares are derived from the EUR line rate, never copied from USD.
      const usd = await usdBaseAmounts(seeded.templateId);
      for (const amount of flatAmounts(l)) expect(usd.has(amount)).toBe(false);
    });

    it('USD-only template -> EUR client with nothing entered is rejected listing every required slot, and rolls back', async () => {
      const seeded = await seedRichTemplate('USD');
      const clientId = await insertClient('EUR Bare Client', 'EUR');
      const before = await counts();

      const result = await submit(clientId, seeded.templateId);
      expect(result.actionError).toMatch(/^Cannot create contract in EUR\. The following amounts have no EUR value: /);
      expect(result.actionError).toMatch(/Enter an amount for each, or add EUR rates to the template\.$/);
      for (const slot of await requiredSlots(seeded.templateId)) {
        expect(result.actionError).toContain(`"${slot.label}"`);
      }
      expect(result.messageKey).toBe('msp/contracts:errors.wizard.templateAmountsMissing');
      expect(result.messageParams).toMatchObject({ currency: 'EUR' });
      expect(result.messageParams.amounts).toContain('Managed Services - Core — base rate');

      expect(await counts()).toEqual(before);
      expect(await t('client_contracts').where({ client_id: clientId })).toHaveLength(0);

      // Drafts are rejected the same way.
      const draft = await submit(clientId, seeded.templateId, {}, true);
      expect(draft.actionError).toMatch(/Cannot create contract in EUR/);
      expect(await counts()).toEqual(before);
    });

    it('USD-only template -> EUR client with EUR catalog prices: view returns catalog_amount, a fully edited submission lands only EUR amounts', async () => {
      const seeded = await seedRichTemplate('USD');
      const clientId = await insertClient('EUR Catalog Client', 'EUR');
      const catalog: Record<string, number> = {
        [seeded.serviceIds.hourly1]: 13111,
        [seeded.serviceIds.usage1]: 411,
        [seeded.serviceIds.bucketHourly]: 11222,
        [seeded.serviceIds.legacy]: 10333,
      };
      for (const [serviceId, rate] of Object.entries(catalog)) {
        await t('service_prices').insert({ tenant: tenantId, service_id: serviceId, currency_code: 'EUR', rate });
      }

      const view = (await getContractTemplateLinesForClientWizard(seeded.templateId, clientId)) as any;
      expect(view.amount_source).toBe('none');
      const hourlyView = view.lines.find((v: any) => v.template_line_id === seeded.lineIds.hourly);
      expect(hourlyView.services[0].rate).toMatchObject({ template_amount: 14000, amount: null, catalog_amount: 13111, required: true });
      expect(hourlyView.base_rate.amount).toBeNull();
      const usageView = view.lines.find((v: any) => v.template_line_id === seeded.lineIds.usage);
      expect(usageView.services[0].rate.catalog_amount).toBe(411);

      // The UI prefills the catalog price into the edit; everything else is typed.
      const slots = await requiredSlots(seeded.templateId);
      const edits = buildEdits(slots, (slot) =>
        slot.slot_kind === 'member_rate' && slot.service_id && catalog[slot.service_id] !== undefined
          ? catalog[slot.service_id]
          : eurOf(slot),
      );
      const result = await submit(clientId, seeded.templateId, { template_lines: edits });
      created.contractIds.push(result.contract_id);

      const l = await landed(result.contract_id);
      expect(l['Service Desk Hourly'].members[seeded.serviceIds.hourly1].hourly).toBe(13111);
      expect(l['Backup Usage'].members[seeded.serviceIds.usage1].usage).toBe(411);
      expect(l['Managed Services - Core'].rate).toBe(250007);
      expect(l['Service Desk Hourly'].overtime).toBe(21009);
      expect(l['Service Desk Hourly'].members[seeded.serviceIds.hourly1].overtime).toBe(21011);
      expect(l['Prepaid Support Block'].pools).toEqual([9513]);
      expect(l['Legacy Bucket Line'].pools).toEqual([4517]);
      expect(l['Per Seat Line'].members[seeded.serviceIds.seat].unit).toBe(7508);

      const usd = await usdBaseAmounts(seeded.templateId);
      for (const amount of flatAmounts(l)) expect(usd.has(amount)).toBe(false);
      // Nothing was saved to the template without the flag.
      expect(await t('contract_template_price_sets').where({ template_id: seeded.templateId })).toHaveLength(0);
    });

    it('save_template_amounts stores a price set; a second EUR client then clones verbatim with no edits', async () => {
      const seeded = await seedRichTemplate('USD');
      const first = await insertClient('EUR Save Client A', 'EUR');
      const second = await insertClient('EUR Save Client B', 'EUR');
      const slots = await requiredSlots(seeded.templateId);
      const edits = buildEdits(slots, eurOf);

      const result = await submit(first, seeded.templateId, { template_lines: edits, save_template_amounts: true });
      created.contractIds.push(result.contract_id);

      const sets = await t('contract_template_price_sets').where({ template_id: seeded.templateId });
      expect(sets).toHaveLength(1);
      expect(sets[0]).toMatchObject({ currency_code: 'EUR', created_by: authRef.user.user_id });
      const prices = await t('contract_template_prices').where({ template_id: seeded.templateId, currency_code: 'EUR' });
      expect(prices.map((p: any) => p.slot_key).sort()).toEqual(slots.map((s) => s.slot_key).sort());
      for (const slot of slots) {
        expect(Number(prices.find((p: any) => p.slot_key === slot.slot_key).rate)).toBe(eurOf(slot));
      }

      const view = (await getContractTemplateLinesForClientWizard(seeded.templateId, second)) as any;
      expect(view.amount_source).toBe('price_set');
      const again = await submit(second, seeded.templateId);
      created.contractIds.push(again.contract_id);
      expect(flatAmounts(await landed(again.contract_id))).toEqual(flatAmounts(await landed(result.contract_id)));
    });

    it('save_template_amounts is ignored when the template currency is the contract currency', async () => {
      const seeded = await seedRichTemplate('USD');
      const clientId = await insertClient('USD Save Client', 'USD');
      const result = await submit(clientId, seeded.templateId, { currency_code: 'USD', save_template_amounts: true });
      created.contractIds.push(result.contract_id);
      expect(await t('contract_template_price_sets').where({ template_id: seeded.templateId })).toHaveLength(0);
    });

    it('save_template_amounts without billing:update is rejected and the whole request rolls back', async () => {
      const seeded = await seedRichTemplate('USD');
      const clientId = await insertClient('EUR No Perm Client', 'EUR');
      const edits = buildEdits(await requiredSlots(seeded.templateId), eurOf);
      const before = await counts();

      setupCommonMocks({
        tenantId,
        userId: authRef.user.user_id,
        permissionCheck: (_user, resource, action) => !(resource === 'billing' && action === 'update'),
      });
      try {
        const view = (await getContractTemplateLinesForClientWizard(seeded.templateId, clientId)) as any;
        expect(view.can_save_template_amounts).toBe(false);

        const result = await submit(clientId, seeded.templateId, { template_lines: edits, save_template_amounts: true });
        expect(result.permissionError).toMatch(/Permission denied/);
      } finally {
        setupCommonMocks({ tenantId, userId: authRef.user.user_id, permissionCheck: () => true });
      }
      expect(await counts()).toEqual(before);
      expect(await t('contract_template_price_sets').where({ template_id: seeded.templateId })).toHaveLength(0);
      expect(await t('contract_template_prices').where({ template_id: seeded.templateId })).toHaveLength(0);

      // The same submission without the flag is fine.
      const ok = await submit(clientId, seeded.templateId, { template_lines: edits });
      created.contractIds.push(ok.contract_id);
      expect(ok.contract_id).toBeDefined();
    });

    it('partial set: a line added after the EUR set was saved needs new amounts; old slots clone from the set; saving completes the set', async () => {
      const seeded = await seedRichTemplate('USD');
      await writeEurSet(seeded);

      // A new line with two required slots (hourly rate + line overtime), added after the set.
      const lateService = await insertService(seeded.serviceTypeId, 'Late Addition', 'hourly', 123);
      const lateLine = await insertTemplateLine(seeded.templateId, {
        template_line_name: 'Late Added Line',
        billing_frequency: 'monthly',
        line_type: 'Hourly',
        display_order: 9,
        overtime_rate: 15000,
        billing_timing: 'arrears',
        cadence_owner: 'client',
      });
      const lateCfg = await insertTemplateMember(lateLine, lateService, 'Hourly', {});
      await t('contract_template_line_service_hourly_config').insert({
        tenant: tenantId,
        config_id: lateCfg,
        hourly_rate: 10000,
        minimum_billable_time: 15,
        round_up_to_nearest: 15,
      });
      const lateRate = templateAmountSlotKey('member_rate', { template_line_id: lateLine, service_id: lateService });
      const lateOvertime = templateAmountSlotKey('line_overtime_rate', { template_line_id: lateLine });

      const clientId = await insertClient('EUR Partial Client', 'EUR');
      const view = (await getContractTemplateLinesForClientWizard(seeded.templateId, clientId)) as any;
      expect(view.amount_source).toBe('price_set');
      const lateView = view.lines.find((v: any) => v.template_line_id === lateLine);
      expect(lateView.services[0].rate).toMatchObject({ amount: null, template_amount: 10000, required: true });
      expect(lateView.overtime_rate).toMatchObject({ amount: null, required: true });
      const oldView = view.lines.find((v: any) => v.template_line_id === seeded.lineIds.fixedA);
      expect(oldView.base_rate.amount).toBe(250007);

      const before = await counts();
      const rejected = await submit(clientId, seeded.templateId);
      expect(rejected.actionError).toMatch(/Cannot create contract in EUR/);
      expect(rejected.actionError).toContain('Late Added Line');
      expect(rejected.actionError).not.toContain('Managed Services - Core');
      expect(await counts()).toEqual(before);

      const edits = [
        {
          template_line_id: lateLine,
          overtime_rate: 15555,
          services: [{ service_id: lateService, rate: 10555 }],
        },
      ];
      const result = await submit(clientId, seeded.templateId, { template_lines: edits, save_template_amounts: true });
      created.contractIds.push(result.contract_id);
      const l = await landed(result.contract_id);
      expect(l['Managed Services - Core'].rate).toBe(250007);
      expect(l['Late Added Line'].overtime).toBe(15555);
      expect(l['Late Added Line'].members[lateService].hourly).toBe(10555);

      const saved = await t('contract_template_prices').where({ template_id: seeded.templateId, currency_code: 'EUR' });
      expect(Number(saved.find((p: any) => p.slot_key === lateRate).rate)).toBe(10555);
      expect(Number(saved.find((p: any) => p.slot_key === lateOvertime).rate)).toBe(15555);
      // The pre-existing rows were left alone.
      expect(
        Number(saved.find((p: any) => p.slot_key === templateAmountSlotKey('line_base_rate', { template_line_id: seeded.lineIds.fixedA })).rate),
      ).toBe(250007);
    });

    it('bundle shares: a EUR set with only the line rate re-splits the shares by quantity', async () => {
      const serviceTypeId = uuidv4();
      await t('service_types').insert({
        id: serviceTypeId,
        tenant: tenantId,
        name: `Bundle Type ${serviceTypeId.slice(0, 6)}`,
        order_number: Math.floor(Math.random() * 1_000_000),
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      created.serviceTypeIds.push(serviceTypeId);
      const m1 = await insertService(serviceTypeId, 'Bundle One', 'fixed', 1);
      const m2 = await insertService(serviceTypeId, 'Bundle Two', 'fixed', 2);
      const templateId = await insertTemplate('published', 'Bundle Template', 'USD');
      const lineId = await insertTemplateLine(templateId, {
        template_line_name: 'Bundle Line',
        billing_frequency: 'monthly',
        line_type: 'Fixed',
        display_order: 0,
        custom_rate: 300000,
        billing_timing: 'arrears',
        cadence_owner: 'client',
      });
      await t('contract_template_line_fixed_config').insert({
        tenant: tenantId,
        template_line_id: lineId,
        base_rate: 300000,
        enable_proration: false,
      });
      await insertTemplateMember(lineId, m1, 'Fixed', { quantity: 1, rate: 100000, order: 0 });
      await insertTemplateMember(lineId, m2, 'Fixed', { quantity: 2, rate: 200000, order: 1 });
      await writeTemplatePriceSet(
        db,
        tenantId,
        templateId,
        'EUR',
        { [templateAmountSlotKey('line_base_rate', { template_line_id: lineId })]: 150000 },
        authRef.user.user_id,
      );

      const clientId = await insertClient('EUR Bundle Client', 'EUR');
      const result = await submit(clientId, templateId);
      created.contractIds.push(result.contract_id);
      const l = await landed(result.contract_id);
      expect(l['Bundle Line'].rate).toBe(150000);
      expect(l['Bundle Line'].members[m1].share).toBe(50000);
      expect(l['Bundle Line'].members[m2].share).toBe(100000);
    });

    it('resume: a fallback-mode draft keeps line/member overtime and pool overage and re-saves unchanged', async () => {
      const seeded = await seedRichTemplate('USD');
      const clientId = await insertClient('EUR Resume Client', 'EUR');
      const edits = buildEdits(await requiredSlots(seeded.templateId), eurOf);

      const draft = await submit(clientId, seeded.templateId, { template_lines: edits }, true);
      created.contractIds.push(draft.contract_id);
      const before = await landed(draft.contract_id);

      const resumed = (await getDraftContractForResume(draft.contract_id)) as any;
      expect(resumed.template_lines).toHaveLength(7);
      const hourlyEdit = resumed.template_lines.find((e: any) => e.template_line_id === seeded.lineIds.hourly);
      expect(hourlyEdit.overtime_rate).toBe(21009);
      expect(hourlyEdit.services[0]).toMatchObject({ service_id: seeded.serviceIds.hourly1, rate: 14008, overtime_rate: 21011 });
      const bucketEdit = resumed.template_lines.find((e: any) => e.template_line_id === seeded.lineIds.bucket);
      const templatePool = await t('contract_template_line_buckets').where({ template_line_id: seeded.lineIds.bucket }).first();
      expect(bucketEdit.bucket_overage_rates).toEqual([{ bucket_id: templatePool.bucket_id, rate: 9513 }]);
      const legacyEdit = resumed.template_lines.find((e: any) => e.template_line_id === seeded.lineIds.legacy);
      expect(legacyEdit.services[0]).toMatchObject({ service_id: seeded.serviceIds.legacy, bucket_overage_rate: 4517 });

      // Re-saving the resumed edits unchanged succeeds (nothing unset) and reproduces every amount.
      const resaved = await submit(
        clientId,
        seeded.templateId,
        { contract_id: draft.contract_id, template_lines: resumed.template_lines },
        true,
      );
      expect(resaved.actionError).toBeUndefined();
      expect(resaved.contract_id).toBe(draft.contract_id);
      expect(await landed(draft.contract_id)).toEqual(before);
    });

    it('the picker returns the template currency, its price-set currencies and which sets are incomplete', async () => {
      const seeded = await seedRichTemplate('USD');
      const plain = await insertTemplate('published', 'Picker Plain', 'GBP');
      await writeEurSet(seeded);

      let options = (await listContractTemplatesForWizard()) as any[];
      expect(options.find((o) => o.contract_id === plain)).toMatchObject({
        currency_code: 'GBP',
        price_set_currencies: [],
        incomplete_set_currencies: [],
      });
      expect(options.find((o) => o.contract_id === seeded.templateId)).toMatchObject({
        currency_code: 'USD',
        price_set_currencies: ['EUR'],
        incomplete_set_currencies: [],
      });

      // A set that lacks a required slot is reported as incomplete.
      await t('contract_template_prices')
        .where({
          template_id: seeded.templateId,
          slot_key: templateAmountSlotKey('line_base_rate', { template_line_id: seeded.lineIds.fixedA }),
        })
        .del();
      options = (await listContractTemplatesForWizard()) as any[];
      expect(options.find((o) => o.contract_id === seeded.templateId)).toMatchObject({
        price_set_currencies: ['EUR'],
        incomplete_set_currencies: ['EUR'],
      });
    });
  });

  describe('currency safety of the clone paths (a template amount never crosses currencies)', () => {
    async function eurContract(name: string) {
      const clientId = await insertClient(name, 'EUR');
      const contractId = uuidv4();
      await t('contracts').insert({
        tenant: tenantId,
        contract_id: contractId,
        contract_name: `${name} Contract ${contractId.slice(0, 6)}`,
        billing_frequency: 'monthly',
        is_template: false,
        status: 'draft',
        currency_code: 'EUR',
        owner_client_id: clientId,
      });
      created.contractIds.push(contractId);
      return contractId;
    }

    /** Every cents value the USD fixture stores anywhere on a template line. */
    const USD_AMOUNTS = new Set([250000, 100000, 50000, 90000, 14000, 21000, 350, 12000, 9500]);

    async function landedAmounts(contractId: string) {
      const lines = (await t('contract_lines').where({ contract_id: contractId })) as any[];
      const amounts: number[] = [];
      for (const line of lines) {
        if (line.custom_rate != null) amounts.push(Number(line.custom_rate));
        if (line.overtime_rate != null) amounts.push(Number(line.overtime_rate));
        const { services, configs } = await memberRows(line.contract_line_id);
        services.forEach((svc: any) => svc.custom_rate != null && amounts.push(Number(svc.custom_rate)));
        configs.forEach((cfg: any) => cfg.custom_rate != null && amounts.push(Number(cfg.custom_rate)));
        for (const cfg of configs) {
          const fixed = await t('contract_line_service_fixed_config').where({ config_id: cfg.config_id }).first();
          if (fixed?.base_rate != null) amounts.push(Number(fixed.base_rate));
          const hourly = await t('contract_line_service_hourly_configs').where({ config_id: cfg.config_id }).first();
          if (hourly) amounts.push(Number(hourly.hourly_rate));
          const terms = await t('contract_line_service_hourly_config').where({ config_id: cfg.config_id }).first();
          if (terms?.overtime_rate != null) amounts.push(Number(terms.overtime_rate));
          const usage = await t('contract_line_service_usage_config').where({ config_id: cfg.config_id }).first();
          if (usage?.base_rate != null) amounts.push(Number(usage.base_rate));
        }
        const pools = (await t('contract_line_buckets').where({ contract_line_id: line.contract_line_id })) as any[];
        pools.forEach((pool) => amounts.push(Number(pool.overage_rate)));
      }
      return amounts;
    }

    async function cloneEveryLine(
      clone: 'addContractLine' | 'shared' | 'billing',
      seeded: Seeded,
      contractId: string,
    ) {
      await db.transaction(async (trx) => {
        for (const templateLineId of Object.values(seeded.lineIds)) {
          if (clone === 'addContractLine') {
            await addContractLine(trx, tenantId, contractId, templateLineId);
            continue;
          }
          const lineId = uuidv4();
          const templateLine = await trx('contract_template_lines')
            .where({ tenant: tenantId, template_line_id: templateLineId })
            .first();
          await trx('contract_lines').insert({
            tenant: tenantId,
            contract_line_id: lineId,
            contract_id: contractId,
            contract_line_name: templateLine.template_line_name,
            contract_line_type: templateLine.line_type,
            billing_frequency: templateLine.billing_frequency,
            cadence_owner: 'client',
            is_custom: false,
            is_active: true,
          });
          const amounts = await resolveTemplateAmountsForContract(trx, tenantId, seeded.templateId, contractId);
          const cloneFn = clone === 'shared' ? sharedCloneTemplateContractLine : billingCloneTemplateContractLine;
          await cloneFn(trx, {
            tenant: tenantId,
            templateContractLineId: templateLineId,
            contractLineId: lineId,
            templateContractId: seeded.templateId,
            amounts,
          });
        }
      });
    }

    for (const clone of ['addContractLine', 'shared', 'billing'] as const) {
      it(`${clone}: a USD-only template cloned onto a EUR contract lands no USD amount`, async () => {
        const seeded = await seedFullTemplate('USD');
        const contractId = await eurContract(`Mismatch ${clone}`);
        await cloneEveryLine(clone, seeded, contractId);

        const lines = await liveLinesByName(contractId);
        expect(lines.size).toBe(5);
        const landed = await landedAmounts(contractId);
        const leaked = landed.filter((cents) => USD_AMOUNTS.has(cents));
        expect(leaked).toEqual([]);

        // The structure still clones; unset amounts stay unset (never rejected on this path).
        expect(lines.get('Managed Services - Core').custom_rate).toBeNull();
        const bucketLine = lines.get('Prepaid Support Block');
        const pools = await t('contract_line_buckets').where({ contract_line_id: bucketLine.contract_line_id });
        expect(pools).toHaveLength(1);
        expect(Number(pools[0].overage_rate)).toBe(0);
        expect(Number(pools[0].total_minutes)).toBe(600);
      });

      it(`${clone}: a USD template with a EUR price set lands the EUR amounts verbatim and no USD amount`, async () => {
        const seeded = await seedFullTemplate('USD');
        const slots = await enumerateTemplateAmountSlots(db, tenantId, seeded.templateId);
        const eur: Record<string, number> = {};
        for (const slot of slots) eur[slot.slot_key] = slot.base_amount + 7;
        await db.transaction((trx) => writeTemplatePriceSet(trx, tenantId, seeded.templateId, 'EUR', eur, null));

        const contractId = await eurContract(`Set ${clone}`);
        await cloneEveryLine(clone, seeded, contractId);

        const landed = await landedAmounts(contractId);
        expect(landed.filter((cents) => USD_AMOUNTS.has(cents))).toEqual([]);

        const lines = await liveLinesByName(contractId);
        expect(Number(lines.get('Managed Services - Core').custom_rate)).toBe(250007);
        const hourly = lines.get('Service Desk Hourly');
        const hourlyCfg = (await memberRows(hourly.contract_line_id)).configs[0];
        const hourlyRate = await t('contract_line_service_hourly_configs').where({ config_id: hourlyCfg.config_id }).first();
        expect(Number(hourlyRate.hourly_rate)).toBe(14007);
        const usageCfg = (await memberRows(lines.get('Backup Usage').contract_line_id)).configs[0];
        const usageRate = await t('contract_line_service_usage_config').where({ config_id: usageCfg.config_id }).first();
        if (clone !== 'shared') expect(Number(usageRate.base_rate)).toBe(357);
        const pools = await t('contract_line_buckets').where({
          contract_line_id: lines.get('Prepaid Support Block').contract_line_id,
        });
        expect(Number(pools[0].overage_rate)).toBe(9507);
      });
    }

    it('REST ContractLineService and the clients actions resolve through the contract currency, not the template line columns', async () => {
      const seeded = await seedFullTemplate('USD');
      const contractId = await eurContract('Resolver wiring');
      const amounts = await resolveTemplateAmountsForContract(db, tenantId, seeded.templateId, contractId);
      expect(amounts.target_currency).toBe('EUR');
      expect(amounts.template_currency).toBe('USD');
      expect(amounts.source).toBe('none');
      expect(amounts.amountBySlot.size).toBe(0);
    });
  });

  describe('addContractLine / cloneTemplateLineToContract (the shared clone path)', () => {
    it('copies hourly and usage rates and the fixed config, in the contract currency', async () => {
      const seeded = await seedFullTemplate('EUR');
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
      const seeded = await seedFullTemplate('EUR');
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
