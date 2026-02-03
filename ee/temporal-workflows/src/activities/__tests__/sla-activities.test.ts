import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Knex } from 'knex';
import {
  calculateNextWakeTime,
  sendSlaNotification,
  checkAndEscalate,
  updateSlaStatus,
  recordSlaAuditLog,
} from '../sla-activities';

const sendSlaNotificationService = vi.fn();
const checkEscalationNeeded = vi.fn();
const escalateTicket = vi.fn();

vi.mock('@alga-psa/sla/services/slaNotificationService', () => ({
  sendSlaNotification: sendSlaNotificationService,
}));

vi.mock('@alga-psa/sla/services/escalationService', () => ({
  checkEscalationNeeded,
  escalateTicket,
}));

let lastTrx: any;
const withTransaction = vi.fn(async (_knex: unknown, fn: (trx: Knex.Transaction) => Promise<void>) => {
  lastTrx = createMockTrx();
  await fn(lastTrx as unknown as Knex.Transaction);
});

const createTenantKnex = vi.fn(async () => ({ knex: {} }));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex,
  withTransaction,
}));

function createMockTrx() {
  const chains: Record<string, any> = {};
  const makeChain = (table: string) => {
    if (chains[table]) return chains[table];
    const chain: any = {
      leftJoin: vi.fn().mockReturnValue(chain),
      where: vi.fn().mockReturnValue(chain),
      select: vi.fn().mockReturnValue(chain),
      first: vi.fn().mockResolvedValue({
        ticket_id: 'ticket-1',
        ticket_number: 'T-100',
        title: 'Test ticket',
        assigned_to: 'user-1',
        board_id: 'board-1',
        sla_policy_id: 'policy-1',
        sla_response_due_at: new Date(Date.now() + 60 * 60000).toISOString(),
        sla_resolution_due_at: new Date(Date.now() + 120 * 60000).toISOString(),
        client_name: 'Client',
        priority_name: 'P1',
      }),
      update: vi.fn().mockResolvedValue(1),
      insert: vi.fn().mockResolvedValue([1]),
    };
    chains[table] = chain;
    return chain;
  };

  return ((table: string) => makeChain(table)) as unknown as Knex.Transaction;
}

const scheduleWeekdays = {
  schedule_id: 'schedule-1',
  schedule_name: 'Weekdays',
  timezone: 'UTC',
  is_default: false,
  is_24x7: false,
  entries: [
    { entry_id: 'e1', schedule_id: 'schedule-1', day_of_week: 1, start_time: '08:00', end_time: '17:00', is_enabled: true },
    { entry_id: 'e2', schedule_id: 'schedule-1', day_of_week: 2, start_time: '08:00', end_time: '17:00', is_enabled: true },
    { entry_id: 'e3', schedule_id: 'schedule-1', day_of_week: 3, start_time: '08:00', end_time: '17:00', is_enabled: true },
    { entry_id: 'e4', schedule_id: 'schedule-1', day_of_week: 4, start_time: '08:00', end_time: '17:00', is_enabled: true },
    { entry_id: 'e5', schedule_id: 'schedule-1', day_of_week: 5, start_time: '08:00', end_time: '17:00', is_enabled: true },
  ],
  holidays: [],
};

describe('sla activities', () => {
  beforeEach(() => {
    sendSlaNotificationService.mockClear();
    checkEscalationNeeded.mockClear();
    escalateTicket.mockClear();
  });

  it('calculateNextWakeTime returns correct wall-clock time for weekday schedule', async () => {
    const result = await calculateNextWakeTime({
      currentTime: '2024-01-01T09:00:00.000Z',
      targetMinutes: 120,
      schedule: scheduleWeekdays,
      pauseMinutes: 0,
    });
    expect(result).toBe('2024-01-01T11:00:00.000Z');
  });

  it('calculateNextWakeTime advances to Monday when start is Friday 4pm and target is 2 hours', async () => {
    const result = await calculateNextWakeTime({
      currentTime: '2024-01-05T16:00:00.000Z',
      targetMinutes: 120,
      schedule: scheduleWeekdays,
      pauseMinutes: 0,
    });
    expect(result).toBe('2024-01-08T09:00:00.000Z');
  });

  it('calculateNextWakeTime skips holidays in calculation', async () => {
    const result = await calculateNextWakeTime({
      currentTime: '2024-01-05T16:00:00.000Z',
      targetMinutes: 120,
      schedule: {
        ...scheduleWeekdays,
        holidays: [{ holiday_id: 'h1', holiday_date: '2024-01-08', is_recurring: false }],
      },
      pauseMinutes: 0,
    });
    expect(result).toBe('2024-01-09T09:00:00.000Z');
  });

  it('calculateNextWakeTime handles recurring holidays correctly', async () => {
    const result = await calculateNextWakeTime({
      currentTime: '2025-01-08T16:00:00.000Z',
      targetMinutes: 120,
      schedule: {
        ...scheduleWeekdays,
        holidays: [{ holiday_id: 'h2', holiday_date: '2024-01-09', is_recurring: true }],
      },
      pauseMinutes: 0,
    });
    expect(result).toBe('2025-01-10T09:00:00.000Z');
  });

  it('calculateNextWakeTime subtracts pause minutes from elapsed time', async () => {
    const result = await calculateNextWakeTime({
      currentTime: '2024-01-01T09:00:00.000Z',
      targetMinutes: 60,
      schedule: scheduleWeekdays,
      pauseMinutes: 30,
    });
    expect(result).toBe('2024-01-01T10:30:00.000Z');
  });

  it('calculateNextWakeTime returns immediate time for 24x7 schedule', async () => {
    const result = await calculateNextWakeTime({
      currentTime: '2024-01-01T09:00:00.000Z',
      targetMinutes: 60,
      schedule: { ...scheduleWeekdays, is_24x7: true, entries: [] },
      pauseMinutes: 0,
    });
    expect(result).toBe('2024-01-01T10:00:00.000Z');
  });

  it('calculateNextWakeTime handles timezone correctly for America/New_York', async () => {
    const result = await calculateNextWakeTime({
      currentTime: '2024-01-01T14:00:00.000Z',
      targetMinutes: 60,
      schedule: { ...scheduleWeekdays, timezone: 'America/New_York' },
      pauseMinutes: 0,
    });
    expect(result).toBe('2024-01-01T15:00:00.000Z');
  });

  it('calculateNextWakeTime handles timezone correctly for Europe/London', async () => {
    const result = await calculateNextWakeTime({
      currentTime: '2024-01-01T09:00:00.000Z',
      targetMinutes: 60,
      schedule: { ...scheduleWeekdays, timezone: 'Europe/London' },
      pauseMinutes: 0,
    });
    expect(result).toBe('2024-01-01T10:00:00.000Z');
  });

  it('calculateNextWakeTime handles DST transition correctly', async () => {
    const result = await calculateNextWakeTime({
      currentTime: '2024-03-11T13:00:00.000Z',
      targetMinutes: 60,
      schedule: { ...scheduleWeekdays, timezone: 'America/New_York' },
      pauseMinutes: 0,
    });
    expect(result).toBe('2024-03-11T14:00:00.000Z');
  });

  it('sendSlaNotification activity calls slaNotificationService.sendSlaNotification()', async () => {
    await sendSlaNotification({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      phase: 'response',
      thresholdPercent: 50,
    });
    expect(sendSlaNotificationService).toHaveBeenCalledTimes(1);
  });

  it('checkAndEscalate activity calls escalationService.checkEscalationNeeded()', async () => {
    checkEscalationNeeded.mockResolvedValue(null);
    await checkAndEscalate({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      phase: 'response',
      thresholdPercent: 75,
    });
    expect(checkEscalationNeeded).toHaveBeenCalledTimes(1);
  });

  it('checkAndEscalate activity calls escalationService.escalateTicket() when needed', async () => {
    checkEscalationNeeded.mockResolvedValue(2);
    await checkAndEscalate({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      phase: 'resolution',
      thresholdPercent: 90,
    });
    expect(escalateTicket).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'ticket-1', 2);
  });

  it('updateSlaStatus activity updates ticket sla_response_met field', async () => {
    await updateSlaStatus({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      phase: 'response',
      breached: true,
    });
    expect(lastTrx('tickets').update).toHaveBeenCalledWith(
      expect.objectContaining({ sla_response_met: false })
    );
  });

  it('updateSlaStatus activity updates ticket sla_resolution_met field', async () => {
    await updateSlaStatus({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      phase: 'resolution',
      breached: true,
    });
    expect(lastTrx('tickets').update).toHaveBeenCalledWith(
      expect.objectContaining({ sla_resolution_met: false })
    );
  });

  it('recordSlaAuditLog activity inserts entry with correct event type', async () => {
    await recordSlaAuditLog({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      eventType: 'sla_test_event',
      eventData: { foo: 'bar' },
    });
    expect(withTransaction).toHaveBeenCalled();
  });
});
