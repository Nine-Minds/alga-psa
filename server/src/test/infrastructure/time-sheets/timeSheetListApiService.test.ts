import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../../test-utils/testContext';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { TimeSheetService } from '../../../lib/api/services/TimeSheetService';
import { ValidationError } from '../../../lib/api/middleware/apiMiddleware';

/**
 * Regression tests for GET /api/v1/time-sheets (#3205): list() used to ORDER BY
 * time_sheets.created_at, which does not exist (42703 -> 500).
 */
describe('TimeSheetService.list (API)', () => {
  const context = new TestContext({
    cleanupTables: ['time_entries', 'time_sheets', 'time_periods'],
    runSeeds: true,
  });
  let service: TimeSheetService;
  let ctx: any;

  const table = (name: string) => tenantDb(context.db, context.tenantId).table(name);

  let otherUserId: string;
  let newerPeriodId: string;
  let olderPeriodId: string;
  // sheets: A (older period, ctx user), B + C (newer period, ctx user / other user)
  let sheetA: string;
  let sheetB: string;
  let sheetC: string;

  const addPeriod = async (start: string, end: string) => {
    const id = uuidv4();
    await table('time_periods').insert({ period_id: id, tenant: context.tenantId, start_date: start, end_date: end });
    return id;
  };
  const addSheet = async (periodId: string, userId: string, extra: Record<string, unknown> = {}) => {
    const id = uuidv4();
    await table('time_sheets').insert({
      id, tenant: context.tenantId, period_id: periodId, user_id: userId, approval_status: 'DRAFT', ...extra,
    });
    return id;
  };
  const ids = (r: { data: any[] }) => r.data.map((d) => d.id);

  beforeAll(async () => {
    await context.initialize();
  });
  afterAll(async () => {
    await context.cleanup();
  });

  beforeEach(async () => {
    await context.reset();
    setupCommonMocks({ tenantId: context.tenantId });
    service = new TimeSheetService();
    vi.spyOn(service as any, 'getKnex').mockImplementation(async () => ({
      knex: context.db,
      tenant: context.tenantId,
    }));
    ctx = { tenant: context.tenantId, userId: context.userId, user: context.user };

    otherUserId = uuidv4();
    await table('users').insert({
      user_id: otherUserId,
      tenant: context.tenantId,
      username: `other-${otherUserId.slice(0, 8)}`,
      first_name: 'Other',
      last_name: 'User',
      email: `other-${otherUserId.slice(0, 8)}@example.com`,
      hashed_password: 'x',
      is_inactive: false,
    });

    olderPeriodId = await addPeriod('2026-01-01', '2026-01-08');
    newerPeriodId = await addPeriod('2026-02-01', '2026-02-08');
    sheetA = await addSheet(olderPeriodId, context.userId);
    sheetB = await addSheet(newerPeriodId, context.userId, { submitted_at: new Date('2026-02-09T10:00:00Z') });
    sheetC = await addSheet(newerPeriodId, otherUserId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const expectedDefault = () => {
    const pair = [sheetB, sheetC].sort().reverse(); // id desc tie-break
    return [...pair, sheetA];
  };

  it('lists with no sort: newer period first, id desc tie-break, period fields populated', async () => {
    const r = await service.list({}, ctx);
    expect(r.total).toBe(3);
    expect(ids(r)).toEqual(expectedDefault());
    for (const row of r.data) {
      expect(row.period_start).toBeTruthy();
      expect(row.period_end).toBeTruthy();
    }
  });

  it('treats sort=created_at as the default', async () => {
    const r = await service.list({ sort: 'created_at' }, ctx);
    expect(ids(r)).toEqual(expectedDefault());
  });

  it('sorts submitted_at desc with NULLs last', async () => {
    const r = await service.list({ sort: 'submitted_at', order: 'desc' }, ctx);
    expect(r.data[0].id).toBe(sheetB);
    expect(ids(r).slice(1).sort()).toEqual([sheetA, sheetC].sort());
  });

  it('sorts submitted_at asc with NULLs still last', async () => {
    const r = await service.list({ sort: 'submitted_at', order: 'asc' }, ctx);
    expect(r.data[0].id).toBe(sheetB);
  });

  it('rejects an unknown sort with ValidationError', async () => {
    await expect(service.list({ sort: 'bogus' }, ctx)).rejects.toBeInstanceOf(ValidationError);
  });

  it('paginates with limit 1 and never repeats a row across three pages', async () => {
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const r = await service.list({ limit: 1, page }, ctx);
      expect(r.total).toBe(3);
      seen.push(...ids(r));
    }
    expect(new Set(seen).size).toBe(3);
    expect(seen).toEqual(expectedDefault());
  });

  it('honours options.filters (controller shape)', async () => {
    const r = await service.list({ filters: { user_id: otherUserId } } as any, ctx);
    expect(ids(r)).toEqual([sheetC]);
    expect(r.total).toBe(1);
  });

  it('applies period range filters without a duplicate-join error', async () => {
    const r = await service.list(
      { filters: { period_start_from: '2026-01-15T00:00:00.000Z', period_end_to: '2026-03-01T00:00:00.000Z' } } as any,
      ctx
    );
    expect(ids(r).sort()).toEqual([sheetB, sheetC].sort());
    expect(r.total).toBe(2);
  });
});
