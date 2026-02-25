import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Knex } from 'knex';
import {
  recordFirstResponse,
  recordResolution,
  getSlaStatus,
  type StartSlaResult,
  type RecordSlaEventResult
} from '../slaService';
import type {
  ISlaPolicy,
  ISlaPolicyTarget,
  ISlaPolicyWithTargets,
  IBusinessHoursScheduleWithEntries,
  SlaTimerStatus
} from '../../types';

// Create a robust mock that tracks calls and returns configured data
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

describe('slaService', () => {
  const TENANT_ID = '00000000-0000-0000-0000-000000000001';
  const TICKET_ID = '00000000-0000-0000-0000-000000000002';
  const CLIENT_ID = '00000000-0000-0000-0000-000000000003';
  const BOARD_ID = '00000000-0000-0000-0000-000000000004';
  const PRIORITY_ID = '00000000-0000-0000-0000-000000000005';
  const POLICY_ID = '00000000-0000-0000-0000-000000000006';
  const SCHEDULE_ID = '00000000-0000-0000-0000-000000000007';
  const USER_ID = '00000000-0000-0000-0000-000000000008';

  describe('recordFirstResponse', () => {
    it('should record first response and mark SLA as met when before due date', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_response_at: null,
        sla_response_due_at: new Date('2024-01-15T11:00:00Z').toISOString(),
        sla_total_pause_minutes: 0,
      });

      const respondedAt = new Date('2024-01-15T10:30:00Z'); // Before due

      const result = await recordFirstResponse(
        trx,
        TENANT_ID,
        TICKET_ID,
        respondedAt,
        USER_ID
      );

      expect(result.success).toBe(true);
      expect(result.met).toBe(true);
      expect(result.recorded_at).toEqual(respondedAt);
    });

    it('should record first response and mark SLA as breached when after due date', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_response_at: null,
        sla_response_due_at: new Date('2024-01-15T11:00:00Z').toISOString(),
        sla_total_pause_minutes: 0,
      });

      const respondedAt = new Date('2024-01-15T12:00:00Z'); // After due

      const result = await recordFirstResponse(
        trx,
        TENANT_ID,
        TICKET_ID,
        respondedAt,
        USER_ID
      );

      expect(result.success).toBe(true);
      expect(result.met).toBe(false);
      expect(result.recorded_at).toEqual(respondedAt);
    });

    it('should account for pause time when determining if SLA met', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_response_at: null,
        sla_response_due_at: new Date('2024-01-15T11:00:00Z').toISOString(),
        sla_total_pause_minutes: 120, // 2 hours paused
      });

      // Response at 12:30 would be late without pause, but with 2hr pause it's on time
      const respondedAt = new Date('2024-01-15T12:30:00Z');

      const result = await recordFirstResponse(
        trx,
        TENANT_ID,
        TICKET_ID,
        respondedAt,
        USER_ID
      );

      expect(result.success).toBe(true);
      // Due at 11:00 + 2hr pause = effective due at 13:00, response at 12:30 = met
      expect(result.met).toBe(true);
    });

    it('should skip if ticket has already responded', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_response_at: new Date('2024-01-15T10:00:00Z').toISOString(), // Already responded
        sla_response_due_at: new Date('2024-01-15T11:00:00Z').toISOString(),
        sla_total_pause_minutes: 0,
      });

      const result = await recordFirstResponse(
        trx,
        TENANT_ID,
        TICKET_ID,
        new Date('2024-01-15T10:30:00Z'),
        USER_ID
      );

      expect(result.success).toBe(true);
      expect(result.met).toBeNull(); // No change

      // Verify no update was made
      const updateCalls = trx.getCalls().filter(c => c.method === 'update');
      expect(updateCalls.length).toBe(0);
    });

    it('should skip if ticket has no SLA policy', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: null,
        sla_response_at: null,
        sla_response_due_at: null,
        sla_total_pause_minutes: 0,
      });

      const result = await recordFirstResponse(
        trx,
        TENANT_ID,
        TICKET_ID,
        new Date()
      );

      expect(result.success).toBe(true);
      expect(result.met).toBeNull();
    });

    it('should return error if ticket not found', async () => {
      const trx = createAdvancedMockTrx();
      trx.setData('tickets', null);

      const result = await recordFirstResponse(
        trx,
        TENANT_ID,
        TICKET_ID,
        new Date()
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ticket not found');
    });

    it('should handle null response due date gracefully', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_response_at: null,
        sla_response_due_at: null, // No response target
        sla_total_pause_minutes: 0,
      });

      const respondedAt = new Date('2024-01-15T10:30:00Z');

      const result = await recordFirstResponse(
        trx,
        TENANT_ID,
        TICKET_ID,
        respondedAt
      );

      expect(result.success).toBe(true);
      expect(result.met).toBeNull(); // Can't determine if met without due date
    });

    it('should log the response event to audit log', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_response_at: null,
        sla_response_due_at: new Date('2024-01-15T11:00:00Z').toISOString(),
        sla_total_pause_minutes: 0,
      });

      const respondedAt = new Date('2024-01-15T10:30:00Z');

      await recordFirstResponse(trx, TENANT_ID, TICKET_ID, respondedAt, USER_ID);

      // Verify insert was called on sla_audit_log
      const insertCalls = trx.getCalls().filter(c => c.method === 'insert' && c.table === 'sla_audit_log');
      expect(insertCalls.length).toBe(1);
    });
  });

  describe('recordResolution', () => {
    it('should record resolution and mark SLA as met when before due date', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_resolution_at: null,
        sla_resolution_due_at: new Date('2024-01-15T18:00:00Z').toISOString(),
        sla_total_pause_minutes: 0,
      });

      const resolvedAt = new Date('2024-01-15T16:00:00Z'); // Before due

      const result = await recordResolution(
        trx,
        TENANT_ID,
        TICKET_ID,
        resolvedAt,
        USER_ID
      );

      expect(result.success).toBe(true);
      expect(result.met).toBe(true);
      expect(result.recorded_at).toEqual(resolvedAt);
    });

    it('should record resolution and mark SLA as breached when after due date', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_resolution_at: null,
        sla_resolution_due_at: new Date('2024-01-15T18:00:00Z').toISOString(),
        sla_total_pause_minutes: 0,
      });

      const resolvedAt = new Date('2024-01-15T19:00:00Z'); // After due

      const result = await recordResolution(
        trx,
        TENANT_ID,
        TICKET_ID,
        resolvedAt,
        USER_ID
      );

      expect(result.success).toBe(true);
      expect(result.met).toBe(false);
      expect(result.recorded_at).toEqual(resolvedAt);
    });

    it('should account for pause time when determining if SLA met', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_resolution_at: null,
        sla_resolution_due_at: new Date('2024-01-15T18:00:00Z').toISOString(),
        sla_total_pause_minutes: 180, // 3 hours paused
      });

      // Resolved at 20:00 would be late without pause, but with 3hr pause it's on time
      const resolvedAt = new Date('2024-01-15T20:00:00Z');

      const result = await recordResolution(
        trx,
        TENANT_ID,
        TICKET_ID,
        resolvedAt,
        USER_ID
      );

      expect(result.success).toBe(true);
      // Due at 18:00 + 3hr pause = effective due at 21:00, resolved at 20:00 = met
      expect(result.met).toBe(true);
    });

    it('should skip if ticket has no SLA policy', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: null,
        sla_resolution_at: null,
        sla_resolution_due_at: null,
        sla_total_pause_minutes: 0,
      });

      const result = await recordResolution(
        trx,
        TENANT_ID,
        TICKET_ID,
        new Date()
      );

      expect(result.success).toBe(true);
      expect(result.met).toBeNull();
    });

    it('should return error if ticket not found', async () => {
      const trx = createAdvancedMockTrx();
      trx.setData('tickets', null);

      const result = await recordResolution(
        trx,
        TENANT_ID,
        TICKET_ID,
        new Date()
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ticket not found');
    });

    it('should handle null resolution due date gracefully', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_resolution_at: null,
        sla_resolution_due_at: null, // No resolution target
        sla_total_pause_minutes: 0,
      });

      const result = await recordResolution(
        trx,
        TENANT_ID,
        TICKET_ID,
        new Date('2024-01-15T16:00:00Z')
      );

      expect(result.success).toBe(true);
      expect(result.met).toBeNull();
    });

    it('should log the resolution event to audit log', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_resolution_at: null,
        sla_resolution_due_at: new Date('2024-01-15T18:00:00Z').toISOString(),
        sla_total_pause_minutes: 0,
      });

      await recordResolution(trx, TENANT_ID, TICKET_ID, new Date('2024-01-15T16:00:00Z'), USER_ID);

      // Verify insert was called on sla_audit_log
      const insertCalls = trx.getCalls().filter(c => c.method === 'insert' && c.table === 'sla_audit_log');
      expect(insertCalls.length).toBe(1);
    });
  });

  describe('getSlaStatus', () => {
    it('should return null for ticket without SLA policy', async () => {
      const trx = createAdvancedMockTrx();

      trx.setData('tickets', {
        sla_policy_id: null,
      });

      const status = await getSlaStatus(trx, TENANT_ID, TICKET_ID);

      expect(status).toBeNull();
    });

    it('should return null for non-existent ticket', async () => {
      const trx = createAdvancedMockTrx();
      trx.setData('tickets', null);

      const status = await getSlaStatus(trx, TENANT_ID, TICKET_ID);

      expect(status).toBeNull();
    });

    it('should return on_track status for ticket well within SLA', async () => {
      const trx = createAdvancedMockTrx();

      const now = new Date();
      const responseDue = new Date(now.getTime() + 3600000); // 1 hour from now
      const resolutionDue = new Date(now.getTime() + 28800000); // 8 hours from now
      const startedAt = new Date(now.getTime() - 1800000); // 30 min ago

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: resolutionDue.toISOString(),
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
        priority_id: PRIORITY_ID,
      });

      const status = await getSlaStatus(trx, TENANT_ID, TICKET_ID);

      expect(status).not.toBeNull();
      expect(status!.status).toBe('on_track');
      expect(status!.is_paused).toBe(false);
      expect(status!.response_remaining_minutes).toBeGreaterThan(0);
      expect(status!.resolution_remaining_minutes).toBeGreaterThan(0);
    });

    it('should return at_risk status when approaching deadline', async () => {
      const trx = createAdvancedMockTrx();

      const now = new Date();
      const startedAt = new Date(now.getTime() - 3000000); // 50 min ago
      const responseDue = new Date(now.getTime() + 600000); // 10 min from now (within 25% of 60 min total)

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
        priority_id: PRIORITY_ID,
      });

      const status = await getSlaStatus(trx, TENANT_ID, TICKET_ID);

      expect(status).not.toBeNull();
      expect(status!.status).toBe('at_risk');
    });

    it('should return response_breached status when response SLA is breached', async () => {
      const trx = createAdvancedMockTrx();

      const now = new Date();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_started_at: new Date(now.getTime() - 7200000).toISOString(),
        sla_response_due_at: new Date(now.getTime() - 600000).toISOString(), // 10 min ago
        sla_response_at: null,
        sla_response_met: null, // Not yet recorded but past due
        sla_resolution_due_at: new Date(now.getTime() + 28800000).toISOString(),
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
        priority_id: PRIORITY_ID,
      });

      const status = await getSlaStatus(trx, TENANT_ID, TICKET_ID);

      expect(status).not.toBeNull();
      expect(status!.status).toBe('response_breached');
      expect(status!.response_remaining_minutes).toBeLessThan(0);
    });

    it('should return resolution_breached status when resolution SLA is breached', async () => {
      const trx = createAdvancedMockTrx();

      const now = new Date();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_started_at: new Date(now.getTime() - 36000000).toISOString(),
        sla_response_due_at: new Date(now.getTime() - 32400000).toISOString(),
        sla_response_at: new Date(now.getTime() - 32400000).toISOString(), // Response made on time
        sla_response_met: true,
        sla_resolution_due_at: new Date(now.getTime() - 1800000).toISOString(), // 30 min ago
        sla_resolution_at: null,
        sla_resolution_met: null, // Not yet resolved but past due
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
        priority_id: PRIORITY_ID,
      });

      const status = await getSlaStatus(trx, TENANT_ID, TICKET_ID);

      expect(status).not.toBeNull();
      expect(status!.status).toBe('resolution_breached');
      expect(status!.resolution_remaining_minutes).toBeLessThan(0);
    });

    it('should return paused status when SLA is paused', async () => {
      const trx = createAdvancedMockTrx();

      const now = new Date();
      const pausedAt = new Date(now.getTime() - 1800000); // Paused 30 min ago

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_started_at: new Date(now.getTime() - 3600000).toISOString(),
        sla_response_due_at: new Date(now.getTime() + 1800000).toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: new Date(now.getTime() + 28800000).toISOString(),
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 10,
        priority_id: PRIORITY_ID,
      });

      const status = await getSlaStatus(trx, TENANT_ID, TICKET_ID);

      expect(status).not.toBeNull();
      expect(status!.status).toBe('paused');
      expect(status!.is_paused).toBe(true);
      expect(status!.total_pause_minutes).toBeGreaterThan(0);
    });

    it('should include current pause time in calculations', async () => {
      const trx = createAdvancedMockTrx();

      const now = new Date();
      const pausedAt = new Date(now.getTime() - 3600000); // Paused 1 hour ago

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_started_at: new Date(now.getTime() - 7200000).toISOString(),
        sla_response_due_at: new Date(now.getTime() - 1800000).toISOString(), // Would be 30 min late
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 0,
        priority_id: PRIORITY_ID,
      });

      const status = await getSlaStatus(trx, TENANT_ID, TICKET_ID);

      expect(status).not.toBeNull();
      // Even though due was 30 min ago, we've been paused for 1 hour
      // So effective remaining should be positive (30 min still available)
      expect(status!.response_remaining_minutes).toBeGreaterThan(0);
    });

    it('should not have remaining times if response/resolution already made', async () => {
      const trx = createAdvancedMockTrx();

      const now = new Date();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_started_at: new Date(now.getTime() - 7200000).toISOString(),
        sla_response_due_at: new Date(now.getTime() - 3600000).toISOString(),
        sla_response_at: new Date(now.getTime() - 3700000).toISOString(), // Responded
        sla_response_met: true,
        sla_resolution_due_at: new Date(now.getTime() + 3600000).toISOString(),
        sla_resolution_at: new Date(now.getTime() - 1800000).toISOString(), // Resolved
        sla_resolution_met: true,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
        priority_id: PRIORITY_ID,
      });

      const status = await getSlaStatus(trx, TENANT_ID, TICKET_ID);

      expect(status).not.toBeNull();
      expect(status!.response_remaining_minutes).toBeUndefined();
      expect(status!.resolution_remaining_minutes).toBeUndefined();
    });

    it('should include total pause minutes in status', async () => {
      const trx = createAdvancedMockTrx();

      const now = new Date();

      trx.setData('tickets', {
        sla_policy_id: POLICY_ID,
        sla_started_at: new Date(now.getTime() - 7200000).toISOString(),
        sla_response_due_at: new Date(now.getTime() + 3600000).toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: new Date(now.getTime() + 28800000).toISOString(),
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 45, // 45 minutes of total pause time
        priority_id: PRIORITY_ID,
      });

      const status = await getSlaStatus(trx, TENANT_ID, TICKET_ID);

      expect(status).not.toBeNull();
      expect(status!.total_pause_minutes).toBe(45);
    });
  });
});
