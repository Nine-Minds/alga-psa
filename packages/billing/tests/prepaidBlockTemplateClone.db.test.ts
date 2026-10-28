import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import type { Knex } from 'knex';

// Guarded DB tests for the Prepaid Block config on the template paths (plan section 9, "Clone"):
//  - template -> client contract carries contract_template_line_prepaid_blocks through BOTH clone
//    routines (the canonical cloneTemplateLineToContract and the legacy cloneTemplateContractLine
//    in shared/ and in packages/billing, which share one helper);
//  - contract -> template snapshot (ensureTemplateLineSnapshot, repository + actions copies);
//  - preset -> line copy.
// Run with HOUR_BLOCK_DB_TESTS=1 (see prepaidBlockConfigActions.db.test.ts for the env vars).
const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const connection = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

const hoisted = vi.hoisted(() => {
  const withAuthMock = (fn: any) => (...args: any[]) => fn({ user_id: 'u1', user_type: 'internal' }, { tenant: '' }, ...args);
  return { withAuthMock };
});
vi.mock('@alga-psa/auth', () => ({ withAuth: hoisted.withAuthMock, getSession: vi.fn(async () => null) }));
vi.mock('@alga-psa/auth/withAuth', () => ({ withAuth: hoisted.withAuthMock }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

const repo = enabled ? await import('../src/repositories/contractLineRepository') : (null as any);
const legacyBilling = enabled ? await import('../src/lib/billing/utils/templateClone') : (null as any);
const legacyShared = enabled ? await import('@alga-psa/shared/billingClients/templateClone') : (null as any);
// The legacy clones take their amounts from the resolver instead of copying
// template amount columns, so every caller resolves them for the target contract.
const templateAmounts = enabled ? await import('@alga-psa/shared/billingClients/templateAmounts') : (null as any);
const mappingActions = enabled ? await import('../src/actions/contractLineMappingActions') : (null as any);
const configService = enabled ? await import('../src/services/prepaidBlockConfigService') : (null as any);

const BLOCK = {
  block_minutes: 2400,
  block_price: 440000,
  expiry_months: 12,
  trigger_on_exhaustion: true,
  trigger_threshold_percent: 20,
  trigger_on_expiry: true,
  trigger_on_renewal: false,
  replenishment_tier: 'auto_issue',
};

describe.runIf(enabled)('Prepaid Block config through template clone and snapshot paths', () => {
  let db: Knex;
  let tenant: string;
  let typeId: string;
  let svcA: string;
  let svcB: string;

  // withHourlyConfig=false skips the per-service configuration rows: the shared/ legacy clone's
  // cloneHourlyConfig still selects dropped columns (billing_period, hourly_rate, user_type_rates) from
  // contract_template_line_service_hourly_config, a defect that predates this slice, so its prepaid
  // path is exercised on template lines without per-service configuration.
  async function seedTemplateLine(withBlock = true, withHourlyConfig = true) {
    const templateId = uuidv4();
    const templateLineId = uuidv4();
    // Base currency matches the contracts below (newContract defaults to EUR),
    // so cloning reads the template's own amounts.
    await db('contract_templates').insert({ tenant, template_id: templateId, template_name: `Tpl ${templateId.slice(0, 6)}`, currency_code: 'EUR' });
    await db('contract_template_lines').insert({
      tenant, template_line_id: templateLineId, template_id: templateId, template_line_name: 'Prepaid Block', line_type: 'Hourly',
    });
    for (const [i, serviceId] of [svcA, svcB].entries()) {
      await db('contract_template_line_services').insert({ tenant, template_line_id: templateLineId, service_id: serviceId, display_order: i });
      if (withHourlyConfig) {
        const configId = uuidv4();
        await db('contract_template_line_service_configuration').insert({
          tenant, config_id: configId, template_line_id: templateLineId, service_id: serviceId, configuration_type: 'Hourly',
        });
        await db('contract_template_line_service_hourly_config').insert({ tenant, config_id: configId, minimum_billable_time: 15, round_up_to_nearest: 15 });
      }
    }
    if (withBlock) {
      await db('contract_template_line_prepaid_blocks').insert({ tenant, template_line_id: templateLineId, ...BLOCK, sold_as_service_id: svcB });
    }
    return { templateId, templateLineId };
  }

  async function newContract(currency = 'EUR') {
    const contractId = uuidv4();
    await db('contracts').insert({ tenant, contract_id: contractId, contract_name: `C ${contractId.slice(0, 6)}`, currency_code: currency, status: 'active' });
    return contractId;
  }

  async function blockRow(contractLineId: string) {
    return db('contract_line_prepaid_blocks').where({ tenant, contract_line_id: contractLineId }).first();
  }

  function expectCarried(row: any, soldAs = svcB) {
    expect(row).toBeTruthy();
    expect(row).toMatchObject({
      block_minutes: 2400, expiry_months: 12, trigger_on_exhaustion: true, trigger_threshold_percent: 20,
      trigger_on_expiry: true, trigger_on_renewal: false, replenishment_tier: 'auto_issue', sold_as_service_id: soldAs,
    });
    expect(Number(row.block_price)).toBe(440000);
  }

  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection, pool: { min: 0, max: 4 } });
    tenant = uuidv4();
    typeId = uuidv4();
    svcA = uuidv4();
    svcB = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'PBT Tenant', email: 'pbt@test.local', billing_source: 'test' });
    await db('service_types').insert({ id: typeId, tenant, name: 'PBT Type', is_active: true, order_number: 1 });
    for (const [id, name] of [[svcA, 'Remote Support'], [svcB, 'Onsite Support']] as const) {
      await db('service_catalog').insert({
        service_id: id, tenant, service_name: name, custom_service_type_id: typeId, billing_method: 'hourly',
        default_rate: 11000, unit_of_measure: 'hour', category_id: null, tax_rate_id: null,
        item_kind: 'service', is_active: true, is_license: false,
      });
    }
  });

  afterAll(async () => {
    if (!db) return;
    for (const table of [
      'contract_line_block_issuances', 'contract_line_prepaid_blocks', 'contract_line_preset_prepaid_blocks',
      'contract_line_presets', 'contract_template_line_prepaid_blocks',
      'contract_line_service_hourly_configs', 'contract_line_service_configuration', 'contract_line_services',
      'contract_template_line_service_hourly_config', 'contract_template_line_service_configuration',
      'contract_template_line_services', 'contract_lines', 'contract_template_lines', 'contract_templates',
      'contracts', 'service_catalog', 'service_types', 'tenants',
    ]) {
      await db(table).where({ tenant }).delete().catch(() => undefined);
    }
    await db.destroy();
  });

  it('cloneTemplateLineToContract (canonical routine) copies the block config and keeps the line Hourly', async () => {
    const { templateLineId } = await seedTemplateLine();
    const contractId = await newContract('EUR');
    const result = await db.transaction((trx) =>
      repo.cloneTemplateLineToContract(trx, tenant, contractId, templateLineId, { currencyCode: 'EUR' }));
    const line = await db('contract_lines').where({ tenant, contract_line_id: result.contract_line_id }).first();
    expect(line.contract_line_type).toBe('Hourly');
    expectCarried(await blockRow(result.contract_line_id));
  });

  it('cloneTemplateLineToContract leaves no config row when the template line has none', async () => {
    const { templateLineId } = await seedTemplateLine(false);
    const contractId = await newContract();
    const result = await db.transaction((trx) => repo.cloneTemplateLineToContract(trx, tenant, contractId, templateLineId, {}));
    expect(await blockRow(result.contract_line_id)).toBeUndefined();
  });

  it.each([
    ['shared/billingClients/templateClone', () => legacyShared.cloneTemplateContractLine],
    ['packages/billing templateClone', () => legacyBilling.cloneTemplateContractLine],
  ])('legacy clone routine (%s) copies the block config', async (_label, getFn) => {
    const { templateId, templateLineId } = await seedTemplateLine(true, _label.startsWith('packages'));
    const contractId = await newContract();
    const contractLineId = uuidv4();
    await db('contract_lines').insert({
      tenant, contract_line_id: contractLineId, contract_id: contractId, contract_line_name: 'Legacy clone', contract_line_type: 'Hourly',
    });
    await db.transaction(async (trx) => {
      const amounts = await templateAmounts.resolveTemplateAmountsForContract(trx, tenant, templateId, contractId);
      return getFn()(trx, { tenant, templateContractLineId: templateLineId, contractLineId, templateContractId: templateId, amounts });
    });
    expectCarried(await blockRow(contractLineId));
  });

  it('legacy clone falls back to the first covered service when the template sold-as service is not on the line', async () => {
    const { templateId, templateLineId } = await seedTemplateLine(true, false);
    const stray = uuidv4();
    await db('service_catalog').insert({
      service_id: stray, tenant, service_name: 'Stray', custom_service_type_id: typeId, billing_method: 'hourly',
      default_rate: 1000, unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
    await db('contract_template_line_prepaid_blocks').where({ tenant, template_line_id: templateLineId }).update({ sold_as_service_id: stray });
    const contractId = await newContract();
    const contractLineId = uuidv4();
    await db('contract_lines').insert({
      tenant, contract_line_id: contractLineId, contract_id: contractId, contract_line_name: 'Fallback', contract_line_type: 'Hourly',
    });
    await db.transaction(async (trx) => {
      const amounts = await templateAmounts.resolveTemplateAmountsForContract(trx, tenant, templateId, contractId);
      return legacyShared.cloneTemplateContractLine(trx, { tenant, templateContractLineId: templateLineId, contractLineId, templateContractId: templateId, amounts });
    });
    expect((await blockRow(contractLineId)).sold_as_service_id).toBe(svcA); // first by template display order
  });

  async function seedBlockLine() {
    const contractId = await newContract();
    const lineId = uuidv4();
    await db('contract_lines').insert({
      tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'Source prepaid', contract_line_type: 'Hourly',
    });
    for (const serviceId of [svcA, svcB]) {
      await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
      const configId = uuidv4();
      await db('contract_line_service_configuration').insert({ tenant, config_id: configId, contract_line_id: lineId, service_id: serviceId, configuration_type: 'Hourly' });
      await db('contract_line_service_hourly_configs').insert({ tenant, config_id: configId, hourly_rate: 11000, minimum_billable_time: 15, round_up_to_nearest: 15 });
    }
    await db('contract_line_prepaid_blocks').insert({ tenant, contract_line_id: lineId, ...BLOCK, sold_as_service_id: svcB });
    return lineId;
  }

  async function newTemplate() {
    const templateId = uuidv4();
    // The snapshot source lines live on EUR contracts, and a live line may only
    // be snapshotted into a template whose base currency is the same.
    await db('contract_templates').insert({ tenant, template_id: templateId, template_name: `Snap ${templateId.slice(0, 6)}`, currency_code: 'EUR' });
    return templateId;
  }

  it('ensureTemplateLineSnapshot (repository) carries the block config onto the new template line', async () => {
    const lineId = await seedBlockLine();
    const templateId = await newTemplate();
    const templateLineId = await db.transaction((trx) => repo.ensureTemplateLineSnapshot(trx, tenant, templateId, lineId));
    const row = await db('contract_template_line_prepaid_blocks').where({ tenant, template_line_id: templateLineId }).first();
    expectCarried(row);
  });

  it('ensureTemplateLineSnapshot (contractLineMappingActions copy) carries the block config', async () => {
    const lineId = await seedBlockLine();
    const templateId = await newTemplate();
    await db.transaction((trx) => mappingActions.ensureTemplateLineSnapshot(trx, tenant, templateId, lineId));
    const row = await db('contract_template_line_prepaid_blocks').where({ tenant, template_line_id: lineId }).first();
    expectCarried(row);
  });

  it('re-snapshotting an existing template line does not drop its block config', async () => {
    const lineId = await seedBlockLine();
    const templateId = await newTemplate();
    const templateLineId = await db.transaction((trx) => repo.ensureTemplateLineSnapshot(trx, tenant, templateId, lineId));
    await db.transaction((trx) => repo.ensureTemplateLineSnapshot(trx, tenant, templateId, templateLineId, 5000));
    expectCarried(await db('contract_template_line_prepaid_blocks').where({ tenant, template_line_id: templateLineId }).first());
  });

  it('round-trips contract -> template -> contract with the same config', async () => {
    const lineId = await seedBlockLine();
    const templateId = await newTemplate();
    // The actions copy also snapshots the services, so the clone can resolve the sold-as service.
    await db.transaction((trx) => mappingActions.ensureTemplateLineSnapshot(trx, tenant, templateId, lineId));
    const templateLineId = lineId;
    const contractId = await newContract('GBP');
    const cloned = await db.transaction((trx) =>
      repo.cloneTemplateLineToContract(trx, tenant, contractId, templateLineId, { currencyCode: 'GBP' }));
    expectCarried(await blockRow(cloned.contract_line_id));
  });

  it('copyPresetPrepaidBlockToLine copies a preset config onto a line, validating like a direct upsert', async () => {
    const presetId = uuidv4();
    await db('contract_line_presets').insert({ tenant, preset_id: presetId, preset_name: 'Preset', contract_line_type: 'Hourly' });
    await db('contract_line_preset_prepaid_blocks').insert({ tenant, preset_id: presetId, ...BLOCK, sold_as_service_id: svcB });

    const contractId = await newContract();
    const lineId = uuidv4();
    await db('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'From preset', contract_line_type: 'Hourly' });
    for (const serviceId of [svcA, svcB]) {
      await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
      const configId = uuidv4();
      await db('contract_line_service_configuration').insert({ tenant, config_id: configId, contract_line_id: lineId, service_id: serviceId, configuration_type: 'Hourly' });
      await db('contract_line_service_hourly_configs').insert({ tenant, config_id: configId, hourly_rate: 11000, minimum_billable_time: 15, round_up_to_nearest: 15 });
    }
    const result = await db.transaction((trx) => configService.copyPresetPrepaidBlockToLine(trx, tenant, presetId, lineId));
    expect(result).toBeTruthy();
    expectCarried(await blockRow(lineId));

    // A preset without covered hourly rates cannot produce a block line.
    const unpricedLine = uuidv4();
    await db('contract_lines').insert({ tenant, contract_line_id: unpricedLine, contract_id: contractId, contract_line_name: 'No rates', contract_line_type: 'Hourly' });
    await db('contract_line_services').insert({ tenant, contract_line_id: unpricedLine, service_id: svcA });
    await expect(db.transaction((trx) => configService.copyPresetPrepaidBlockToLine(trx, tenant, presetId, unpricedLine))).rejects.toThrow();
  });

  it('returns null when the preset has no block config', async () => {
    const presetId = uuidv4();
    await db('contract_line_presets').insert({ tenant, preset_id: presetId, preset_name: 'Plain', contract_line_type: 'Hourly' });
    const contractId = await newContract();
    const lineId = uuidv4();
    await db('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'Plain', contract_line_type: 'Hourly' });
    const result = await db.transaction((trx) => configService.copyPresetPrepaidBlockToLine(trx, tenant, presetId, lineId));
    expect(result).toBeNull();
  });
});
