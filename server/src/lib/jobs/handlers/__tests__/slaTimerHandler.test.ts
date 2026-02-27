import { describe, expect, it, vi, beforeEach } from 'vitest';

const runWithTenantMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const findCrossedThresholdsMock = vi.fn();
const publishWorkflowEventMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  runWithTenant: runWithTenantMock,
  createTenantKnex: createTenantKnexMock,
  withTransaction: withTransactionMock,
}));

vi.mock('@alga-psa/sla', () => ({
  findCrossedThresholds: findCrossedThresholdsMock,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: publishWorkflowEventMock,
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

  it('processes tickets and publishes workflow events for crossed thresholds', async () => {
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
    findCrossedThresholdsMock.mockResolvedValue({
      thresholds: [{ threshold_percent: 50 }],
      highestThreshold: 50,
    });
    publishWorkflowEventMock.mockResolvedValue(undefined);

    const { slaTimerHandler } = await import('../slaTimerHandler');

    await slaTimerHandler({ tenantId: 'tenant-1' });

    expect(findCrossedThresholdsMock).toHaveBeenCalledTimes(1);
    expect(findCrossedThresholdsMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'ticket-1',
      expect.any(Number),
      'response',
      0
    );

    expect(publishWorkflowEventMock).toHaveBeenCalledTimes(1);
    expect(publishWorkflowEventMock).toHaveBeenCalledWith({
      eventType: 'TICKET_SLA_THRESHOLD_REACHED',
      payload: {
        ticketId: 'ticket-1',
        phase: 'response',
        thresholdPercent: 50,
      },
      ctx: {
        tenantId: 'tenant-1',
        occurredAt: expect.any(String),
        actor: { actorType: 'SYSTEM' },
      },
    });
  });

  it('does not publish events when no thresholds are crossed', async () => {
    const now = Date.now();
    const tickets = [
      {
        ticket_id: 'ticket-2',
        ticket_number: 'T-2',
        sla_policy_id: 'policy-1',
        sla_started_at: new Date(now - 10 * 60 * 1000),
        sla_response_due_at: new Date(now + 90 * 60 * 1000),
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
    findCrossedThresholdsMock.mockResolvedValue({
      thresholds: [],
      highestThreshold: 0,
    });

    const { slaTimerHandler } = await import('../slaTimerHandler');

    await slaTimerHandler({ tenantId: 'tenant-1' });

    expect(findCrossedThresholdsMock).toHaveBeenCalledTimes(1);
    expect(publishWorkflowEventMock).not.toHaveBeenCalled();
  });
});
