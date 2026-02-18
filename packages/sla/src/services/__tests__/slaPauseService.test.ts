import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import {
  pauseSla,
  resumeSla,
  handleStatusChange,
  handleResponseStateChange,
  shouldSlaBePaused,
  syncPauseState,
  getPauseStats,
  type PauseResult
} from '../slaPauseService';
import type { SlaPauseReason } from '../../types';

// Mock Knex transaction/query builder
function createMockTrx() {
  const mockChain = {
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    first: vi.fn().mockReturnThis(),
    update: vi.fn().mockResolvedValue(1),
    insert: vi.fn().mockResolvedValue([1]),
  };

  const mockTrx = vi.fn().mockImplementation((table: string) => {
    return { ...mockChain };
  });

  // Store mock data for different tables
  (mockTrx as any)._mockData = {
    tickets: null,
    sla_settings: null,
    status_sla_pause_config: null,
  };

  return mockTrx as unknown as Knex.Transaction & {
    _mockData: {
      tickets: any;
      sla_settings: any;
      status_sla_pause_config: any;
    };
  };
}

// Helper to setup mock data for a specific table
function setupMockData(
  trx: ReturnType<typeof createMockTrx>,
  tableName: string,
  data: any
) {
  const originalImpl = trx;

  vi.mocked(trx).mockImplementation((table: string) => {
    const mockChain = {
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(() => {
        if (table === tableName) {
          return Promise.resolve(data);
        }
        return Promise.resolve((trx as any)._mockData[table] || null);
      }),
      update: vi.fn().mockResolvedValue(1),
      insert: vi.fn().mockResolvedValue([1]),
    };
    return mockChain;
  });
}

// Create a more robust mock that tracks calls and returns configured data
function createAdvancedMockTrx() {
  const mockData: Record<string, any> = {};
  const calls: { table: string; method: string; args: any[] }[] = [];

  const createChain = (table: string) => {
    const chain: any = {
      where: vi.fn().mockImplementation((...args) => {
        calls.push({ table, method: 'where', args });
        return chain;
      }),
      select: vi.fn().mockImplementation((...args) => {
        calls.push({ table, method: 'select', args });
        return chain;
      }),
      first: vi.fn().mockImplementation(() => {
        calls.push({ table, method: 'first', args: [] });
        return Promise.resolve(mockData[table] || null);
      }),
      update: vi.fn().mockImplementation((data) => {
        calls.push({ table, method: 'update', args: [data] });
        return Promise.resolve(1);
      }),
      insert: vi.fn().mockImplementation((data) => {
        calls.push({ table, method: 'insert', args: [data] });
        return Promise.resolve([1]);
      }),
    };
    return chain;
  };

  const trx = ((table: string) => createChain(table)) as any;
  trx.setData = (table: string, data: any) => {
    mockData[table] = data;
  };
  trx.getCalls = () => calls;
  trx.clearCalls = () => calls.length = 0;

  return trx as Knex.Transaction & {
    setData: (table: string, data: any) => void;
    getCalls: () => { table: string; method: string; args: any[] }[];
    clearCalls: () => void;
  };
}

describe('slaPauseService', () => {
  const TENANT_ID = '00000000-0000-0000-0000-000000000001';
  const TICKET_ID = '00000000-0000-0000-0000-000000000002';
  const POLICY_ID = '00000000-0000-0000-0000-000000000003';
  const STATUS_ID = '00000000-0000-0000-0000-000000000004';
  const USER_ID = '00000000-0000-0000-0000-000000000005';

  describe('pauseSla', () => {
    it('should pause SLA timer successfully', async () => {
      const trx = createAdvancedMockTrx();

      // Set up ticket that is not paused
      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: null,
        status_id: STATUS_ID,
      });

      const result = await pauseSla(
        trx,
        TENANT_ID,
        TICKET_ID,
        'status_pause',
        USER_ID
      );

      expect(result.success).toBe(true);
      expect(result.was_paused).toBe(false);
      expect(result.is_now_paused).toBe(true);

      // Verify update was called
      const updateCalls = trx.getCalls().filter(c => c.method === 'update');
      expect(updateCalls.length).toBeGreaterThan(0);
    });

    it('should be a no-op if already paused', async () => {
      const trx = createAdvancedMockTrx();

      // Set up ticket that is already paused
      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: new Date('2024-01-15T10:00:00Z'),
        status_id: STATUS_ID,
      });

      const result = await pauseSla(
        trx,
        TENANT_ID,
        TICKET_ID,
        'awaiting_client',
        USER_ID
      );

      expect(result.success).toBe(true);
      expect(result.was_paused).toBe(true);
      expect(result.is_now_paused).toBe(true);

      // Verify no update was made (only select calls, no update)
      const updateCalls = trx.getCalls().filter(c => c.method === 'update');
      expect(updateCalls.length).toBe(0);
    });

    it('should skip pause if ticket has no SLA policy', async () => {
      const trx = createAdvancedMockTrx();

      // Set up ticket without SLA
      trx.setData('tickets', {
        sla_policy_id: null,
        sla_paused_at: null,
        status_id: STATUS_ID,
      });

      const result = await pauseSla(
        trx,
        TENANT_ID,
        TICKET_ID,
        'status_pause'
      );

      expect(result.success).toBe(true);
      expect(result.was_paused).toBe(false);
      expect(result.is_now_paused).toBe(false);
    });

    it('should return error if ticket not found', async () => {
      const trx = createAdvancedMockTrx();

      // No ticket data
      trx.setData('tickets', null);

      const result = await pauseSla(
        trx,
        TENANT_ID,
        TICKET_ID,
        'status_pause'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ticket not found');
    });

    it('should accept both pause reasons', async () => {
      const trx1 = createAdvancedMockTrx();
      trx1.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: null,
        status_id: STATUS_ID,
      });

      const result1 = await pauseSla(trx1, TENANT_ID, TICKET_ID, 'status_pause');
      expect(result1.success).toBe(true);

      const trx2 = createAdvancedMockTrx();
      trx2.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: null,
        status_id: STATUS_ID,
      });

      const result2 = await pauseSla(trx2, TENANT_ID, TICKET_ID, 'awaiting_client');
      expect(result2.success).toBe(true);
    });
  });

  describe('resumeSla', () => {
    it('should resume SLA timer and calculate pause duration', async () => {
      const trx = createAdvancedMockTrx();

      const pausedAt = new Date();
      pausedAt.setMinutes(pausedAt.getMinutes() - 30); // Paused 30 minutes ago

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 10,
        status_id: STATUS_ID,
      });

      const result = await resumeSla(trx, TENANT_ID, TICKET_ID, USER_ID);

      expect(result.success).toBe(true);
      expect(result.was_paused).toBe(true);
      expect(result.is_now_paused).toBe(false);
      expect(result.pause_duration_minutes).toBeGreaterThanOrEqual(29);
      expect(result.pause_duration_minutes).toBeLessThanOrEqual(31);
    });

    it('should be a no-op if not paused', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
        status_id: STATUS_ID,
      });

      const result = await resumeSla(trx, TENANT_ID, TICKET_ID);

      expect(result.success).toBe(true);
      expect(result.was_paused).toBe(false);
      expect(result.is_now_paused).toBe(false);
      expect(result.pause_duration_minutes).toBeUndefined();
    });

    it('should skip resume if ticket has no SLA policy', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: null,
        sla_paused_at: new Date().toISOString(),
        sla_total_pause_minutes: 0,
        status_id: STATUS_ID,
      });

      const result = await resumeSla(trx, TENANT_ID, TICKET_ID);

      expect(result.success).toBe(true);
      expect(result.was_paused).toBe(false);
      expect(result.is_now_paused).toBe(false);
    });

    it('should return error if ticket not found', async () => {
      const trx = createAdvancedMockTrx();
      trx.setData('tickets', null);

      const result = await resumeSla(trx, TENANT_ID, TICKET_ID);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ticket not found');
    });

    it('should accumulate total pause minutes', async () => {
      const trx = createAdvancedMockTrx();

      const pausedAt = new Date();
      pausedAt.setMinutes(pausedAt.getMinutes() - 60); // Paused 60 minutes ago

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 120, // Already had 2 hours of pause time
        status_id: STATUS_ID,
      });

      const result = await resumeSla(trx, TENANT_ID, TICKET_ID);

      expect(result.success).toBe(true);
      expect(result.pause_duration_minutes).toBeGreaterThanOrEqual(59);
      expect(result.pause_duration_minutes).toBeLessThanOrEqual(61);

      // Verify the update would include new total (120 + ~60 = ~180)
      const updateCalls = trx.getCalls().filter(c => c.method === 'update' && c.table === 'tickets');
      expect(updateCalls.length).toBeGreaterThan(0);
    });
  });

  describe('handleStatusChange', () => {
    it('should pause SLA when moving to a pause-configured status', async () => {
      const trx = createAdvancedMockTrx();
      const NEW_STATUS_ID = '00000000-0000-0000-0000-000000000006';

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: null,
        response_state: 'open',
        status_id: STATUS_ID,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: true,
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });

      const result = await handleStatusChange(
        trx,
        TENANT_ID,
        TICKET_ID,
        STATUS_ID,
        NEW_STATUS_ID,
        USER_ID
      );

      expect(result.success).toBe(true);
    });

    it('should resume SLA when moving from pause status to non-pause status', async () => {
      const trx = createAdvancedMockTrx();
      const NEW_STATUS_ID = '00000000-0000-0000-0000-000000000006';

      const pausedAt = new Date();
      pausedAt.setMinutes(pausedAt.getMinutes() - 15);

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 0,
        response_state: 'open',
        status_id: NEW_STATUS_ID,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: false,
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });

      const result = await handleStatusChange(
        trx,
        TENANT_ID,
        TICKET_ID,
        STATUS_ID,
        NEW_STATUS_ID,
        USER_ID
      );

      expect(result.success).toBe(true);
    });

    it('should not resume if awaiting_client still applies', async () => {
      const trx = createAdvancedMockTrx();
      const NEW_STATUS_ID = '00000000-0000-0000-0000-000000000006';

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: new Date().toISOString(),
        sla_total_pause_minutes: 0,
        response_state: 'awaiting_client',
        status_id: NEW_STATUS_ID,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: false,
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });

      const result = await handleStatusChange(
        trx,
        TENANT_ID,
        TICKET_ID,
        STATUS_ID,
        NEW_STATUS_ID,
        USER_ID
      );

      expect(result.success).toBe(true);
      expect(result.is_now_paused).toBe(true);
    });

    it('should return error if ticket not found', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', null);
      trx.setData('status_sla_pause_config', null);
      trx.setData('sla_settings', null);

      const result = await handleStatusChange(
        trx,
        TENANT_ID,
        TICKET_ID,
        STATUS_ID,
        'new-status',
        USER_ID
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ticket not found');
    });
  });

  describe('handleResponseStateChange', () => {
    it('should pause SLA when changing to awaiting_client', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: null,
        status_id: STATUS_ID,
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: false,
      });

      const result = await handleResponseStateChange(
        trx,
        TENANT_ID,
        TICKET_ID,
        'open',
        'awaiting_client',
        USER_ID
      );

      expect(result.success).toBe(true);
    });

    it('should resume SLA when changing from awaiting_client', async () => {
      const trx = createAdvancedMockTrx();

      const pausedAt = new Date();
      pausedAt.setMinutes(pausedAt.getMinutes() - 10);

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 0,
        status_id: STATUS_ID,
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: false,
      });

      const result = await handleResponseStateChange(
        trx,
        TENANT_ID,
        TICKET_ID,
        'awaiting_client',
        'open',
        USER_ID
      );

      expect(result.success).toBe(true);
    });

    it('should not resume if status also pauses SLA', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: new Date().toISOString(),
        sla_total_pause_minutes: 0,
        status_id: STATUS_ID,
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: true, // Status also pauses
      });

      const result = await handleResponseStateChange(
        trx,
        TENANT_ID,
        TICKET_ID,
        'awaiting_client',
        'open',
        USER_ID
      );

      expect(result.success).toBe(true);
      expect(result.is_now_paused).toBe(true);
    });

    it('should do nothing if pause_on_awaiting_client is disabled', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: null,
        status_id: STATUS_ID,
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: false,
      });

      const result = await handleResponseStateChange(
        trx,
        TENANT_ID,
        TICKET_ID,
        'open',
        'awaiting_client',
        USER_ID
      );

      expect(result.success).toBe(true);
      expect(result.is_now_paused).toBe(false);
    });

    it('should return error if ticket not found', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', null);
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });

      const result = await handleResponseStateChange(
        trx,
        TENANT_ID,
        TICKET_ID,
        'open',
        'awaiting_client'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ticket not found');
    });
  });

  describe('shouldSlaBePaused', () => {
    it('should return paused=true with awaiting_client reason', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        status_id: STATUS_ID,
        response_state: 'awaiting_client',
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: false,
      });

      const result = await shouldSlaBePaused(trx, TENANT_ID, TICKET_ID);

      expect(result.paused).toBe(true);
      expect(result.reason).toBe('awaiting_client');
    });

    it('should return paused=true with status_pause reason', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        status_id: STATUS_ID,
        response_state: 'open',
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: true,
      });

      const result = await shouldSlaBePaused(trx, TENANT_ID, TICKET_ID);

      expect(result.paused).toBe(true);
      expect(result.reason).toBe('status_pause');
    });

    it('should return paused=false when no conditions match', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        status_id: STATUS_ID,
        response_state: 'open',
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: false,
      });

      const result = await shouldSlaBePaused(trx, TENANT_ID, TICKET_ID);

      expect(result.paused).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('should return paused=false if ticket not found', async () => {
      const trx = createAdvancedMockTrx();
      trx.setData('tickets', null);

      const result = await shouldSlaBePaused(trx, TENANT_ID, TICKET_ID);

      expect(result.paused).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('should use default settings if none exist', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        status_id: STATUS_ID,
        response_state: 'awaiting_client',
      });
      trx.setData('sla_settings', null); // No settings
      trx.setData('status_sla_pause_config', {
        pauses_sla: false,
      });

      const result = await shouldSlaBePaused(trx, TENANT_ID, TICKET_ID);

      // Default is pause_on_awaiting_client: true
      expect(result.paused).toBe(true);
      expect(result.reason).toBe('awaiting_client');
    });
  });

  describe('syncPauseState', () => {
    it('should pause ticket if should be paused but is not', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: null,
        status_id: STATUS_ID,
        response_state: 'awaiting_client',
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: false,
      });

      const result = await syncPauseState(trx, TENANT_ID, TICKET_ID);

      expect(result.success).toBe(true);
    });

    it('should resume ticket if should not be paused but is', async () => {
      const trx = createAdvancedMockTrx();

      const pausedAt = new Date();
      pausedAt.setMinutes(pausedAt.getMinutes() - 20);

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 0,
        status_id: STATUS_ID,
        response_state: 'open',
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: false,
      });

      const result = await syncPauseState(trx, TENANT_ID, TICKET_ID);

      expect(result.success).toBe(true);
    });

    it('should do nothing if state is correct', async () => {
      const trx = createAdvancedMockTrx();

      // Ticket is paused and should be paused
      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_paused_at: new Date().toISOString(),
        sla_total_pause_minutes: 10,
        status_id: STATUS_ID,
        response_state: 'awaiting_client',
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: false,
      });

      const result = await syncPauseState(trx, TENANT_ID, TICKET_ID);

      expect(result.success).toBe(true);
      expect(result.was_paused).toBe(true);
      expect(result.is_now_paused).toBe(true);
    });

    it('should return error if ticket not found', async () => {
      const trx = createAdvancedMockTrx();
      trx.setData('tickets', null);
      trx.setData('sla_settings', null);
      trx.setData('status_sla_pause_config', null);

      const result = await syncPauseState(trx, TENANT_ID, TICKET_ID);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ticket not found');
    });
  });

  describe('getPauseStats', () => {
    it('should return stats for paused ticket', async () => {
      const trx = createAdvancedMockTrx();

      const pausedAt = new Date();
      pausedAt.setMinutes(pausedAt.getMinutes() - 45);

      trx.setData('tickets', {
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 120,
        response_state: 'awaiting_client',
        status_id: STATUS_ID,
      });
      trx.setData('sla_settings', {
        pause_on_awaiting_client: true,
      });
      trx.setData('status_sla_pause_config', {
        pauses_sla: false,
      });

      const stats = await getPauseStats(trx, TENANT_ID, TICKET_ID);

      expect(stats).not.toBeNull();
      expect(stats!.is_paused).toBe(true);
      expect(stats!.total_pause_minutes).toBe(120);
      expect(stats!.current_pause_minutes).toBeGreaterThanOrEqual(44);
      expect(stats!.current_pause_minutes).toBeLessThanOrEqual(46);
      expect(stats!.pause_reason).toBe('awaiting_client');
    });

    it('should return stats for non-paused ticket', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_paused_at: null,
        sla_total_pause_minutes: 60,
        response_state: 'open',
        status_id: STATUS_ID,
      });

      const stats = await getPauseStats(trx, TENANT_ID, TICKET_ID);

      expect(stats).not.toBeNull();
      expect(stats!.is_paused).toBe(false);
      expect(stats!.paused_at).toBeNull();
      expect(stats!.total_pause_minutes).toBe(60);
      expect(stats!.current_pause_minutes).toBe(0);
      expect(stats!.pause_reason).toBeNull();
    });

    it('should return null if ticket not found', async () => {
      const trx = createAdvancedMockTrx();
      trx.setData('tickets', null);

      const stats = await getPauseStats(trx, TENANT_ID, TICKET_ID);

      expect(stats).toBeNull();
    });

    it('should handle zero total pause minutes', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
        response_state: 'open',
        status_id: STATUS_ID,
      });

      const stats = await getPauseStats(trx, TENANT_ID, TICKET_ID);

      expect(stats).not.toBeNull();
      expect(stats!.total_pause_minutes).toBe(0);
    });

    it('should handle undefined total pause minutes', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_paused_at: null,
        sla_total_pause_minutes: undefined, // Could be undefined in DB
        response_state: 'open',
        status_id: STATUS_ID,
      });

      const stats = await getPauseStats(trx, TENANT_ID, TICKET_ID);

      expect(stats).not.toBeNull();
      expect(stats!.total_pause_minutes).toBe(0);
    });
  });
});
