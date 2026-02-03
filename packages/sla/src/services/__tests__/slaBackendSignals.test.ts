import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Knex } from 'knex';
import {
  startSlaForTicket,
  recordFirstResponse,
  recordResolution,
} from '../slaService';
import { pauseSla, resumeSla } from '../slaPauseService';
import { SlaBackendFactory } from '../backends/SlaBackendFactory';

function createAdvancedMockTrx() {
  const mockData: Record<string, any> = {};

  const createChain = (table: string) => {
    const chain: any = {
      where: vi.fn().mockImplementation(() => chain),
      select: vi.fn().mockImplementation(() => chain),
      first: vi.fn().mockImplementation(() => Promise.resolve(mockData[table] || null)),
      update: vi.fn().mockImplementation(() => Promise.resolve(1)),
      insert: vi.fn().mockImplementation(() => Promise.resolve([1])),
    };
    return chain;
  };

  const trx = ((table: string) => createChain(table)) as any;
  trx.setData = (table: string, data: any) => {
    mockData[table] = data;
  };

  return trx as Knex.Transaction & {
    setData: (table: string, data: any) => void;
  };
}

describe('SLA backend signaling', () => {
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

  beforeEach(() => {
    vi.spyOn(SlaBackendFactory, 'getBackend').mockResolvedValue(backendMock as any);
    backendMock.startSlaTracking.mockClear();
    backendMock.pauseSla.mockClear();
    backendMock.resumeSla.mockClear();
    backendMock.completeSla.mockClear();
  });

  it('startSlaForTicket calls backend.startSlaTracking()', async () => {
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

    await startSlaForTicket(
      trx,
      TENANT_ID,
      TICKET_ID,
      CLIENT_ID,
      BOARD_ID,
      PRIORITY_ID,
      new Date('2024-01-01T00:00:00Z')
    );

    expect(backendMock.startSlaTracking).toHaveBeenCalledTimes(1);
  });

  it("recordFirstResponse calls backend.completeSla('response')", async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_policy_id: POLICY_ID,
      sla_response_at: null,
      sla_response_due_at: new Date(Date.now() + 60 * 60000).toISOString(),
      sla_total_pause_minutes: 0,
    });

    await recordFirstResponse(trx, TENANT_ID, TICKET_ID, new Date());
    expect(backendMock.completeSla).toHaveBeenCalledWith(TICKET_ID, 'response', true);
  });

  it("recordResolution calls backend.completeSla('resolution')", async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_policy_id: POLICY_ID,
      sla_resolution_at: null,
      sla_resolution_due_at: new Date(Date.now() + 60 * 60000).toISOString(),
      sla_total_pause_minutes: 0,
    });

    await recordResolution(trx, TENANT_ID, TICKET_ID, new Date());
    expect(backendMock.completeSla).toHaveBeenCalledWith(TICKET_ID, 'resolution', true);
  });

  it('pauseSla signals backend.pauseSla()', async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_policy_id: POLICY_ID,
      sla_paused_at: null,
      status_id: 'status-1',
    });

    await pauseSla(trx, TENANT_ID, TICKET_ID, 'status_pause');
    expect(backendMock.pauseSla).toHaveBeenCalledWith(TICKET_ID, 'status_pause');
  });

  it('resumeSla signals backend.resumeSla()', async () => {
    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_policy_id: POLICY_ID,
      sla_paused_at: new Date(Date.now() - 10 * 60000).toISOString(),
      sla_total_pause_minutes: 0,
      status_id: 'status-1',
    });

    await resumeSla(trx, TENANT_ID, TICKET_ID);
    expect(backendMock.resumeSla).toHaveBeenCalledWith(TICKET_ID);
  });
});
