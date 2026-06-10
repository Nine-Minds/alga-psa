import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Knex } from 'knex';
import {
  startSlaForTicket,
  recordFirstResponse,
  recordResolution,
  handlePriorityChange,
} from '../slaService';
import { pauseSla, resumeSla } from '../slaPauseService';
import { dispatchSlaBackendActions } from '../slaBackendActions';
import { SlaBackendFactory } from '../backends/SlaBackendFactory';

function createAdvancedMockTrx() {
  const mockData: Record<string, any> = {};

  const createChain = (table: string) => {
    const rows = () => {
      const value = mockData[table];
      if (value === undefined || value === null) return [];
      return Array.isArray(value) ? value : [value];
    };
    const chain: any = {
      where: vi.fn().mockImplementation(() => chain),
      select: vi.fn().mockImplementation(() => chain),
      orderBy: vi.fn().mockImplementation(() => chain),
      first: vi.fn().mockImplementation(() => Promise.resolve(rows()[0] ?? null)),
      update: vi.fn().mockImplementation(() => Promise.resolve(1)),
      insert: vi.fn().mockImplementation(() => Promise.resolve([1])),
      // Awaiting the chain itself (e.g. `await trx(t).where(...)`) yields rows.
      then: (resolve: any, reject: any) => Promise.resolve(rows()).then(resolve, reject),
    };
    return chain;
  };

  const trx = ((table: string) => createChain(table)) as any;
  trx.raw = vi.fn(async () => ({ rows: [] }));
  trx.setData = (table: string, data: any) => {
    mockData[table] = data;
  };

  return trx as Knex.Transaction & {
    setData: (table: string, data: any) => void;
  };
}

// The SLA write functions are pure DB mutators: they must never reach the
// backend (network / second connection) while the caller's transaction is
// open. They describe the warranted side effect as a backendActions entry and
// the caller dispatches it after commit via dispatchSlaBackendActions().
describe('SLA backend actions', () => {
  const TENANT_ID = 'tenant-1';
  const TICKET_ID = 'ticket-1';
  const CLIENT_ID = 'client-1';
  const BOARD_ID = 'board-1';
  const PRIORITY_ID = 'priority-1';
  const POLICY_ID = 'policy-1';
  const SCHEDULE_ID = 'schedule-1';

  const backendMock = {
    startSlaTracking: vi.fn(),
    pauseSla: vi.fn(),
    resumeSla: vi.fn(),
    completeSla: vi.fn(),
    cancelSla: vi.fn(),
    getSlaStatus: vi.fn(),
  };

  let getBackendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getBackendSpy = vi.spyOn(SlaBackendFactory, 'getBackend').mockResolvedValue(backendMock as any);
    backendMock.startSlaTracking.mockClear();
    backendMock.pauseSla.mockClear();
    backendMock.resumeSla.mockClear();
    backendMock.completeSla.mockClear();
    backendMock.cancelSla.mockClear();
  });

  it('startSlaForTicket returns a start action without touching the backend', async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('clients', { sla_policy_id: POLICY_ID });
    trx.setData('sla_policies', { sla_policy_id: POLICY_ID, policy_name: 'Policy' });
    trx.setData('sla_policy_targets', [{
      sla_policy_id: POLICY_ID,
      priority_id: PRIORITY_ID,
      response_time_minutes: 60,
      resolution_time_minutes: 240,
      is_24x7: true,
    }]);
    trx.setData('business_hours_schedules', {
      schedule_id: SCHEDULE_ID,
      schedule_name: 'Default',
      timezone: 'UTC',
      is_default: true,
      is_24x7: true,
    });
    trx.setData('business_hours_entries', []);
    trx.setData('holidays', []);

    const result = await startSlaForTicket(
      trx,
      TENANT_ID,
      TICKET_ID,
      CLIENT_ID,
      BOARD_ID,
      PRIORITY_ID,
      new Date('2024-01-01T00:00:00Z')
    );

    expect(getBackendSpy).not.toHaveBeenCalled();
    expect(result.backendActions).toHaveLength(1);
    expect(result.backendActions?.[0]).toMatchObject({
      kind: 'start',
      ticketId: TICKET_ID,
      policyId: POLICY_ID,
    });
  });

  it('handlePriorityChange returns cancel+start actions without touching the backend', async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_policy_id: POLICY_ID,
      sla_started_at: new Date('2024-01-01T00:00:00Z').toISOString(),
      sla_response_at: null,
      sla_resolution_at: null,
      sla_resolution_due_at: null,
      sla_total_pause_minutes: 0,
      client_id: CLIENT_ID,
      board_id: BOARD_ID,
      priority_id: PRIORITY_ID,
      due_date: null,
    });
    trx.setData('sla_policies', { sla_policy_id: POLICY_ID, policy_name: 'Policy' });
    trx.setData('sla_policy_targets', [{
      sla_policy_id: POLICY_ID,
      priority_id: 'priority-2',
      response_time_minutes: 30,
      resolution_time_minutes: 120,
      is_24x7: true,
    }]);
    trx.setData('business_hours_schedules', {
      schedule_id: SCHEDULE_ID,
      schedule_name: 'Default',
      timezone: 'UTC',
      is_default: true,
      is_24x7: true,
    });
    trx.setData('business_hours_entries', []);
    trx.setData('holidays', []);

    const result = await handlePriorityChange(trx, TENANT_ID, TICKET_ID, 'priority-2');

    expect(getBackendSpy).not.toHaveBeenCalled();
    expect(result.backendActions).toEqual([
      { kind: 'cancel', tenantId: TENANT_ID, ticketId: TICKET_ID },
      expect.objectContaining({ kind: 'start', ticketId: TICKET_ID, policyId: POLICY_ID }),
    ]);
  });

  it('handlePriorityChange returns no actions when both SLA stages are already recorded', async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_policy_id: POLICY_ID,
      sla_started_at: new Date('2024-01-01T00:00:00Z').toISOString(),
      sla_response_at: new Date('2024-01-01T00:30:00Z').toISOString(),
      sla_resolution_at: new Date('2024-01-01T02:00:00Z').toISOString(),
      sla_resolution_due_at: null,
      sla_total_pause_minutes: 0,
      client_id: CLIENT_ID,
      board_id: BOARD_ID,
      priority_id: PRIORITY_ID,
      due_date: null,
    });
    trx.setData('sla_policies', { sla_policy_id: POLICY_ID, policy_name: 'Policy' });
    trx.setData('sla_policy_targets', [{
      sla_policy_id: POLICY_ID,
      priority_id: 'priority-2',
      response_time_minutes: 30,
      resolution_time_minutes: 120,
      is_24x7: true,
    }]);
    trx.setData('business_hours_schedules', {
      schedule_id: SCHEDULE_ID,
      schedule_name: 'Default',
      timezone: 'UTC',
      is_default: true,
      is_24x7: true,
    });
    trx.setData('business_hours_entries', []);
    trx.setData('holidays', []);

    const result = await handlePriorityChange(trx, TENANT_ID, TICKET_ID, 'priority-2');

    expect(getBackendSpy).not.toHaveBeenCalled();
    expect(result.backendActions).toEqual([]);
  });

  it("recordFirstResponse returns a complete('response') action without touching the backend", async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_policy_id: POLICY_ID,
      sla_response_at: null,
      sla_response_due_at: new Date(Date.now() + 60 * 60000).toISOString(),
      sla_total_pause_minutes: 0,
    });

    const result = await recordFirstResponse(trx, TENANT_ID, TICKET_ID, new Date());
    expect(getBackendSpy).not.toHaveBeenCalled();
    expect(result.backendActions).toEqual([
      { kind: 'complete', ticketId: TICKET_ID, type: 'response', met: true },
    ]);
  });

  it('recordFirstResponse returns no action when there is no response due date', async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_policy_id: POLICY_ID,
      sla_response_at: null,
      sla_response_due_at: null,
      sla_total_pause_minutes: 0,
    });

    const result = await recordFirstResponse(trx, TENANT_ID, TICKET_ID, new Date());
    expect(result.success).toBe(true);
    expect(result.backendActions).toBeUndefined();
  });

  it("recordResolution returns a complete('resolution') action without touching the backend", async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_policy_id: POLICY_ID,
      sla_resolution_at: null,
      sla_resolution_due_at: new Date(Date.now() + 60 * 60000).toISOString(),
      sla_total_pause_minutes: 0,
    });

    const result = await recordResolution(trx, TENANT_ID, TICKET_ID, new Date());
    expect(getBackendSpy).not.toHaveBeenCalled();
    expect(result.backendActions).toEqual([
      { kind: 'complete', ticketId: TICKET_ID, type: 'resolution', met: true },
    ]);
  });

  it('recordResolution still emits a complete action when met is null', async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_policy_id: POLICY_ID,
      sla_resolution_at: null,
      sla_resolution_due_at: null,
      sla_total_pause_minutes: 0,
    });

    const result = await recordResolution(trx, TENANT_ID, TICKET_ID, new Date());
    expect(result.backendActions).toEqual([
      { kind: 'complete', ticketId: TICKET_ID, type: 'resolution', met: null },
    ]);
  });

  it('pauseSla returns a pause action without touching the backend', async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_policy_id: POLICY_ID,
      sla_paused_at: null,
      status_id: 'status-1',
    });

    const result = await pauseSla(trx, TENANT_ID, TICKET_ID, 'status_pause');
    expect(getBackendSpy).not.toHaveBeenCalled();
    expect(result.backendActions).toEqual([
      { kind: 'pause', ticketId: TICKET_ID, reason: 'status_pause' },
    ]);
  });

  it('resumeSla returns a resume action without touching the backend', async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_policy_id: POLICY_ID,
      sla_paused_at: new Date(Date.now() - 10 * 60000).toISOString(),
      sla_total_pause_minutes: 0,
      status_id: 'status-1',
    });

    const result = await resumeSla(trx, TENANT_ID, TICKET_ID);
    expect(getBackendSpy).not.toHaveBeenCalled();
    expect(result.backendActions).toEqual([{ kind: 'resume', ticketId: TICKET_ID }]);
  });

  describe('dispatchSlaBackendActions', () => {
    it('translates actions to backend calls', async () => {
      await dispatchSlaBackendActions([
        { kind: 'pause', ticketId: TICKET_ID, reason: 'status_pause' },
        { kind: 'resume', ticketId: TICKET_ID },
        { kind: 'complete', ticketId: TICKET_ID, type: 'resolution', met: true },
        { kind: 'cancel', tenantId: TENANT_ID, ticketId: TICKET_ID },
      ]);

      expect(backendMock.pauseSla).toHaveBeenCalledWith(TICKET_ID, 'status_pause');
      expect(backendMock.resumeSla).toHaveBeenCalledWith(TICKET_ID);
      expect(backendMock.completeSla).toHaveBeenCalledWith(TICKET_ID, 'resolution', true);
      expect(backendMock.cancelSla).toHaveBeenCalledWith(TENANT_ID, TICKET_ID);
    });

    it('handles undefined and empty action lists without touching the backend', async () => {
      await dispatchSlaBackendActions(undefined);
      await dispatchSlaBackendActions([]);
      expect(getBackendSpy).not.toHaveBeenCalled();
    });

    it('swallows backend failures and continues with remaining actions', async () => {
      backendMock.pauseSla.mockRejectedValueOnce(new Error('temporal down'));

      await expect(
        dispatchSlaBackendActions([
          { kind: 'pause', ticketId: TICKET_ID, reason: 'status_pause' },
          { kind: 'resume', ticketId: TICKET_ID },
        ])
      ).resolves.toBeUndefined();

      expect(backendMock.resumeSla).toHaveBeenCalledWith(TICKET_ID);
    });
  });
});
