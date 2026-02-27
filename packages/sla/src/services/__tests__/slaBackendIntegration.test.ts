import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';

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

describe('SLA backend integration', () => {
  const originalEdition = process.env.EDITION;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.EDITION = originalEdition;
  });

  it('EE ticket start triggers Temporal workflow', async () => {
    process.env.EDITION = 'ee';

    const startSpy = vi.fn();
    vi.doMock('@enterprise/lib/sla/TemporalSlaBackend', () => ({
      TemporalSlaBackend: class TemporalSlaBackendMock {
        startSlaTracking = startSpy;
        pauseSla = vi.fn();
        resumeSla = vi.fn();
        completeSla = vi.fn();
        cancelSla = vi.fn();
        getSlaStatus = vi.fn();
      },
    }));

    const { startSlaForTicket } = await import('../slaService');
    const { SlaBackendFactory } = await import('../backends/SlaBackendFactory');

    const trx = createAdvancedMockTrx();
    trx.setData('clients', { sla_policy_id: 'policy-1' });
    trx.setData('sla_policies', { sla_policy_id: 'policy-1', policy_name: 'Policy' });
    trx.setData('sla_policy_targets', [{
      sla_policy_id: 'policy-1',
      priority_id: 'priority-1',
      response_time_minutes: 60,
      resolution_time_minutes: 120,
      is_24x7: true,
    }]);

    await startSlaForTicket(
      trx,
      'tenant-1',
      'ticket-1',
      'client-1',
      'board-1',
      'priority-1',
      new Date('2024-01-01T00:00:00Z')
    );

    expect(startSpy).toHaveBeenCalledTimes(1);
    SlaBackendFactory.getInstance().reset();
  });

  it('CE ticket start does not construct Temporal backend', async () => {
    process.env.EDITION = 'ce';

    const constructorSpy = vi.fn();
    vi.doMock('@enterprise/lib/sla/TemporalSlaBackend', () => ({
      TemporalSlaBackend: class TemporalSlaBackendMock {
        constructor() {
          constructorSpy();
        }
      },
    }));

    const { startSlaForTicket } = await import('../slaService');
    const { SlaBackendFactory } = await import('../backends/SlaBackendFactory');

    const trx = createAdvancedMockTrx();
    trx.setData('clients', { sla_policy_id: 'policy-1' });
    trx.setData('sla_policies', { sla_policy_id: 'policy-1', policy_name: 'Policy' });
    trx.setData('sla_policy_targets', [{
      sla_policy_id: 'policy-1',
      priority_id: 'priority-1',
      response_time_minutes: 60,
      resolution_time_minutes: 120,
      is_24x7: true,
    }]);

    await startSlaForTicket(
      trx,
      'tenant-1',
      'ticket-2',
      'client-1',
      'board-1',
      'priority-1',
      new Date('2024-01-01T00:00:00Z')
    );

    expect(constructorSpy).not.toHaveBeenCalled();
    SlaBackendFactory.getInstance().reset();
  });

  it('EE falls back to PgBoss when Temporal unavailable', async () => {
    process.env.EDITION = 'ee';

    vi.doMock('@enterprise/lib/sla/TemporalSlaBackend', () => ({
      TemporalSlaBackend: class TemporalSlaBackendMock {
        constructor() {
          throw new Error('Temporal unavailable');
        }
      },
    }));

    const { startSlaForTicket } = await import('../slaService');
    const { SlaBackendFactory } = await import('../backends/SlaBackendFactory');

    const trx = createAdvancedMockTrx();
    trx.setData('clients', { sla_policy_id: 'policy-1' });
    trx.setData('sla_policies', { sla_policy_id: 'policy-1', policy_name: 'Policy' });
    trx.setData('sla_policy_targets', [{
      sla_policy_id: 'policy-1',
      priority_id: 'priority-1',
      response_time_minutes: 60,
      resolution_time_minutes: 120,
      is_24x7: true,
    }]);

    await expect(
      startSlaForTicket(
        trx,
        'tenant-1',
        'ticket-3',
        'client-1',
        'board-1',
        'priority-1',
        new Date('2024-01-01T00:00:00Z')
      )
    ).resolves.toBeDefined();

    SlaBackendFactory.getInstance().reset();
  });

  it('SLA policy change cancels old workflow and starts new one', async () => {
    process.env.EDITION = 'ce';

    const { handlePolicyChange } = await import('../slaService');
    const { SlaBackendFactory } = await import('../backends/SlaBackendFactory');

    const backendMock = {
      cancelSla: vi.fn(),
      startSlaTracking: vi.fn(),
      pauseSla: vi.fn(),
      resumeSla: vi.fn(),
      completeSla: vi.fn(),
      getSlaStatus: vi.fn(),
    };

    vi.spyOn(SlaBackendFactory, 'getBackend').mockResolvedValue(backendMock as any);

    const trx = createAdvancedMockTrx();
    trx.setData('tickets', {
      sla_started_at: new Date('2024-01-01T00:00:00Z').toISOString(),
      priority_id: 'priority-1',
      client_id: 'client-1',
      board_id: 'board-1',
    });
    trx.setData('sla_policies', {
      sla_policy_id: 'policy-1',
      policy_name: 'Policy',
      business_hours_schedule_id: 'schedule-1',
    });
    trx.setData('sla_policy_targets', [{
      sla_policy_id: 'policy-1',
      priority_id: 'priority-1',
      response_time_minutes: 60,
      resolution_time_minutes: 120,
      is_24x7: true,
    }]);
    trx.setData('business_hours_schedules', {
      schedule_id: 'schedule-1',
      schedule_name: 'Default',
      timezone: 'UTC',
      is_default: true,
      is_24x7: true,
    });
    trx.setData('business_hours_entries', []);
    trx.setData('holidays', []);

    await handlePolicyChange(trx, 'tenant-1', 'ticket-1', 'policy-1');

    expect(backendMock.cancelSla).toHaveBeenCalledWith('ticket-1');
    expect(backendMock.startSlaTracking).toHaveBeenCalled();
  });
});
