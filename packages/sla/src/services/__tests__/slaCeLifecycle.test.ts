import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { startSlaForTicket, recordFirstResponse, recordResolution } from '../slaService';
import { pauseSla, resumeSla } from '../slaPauseService';
import * as notificationService from '../slaNotificationService';

const getBackendMock = vi.fn();

vi.mock('../backends/SlaBackendFactory', () => ({
  SlaBackendFactory: {
    getBackend: getBackendMock,
  },
}));

function createAdvancedMockTrx() {
  const mockData: Record<string, any> = {};

  const normalizeTable = (table: string) => table.split(' ')[0];

  const createChain = (tableName: string) => {
    const table = normalizeTable(tableName);
    const chain: any = {
      where: vi.fn().mockImplementation(() => chain),
      whereNotNull: vi.fn().mockImplementation(() => chain),
      whereNull: vi.fn().mockImplementation(() => chain),
      join: vi.fn().mockImplementation(() => chain),
      leftJoin: vi.fn().mockImplementation(() => chain),
      orderBy: vi.fn().mockImplementation(() => chain),
      select: vi.fn().mockImplementation(() => {
        const value = mockData[table];
        if (value === undefined) {
          return Promise.resolve([]);
        }
        return Promise.resolve(Array.isArray(value) ? value : [value]);
      }),
      first: vi.fn().mockImplementation(() => {
        const value = mockData[table];
        if (value === undefined) {
          return Promise.resolve(null);
        }
        return Promise.resolve(Array.isArray(value) ? value[0] : value);
      }),
      update: vi.fn().mockImplementation((updates: Record<string, any>) => {
        const value = mockData[table];
        if (Array.isArray(value)) {
          if (value.length > 0) {
            Object.assign(value[0], updates);
          }
        } else if (value) {
          Object.assign(value, updates);
        }
        return Promise.resolve(1);
      }),
      insert: vi.fn().mockImplementation((record: any) => {
        if (!mockData[table]) {
          mockData[table] = [];
        }
        if (Array.isArray(mockData[table])) {
          mockData[table].push(record);
        }
        return Promise.resolve([1]);
      }),
      delete: vi.fn().mockResolvedValue(1),
    };
    return chain;
  };

  const trx = ((table: string) => createChain(table)) as any;
  trx.setData = (table: string, data: any) => {
    mockData[table] = data;
  };
  trx.getData = (table: string) => mockData[table];

  return trx as Knex.Transaction & {
    setData: (table: string, data: any) => void;
    getData: (table: string) => any;
  };
}

describe('CE SLA lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBackendMock.mockResolvedValue({
      startSlaTracking: vi.fn(),
      pauseSla: vi.fn(),
      resumeSla: vi.fn(),
      completeSla: vi.fn(),
      cancelSla: vi.fn(),
      getSlaStatus: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs create, poll-based notification, pause/resume, response, and resolution flow', async () => {
    vi.useFakeTimers();

    const sendNotificationSpy = vi
      .spyOn(notificationService, 'sendSlaNotification')
      .mockResolvedValue({ recipientCount: 1, errors: [] });

    const trx = createAdvancedMockTrx();
    const createdAt = new Date('2024-01-01T00:00:00Z');

    trx.setData('clients', { sla_policy_id: 'policy-1' });
    trx.setData('sla_policies', {
      sla_policy_id: 'policy-1',
      policy_name: 'Standard',
      business_hours_schedule_id: 'schedule-1',
      is_default: true,
    });
    trx.setData('sla_policy_targets', [
      {
        sla_policy_id: 'policy-1',
        priority_id: 'priority-1',
        response_time_minutes: 60,
        resolution_time_minutes: 240,
        is_24x7: true,
      },
    ]);
    trx.setData('business_hours_schedules', {
      schedule_id: 'schedule-1',
      schedule_name: '24x7',
      timezone: 'UTC',
      is_default: true,
      is_24x7: true,
    });
    trx.setData('business_hours_entries', []);
    trx.setData('holidays', []);
    trx.setData('sla_audit_log', []);
    trx.setData('sla_notification_thresholds', [
      {
        sla_policy_id: 'policy-1',
        threshold_percent: 50,
        tenant: 'tenant-1',
      },
    ]);
    trx.setData('tickets', [
      {
        ticket_id: 'ticket-1',
        tenant: 'tenant-1',
        ticket_number: 'T-1',
        title: 'Example',
        assigned_to: 'user-1',
        board_id: 'board-1',
        client_id: 'client-1',
        priority_id: 'priority-1',
        client_name: 'Acme Co',
        priority_name: 'High',
        sla_policy_id: null,
        sla_started_at: null,
        sla_response_due_at: null,
        sla_resolution_due_at: null,
        sla_response_at: null,
        sla_resolution_at: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
      },
    ]);

    await startSlaForTicket(
      trx,
      'tenant-1',
      'ticket-1',
      'client-1',
      'board-1',
      'priority-1',
      createdAt
    );

    const ticketAfterStart = trx.getData('tickets')[0];
    expect(ticketAfterStart.sla_policy_id).toBe('policy-1');

    const notificationResult = await notificationService.checkAndSendThresholdNotifications(
      trx,
      'tenant-1',
      'ticket-1',
      50,
      'response',
      0
    );

    expect(notificationResult.notifiedThreshold).toBe(50);
    expect(sendNotificationSpy).toHaveBeenCalled();

    await pauseSla(trx, 'tenant-1', 'ticket-1', 'status_pause', 'user-1', {
      skipBackend: true,
    });

    vi.advanceTimersByTime(5 * 60 * 1000);

    await resumeSla(trx, 'tenant-1', 'ticket-1', 'user-1', {
      skipBackend: true,
    });

    await recordFirstResponse(trx, 'tenant-1', 'ticket-1', new Date(), 'user-1', {
      skipBackend: true,
    });

    await recordResolution(trx, 'tenant-1', 'ticket-1', new Date(), 'user-1', {
      skipBackend: true,
    });

    const finalTicket = trx.getData('tickets')[0];
    expect(finalTicket.sla_response_at).toBeTruthy();
    expect(finalTicket.sla_resolution_at).toBeTruthy();
  });
});
