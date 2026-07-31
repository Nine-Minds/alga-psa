import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';

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

function seedPolicy(trx: ReturnType<typeof createAdvancedMockTrx>) {
  trx.setData('clients', { sla_policy_id: 'policy-1' });
  trx.setData('sla_policies', { sla_policy_id: 'policy-1', policy_name: 'Policy' });
  trx.setData('sla_policy_targets', [{
    sla_policy_id: 'policy-1',
    priority_id: 'priority-1',
    response_time_minutes: 60,
    resolution_time_minutes: 120,
    is_24x7: true,
  }]);
}

describe('SLA backend integration', () => {
  const originalEdition = process.env.EDITION;
  const originalNextPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    // isEnterprise (packages/core features) checks both EDITION and
    // NEXT_PUBLIC_EDITION. Nx auto-loads the repo root .env, which sets
    // NEXT_PUBLIC_EDITION=enterprise, so clear it to make each test's
    // EDITION assignment authoritative regardless of how vitest is invoked.
    delete process.env.NEXT_PUBLIC_EDITION;
  });

  afterEach(() => {
    if (originalEdition === undefined) {
      delete process.env.EDITION;
    } else {
      process.env.EDITION = originalEdition;
    }
    if (originalNextPublicEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalNextPublicEdition;
    }
  });

  it('EE ticket start triggers Temporal workflow after commit dispatch', async () => {
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
    const { dispatchSlaBackendActions } = await import('../slaBackendActions');
    const { SlaBackendFactory } = await import('../backends/SlaBackendFactory');

    const trx = createAdvancedMockTrx();
    seedPolicy(trx);

    const result = await startSlaForTicket(
      trx,
      'tenant-1',
      'ticket-1',
      'client-1',
      'board-1',
      'priority-1',
      new Date('2024-01-01T00:00:00Z')
    );

    // No backend work inside the transaction; the action carries it instead.
    expect(startSpy).not.toHaveBeenCalled();
    expect(result.backendActions).toHaveLength(1);

    await dispatchSlaBackendActions(result.backendActions);
    expect(startSpy).toHaveBeenCalledTimes(1);

    SlaBackendFactory.getInstance().reset();
  });

  it('CE dispatch does not construct Temporal backend', async () => {
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
    const { dispatchSlaBackendActions } = await import('../slaBackendActions');
    const { SlaBackendFactory } = await import('../backends/SlaBackendFactory');

    const trx = createAdvancedMockTrx();
    seedPolicy(trx);

    const result = await startSlaForTicket(
      trx,
      'tenant-1',
      'ticket-2',
      'client-1',
      'board-1',
      'priority-1',
      new Date('2024-01-01T00:00:00Z')
    );
    await dispatchSlaBackendActions(result.backendActions);

    expect(constructorSpy).not.toHaveBeenCalled();
    SlaBackendFactory.getInstance().reset();
  });

  it('EE dispatch falls back to PgBoss when Temporal unavailable', async () => {
    process.env.EDITION = 'ee';

    vi.doMock('@enterprise/lib/sla/TemporalSlaBackend', () => ({
      TemporalSlaBackend: class TemporalSlaBackendMock {
        constructor() {
          throw new Error('Temporal unavailable');
        }
      },
    }));

    const { startSlaForTicket } = await import('../slaService');
    const { dispatchSlaBackendActions } = await import('../slaBackendActions');
    const { SlaBackendFactory } = await import('../backends/SlaBackendFactory');

    const trx = createAdvancedMockTrx();
    seedPolicy(trx);

    const result = await startSlaForTicket(
      trx,
      'tenant-1',
      'ticket-3',
      'client-1',
      'board-1',
      'priority-1',
      new Date('2024-01-01T00:00:00Z')
    );

    await expect(dispatchSlaBackendActions(result.backendActions)).resolves.toBeUndefined();

    SlaBackendFactory.getInstance().reset();
  });

  it('SLA policy change cancels old workflow and starts new one on dispatch', async () => {
    process.env.EDITION = 'ce';

    const { handlePolicyChange } = await import('../slaService');
    const { dispatchSlaBackendActions } = await import('../slaBackendActions');
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

    const { backendActions } = await handlePolicyChange(trx, 'tenant-1', 'ticket-1', 'policy-1');

    expect(backendMock.cancelSla).not.toHaveBeenCalled();
    expect(backendActions.map(a => a.kind)).toEqual(['cancel', 'start']);

    await dispatchSlaBackendActions(backendActions);

    expect(backendMock.cancelSla).toHaveBeenCalledWith('tenant-1', 'ticket-1');
    expect(backendMock.startSlaTracking).toHaveBeenCalled();
  });
});
