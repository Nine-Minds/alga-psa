import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PORTABLE_RESTORE_UPLOAD_CLEANUP_SCHEDULE,
  resetMaintenanceScheduleExtensions,
} from '@alga-psa/types';

const { scheduleCreate, scheduleUpdate, scheduleDelete, hasTable, firstAttempt, adminConnection, existing } = vi.hoisted(() => ({
  scheduleCreate: vi.fn(),
  scheduleUpdate: vi.fn(),
  scheduleDelete: vi.fn(),
  hasTable: vi.fn(),
  firstAttempt: vi.fn(),
  adminConnection: vi.fn(),
  existing: new Map<string, unknown>(),
}));

vi.mock('@temporalio/client', () => ({
  Connection: { connect: vi.fn(async () => ({})) },
  Client: vi.fn(function () { return ({ schedule: {
    create: scheduleCreate,
    getHandle: vi.fn((id: string) => ({
      update: (updater: (previous: Record<string, unknown>) => unknown) => scheduleUpdate(id, updater((existing.get(id) as Record<string, unknown>) ?? {})),
      delete: () => scheduleDelete(id), trigger: vi.fn(),
    })),
    list: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
  } }); }),
  ScheduleOverlapPolicy: { SKIP: 'SKIP' },
}));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: adminConnection,
}));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn(() => ({
  unscoped: vi.fn(() => ({ where: vi.fn().mockReturnThis(), join: vi.fn().mockReturnThis(), whereNull: vi.fn().mockReturnThis(), select: vi.fn(async () => []) })),
  tenantJoin: vi.fn(),
})) }));
vi.mock('@ee/lib/integrations/ninjaone/proactiveRefresh', () => ({ seedNinjaOneProactiveRefreshFromStoredCredentials: vi.fn() }));

describe('portable restore EE scheduler convergence', () => {
  const originalForce = process.env.FORCE_CAPABILITIES;
  beforeEach(() => {
    vi.clearAllMocks();
    existing.clear();
    resetMaintenanceScheduleExtensions();
    process.env.EDITION = 'ee';
    delete process.env.FORCE_CAPABILITIES;
    hasTable.mockResolvedValue(true);
    firstAttempt.mockResolvedValue({ attempt_id: 'attempt' });
    adminConnection.mockResolvedValue(Object.assign(
      () => ({ select: () => ({ first: firstAttempt }) }),
      { schema: { hasTable }, raw: vi.fn(() => '1') },
    ));
    scheduleCreate.mockImplementation(async (input: { scheduleId: string }) => {
      if (existing.has(input.scheduleId)) throw { code: 6 };
      existing.set(input.scheduleId, input);
    });
    scheduleUpdate.mockImplementation((id: string, next: unknown) => existing.set(id, next));
  });

  afterAll(() => {
    if (originalForce === undefined) delete process.env.FORCE_CAPABILITIES;
    else process.env.FORCE_CAPABILITIES = originalForce;
    delete process.env.EDITION;
    resetMaintenanceScheduleExtensions();
  });

  it('creates the durable Temporal schedule through the production registry and convergence path', async () => {
    const { setupSchedules } = await import('../setupSchedules');
    await setupSchedules();

    const id = `maintenance-fanout:${PORTABLE_RESTORE_UPLOAD_CLEANUP_SCHEDULE.jobName}`;
    const persisted = scheduleCreate.mock.calls.map(([input]) => input).find((input) => input.scheduleId === id);
    expect(persisted).toMatchObject({
      scheduleId: id,
      spec: { cronExpressions: [PORTABLE_RESTORE_UPLOAD_CLEANUP_SCHEDULE.cron] },
      action: expect.objectContaining({ args: [{ jobName: PORTABLE_RESTORE_UPLOAD_CLEANUP_SCHEDULE.jobName }] }),
      policies: { overlap: 'SKIP', catchupWindow: '1m' },
    });
  });

  it('keeps the schedule dark when there is no journal or the capability kill switch is off', async () => {
    const { setupSchedules } = await import('../setupSchedules');
    firstAttempt.mockResolvedValueOnce(undefined);
    await setupSchedules();
    expect(scheduleCreate.mock.calls.some(([input]) => input.scheduleId === 'maintenance-fanout:portable-restore-upload-cleanup')).toBe(false);
    expect(scheduleDelete).toHaveBeenCalledWith('maintenance-fanout:portable-restore-upload-cleanup');

    vi.clearAllMocks();
    existing.clear();
    resetMaintenanceScheduleExtensions();
    hasTable.mockResolvedValue(false);
    await setupSchedules();
    expect(scheduleCreate.mock.calls.some(([input]) => input.scheduleId === 'maintenance-fanout:portable-restore-upload-cleanup')).toBe(false);
    expect(scheduleDelete).toHaveBeenCalledWith('maintenance-fanout:portable-restore-upload-cleanup');

    vi.clearAllMocks();
    existing.clear();
    resetMaintenanceScheduleExtensions();
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    hasTable.mockResolvedValue(true);
    firstAttempt.mockResolvedValue({ attempt_id: 'attempt' });
    await setupSchedules();
    expect(hasTable).not.toHaveBeenCalled();
    expect(scheduleCreate.mock.calls.some(([input]) => input.scheduleId === 'maintenance-fanout:portable-restore-upload-cleanup')).toBe(false);
    expect(scheduleDelete).toHaveBeenCalledWith('maintenance-fanout:portable-restore-upload-cleanup');
  });

  it('continues native schedule convergence when the optional restore journal probe fails', async () => {
    const { setupSchedules } = await import('../setupSchedules');
    adminConnection.mockRejectedValueOnce(new Error('restore probe unavailable'));

    await setupSchedules();

    expect(scheduleCreate.mock.calls.some(([input]) => input.scheduleId === 'maintenance-fanout:expired-credits')).toBe(true);
    expect(scheduleCreate.mock.calls.some(([input]) => input.scheduleId === 'maintenance-fanout:portable-restore-upload-cleanup')).toBe(false);
    expect(scheduleDelete).not.toHaveBeenCalledWith('maintenance-fanout:portable-restore-upload-cleanup');
  });
});
