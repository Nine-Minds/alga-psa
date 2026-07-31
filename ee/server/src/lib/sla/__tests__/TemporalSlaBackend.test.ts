import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemporalSlaBackend } from '../TemporalSlaBackend';

const startMock = vi.fn();
const signalMock = vi.fn();
const queryMock = vi.fn();
const dbMocks = vi.hoisted(() => {
  const chain: any = {
    where: vi.fn(),
    select: vi.fn(),
    first: vi.fn().mockResolvedValue({ tenant: 'tenant-1' }),
  };
  chain.where.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);

  const unscoped = vi.fn(() => chain);
  return {
    chain,
    getConnection: vi.fn(async () => ({})),
    tenantDb: vi.fn(() => ({ unscoped })),
    unscoped,
  };
});

vi.mock('@temporalio/client', () => ({
  Connection: {
    connect: vi.fn(async () => ({})),
  },
  Client: vi.fn().mockImplementation(function () {
    return {
      workflow: {
        start: startMock,
        getHandle: vi.fn(() => ({
          signal: signalMock,
          query: queryMock,
        })),
      },
    };
  }),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: dbMocks.getConnection,
  tenantDb: dbMocks.tenantDb,
}));

describe('TemporalSlaBackend', () => {
  beforeEach(() => {
    startMock.mockClear();
    signalMock.mockClear();
    queryMock.mockClear();
    dbMocks.getConnection.mockClear();
    dbMocks.tenantDb.mockClear();
    dbMocks.unscoped.mockClear();
    dbMocks.chain.where.mockClear();
    dbMocks.chain.select.mockClear();
    dbMocks.chain.first.mockClear();
  });

  it('startSlaTracking starts workflow with correct ID', async () => {
    const backend = new TemporalSlaBackend();
    await backend.startSlaTracking(
      'ticket-1',
      'policy-1',
      [
        {
          target_id: 'target-1',
          sla_policy_id: 'policy-1',
          priority_id: 'priority-1',
          response_time_minutes: 60,
          resolution_time_minutes: 120,
          escalation_1_percent: 50,
          escalation_2_percent: 75,
          escalation_3_percent: 90,
          is_24x7: true,
        },
      ],
      {
        tenant: 'tenant-1',
        schedule_id: '24x7',
        schedule_name: '24x7',
        timezone: 'UTC',
        is_default: false,
        is_24x7: true,
        entries: [],
        holidays: [],
      }
    );

    const call = startMock.mock.calls[0][1];
    expect(call.workflowId).toBe('sla-ticket-tenant-1-ticket-1');
  });

  it('pauseSla sends pause signal', async () => {
    const backend = new TemporalSlaBackend();
    await backend.pauseSla('ticket-1', 'status_pause');
    expect(signalMock).toHaveBeenCalledWith('pause', { reason: 'status_pause' });
  });

  it('resolves ticket tenant through an explicit unscoped discovery boundary', async () => {
    const backend = new TemporalSlaBackend();
    await backend.pauseSla('ticket-1', 'status_pause');

    expect(dbMocks.tenantDb).toHaveBeenCalledWith(
      expect.anything(),
      '__temporal_sla_ticket_discovery__'
    );
    expect(dbMocks.unscoped).toHaveBeenCalledWith(
      'tickets',
      'resolve tenant id for SLA workflow ticket handle'
    );
    expect(dbMocks.chain.where).toHaveBeenCalledWith({ ticket_id: 'ticket-1' });
  });

  it('resumeSla sends resume signal', async () => {
    const backend = new TemporalSlaBackend();
    await backend.resumeSla('ticket-1');
    expect(signalMock).toHaveBeenCalledWith('resume');
  });

  it("completeSla('response') sends completeResponse signal", async () => {
    const backend = new TemporalSlaBackend();
    await backend.completeSla('ticket-1', 'response', true);
    expect(signalMock).toHaveBeenCalledWith('completeResponse', { met: true });
  });

  it("completeSla('resolution') sends completeResolution signal", async () => {
    const backend = new TemporalSlaBackend();
    await backend.completeSla('ticket-1', 'resolution', true);
    expect(signalMock).toHaveBeenCalledWith('completeResolution', { met: true });
  });

  it('cancelSla sends cancel signal', async () => {
    const backend = new TemporalSlaBackend();
    await backend.cancelSla('tenant-1', 'ticket-1');
    expect(signalMock).toHaveBeenCalledWith('cancel');
  });

  it('getSlaStatus queries workflow state', async () => {
    queryMock.mockResolvedValue({ status: 'active' });
    const backend = new TemporalSlaBackend();
    await backend.getSlaStatus('ticket-1');
    expect(queryMock).toHaveBeenCalledWith('getState');
  });

  it('startSlaTracking handles duplicate workflow ID without error', async () => {
    startMock.mockImplementationOnce(() => {
      const error = new Error('already started');
      (error as any).name = 'WorkflowExecutionAlreadyStartedError';
      throw error;
    });

    const backend = new TemporalSlaBackend();
    await expect(
      backend.startSlaTracking(
        'ticket-2',
        'policy-1',
        [
          {
            target_id: 'target-1',
            sla_policy_id: 'policy-1',
            priority_id: 'priority-1',
            response_time_minutes: 60,
            resolution_time_minutes: 120,
            escalation_1_percent: 50,
            escalation_2_percent: 75,
            escalation_3_percent: 90,
            is_24x7: true,
          },
        ],
        {
          tenant: 'tenant-1',
          schedule_id: '24x7',
          schedule_name: '24x7',
          timezone: 'UTC',
          is_default: false,
          is_24x7: true,
          entries: [],
          holidays: [],
        }
      )
    ).resolves.toBeUndefined();
  });
});
