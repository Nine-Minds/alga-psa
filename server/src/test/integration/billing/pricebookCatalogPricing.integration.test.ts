import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../test-utils/testContext';
import { createTestService } from '../../../../test-utils/billingTestHelpers';

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});
vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: { capture: vi.fn(), identify: vi.fn(), trackPerformance: vi.fn(), getClient: () => null },
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any)),
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/workflows/persistence', () => ({ WorkflowEventModel: { create: vi.fn() } }));
vi.mock('@alga-psa/workflow-streams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/workflow-streams')>()),
  getRedisStreamClient: () => ({ publishEvent: vi.fn() }),
  toStreamEvent: (event: unknown) => event,
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const { beforeAll: setupContext, beforeEach: resetContext, afterEach: rollbackContext, afterAll: cleanupContext } =
  TestContext.createHelpers();

import { writeServiceCatalogPricing } from '@alga-psa/billing/lib/catalog/serviceCatalogPricing';
import { previewServicePriceRemoval } from '@alga-psa/billing/actions/serviceActions';
import { applyServicePriceChange, previewServicePriceChange } from '@alga-psa/billing/actions/servicePriceRolloutActions';

const TODAY = new Date().toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const FUTURE = addDays(TODAY, 60);
const FUTURE_2 = addDays(TODAY, 120);

describe('pricebook catalog pricing: the single writer', () => {
  let context: TestContext;

  const tenantRows = (serviceId: string) =>
    context.db('service_prices')
      .where({ tenant: context.tenantId, service_id: serviceId })
      .orderBy(['effective_date', 'currency_code']);
  const asTuple = (r: any) => [r.currency_code, Number(r.rate), String(new Date(r.effective_date).toISOString().slice(0, 10)), r.price_book_id ?? null];
  const trxWrite = (serviceId: string, input: Parameters<typeof writeServiceCatalogPricing>[3]) =>
    context.db.transaction((trx) => writeServiceCatalogPricing(trx, context.tenantId, serviceId, input));

  async function makeBook(name: string, effective_date: string, status = 'scheduled'): Promise<string> {
    const id = uuidv4();
    await context.db('catalog_price_books').insert({
      tenant: context.tenantId, price_book_id: id, name, effective_date, status,
    });
    return id;
  }
  async function stamp(serviceId: string, rate: number, date: string, bookId: string, currency = 'USD') {
    await context.db('service_prices').insert({
      price_id: uuidv4(), tenant: context.tenantId, service_id: serviceId, currency_code: currency,
      rate, effective_date: date, display_order: 0, price_book_id: bookId,
    });
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: ['service_catalog', 'service_prices', 'catalog_price_books', 'default_billing_settings', 'audit_logs'],
      clientName: 'Pricebook Test Client',
      userType: 'internal',
    });
    setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, permissionCheck: () => true });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, permissionCheck: () => true });
  }, 60000);
  afterEach(async () => { await rollbackContext(); }, 60000);
  afterAll(async () => { await cleanupContext(); }, 30000);

  async function seedWithTwoBooks() {
    const serviceId = await createTestService(context, { service_name: 'Managed Endpoint', billing_method: 'fixed', default_rate: 100 });
    const b2024 = await makeBook('2024', '2024-01-01');
    const b2025 = await makeBook('2025', '2025-01-01');
    await stamp(serviceId, 110, '2024-01-01', b2024);
    await stamp(serviceId, 120, '2025-01-01', b2025);
    return { serviceId, b2024, b2025 };
  }

  describe('T1: current keeps effective-dated history', () => {
    it('writer: an ordinary save leaves both pricebooks rows intact and writes at today', async () => {
      const { serviceId, b2024, b2025 } = await seedWithTwoBooks();
      const result = await trxWrite(serviceId, { current: [{ currency_code: 'USD', rate: 130 }] });
      expect(result.servicePatch.default_rate).toBe(130);
      const rows = (await tenantRows(serviceId)).map(asTuple);
      expect(rows).toEqual([
        ['USD', 100, '1970-01-01', null],
        ['USD', 110, '2024-01-01', b2024],
        ['USD', 120, '2025-01-01', b2025],
        ['USD', 130, TODAY, null],
      ]);
    });

    it('writer: re-saving the same rate writes nothing new', async () => {
      const { serviceId } = await seedWithTwoBooks();
      await trxWrite(serviceId, { current: [{ currency_code: 'USD', rate: 120 }] });
      expect(await tenantRows(serviceId)).toHaveLength(3);
    });

    it('writer: only a removed currency loses its history', async () => {
      const { serviceId } = await seedWithTwoBooks();
      await context.db('service_prices').insert({
        price_id: uuidv4(), tenant: context.tenantId, service_id: serviceId, currency_code: 'CAD', rate: 150,
        effective_date: '1970-01-01', display_order: 1,
      });
      await trxWrite(serviceId, { current: [{ currency_code: 'USD', rate: 130 }] });
      const rows = (await tenantRows(serviceId)).map(asTuple);
      expect(rows.some((r) => r[0] === 'CAD')).toBe(false);
      expect(rows.filter((r) => r[0] === 'USD')).toHaveLength(4);
    });

    it('writer: a same-day edit merges into the pricebook row, detaches it and is audited', async () => {
      const serviceId = await createTestService(context, { service_name: 'Same Day', billing_method: 'fixed', default_rate: 100 });
      const book = await makeBook('Today book', TODAY);
      await stamp(serviceId, 140, TODAY, book);
      await trxWrite(serviceId, { current: [{ currency_code: 'USD', rate: 145 }], actorUserId: context.userId });
      const rows = await tenantRows(serviceId);
      const today = rows.find((r: any) => String(new Date(r.effective_date).toISOString().slice(0, 10)) === TODAY)!;
      expect(Number(today.rate)).toBe(145);
      expect(today.price_book_id).toBeNull();
      const audit = await context.db('audit_logs').where({ tenant: context.tenantId, record_id: today.price_id });
      expect(audit).toHaveLength(1);
      expect(audit[0].changed_data.rate).toEqual({ old: 140, new: 145 });
      expect(audit[0].details.price_book_id).toBe(book);
    });

    it('writer: the default_rate-only path upserts at today instead of rewriting history', async () => {
      const { serviceId, b2025 } = await seedWithTwoBooks();
      await trxWrite(serviceId, { defaultRate: 150 });
      const rows = (await tenantRows(serviceId)).map(asTuple);
      expect(rows).toContainEqual(['USD', 120, '2025-01-01', b2025]);
      expect(rows).toContainEqual(['USD', 150, TODAY, null]);
    });

    it('caller: applyServicePriceChange (rollout dialog, immediate) keeps history', async () => {
      const { serviceId, b2024, b2025 } = await seedWithTwoBooks();
      const result = await applyServicePriceChange({ serviceId, prices: [{ currency_code: 'USD', rate: 160 }] });
      expect(result).toEqual({ success: true });
      const rows = (await tenantRows(serviceId)).map(asTuple);
      expect(rows).toContainEqual(['USD', 110, '2024-01-01', b2024]);
      expect(rows).toContainEqual(['USD', 120, '2025-01-01', b2025]);
      expect(rows).toContainEqual(['USD', 160, TODAY, null]);
    });

    it('caller: ServiceCatalogService.update (REST) keeps history', async () => {
      const { ServiceCatalogService } = await import('@/lib/api/services/ServiceCatalogService');
      const { serviceId, b2024, b2025 } = await seedWithTwoBooks();
      const service = new ServiceCatalogService();
      vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: context.db, tenant: context.tenantId });
      await service.update(serviceId, { prices: [{ currency_code: 'USD', rate: 170 }] } as never, { tenant: context.tenantId, userId: context.userId } as never);
      const rows = (await tenantRows(serviceId)).map(asTuple);
      expect(rows).toContainEqual(['USD', 110, '2024-01-01', b2024]);
      expect(rows).toContainEqual(['USD', 120, '2025-01-01', b2025]);
      expect(rows).toContainEqual(['USD', 170, TODAY, null]);
    });

    it('caller: ProductCatalogService.update (REST) keeps history', async () => {
      const { ProductCatalogService } = await import('@/lib/api/services/ProductCatalogService');
      const serviceId = await createTestService(context, { service_name: 'Widget', billing_method: 'usage', default_rate: 100 });
      await context.db('service_catalog').where({ tenant: context.tenantId, service_id: serviceId }).update({ item_kind: 'product' });
      const book = await makeBook('2025', '2025-01-01');
      await stamp(serviceId, 120, '2025-01-01', book);
      const service = new ProductCatalogService();
      vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: context.db, tenant: context.tenantId });
      await service.update(serviceId, { prices: [{ currency_code: 'USD', rate: 175 }] } as never, { tenant: context.tenantId, userId: context.userId } as never);
      const rows = (await tenantRows(serviceId)).map(asTuple);
      expect(rows).toContainEqual(['USD', 120, '2025-01-01', book]);
      expect(rows).toContainEqual(['USD', 175, TODAY, null]);
    });
  });

  describe('T2: appendAt', () => {
    it('inserts dated rows stamped with the price book and the writer', async () => {
      const serviceId = await createTestService(context, { service_name: 'Appendable', billing_method: 'fixed', default_rate: 100 });
      const book = await makeBook('2027', FUTURE, 'draft');
      const result = await trxWrite(serviceId, {
        appendAt: { effectiveDate: FUTURE, priceBookId: book, prices: [{ currency_code: 'USD', rate: 200 }, { currency_code: 'CAD', rate: 260 }] },
        actorUserId: context.userId,
      });
      expect(result.prices).toHaveLength(2);
      expect(result.servicePatch.default_rate).toBeUndefined();
      const rows = await tenantRows(serviceId);
      const appended = rows.filter((r: any) => r.price_book_id === book);
      expect(appended.map((r: any) => [r.currency_code, Number(r.rate)]).sort()).toEqual([['CAD', 260], ['USD', 200]]);
      expect(appended.every((r: any) => r.created_by === context.userId)).toBe(true);
      expect(rows.find((r: any) => r.price_book_id === null && r.currency_code === 'USD' && Number(r.rate) === 100)).toBeTruthy();
    });

    it('same rate and same pricebook is a no-op; the row is reported unchanged', async () => {
      const serviceId = await createTestService(context, { service_name: 'Idem', billing_method: 'fixed', default_rate: 100 });
      const book = await makeBook('2027', FUTURE, 'draft');
      const input = { appendAt: { effectiveDate: FUTURE, priceBookId: book, prices: [{ currency_code: 'USD', rate: 200 }] } };
      await trxWrite(serviceId, input);
      const again = await trxWrite(serviceId, input);
      expect(again.unchangedPrices).toHaveLength(1);
      expect(await tenantRows(serviceId)).toHaveLength(2);
    });

    it('a different-rate conflict is an error that names the row, and nothing is written', async () => {
      const serviceId = await createTestService(context, { service_name: 'Clash', billing_method: 'fixed', default_rate: 100 });
      const book = await makeBook('2027', FUTURE, 'draft');
      await trxWrite(serviceId, { appendAt: { effectiveDate: FUTURE, priceBookId: book, prices: [{ currency_code: 'USD', rate: 200 }] } });
      await expect(
        trxWrite(serviceId, { appendAt: { effectiveDate: FUTURE, priceBookId: book, prices: [{ currency_code: 'USD', rate: 210 }] } }),
      ).rejects.toThrow(new RegExp(`USD price 200 dated ${FUTURE} in price book ${book}`));
      expect(await tenantRows(serviceId)).toHaveLength(2);
    });

    it('the same rate from a different pricebook is a conflict', async () => {
      const serviceId = await createTestService(context, { service_name: 'Other', billing_method: 'fixed', default_rate: 100 });
      const a = await makeBook('A', FUTURE, 'draft');
      const b = await makeBook('B', FUTURE_2, 'draft');
      await trxWrite(serviceId, { appendAt: { effectiveDate: FUTURE, priceBookId: a, prices: [{ currency_code: 'USD', rate: 200 }] } });
      await expect(
        trxWrite(serviceId, { appendAt: { effectiveDate: FUTURE, priceBookId: b, prices: [{ currency_code: 'USD', rate: 200 }] } }),
      ).rejects.toThrow(/already has/);
    });

    it('a date before today is refused; today is allowed and updates default_rate', async () => {
      const serviceId = await createTestService(context, { service_name: 'Dated', billing_method: 'fixed', default_rate: 100 });
      const book = await makeBook('Backdated', addDays(TODAY, -1), 'draft');
      await expect(
        trxWrite(serviceId, { appendAt: { effectiveDate: addDays(TODAY, -1), priceBookId: book, prices: [{ currency_code: 'USD', rate: 200 }] } }),
      ).rejects.toThrow(/before today/);
      const todayBook = await makeBook('Today', TODAY, 'draft');
      const ok = await trxWrite(serviceId, { appendAt: { effectiveDate: TODAY, priceBookId: todayBook, prices: [{ currency_code: 'USD', rate: 205 }] } });
      expect(ok.servicePatch.default_rate).toBe(205);
    });

    it('scheduledAt (rollout dialog) still merges its own previous scheduled row, and refuses a pricebook row', async () => {
      const serviceId = await createTestService(context, { service_name: 'Rollout', billing_method: 'fixed', default_rate: 100 });
      await trxWrite(serviceId, { scheduledAt: { effectiveDate: FUTURE, prices: [{ currency_code: 'USD', rate: 200 }] } });
      await trxWrite(serviceId, { scheduledAt: { effectiveDate: FUTURE, prices: [{ currency_code: 'USD', rate: 220 }] } });
      const future = (await tenantRows(serviceId)).filter((r: any) => asTuple(r)[2] === FUTURE);
      expect(future.map((r: any) => Number(r.rate))).toEqual([220]);
      const book = await makeBook('Held', FUTURE_2, 'scheduled');
      await stamp(serviceId, 300, FUTURE_2, book);
      await expect(
        trxWrite(serviceId, { scheduledAt: { effectiveDate: FUTURE_2, prices: [{ currency_code: 'USD', rate: 310 }] } }),
      ).rejects.toThrow(/already has/);
    });
  });

  describe('removing a currency (spec 3.3)', () => {
    it('previewServicePriceRemoval counts the rows a save would delete and names the price books, writing nothing', async () => {
      const serviceId = await createTestService(context, { service_name: 'Removal item', billing_method: 'fixed', default_rate: 100 });
      const book = await makeBook('2024 CAD', '2024-01-01');
      await context.db('service_prices').insert([
        { price_id: uuidv4(), tenant: context.tenantId, service_id: serviceId, currency_code: 'CAD', rate: 130, effective_date: '1970-01-01', display_order: 1 },
        { price_id: uuidv4(), tenant: context.tenantId, service_id: serviceId, currency_code: 'CAD', rate: 140, effective_date: '2024-01-01', display_order: 1, price_book_id: book },
        { price_id: uuidv4(), tenant: context.tenantId, service_id: serviceId, currency_code: 'CAD', rate: 150, effective_date: addDays(TODAY, 30), display_order: 1 },
      ]);
      const total = (await tenantRows(serviceId)).length;

      const dropCad = await previewServicePriceRemoval(serviceId, ['USD']);
      // The future CAD row is outside the current window, so only the two historical rows count.
      expect(dropCad).toEqual({ removedCount: 2, currencies: ['CAD'], priceBookNames: ['2024 CAD'] });
      expect(await previewServicePriceRemoval(serviceId, ['USD', 'CAD'])).toEqual({ removedCount: 0, currencies: [], priceBookNames: [] });
      expect(await previewServicePriceRemoval(serviceId, [])).toMatchObject({ removedCount: 3, currencies: ['CAD', 'USD'] });
      expect((await tenantRows(serviceId)).length).toBe(total);

      // And the writer deletes exactly what the preview said.
      await trxWrite(serviceId, { current: [{ currency_code: 'USD', rate: 100 }] });
      expect((await tenantRows(serviceId)).filter((r: any) => r.currency_code === 'CAD').map((r: any) => Number(r.rate))).toEqual([150]);
    });
  });

  describe('T16: the rollout preview never falls back to USD', () => {
    it('uses the tenant default currency when the service has no price and none is passed', async () => {
      await context.db('default_billing_settings')
        .insert({ tenant: context.tenantId, default_currency_code: 'CAD', zero_dollar_invoice_handling: 'normal', suppress_zero_dollar_invoices: false })
        .onConflict('tenant').merge({ default_currency_code: 'CAD' });
      const serviceId = await createTestService(context, { service_name: 'Priceless', billing_method: 'fixed', default_rate: 0 });
      await context.db('service_prices').where({ tenant: context.tenantId, service_id: serviceId }).del();
      const preview = await previewServicePriceChange(serviceId, 5000);
      expect('currency' in preview && preview.currency).toBe('CAD');
    });

    it('reports an error rather than guessing when there is no default either', async () => {
      await context.db('default_billing_settings').where({ tenant: context.tenantId }).update({ default_currency_code: null }).catch(() => undefined);
      const serviceId = await createTestService(context, { service_name: 'Priceless 2', billing_method: 'fixed', default_rate: 0 });
      await context.db('service_prices').where({ tenant: context.tenantId, service_id: serviceId }).del();
      const preview = await previewServicePriceChange(serviceId, 5000);
      expect('currency' in preview).toBe(false);
    });
  });
});
