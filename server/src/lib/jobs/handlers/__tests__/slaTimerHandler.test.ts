import { describe, expect, it, vi, beforeEach } from 'vitest';

const runWithTenantMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const checkAndSendThresholdNotificationsMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  runWithTenant: runWithTenantMock,
  createTenantKnex: createTenantKnexMock,
  withTransaction: withTransactionMock,
}));

vi.mock('@alga-psa/sla', () => ({
  checkAndSendThresholdNotifications: checkAndSendThresholdNotificationsMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: loggerInfoMock,
    error: loggerErrorMock,
  },
}));

function createMockTrx(tickets: any[]) {
  return ((table: string) => {
    const chain: any = {
      where: vi.fn().mockReturnThis(),
      whereNotNull: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue(table === 'tickets' ? tickets : []),
      update: vi.fn().mockResolvedValue(1),
    };
    return chain;
  }) as any;
}

describe('slaTimerHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes tickets and calls threshold notification checks', async () => {
    const now = Date.now();
    const tickets = [
      {
        ticket_id: 'ticket-1',
        ticket_number: 'T-1',
        sla_policy_id: 'policy-1',
        sla_started_at: new Date(now - 50 * 60 * 1000),
        sla_response_due_at: new Date(now + 50 * 60 * 1000),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
        attributes: {
          sla_last_response_threshold_notified: 0,
          sla_last_resolution_threshold_notified: 0,
        },
      },
    ];

    const trx = createMockTrx(tickets);

    runWithTenantMock.mockImplementation(async (_tenant: string, callback: () => Promise<void>) => {
      await callback();
    });
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_knex: any, callback: (trx: any) => Promise<void>) => {
      await callback(trx);
    });
    checkAndSendThresholdNotificationsMock.mockResolvedValue({
      notifiedThreshold: 50,
      result: { recipientCount: 1 },
    });

    const { slaTimerHandler } = await import('../slaTimerHandler');

    await slaTimerHandler({ tenantId: 'tenant-1' });

    expect(checkAndSendThresholdNotificationsMock).toHaveBeenCalledTimes(1);
    expect(checkAndSendThresholdNotificationsMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'ticket-1',
      expect.any(Number),
      'response',
      0
    );
  });
});
