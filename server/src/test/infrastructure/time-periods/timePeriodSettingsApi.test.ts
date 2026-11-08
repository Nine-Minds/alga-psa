import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import type { ITimePeriodSettings } from '@alga-psa/types';
import { TestContext } from '../../../../test-utils/testContext';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { createCleanupHook } from '../../../../test-utils/dbReset';
import { freezeTime, unfreezeTime } from '../../../../test-utils/dateUtils';
import { TimeSheetService } from '../../../lib/api/services/TimeSheetService';
import {
  createTimePeriodSettingsSchema,
  timePeriodSettingsResponseSchema,
  updateTimePeriodSettingsSchema,
} from '../../../lib/api/schemas/timeSheet';
import { handleApiError } from '../../../lib/api/middleware/apiMiddleware';
import { createTimePeriodSettings as createTimePeriodSettingsAction } from '@alga-psa/scheduling/actions/time-period-settings-actions/timePeriodSettingsActions';

// REST /api/v1/time-period-settings goes through TimeSheetService into the shared scheduling
// TimePeriodSettings model, so it must apply the same default, hand-off and overlap rules as the
// settings UI's server action — and report rule failures as HTTP statuses.
describe('Time period settings REST API', () => {
  const context = new TestContext({
    cleanupTables: ['time_periods', 'time_period_settings'],
    runSeeds: true,
  });
  let service: TimeSheetService;
  let serviceContext: { tenant: string; userId: string; user: any };

  const settingsTable = () => tenantDb(context.db, context.tenantId).table('time_period_settings');
  const weekly = { frequency: 1, frequency_unit: 'week' as const, start_day: 7, end_day: 0 };

  const insertSetting = async (overrides: Partial<ITimePeriodSettings>) => {
    const id = uuidv4();
    await settingsTable().insert({
      time_period_settings_id: id,
      tenant: context.tenantId,
      frequency: 1,
      frequency_unit: 'week',
      start_day: 7,
      end_day: 0,
      start_month: 1,
      start_day_of_month: 1,
      end_month: 12,
      end_day_of_month: 0,
      is_active: true,
      effective_from: '2026-09-01T00:00:00.000Z',
      effective_to: null,
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    });
    return id;
  };

  const useUserTimeZone = async (timezone: string) => {
    await tenantDb(context.db, context.tenantId).table('users').where({ user_id: context.userId }).update({ timezone });
  };

  /** Run a service call and return the HTTP status the API would send for its failure. */
  const statusOf = async (call: Promise<unknown>) => {
    try {
      await call;
    } catch (error) {
      return handleApiError(error).status;
    }
    throw new Error('expected the call to fail');
  };

  beforeAll(async () => {
    await context.initialize();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  beforeEach(async () => {
    await context.reset();
    setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, user: context.user });
    service = new TimeSheetService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: context.db, tenant: context.tenantId });
    serviceContext = { tenant: context.tenantId, userId: context.userId, user: context.user };
    await useUserTimeZone('UTC');
  });

  afterEach(async () => {
    unfreezeTime();
    await createCleanupHook(context.db, ['time_periods', 'time_period_settings'])();
    vi.clearAllMocks();
  });

  it('accepts the table shape and rejects the old enum-style frequency', () => {
    expect(createTimePeriodSettingsSchema.safeParse({ ...weekly, effective_from: '2026-10-04' }).success).toBe(true);
    expect(createTimePeriodSettingsSchema.safeParse({ ...weekly }).success).toBe(true);
    expect(createTimePeriodSettingsSchema.safeParse({ frequency: 'weekly', frequency_unit: 1 }).success).toBe(false);
    expect(createTimePeriodSettingsSchema.safeParse({ ...weekly, effective_from: '2026-10-04T00:00:00Z' }).success).toBe(false);
    expect(updateTimePeriodSettingsSchema.safeParse({ effective_to: null }).success).toBe(true);
  });

  it('create without effective_from defaults to the period start in the caller\'s timezone', async () => {
    await useUserTimeZone('America/New_York');
    freezeTime('2026-10-11T02:30:00.000Z'); // Sat 22:30 in New York; the UTC date is already 10/11

    const created = await service.createTimePeriodSettings(createTimePeriodSettingsSchema.parse(weekly), serviceContext);

    expect(created.effective_from).toBe('2026-10-04');
    expect(timePeriodSettingsResponseSchema.safeParse(created).success).toBe(true);
  });

  it('create without effective_from hands off the day after a setting that ended mid-period, like the UI', async () => {
    freezeTime('2026-10-10T15:00:00.000Z');
    await insertSetting({ effective_to: '2026-10-06T00:00:00.000Z' as any });

    const viaApi = await service.createTimePeriodSettings(createTimePeriodSettingsSchema.parse(weekly), serviceContext);
    expect(viaApi.effective_from).toBe('2026-10-07');

    // The server action runs the same model: with the API's setting removed it reaches the same date.
    await settingsTable().where({ time_period_settings_id: viaApi.time_period_settings_id }).delete();
    const viaAction: any = await createTimePeriodSettingsAction(weekly);
    expect(String(viaAction.effective_from).slice(0, 10)).toBe('2026-10-07');
  });

  it('create with an explicit overlapping effective_from returns 409, writes nothing and leaves other settings active', async () => {
    freezeTime('2026-10-10T15:00:00.000Z');
    const existingId = await insertSetting({ effective_to: '2026-10-06T00:00:00.000Z' as any });

    const status = await statusOf(service.createTimePeriodSettings(
      createTimePeriodSettingsSchema.parse({ ...weekly, effective_from: '2026-10-04' }),
      serviceContext,
    ));

    expect(status).toBe(409);
    const rows = await settingsTable();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ time_period_settings_id: existingId, is_active: true });
  });

  it('create against an open-ended setting returns 409 even without effective_from', async () => {
    freezeTime('2026-10-10T15:00:00.000Z');
    await insertSetting({});

    expect(await statusOf(service.createTimePeriodSettings(createTimePeriodSettingsSchema.parse(weekly), serviceContext))).toBe(409);
    expect(await settingsTable()).toHaveLength(1);
  });

  it('create with effective_to before effective_from returns 400', async () => {
    const status = await statusOf(service.createTimePeriodSettings(
      createTimePeriodSettingsSchema.parse({ ...weekly, effective_from: '2026-10-04', effective_to: '2026-10-01' }),
      serviceContext,
    ));
    expect(status).toBe(400);
    expect(await settingsTable()).toHaveLength(0);
  });

  it('update validates the merged setting: overlap is 409, clearing effective_to works, unknown id is 404', async () => {
    const endedId = await insertSetting({ effective_to: '2026-09-30T00:00:00.000Z' as any });
    const laterId = await insertSetting({ effective_from: '2026-10-04T00:00:00.000Z' as any });

    // Clearing the earlier setting's end date would run it into the later one.
    expect(await statusOf(service.updateTimePeriodSettings(endedId, updateTimePeriodSettingsSchema.parse({ effective_to: null }), serviceContext))).toBe(409);
    const unchanged = await service.getTimePeriodSettingsById(endedId, serviceContext);
    expect(unchanged.effective_to).toBe('2026-09-30');

    // Without the later setting in the way, the same patch clears it.
    await service.deleteTimePeriodSettings(laterId, serviceContext);
    const cleared = await service.updateTimePeriodSettings(endedId, updateTimePeriodSettingsSchema.parse({ effective_to: null }), serviceContext);
    expect(cleared.effective_to).toBeUndefined();
    expect(cleared.effective_from).toBe('2026-09-01');

    expect(await statusOf(service.updateTimePeriodSettings(uuidv4(), { frequency: 2 }, serviceContext))).toBe(404);
  });

  it('lists, gets and deletes in the response shape', async () => {
    const olderId = await insertSetting({ effective_to: '2026-09-30T00:00:00.000Z' as any });
    const newerId = await insertSetting({ effective_from: '2026-10-04T00:00:00.000Z' as any, is_active: false });

    const listed = await service.getTimePeriodSettings(serviceContext);
    expect(listed.map((s) => s.time_period_settings_id)).toEqual([newerId, olderId]);
    for (const setting of listed) {
      expect(timePeriodSettingsResponseSchema.safeParse(setting).success).toBe(true);
    }

    await service.deleteTimePeriodSettings(olderId, serviceContext);
    expect(await statusOf(service.getTimePeriodSettingsById(olderId, serviceContext))).toBe(404);
    expect(await statusOf(service.deleteTimePeriodSettings(olderId, serviceContext))).toBe(404);
  });
});
