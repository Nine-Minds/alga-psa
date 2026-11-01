import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../../test-utils/testContext';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { TimeSheetService, formatDbDate } from '../../../lib/api/services/TimeSheetService';
import {
  createTimePeriodSchema,
  updateTimePeriodSchema,
  timePeriodResponseSchema,
  timeSheetWithDetailsResponseSchema,
} from '../../../lib/api/schemas/timeSheet';

/**
 * Integration tests for the REST API time period service (alga-2026-0002689).
 * Calls TimeSheetService directly; schema parsing is done here exactly as the controller does.
 */
describe('TimeSheetService time periods (API)', () => {
  const context = new TestContext({
    cleanupTables: ['time_entries', 'time_sheets', 'time_periods'],
    runSeeds: true,
  });
  let service: TimeSheetService;
  let ctx: any;

  const table = (name: string) => tenantDb(context.db, context.tenantId).table(name);
  const create = (body: Record<string, unknown>) =>
    service.createTimePeriod(createTimePeriodSchema.parse(body), ctx);
  const update = (id: string, body: Record<string, unknown>) =>
    service.updateTimePeriod(id, updateTimePeriodSchema.parse(body), ctx);
  const dbRow = (id: string) => table('time_periods').where({ period_id: id }).first();

  const addTimeSheet = async (periodId: string) => {
    const id = uuidv4();
    await table('time_sheets').insert({
      id,
      tenant: context.tenantId,
      period_id: periodId,
      user_id: context.userId,
      approval_status: 'DRAFT',
    });
    return id;
  };

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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('creates from date-only input and persists the row', async () => {
      const period = await create({ start_date: '2026-11-01', end_date: '2026-11-08' });

      expect(period.start_date).toBe('2026-11-01');
      expect(period.end_date).toBe('2026-11-08');
      expect(period.is_closed).toBe(false);
      const row = await dbRow(period.period_id);
      expect(row).toBeDefined();
      expect(formatDbDate(row.start_date)).toBe('2026-11-01');
      expect(formatDbDate(row.end_date)).toBe('2026-11-08');
    });

    it('truncates datetime input textually to its calendar date', async () => {
      const period = await create({
        start_date: '2026-08-16T23:30:00-05:00',
        end_date: '2026-08-23T00:00:00Z',
      });
      expect(period.start_date).toBe('2026-08-16');
      expect(period.end_date).toBe('2026-08-23');
    });

    it('ignores is_current on input and never persists it', async () => {
      const period = await create({ start_date: '2030-01-01', end_date: '2030-01-08', is_current: true });
      expect(period.is_current).toBe(false); // derived from dates, not the body
      const row = await dbRow(period.period_id);
      expect(row).not.toHaveProperty('is_current');
    });

    it('rejects an overlapping period with 409', async () => {
      await create({ start_date: '2026-11-01', end_date: '2026-11-08' });
      await expect(create({ start_date: '2026-11-07', end_date: '2026-11-14' })).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it('allows touching periods (end_date equals next start_date)', async () => {
      await create({ start_date: '2026-11-01', end_date: '2026-11-08' });
      const next = await create({ start_date: '2026-11-08', end_date: '2026-11-15' });
      expect(next.start_date).toBe('2026-11-08');
    });

    it('rejects start >= end with 400 (schema level and service level)', () => {
      expect(() => createTimePeriodSchema.parse({ start_date: '2026-11-08', end_date: '2026-11-08' })).toThrow();
      expect(() => createTimePeriodSchema.parse({ start_date: '2026-11-09', end_date: '2026-11-08' })).toThrow();
      return expect(
        service.createTimePeriod({ start_date: '2026-11-09', end_date: '2026-11-08' } as any, ctx)
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects an invalid calendar date from the schema', () => {
      expect(() => createTimePeriodSchema.parse({ start_date: '2026-02-30', end_date: '2026-03-08' })).toThrow();
    });
  });

  describe('update', () => {
    it('updates dates and ignores is_current (with and without it)', async () => {
      const period = await create({ start_date: '2030-01-01', end_date: '2030-01-08' });

      const withFlag = await update(period.period_id, { end_date: '2030-01-09', is_current: true });
      expect(withFlag.end_date).toBe('2030-01-09');
      expect(withFlag.is_current).toBe(false);

      const without = await update(period.period_id, { start_date: '2030-01-02' });
      expect(without.start_date).toBe('2030-01-02');
      expect(without.end_date).toBe('2030-01-09');

      const row = await dbRow(period.period_id);
      expect(row).not.toHaveProperty('is_current');
      expect(formatDbDate(row.start_date)).toBe('2030-01-02');
    });

    it('treats a body with only is_current as a no-op returning 200 data', async () => {
      const period = await create({ start_date: '2026-11-01', end_date: '2026-11-08' });
      const result = await update(period.period_id, { is_current: true });
      expect(result.start_date).toBe('2026-11-01');
      expect(result.end_date).toBe('2026-11-08');
    });

    it('validates start < end against stored values (400) and overlap (409)', async () => {
      const a = await create({ start_date: '2026-11-01', end_date: '2026-11-08' });
      await create({ start_date: '2026-11-08', end_date: '2026-11-15' });
      await expect(update(a.period_id, { end_date: '2026-10-31' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(update(a.period_id, { end_date: '2026-11-10' })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('returns 404 for an unknown id', async () => {
      await expect(update(uuidv4(), { end_date: '2026-11-09' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects date edits with 409 when the period has time sheets (D6)', async () => {
      const period = await create({ start_date: '2026-11-01', end_date: '2026-11-08' });
      await addTimeSheet(period.period_id);
      await expect(update(period.period_id, { end_date: '2026-11-09' })).rejects.toMatchObject({ statusCode: 409 });
      const row = await dbRow(period.period_id);
      expect(formatDbDate(row.end_date)).toBe('2026-11-08');
    });
  });

  describe('close / reopen', () => {
    it('flips is_closed in the DB and is idempotent', async () => {
      const period = await create({ start_date: '2026-11-01', end_date: '2026-11-08' });

      const closed = await service.closeTimePeriod(period.period_id, ctx);
      expect(closed.is_closed).toBe(true);
      expect((await dbRow(period.period_id)).is_closed).toBe(true);
      expect((await service.closeTimePeriod(period.period_id, ctx)).is_closed).toBe(true);

      const reopened = await service.reopenTimePeriod(period.period_id, ctx);
      expect(reopened.is_closed).toBe(false);
      expect((await dbRow(period.period_id)).is_closed).toBe(false);
      expect((await service.reopenTimePeriod(period.period_id, ctx)).is_closed).toBe(false);
    });

    it('returns 404 for an unknown id', async () => {
      await expect(service.closeTimePeriod(uuidv4(), ctx)).rejects.toMatchObject({ statusCode: 404 });
      await expect(service.reopenTimePeriod(uuidv4(), ctx)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 404 for another tenant\'s period and leaves it untouched', async () => {
      const period = await create({ start_date: '2026-11-01', end_date: '2026-11-08' });
      const otherCtx = { ...ctx, tenant: uuidv4() };

      await expect(service.closeTimePeriod(period.period_id, otherCtx)).rejects.toMatchObject({ statusCode: 404 });
      await expect(service.reopenTimePeriod(period.period_id, otherCtx)).rejects.toMatchObject({ statusCode: 404 });
      expect((await dbRow(period.period_id)).is_closed).toBe(false);
    });

    it('rejects PUT and DELETE on a closed period with 409, and allows them after reopen', async () => {
      const period = await create({ start_date: '2026-11-01', end_date: '2026-11-08' });
      await service.closeTimePeriod(period.period_id, ctx);

      await expect(update(period.period_id, { end_date: '2026-11-09' })).rejects.toMatchObject({ statusCode: 409 });
      await expect(service.deleteTimePeriod(period.period_id, ctx)).rejects.toMatchObject({ statusCode: 409 });
      expect(await dbRow(period.period_id)).toBeDefined();

      await service.reopenTimePeriod(period.period_id, ctx);
      const updated = await update(period.period_id, { end_date: '2026-11-09' });
      expect(updated.end_date).toBe('2026-11-09');
      await service.deleteTimePeriod(period.period_id, ctx);
      expect(await dbRow(period.period_id)).toBeUndefined();
    });
  });

  describe('is_current derivation', () => {
    it.each([
      ['start day', '2026-11-01T12:00:00Z', true],
      ['end - 1', '2026-11-07T23:59:59Z', true],
      ['end (exclusive)', '2026-11-08T00:00:00Z', false],
      ['day before start', '2026-10-31T23:59:59Z', false],
    ])('%s -> %s', async (_label, now, expected) => {
      const period = await create({ start_date: '2026-11-01', end_date: '2026-11-08' });
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(now));

      expect((await service.getTimePeriod(period.period_id, ctx)).is_current).toBe(expected);
      const listed = (await service.getTimePeriods(ctx)).find((p) => p.period_id === period.period_id);
      expect(listed.is_current).toBe(expected);
    });
  });

  describe('response shape', () => {
    it('matches timePeriodResponseSchema with YYYY-MM-DD dates', async () => {
      const period = await create({ start_date: '2026-11-01', end_date: '2026-11-08' });
      const parsed = timePeriodResponseSchema.parse(JSON.parse(JSON.stringify(period)));
      expect(parsed.start_date).toBe('2026-11-01');
      expect(parsed.duration_days).toBe(7);
      expect(parsed.year).toBe(2026);
      expect(parsed.month_name).toBe('November');

      for (const listed of await service.getTimePeriods(ctx)) {
        timePeriodResponseSchema.parse(JSON.parse(JSON.stringify(listed)));
      }
    });

    it('time sheet details expose a time_period that passes the sub-schema', async () => {
      const period = await create({ start_date: '2026-11-01', end_date: '2026-11-08' });
      const sheetId = await addTimeSheet(period.period_id);
      const details = await service.getWithDetails(sheetId, ctx);
      const subSchema = timeSheetWithDetailsResponseSchema.shape.time_period.unwrap();
      const parsed = subSchema.parse(JSON.parse(JSON.stringify(details.time_period)));
      expect(parsed.start_date).toBe('2026-11-01');
      expect(parsed.is_closed).toBe(false);
    });
  });

  describe('formatDbDate', () => {
    it('formats local-midnight Dates with local getters and passes strings through', () => {
      expect(formatDbDate(new Date(2026, 7, 16))).toBe('2026-08-16'); // local midnight, as pg builds DATE
      expect(formatDbDate('2026-08-16')).toBe('2026-08-16');
    });
  });
});
