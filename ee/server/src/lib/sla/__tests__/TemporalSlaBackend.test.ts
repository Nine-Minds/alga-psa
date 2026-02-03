import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemporalSlaBackend } from '../TemporalSlaBackend';

const startMock = vi.fn();
const signalMock = vi.fn();
const queryMock = vi.fn();

vi.mock('@temporalio/client', () => ({
  Connection: {
    connect: vi.fn(async () => ({})),
  },
  Client: vi.fn().mockImplementation(() => ({
    workflow: {
      start: startMock,
      getHandle: vi.fn(() => ({
        signal: signalMock,
        query: queryMock,
      })),
    },
  })),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => {
    const chain: any = {
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ tenant: 'tenant-1' }),
    };
    return ((_: string) => chain) as any;
  }),
}));

describe('TemporalSlaBackend', () => {
  beforeEach(() => {
    startMock.mockClear();
    signalMock.mockClear();
    queryMock.mockClear();
  });

  it('startSlaTracking starts workflow with correct ID', async () => {
    const backend = new TemporalSlaBackend();
    await backend.startSlaTracking(
      'ticket-1',
      'policy-1',
      [
        {
          sla_policy_id: 'policy-1',
          priority_id: 'priority-1',
          response_time_minutes: 60,
          resolution_time_minutes: 120,
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
    await backend.cancelSla('ticket-1');
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
            sla_policy_id: 'policy-1',
            priority_id: 'priority-1',
            response_time_minutes: 60,
            resolution_time_minutes: 120,
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
