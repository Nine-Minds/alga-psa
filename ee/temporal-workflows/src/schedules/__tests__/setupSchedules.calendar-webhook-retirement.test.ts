import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resetMaintenanceScheduleExtensions } from '@alga-psa/types';

const { scheduleCreate, scheduleDelete, existing } = vi.hoisted(() => ({
  scheduleCreate: vi.fn(),
  scheduleDelete: vi.fn(),
  existing: new Map<string, unknown>(),
}));

vi.mock('@temporalio/client', () => ({
  Connection: { connect: vi.fn(async () => ({})) },
  Client: vi.fn(function () { return ({ schedule: {
    create: scheduleCreate,
    getHandle: vi.fn((id: string) => ({
      update: vi.fn(),
      delete: () => scheduleDelete(id),
      trigger: vi.fn(),
    })),
    list: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
  } }); }),
  ScheduleOverlapPolicy: { SKIP: 'SKIP' },
}));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: vi.fn(async () => Object.assign(
    () => ({ select: () => ({ first: async () => undefined }) }),
    { schema: { hasTable: async () => false }, raw: vi.fn(() => '1') },
  )),
}));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn(() => ({
  unscoped: vi.fn(() => ({ where: vi.fn().mockReturnThis(), join: vi.fn().mockReturnThis(), whereNull: vi.fn().mockReturnThis(), select: vi.fn(async () => []) })),
  tenantJoin: vi.fn(),
})) }));
vi.mock('@ee/lib/integrations/ninjaone/proactiveRefresh', () => ({ seedNinjaOneProactiveRefreshFromStoredCredentials: vi.fn() }));

const LEGACY_ID = 'calendar-webhook-maintenance-schedule';
const RENEWAL_ID = 'maintenance-fanout:renew-microsoft-calendar-webhooks';

// T008: the stub Temporal workflow is gone, its live schedule is deleted on
// worker start, and renewal is carried by the maintenance fan-out schedule.
describe('retired calendar webhook maintenance Temporal schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existing.clear();
    resetMaintenanceScheduleExtensions();
    process.env.EDITION = 'ee';
    scheduleCreate.mockImplementation(async (input: { scheduleId: string }) => {
      existing.set(input.scheduleId, input);
    });
  });

  afterAll(() => {
    delete process.env.EDITION;
    resetMaintenanceScheduleExtensions();
  });

  it('deletes the legacy schedule, never recreates it, and schedules the fan-out renewal', async () => {
    const { setupSchedules } = await import('../setupSchedules');
    await setupSchedules();

    expect(scheduleDelete).toHaveBeenCalledWith(LEGACY_ID);
    expect(scheduleCreate.mock.calls.map(([input]) => input.scheduleId)).not.toContain(LEGACY_ID);

    const renewal = scheduleCreate.mock.calls.map(([input]) => input).find((input) => input.scheduleId === RENEWAL_ID);
    expect(renewal).toMatchObject({
      spec: { cronExpressions: ['*/30 * * * *'] },
      action: expect.objectContaining({ args: [{ jobName: 'renew-microsoft-calendar-webhooks' }] }),
    });
  });

  it('no longer ships the workflow, the stub activity or their exports', () => {
    const src = path.resolve(__dirname, '../..');
    expect(fs.existsSync(path.join(src, 'workflows/calendar-webhook-maintenance-workflow.ts'))).toBe(false);
    expect(fs.existsSync(path.join(src, 'activities/calendar-webhook-maintenance-activities.ts'))).toBe(false);
    for (const index of ['workflows/index.ts', 'workflows/non-authored-index.ts', 'activities/index.ts', 'activities/non-authored-index.ts', 'client.ts']) {
      const source = fs.readFileSync(path.join(src, index), 'utf8');
      expect(source, index).not.toMatch(/calendar-webhook-maintenance-(workflow|activities)|calendarWebhookMaintenance[W]orkflow/);
    }
  });
});
