import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../test-utils/testContext';
import { createFixedPlanAssignment, createTestService } from '../../../../test-utils/billingTestHelpers';

vi.mock('@alga-psa/core/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/core/server')>()),
  featureFlags: { isEnabled: vi.fn(async () => flagState.on) },
}));

const flagState = vi.hoisted(() => ({ on: true }));
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

import {
  createDraftPriceBook,
  deriveActivePriceBookId,
  getActivePriceBook,
} from '@alga-psa/billing/lib/catalog/priceBooks';
import { writeServiceCatalogPricing } from '@alga-psa/billing/lib/catalog/serviceCatalogPricing';
import { loadCatalogAsOf } from '@alga-psa/billing/lib/catalog/priceBooks';
import {
  discardPriceBookAction,
  downloadPriceBookCsvAction,
  makePriceBookActiveAgainAction,
  previewMakePriceBookActiveAgainAction,
  withdrawPriceBookAction,
} from '@alga-psa/billing/actions/priceBookActions';

const TODAY = new Date().toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describe('price book lifecycle (T12–T14) and RBAC of the actions (T15)', () => {
  let context: TestContext;
  let allowed = new Set<string>();
  const grant = (...permissions: string[]) => { allowed = new Set(permissions); };
  const setMocks = () => setupCommonMocks({
    tenantId: context.tenantId,
    userId: context.userId,
    permissionCheck: (_user, resource, action) => allowed.has(`${resource}:${action}`),
  });

  const books = () => context.db('catalog_price_books').where({ tenant: context.tenantId });
  const dateOnly = (value: unknown) => new Date(value as string).toISOString().slice(0, 10);
  async function book(name: string, date: string, status = 'scheduled'): Promise<string> {
    const id = uuidv4();
    await context.db('catalog_price_books').insert({ tenant: context.tenantId, price_book_id: id, name, effective_date: date, status });
    return id;
  }
  async function row(serviceId: string, rate: number, date: string, bookId: string | null, currency = 'USD') {
    await context.db('service_prices').insert({
      price_id: uuidv4(), tenant: context.tenantId, service_id: serviceId, currency_code: currency, rate,
      effective_date: date, display_order: 0, price_book_id: bookId,
    });
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: ['service_catalog', 'service_prices', 'catalog_price_books', 'audit_logs'],
      clientName: 'Price Book Lifecycle Client',
      userType: 'internal',
    });
    flagState.on = true;
    grant('billing:read', 'service:update');
    setMocks();
  }, 120000);
  beforeEach(async () => {
    context = await resetContext();
    flagState.on = true;
    grant('billing:read', 'service:update');
    setMocks();
  }, 60000);
  afterEach(async () => { await rollbackContext(); }, 60000);
  afterAll(async () => { await cleanupContext(); }, 30000);

  it('T12: the active price book is derived from the dates, and a same-date second price book is rejected', async () => {
    const b2024 = await book('2024', addDays(TODAY, -400));
    const b2025 = await book('2025', addDays(TODAY, 30));
    const all = await books();
    const rows = all.map((r: any) => ({ price_book_id: r.price_book_id, effective_date: dateOnly(r.effective_date), status: r.status }));

    // 2024 is active until 2025 takes effect; stored status never decides.
    expect(deriveActivePriceBookId(rows, TODAY)).toBe(b2024);
    expect(deriveActivePriceBookId(rows, addDays(TODAY, 30))).toBe(b2025);
    expect(deriveActivePriceBookId(rows, addDays(TODAY, 29))).toBe(b2024);
    expect(deriveActivePriceBookId(rows, addDays(TODAY, -401))).toBeNull();
    expect((await getActivePriceBook(context.db, context.tenantId, TODAY))?.price_book_id).toBe(b2024);
    expect((await getActivePriceBook(context.db, context.tenantId, addDays(TODAY, 31)))?.price_book_id).toBe(b2025);
    // A draft and a discarded book are never active.
    await book('Draft', addDays(TODAY, -10), 'draft');
    await book('Gone', addDays(TODAY, -5), 'discarded');
    expect((await getActivePriceBook(context.db, context.tenantId, TODAY))?.price_book_id).toBe(b2024);

    // One applied price book per date: refused by the form's check and by the unique index.
    await expect(context.db.transaction((trx) => createDraftPriceBook(trx, context.tenantId, { name: 'Clash', effectiveDate: addDays(TODAY, 30) })))
      .rejects.toThrow(/already takes effect/);
    // Past dates cannot be back-dated at the form.
    await expect(context.db.transaction((trx) => createDraftPriceBook(trx, context.tenantId, { name: 'Past', effectiveDate: addDays(TODAY, -1) })))
      .rejects.toThrow(/past/);
    // The unique index is the backstop (inside a savepoint so the test transaction survives).
    await expect(context.db.transaction((trx) => trx('catalog_price_books').insert({
      tenant: context.tenantId, price_book_id: uuidv4(), name: 'Clash raw', effective_date: addDays(TODAY, 30), status: 'scheduled',
    }))).rejects.toThrow(/catalog_price_books_applied_date_unique|duplicate key/);
  });

  it('T13: make active again creates a new price book with the old rates; the old one is untouched', async () => {
    const serviceId = await createTestService(context, { service_name: 'Rollback item', billing_method: 'fixed', default_rate: 100 });
    const b2024 = await book('2024', addDays(TODAY, -400));
    const b2025 = await book('2025', addDays(TODAY, -200));
    await row(serviceId, 110, addDays(TODAY, -400), b2024);
    await row(serviceId, 120, addDays(TODAY, -200), b2025);
    const before = (await context.db('service_prices').where({ tenant: context.tenantId, service_id: serviceId }).orderBy('effective_date'))
      .map((r: any) => [Number(r.rate), r.price_book_id]);

    const date = addDays(TODAY, 20);
    const preview = await previewMakePriceBookActiveAgainAction(b2024, date);
    expect('impact' in preview).toBe(true);
    // An inherited line on the rolled-back item changes 120 -> 110; a line on an item whose
    // rate is the same on both dates is not listed as a change.
    const steady = await createTestService(context, { service_name: 'Steady item', billing_method: 'fixed', default_rate: 300 });
    const moving = await createFixedPlanAssignment(context, serviceId, { planName: 'Follows catalog' });
    const still = await createFixedPlanAssignment(context, steady, { planName: 'Steady line' });
    await context.db('contract_lines').whereIn('contract_line_id', [moving.contractLineId, still.contractLineId])
      .update({ rate_provenance: 'inherited', custom_rate: null });
    await context.db('contract_line_service_fixed_config').whereIn('config_id',
      context.db('contract_line_service_configuration').select('config_id').whereIn('contract_line_id', [moving.contractLineId, still.contractLineId]))
      .update({ rate_provenance: 'inherited', base_rate: null, base_rate_basis: null });
    const scoped = await previewMakePriceBookActiveAgainAction(b2024, date);
    if (!('impact' in scoped)) throw new Error('preview failed');
    const listed = [...scoped.impact.willChange, ...scoped.impact.custom, ...scoped.impact.unreviewed].map((line) => line.contractLineId);
    expect(listed).toContain(moving.contractLineId);
    expect(listed).not.toContain(still.contractLineId);

    const result = await makePriceBookActiveAgainAction(b2024, { effectiveDate: date });
    expect('priceBookId' in result).toBe(true);
    if (!('priceBookId' in result)) throw new Error('failed');
    const created = await context.db('catalog_price_books').where({ tenant: context.tenantId, price_book_id: result.priceBookId }).first();
    expect(created.copied_from_price_book_id).toBe(b2024);
    expect(created.status).toBe('scheduled');
    expect(dateOnly(created.effective_date)).toBe(date);

    const old = (await context.db('service_prices').where({ tenant: context.tenantId, service_id: serviceId }).where((q) => q.whereNull('price_book_id').orWhereNot('price_book_id', result.priceBookId)).orderBy('effective_date'))
      .map((r: any) => [Number(r.rate), r.price_book_id]);
    expect(old).toEqual(before); // the 2024 and 2025 rows are untouched
    const b2024Row = await context.db('catalog_price_books').where({ price_book_id: b2024 }).first();
    expect(dateOnly(b2024Row.effective_date)).toBe(addDays(TODAY, -400)); // 2024 never moves

    // Billing follows: on the new date the catalog reads 2024's rate; before it, 2025's.
    const onDate = await loadCatalogAsOf(context.db, context.tenantId, date, null);
    expect(onDate.find((r) => r.serviceId === serviceId)?.rateMinor).toBe(110);
    const before_ = await loadCatalogAsOf(context.db, context.tenantId, addDays(TODAY, 19), null);
    expect(before_.find((r) => r.serviceId === serviceId)?.rateMinor).toBe(120);
    // The derived active price book at the new date is the copy.
    expect((await getActivePriceBook(context.db, context.tenantId, date))?.price_book_id).toBe(result.priceBookId);
  });

  it('T14: withdrawing a scheduled price book removes its future rows; after its date it is refused', async () => {
    const serviceId = await createTestService(context, { service_name: 'Withdraw item', billing_method: 'fixed', default_rate: 100 });
    const future = await book('Next year', addDays(TODAY, 90));
    await row(serviceId, 150, addDays(TODAY, 90), future);
    const result = await withdrawPriceBookAction(future);
    expect(result).toEqual({ removedPrices: 1 });
    expect((await books().where({ price_book_id: future }).first()).status).toBe('discarded');
    expect(await context.db('service_prices').where({ tenant: context.tenantId, price_book_id: future })).toHaveLength(0);
    // The baseline price is still there.
    expect(await context.db('service_prices').where({ tenant: context.tenantId, service_id: serviceId })).toHaveLength(1);

    const started = await book('Already started', addDays(TODAY, -10));
    await row(serviceId, 160, addDays(TODAY, -10), started);
    const refused = await withdrawPriceBookAction(started);
    expect(JSON.stringify(refused)).toMatch(/took effect/);
    expect(await context.db('service_prices').where({ tenant: context.tenantId, price_book_id: started })).toHaveLength(1);

    // Discard is for drafts only.
    const scheduled = await book('Scheduled', addDays(TODAY, 120));
    expect(JSON.stringify(await discardPriceBookAction(scheduled))).toMatch(/draft/i);
    const draft = await book('Draft', addDays(TODAY, 130), 'draft');
    expect(await discardPriceBookAction(draft)).toEqual({ success: true });
    expect((await books().where({ price_book_id: draft }).first()).status).toBe('discarded');
  });

  it('download: the catalog as of the price book date, with an Item ref column only in the file', async () => {
    const serviceId = await createTestService(context, { service_name: 'Download item', billing_method: 'fixed', default_rate: 100 });
    const b = await book('2025', addDays(TODAY, -100));
    await row(serviceId, 130, addDays(TODAY, -100), b);
    const result = await downloadPriceBookCsvAction(b);
    if (!('csv' in result)) throw new Error('failed');
    const [header, ...lines] = result.csv.split('\n');
    expect(header).toBe('Item ref,Type,SKU,Name,Price USD,Source');
    const line = lines.find((l) => l.includes('Download item'))!;
    expect(line.startsWith(`${serviceId},service,`)).toBe(true);
    expect(line).toContain('1.30');
    expect(line.endsWith('this price book')).toBe(true);
  });

  it('T15: the lifecycle actions need service:update, the preview needs billing:read, and a flagged-off tenant is refused', async () => {
    const b = await book('RBAC', addDays(TODAY, 40));
    grant('billing:read');
    expect(JSON.stringify(await withdrawPriceBookAction(b))).toMatch(/permission/i);
    expect(JSON.stringify(await discardPriceBookAction(b))).toMatch(/permission/i);
    expect(JSON.stringify(await makePriceBookActiveAgainAction(b, { effectiveDate: addDays(TODAY, 50) }))).toMatch(/permission/i);
    grant('service:update');
    expect(JSON.stringify(await previewMakePriceBookActiveAgainAction(b, addDays(TODAY, 50)))).toMatch(/permission/i);
    expect(JSON.stringify(await downloadPriceBookCsvAction(b))).toMatch(/permission/i);
    expect((await books().where({ price_book_id: b }).first()).status).toBe('scheduled'); // nothing changed

    grant('billing:read', 'service:update');
    flagState.on = false;
    expect(JSON.stringify(await withdrawPriceBookAction(b))).toMatch(/not enabled/i);
  });
});
