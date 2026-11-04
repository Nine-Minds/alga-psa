/**
 * Template amount slots (shared/billingClients/templateAmounts.ts), real DB.
 * A real DB is the only sane way to cover the slot-existence rules: the module
 * walks ~10 template tables. Pure helpers (keys, edits) are covered in the same
 * file without the DB.
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import {
  deleteTemplatePriceSet,
  enumerateTemplateAmountSlots,
  listTemplateCurrencies,
  resolveTemplateAmounts,
  slotAmountsFromEdits,
  templateAmountSlotKey,
  writeTemplatePriceSet,
} from '@alga-psa/shared/billingClients/templateAmounts';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

let db: Knex;
let tenantId: string;
const t = (table: string) => tenantDb(db, tenantId).table(table);

const created = { templateIds: [] as string[], serviceIds: [] as string[], serviceTypeIds: [] as string[] };

async function insertService(serviceTypeId: string, name: string) {
  const serviceId = uuidv4();
  await t('service_catalog').insert({
    tenant: tenantId,
    service_id: serviceId,
    service_name: `${name} ${serviceId.slice(0, 6)}`,
    description: name,
    default_rate: 100,
    unit_of_measure: 'hour',
    billing_method: 'fixed',
    custom_service_type_id: serviceTypeId,
    tax_rate_id: null,
    category_id: null,
  });
  created.serviceIds.push(serviceId);
  return serviceId;
}

async function insertTemplate(currency: string) {
  const templateId = uuidv4();
  await t('contract_templates').insert({
    tenant: tenantId,
    template_id: templateId,
    template_name: `Amounts ${templateId.slice(0, 6)}`,
    default_billing_frequency: 'monthly',
    template_status: 'published',
    currency_code: currency,
  });
  created.templateIds.push(templateId);
  return templateId;
}

async function insertLine(templateId: string, row: Record<string, unknown>) {
  const lineId = uuidv4();
  await t('contract_template_lines').insert({
    tenant: tenantId,
    template_line_id: lineId,
    template_id: templateId,
    billing_frequency: 'monthly',
    ...row,
  });
  return lineId;
}

async function insertMember(
  lineId: string,
  serviceId: string,
  type: 'Fixed' | 'Hourly' | 'Usage',
  member: { quantity?: number; rate?: number | null; order?: number } = {},
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

type Fixture = Awaited<ReturnType<typeof seed>>;

async function seed() {
  const serviceTypeId = uuidv4();
  await t('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Amounts Type ${serviceTypeId.slice(0, 6)}`,
    order_number: Math.floor(Math.random() * 1_000_000),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  created.serviceTypeIds.push(serviceTypeId);
  const svc = {
    bundle1: await insertService(serviceTypeId, 'Bundle One'),
    bundle2: await insertService(serviceTypeId, 'Bundle Two'),
    seat: await insertService(serviceTypeId, 'Seat'),
    hourly: await insertService(serviceTypeId, 'Hourly'),
    usage: await insertService(serviceTypeId, 'Usage'),
    legacy: await insertService(serviceTypeId, 'Legacy Bucket'),
    pooled: await insertService(serviceTypeId, 'Pooled'),
    noRate: await insertService(serviceTypeId, 'No Rate'),
  };
  const templateId = await insertTemplate('USD');
  const lines: Record<string, string> = {};

  // Fixed bundle: line rate 3000 = 2x1000 + 1x1000 shares.
  lines.bundle = await insertLine(templateId, { template_line_name: 'Bundle', line_type: 'Fixed', custom_rate: 300000, display_order: 0 });
  await insertMember(lines.bundle, svc.bundle1, 'Fixed', { quantity: 2, rate: 200000, order: 0 });
  await insertMember(lines.bundle, svc.bundle2, 'Fixed', { quantity: 1, rate: 100000, order: 1 });

  // Fixed per-seat: no line rate (0 in fixed config = none), unit rate 1500.
  lines.seat = await insertLine(templateId, { template_line_name: 'Seats', line_type: 'Fixed', custom_rate: null, display_order: 1 });
  await t('contract_template_line_fixed_config').insert({ tenant: tenantId, template_line_id: lines.seat, base_rate: 0 });
  const seatConfig = await insertMember(lines.seat, svc.seat, 'Fixed', { quantity: 5 });
  await t('contract_template_line_service_fixed_config').insert({
    tenant: tenantId,
    config_id: seatConfig,
    pricing_basis: 'unit',
    base_rate: 1500,
  });
  // A seat member without a stored rate follows the catalog: no slot.
  const seatNoRate = await insertMember(lines.seat, svc.noRate, 'Fixed', { quantity: 1, order: 1 });
  await t('contract_template_line_service_fixed_config').insert({
    tenant: tenantId,
    config_id: seatNoRate,
    pricing_basis: 'unit',
    base_rate: 0,
  });

  // Hourly with line overtime + member overtime.
  lines.hourly = await insertLine(templateId, {
    template_line_name: 'Desk',
    line_type: 'Hourly',
    display_order: 2,
    overtime_rate: 21000,
  });
  const hourlyConfig = await insertMember(lines.hourly, svc.hourly, 'Hourly');
  await t('contract_template_line_service_hourly_config').insert({
    tenant: tenantId,
    config_id: hourlyConfig,
    hourly_rate: 14000,
    overtime_rate: 22000,
  });

  // Usage.
  lines.usage = await insertLine(templateId, { template_line_name: 'Usage', line_type: 'Usage', display_order: 3 });
  const usageConfig = await insertMember(lines.usage, svc.usage, 'Usage');
  await t('contract_template_line_service_usage_config').insert({
    tenant: tenantId,
    config_id: usageConfig,
    unit_of_measure: 'GB',
    base_rate: 350,
  });

  // Pools: one with overage, one without (0).
  lines.pools = await insertLine(templateId, { template_line_name: 'Pools', line_type: 'Hourly', display_order: 4 });
  const poolsConfig = await insertMember(lines.pools, svc.pooled, 'Hourly');
  await t('contract_template_line_service_hourly_config').insert({ tenant: tenantId, config_id: poolsConfig, hourly_rate: 0 });
  const poolWith = uuidv4();
  const poolWithout = uuidv4();
  for (const [bucketId, name, overage] of [
    [poolWith, 'Support Hours', 9500],
    [poolWithout, 'Free Hours', 0],
  ] as Array<[string, string, number]>) {
    await t('contract_template_line_buckets').insert({
      tenant: tenantId,
      bucket_id: bucketId,
      template_line_id: lines.pools,
      bucket_name: name,
      total_minutes: 600,
      overage_rate: overage,
      allow_rollover: false,
      billing_period: 'monthly',
      covers_all_services: false,
    });
  }

  // Legacy bucket config (no pools on this line).
  lines.legacy = await insertLine(templateId, { template_line_name: 'Legacy', line_type: 'Hourly', display_order: 5 });
  const legacyConfig = await insertMember(lines.legacy, svc.legacy, 'Hourly');
  await t('contract_template_line_service_bucket_config').insert({
    tenant: tenantId,
    config_id: legacyConfig,
    total_minutes: 300,
    billing_period: 'monthly',
    overage_rate: 7700,
    allow_rollover: false,
  });

  // $0 line rate: intentional snapshot.
  lines.zero = await insertLine(templateId, { template_line_name: 'Zero', line_type: 'Fixed', custom_rate: 0, display_order: 6 });

  return { templateId, lines, svc, poolWith, poolWithout };
}

const key = templateAmountSlotKey;

describe('templateAmounts (pure helpers)', () => {
  it('builds every key shape in one place', () => {
    const ids = { template_line_id: 'L', service_id: 'S', bucket_id: 'B' };
    expect(key('line_base_rate', ids)).toBe('line:L:base_rate');
    expect(key('member_rate', ids)).toBe('line:L:svc:S:rate');
    expect(key('line_overtime_rate', ids)).toBe('line:L:overtime_rate');
    expect(key('member_overtime_rate', ids)).toBe('line:L:svc:S:overtime_rate');
    expect(key('bucket_overage_rate', ids)).toBe('line:L:bucket:B:overage_rate');
    expect(key('legacy_bucket_overage_rate', ids)).toBe('line:L:svc:S:bucket_overage_rate');
    expect(() => key('member_rate', { template_line_id: 'L' })).toThrow();
  });
});

describe('templateAmounts (DB)', () => {
  let fx: Fixture;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    const existing = await tenantDb(db, '__test_tenant_fixture__')
      .unscoped('tenants', 'test fixture reads tenant rows')
      .first<{ tenant: string }>('tenant');
    tenantId = existing?.tenant ?? uuidv4();
    if (!existing) {
      await tenantDb(db, '__test_tenant_fixture__')
        .unscoped('tenants', 'test fixture creates tenant rows')
        .insert({
          tenant: tenantId,
          client_name: 'Template Amounts Test Tenant',
          email: 'template-amounts@test.co',
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        });
    }
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    const safe = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch {
        /* ignore cleanup issues */
      }
    };
    for (const templateId of created.templateIds) {
      await safe(() => t('contract_template_prices').where({ template_id: templateId }).del());
      await safe(() => t('contract_template_price_sets').where({ template_id: templateId }).del());
      const lines = (await t('contract_template_lines').where({ template_id: templateId }).select('template_line_id')) as any[];
      const lineIds = lines.map((l) => l.template_line_id);
      if (lineIds.length) {
        const cfg = (await t('contract_template_line_service_configuration').whereIn('template_line_id', lineIds).select('config_id')) as any[];
        const cfgIds = cfg.map((c) => c.config_id);
        for (const table of [
          'contract_template_line_service_hourly_config',
          'contract_template_line_service_usage_config',
          'contract_template_line_service_fixed_config',
          'contract_template_line_service_bucket_config',
        ]) {
          await safe(() => t(table).whereIn('config_id', cfgIds).del());
        }
        for (const table of [
          'contract_template_line_bucket_services',
          'contract_template_line_buckets',
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
    for (const serviceId of created.serviceIds) await safe(() => t('service_catalog').where({ service_id: serviceId }).del());
    for (const id of created.serviceTypeIds) await safe(() => t('service_types').where({ id }).del());
    created.templateIds = [];
    created.serviceIds = [];
    created.serviceTypeIds = [];
  });

  describe('enumerateTemplateAmountSlots', () => {
    it('produces the right slot set for every line type', async () => {
      fx = await seed();
      const slots = await enumerateTemplateAmountSlots(db, tenantId, fx.templateId);
      const byKey = new Map(slots.map((s) => [s.slot_key, s]));
      const { lines, svc } = fx;

      // Fixed bundle: line rate required, shares derived (not required).
      expect(byKey.get(key('line_base_rate', { template_line_id: lines.bundle }))).toMatchObject({ base_amount: 300000, required: true });
      expect(byKey.get(key('member_rate', { template_line_id: lines.bundle, service_id: svc.bundle1 }))).toMatchObject({
        base_amount: 200000,
        required: false,
      });
      expect(byKey.get(key('member_rate', { template_line_id: lines.bundle, service_id: svc.bundle2 }))?.required).toBe(false);

      // Per-seat: unit rate required; no slot for a seat with no stored rate; fixed-config 0 => no line rate.
      expect(byKey.get(key('member_rate', { template_line_id: lines.seat, service_id: svc.seat }))).toMatchObject({
        base_amount: 1500,
        required: true,
      });
      expect(byKey.has(key('member_rate', { template_line_id: lines.seat, service_id: svc.noRate }))).toBe(false);
      expect(byKey.has(key('line_base_rate', { template_line_id: lines.seat }))).toBe(false);

      // Hourly: rate + both overtime rates.
      expect(byKey.get(key('member_rate', { template_line_id: lines.hourly, service_id: svc.hourly }))).toMatchObject({
        base_amount: 14000,
        required: true,
      });
      expect(byKey.get(key('line_overtime_rate', { template_line_id: lines.hourly }))?.base_amount).toBe(21000);
      expect(byKey.get(key('member_overtime_rate', { template_line_id: lines.hourly, service_id: svc.hourly }))?.base_amount).toBe(22000);

      // Usage.
      expect(byKey.get(key('member_rate', { template_line_id: lines.usage, service_id: svc.usage }))?.base_amount).toBe(350);

      // Pools: only the pool with a positive overage has a slot; its label names the pool.
      const poolSlot = byKey.get(key('bucket_overage_rate', { template_line_id: lines.pools, bucket_id: fx.poolWith }));
      expect(poolSlot).toMatchObject({ base_amount: 9500, required: true, bucket_name: 'Support Hours' });
      expect(poolSlot?.label).toContain('Support Hours');
      expect(byKey.has(key('bucket_overage_rate', { template_line_id: lines.pools, bucket_id: fx.poolWithout }))).toBe(false);
      // A line with pools never produces legacy slots.
      expect([...byKey.values()].some((s) => s.slot_kind === 'legacy_bucket_overage_rate' && s.template_line_id === lines.pools)).toBe(false);

      // Legacy bucket config (line without pools).
      expect(byKey.get(key('legacy_bucket_overage_rate', { template_line_id: lines.legacy, service_id: svc.legacy }))).toMatchObject({
        base_amount: 7700,
        required: true,
      });

      // $0 line rate is an intentional snapshot => a slot with base_amount 0.
      expect(byKey.get(key('line_base_rate', { template_line_id: lines.zero }))).toMatchObject({ base_amount: 0, required: true });
    });
  });

  describe('resolveTemplateAmounts', () => {
    it('base: every base amount; price_set: only the set; none: nothing', async () => {
      fx = await seed();
      const base = await resolveTemplateAmounts(db, tenantId, fx.templateId, 'USD');
      expect(base.source).toBe('base');
      expect(base.template_currency).toBe('USD');
      expect(base.amountBySlot.size).toBe(base.slots.length);

      const dflt = await resolveTemplateAmounts(db, tenantId, fx.templateId, null);
      expect(dflt.source).toBe('base');

      const none = await resolveTemplateAmounts(db, tenantId, fx.templateId, 'EUR');
      expect(none.source).toBe('none');
      expect(none.amountBySlot.size).toBe(0);
      expect(none.price_set_currencies).toEqual([]);

      const lineKey = key('line_base_rate', { template_line_id: fx.lines.bundle });
      const seatKey = key('member_rate', { template_line_id: fx.lines.seat, service_id: fx.svc.seat });
      await writeTemplatePriceSet(db, tenantId, fx.templateId, 'EUR', { [lineKey]: 280000, [seatKey]: 1400 }, null);

      const eur = await resolveTemplateAmounts(db, tenantId, fx.templateId, 'EUR');
      expect(eur.source).toBe('price_set');
      expect(eur.price_set_currencies).toEqual(['EUR']);
      // Partial set: only what the set carries; the rest is NEVER filled from base.
      expect([...eur.amountBySlot.entries()].sort()).toEqual([[lineKey, 280000], [seatKey, 1400]].sort());

      // A currency with no set still falls back to none.
      expect((await resolveTemplateAmounts(db, tenantId, fx.templateId, 'GBP')).source).toBe('none');
    });

    it('ignores price rows for slots that no longer exist in the structure', async () => {
      fx = await seed();
      const seatKey = key('member_rate', { template_line_id: fx.lines.seat, service_id: fx.svc.seat });
      await writeTemplatePriceSet(db, tenantId, fx.templateId, 'EUR', { [seatKey]: 1400 }, null);
      // The base amount goes away: the slot no longer exists.
      await t('contract_template_line_service_fixed_config')
        .whereIn('config_id', (await t('contract_template_line_service_configuration').where({ template_line_id: fx.lines.seat, service_id: fx.svc.seat }).select('config_id')).map((r: any) => r.config_id))
        .update({ base_rate: 0 });
      const eur = await resolveTemplateAmounts(db, tenantId, fx.templateId, 'EUR');
      expect(eur.source).toBe('price_set');
      expect(eur.amountBySlot.size).toBe(0);
    });
  });

  describe('writeTemplatePriceSet / deleteTemplatePriceSet', () => {
    it('rejects the base currency, unknown keys and bad rates', async () => {
      fx = await seed();
      const lineKey = key('line_base_rate', { template_line_id: fx.lines.bundle });
      await expect(writeTemplatePriceSet(db, tenantId, fx.templateId, 'USD', { [lineKey]: 1 }, null)).rejects.toThrow(/base currency/);
      await expect(writeTemplatePriceSet(db, tenantId, fx.templateId, 'EU', { [lineKey]: 1 }, null)).rejects.toThrow(/Invalid currency/);
      await expect(writeTemplatePriceSet(db, tenantId, fx.templateId, 'EUR', { 'line:nope:base_rate': 1 }, null)).rejects.toThrow(/current structure/);
      await expect(writeTemplatePriceSet(db, tenantId, fx.templateId, 'EUR', { [lineKey]: -1 }, null)).rejects.toThrow(/non-negative integer/);
      await expect(writeTemplatePriceSet(db, tenantId, fx.templateId, 'EUR', { [lineKey]: 10.5 }, null)).rejects.toThrow(/non-negative integer/);
      // A rejected write leaves nothing behind.
      expect(await t('contract_template_price_sets').where({ template_id: fx.templateId }).first()).toBeUndefined();
    });

    it('upserts header and rows, leaves other rows alone, then deletes cleanly', async () => {
      fx = await seed();
      const userId = (await t('users').first('user_id'))?.user_id ?? null;
      const lineKey = key('line_base_rate', { template_line_id: fx.lines.bundle });
      const seatKey = key('member_rate', { template_line_id: fx.lines.seat, service_id: fx.svc.seat });

      await writeTemplatePriceSet(db, tenantId, fx.templateId, 'EUR', { [lineKey]: 280000, [seatKey]: 1400 }, userId);
      await writeTemplatePriceSet(db, tenantId, fx.templateId, 'EUR', { [lineKey]: 290000 }, userId);

      const header = await t('contract_template_price_sets').where({ template_id: fx.templateId, currency_code: 'EUR' }).first();
      expect(header?.created_by).toBe(userId);
      expect(header?.updated_by).toBe(userId);
      const rows = (await t('contract_template_prices').where({ template_id: fx.templateId, currency_code: 'EUR' })) as any[];
      expect(Object.fromEntries(rows.map((r) => [r.slot_key, r.rate]))).toEqual({ [lineKey]: 290000, [seatKey]: 1400 });
      expect(rows.find((r) => r.slot_key === seatKey)).toMatchObject({
        slot_kind: 'member_rate',
        template_line_id: fx.lines.seat,
        service_id: fx.svc.seat,
        bucket_id: null,
      });

      expect(await deleteTemplatePriceSet(db, tenantId, fx.templateId, 'EUR')).toBe(true);
      expect(await deleteTemplatePriceSet(db, tenantId, fx.templateId, 'EUR')).toBe(false);
      expect(await t('contract_template_prices').where({ template_id: fx.templateId }).first()).toBeUndefined();
    });
  });

  describe('slotAmountsFromEdits', () => {
    it('maps every edit kind to slot keys and round-trips through a price set', async () => {
      fx = await seed();
      const slots = await enumerateTemplateAmountSlots(db, tenantId, fx.templateId);
      const edits = [
        { template_line_id: fx.lines.bundle, fixed_base_rate: 250000 },
        {
          template_line_id: fx.lines.hourly,
          overtime_rate: 20000,
          services: [{ service_id: fx.svc.hourly, rate: 13000, overtime_rate: 21000 }],
        },
        { template_line_id: fx.lines.pools, bucket_overage_rates: [{ bucket_id: fx.poolWith, rate: 9000 }] },
        { template_line_id: fx.lines.legacy, services: [{ service_id: fx.svc.legacy, bucket_overage_rate: 7000 }] },
        // Ignored: null/undefined carry no amount, and no-slot fields are dropped.
        { template_line_id: fx.lines.usage, services: [{ service_id: fx.svc.usage, rate: null }] },
        { template_line_id: fx.lines.seat, services: [{ service_id: fx.svc.noRate, rate: 999 }] },
      ];
      const amounts = slotAmountsFromEdits(slots, edits);
      expect(amounts).toEqual({
        [key('line_base_rate', { template_line_id: fx.lines.bundle })]: 250000,
        [key('line_overtime_rate', { template_line_id: fx.lines.hourly })]: 20000,
        [key('member_rate', { template_line_id: fx.lines.hourly, service_id: fx.svc.hourly })]: 13000,
        [key('member_overtime_rate', { template_line_id: fx.lines.hourly, service_id: fx.svc.hourly })]: 21000,
        [key('bucket_overage_rate', { template_line_id: fx.lines.pools, bucket_id: fx.poolWith })]: 9000,
        [key('legacy_bucket_overage_rate', { template_line_id: fx.lines.legacy, service_id: fx.svc.legacy })]: 7000,
      });

      await writeTemplatePriceSet(db, tenantId, fx.templateId, 'EUR', amounts, null);
      const resolved = await resolveTemplateAmounts(db, tenantId, fx.templateId, 'EUR');
      expect(Object.fromEntries(resolved.amountBySlot)).toEqual(amounts);
    });
  });

  describe('listTemplateCurrencies', () => {
    it('returns base, sets and incomplete sets for a batch', async () => {
      fx = await seed();
      const second = await insertTemplate('EUR');
      const other = await insertLine(second, { template_line_name: 'Only', line_type: 'Fixed', custom_rate: 1000 });
      void other;

      // GBP set is complete (every REQUIRED slot); EUR set is partial.
      const slots = await enumerateTemplateAmountSlots(db, tenantId, fx.templateId);
      const required = Object.fromEntries(slots.filter((s) => s.required).map((s) => [s.slot_key, s.base_amount + 1]));
      await writeTemplatePriceSet(db, tenantId, fx.templateId, 'GBP', required, null);
      await writeTemplatePriceSet(
        db,
        tenantId,
        fx.templateId,
        'EUR',
        { [key('line_base_rate', { template_line_id: fx.lines.bundle })]: 1 },
        null,
      );

      const summary = await listTemplateCurrencies(db, tenantId, [fx.templateId, second]);
      expect(summary.get(fx.templateId)).toEqual({ base: 'USD', sets: ['EUR', 'GBP'], incomplete_sets: ['EUR'] });
      expect(summary.get(second)).toEqual({ base: 'EUR', sets: [], incomplete_sets: [] });
      expect((await listTemplateCurrencies(db, tenantId, [])).size).toBe(0);
    });
  });
});
