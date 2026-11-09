import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeSheetService } from '../../../lib/api/services/TimeSheetService';
import { TimePeriodSettings, TimePeriodSettingsRuleError } from '@alga-psa/scheduling/models/timePeriodSettings';
import { delegateRest } from '@alga-psa/scheduling/lib/timeSource';

vi.mock('@alga-psa/scheduling/lib/timeSource', () => ({ delegateRest: vi.fn() }));

const context = { tenant: 'tenant-1', userId: 'user-1' };
const data = { frequency: 1, frequency_unit: 'week' as const, start_day: 7 };
const setting = { ...data, effective_from: '2026-10-07T00:00:00.000Z', effective_to: undefined };
const db = {};

const operations = [
  { method: 'getTimePeriodSettings', model: 'list', args: [context], modelArgs: [db, context.tenant], result: [setting] },
  { method: 'getTimePeriodSettingsById', model: 'getById', args: ['setting-1', context], modelArgs: [db, context.tenant, 'setting-1'], result: setting },
  { method: 'createTimePeriodSettings', model: 'create', args: [data, context], modelArgs: [db, context.tenant, data, { userId: context.userId }], result: setting },
  { method: 'updateTimePeriodSettings', model: 'update', args: ['setting-1', data, context], modelArgs: [db, context.tenant, 'setting-1', data], result: setting },
  { method: 'deleteTimePeriodSettings', model: 'delete', args: ['setting-1', context], modelArgs: [db, context.tenant, 'setting-1'], result: undefined },
] as const;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(delegateRest).mockReset().mockResolvedValue({ handled: false });
});

describe('time period settings service ownership', () => {
  it.each(operations)('$method returns the owning time source result without accessing the native database', async ({ method, args }) => {
    const service = new TimeSheetService();
    const getKnex = vi.spyOn(service as any, 'getKnex').mockRejectedValue(new Error('native DB must not run'));
    const delegatedResult = { source: 'external' };
    vi.mocked(delegateRest).mockResolvedValue({ handled: true, value: delegatedResult });

    expect(await (service[method] as Function)(...args)).toBe(delegatedResult);
    expect(delegateRest).toHaveBeenCalledWith({ tenant: context.tenant, userId: context.userId }, 'sheets', method, args);
    expect(getKnex).not.toHaveBeenCalled();
  });

  it.each(operations)('$method falls through to the shared model for native settings', async ({ method, model, args, modelArgs, result }) => {
    const service = new TimeSheetService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
    const modelCall = vi.spyOn(TimePeriodSettings, model).mockResolvedValue(result as never);

    const response = await (service[method] as Function)(...args);

    expect(modelCall).toHaveBeenCalledWith(...modelArgs);
    if (response !== undefined) {
      expect(Array.isArray(response) ? response[0].effective_from : response.effective_from).toBe('2026-10-07');
    }
  });

  it.each([
    ['overlap', 409],
    ['invalid', 400],
    ['not_found', 404],
  ] as const)('maps the shared model %s failure to HTTP %s', async (kind, statusCode) => {
    const service = new TimeSheetService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
    vi.spyOn(TimePeriodSettings, 'create').mockRejectedValue(new TimePeriodSettingsRuleError(kind, 'Settings rule failed'));

    await expect(service.createTimePeriodSettings(data, context)).rejects.toMatchObject({ statusCode });
  });
});
