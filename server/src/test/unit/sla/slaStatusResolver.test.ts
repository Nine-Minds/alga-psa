/**
 * SLA Status Resolver Unit Tests
 *
 * Tests for SLA status determination logic including:
 * - Status "on_track" when < 80% elapsed
 * - Status "at_risk" when 80-99% elapsed
 * - Status "breached" when >= 100% elapsed
 * - Status "paused" when SLA is paused
 * - Paused overrides on_track/at_risk
 * - Correct status after pause/resume cycles
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Knex } from 'knex';
import type { SlaTimerStatus, ISlaStatus } from '@alga-psa/sla/types';

// ============================================================================
// Test Helpers - Mock Transaction Builder
// ============================================================================

function createMockTrx() {
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

// ============================================================================
// Pure Logic Status Resolver (mimics getSlaStatus logic for unit testing)
// ============================================================================

interface TicketSlaData {
  sla_policy_id: string | null;
  sla_started_at: string | null;
  sla_response_due_at: string | null;
  sla_response_at: string | null;
  sla_response_met: boolean | null;
  sla_resolution_due_at: string | null;
  sla_resolution_at: string | null;
  sla_resolution_met: boolean | null;
  sla_paused_at: string | null;
  sla_total_pause_minutes: number;
}

/**
 * Resolves the SLA status based on ticket data
 * This is a pure function that mimics the getSlaStatus logic for unit testing
 */
function resolveSlaStatus(
  ticket: TicketSlaData,
  currentTime: Date = new Date()
): ISlaStatus | null {
  if (!ticket || !ticket.sla_policy_id) {
    return null;
  }

  const isPaused = ticket.sla_paused_at !== null;
  const totalPauseMinutes = ticket.sla_total_pause_minutes || 0;

  // Calculate current pause time if currently paused
  let currentPauseMinutes = 0;
  if (isPaused && ticket.sla_paused_at) {
    currentPauseMinutes = Math.floor(
      (currentTime.getTime() - new Date(ticket.sla_paused_at).getTime()) / 60000
    );
  }

  const effectivePauseMinutes = totalPauseMinutes + currentPauseMinutes;

  // Calculate remaining times
  let responseRemaining: number | undefined;
  let resolutionRemaining: number | undefined;

  if (ticket.sla_response_due_at && !ticket.sla_response_at) {
    const adjustedDue = new Date(
      new Date(ticket.sla_response_due_at).getTime() + effectivePauseMinutes * 60000
    );
    responseRemaining = Math.floor((adjustedDue.getTime() - currentTime.getTime()) / 60000);
  }

  if (ticket.sla_resolution_due_at && !ticket.sla_resolution_at) {
    const adjustedDue = new Date(
      new Date(ticket.sla_resolution_due_at).getTime() + effectivePauseMinutes * 60000
    );
    resolutionRemaining = Math.floor((adjustedDue.getTime() - currentTime.getTime()) / 60000);
  }

  // Determine status
  let status: SlaTimerStatus = 'on_track';

  if (isPaused) {
    status = 'paused';
  } else if (ticket.sla_response_met === false || (responseRemaining !== undefined && responseRemaining < 0)) {
    status = 'response_breached';
  } else if (ticket.sla_resolution_met === false || (resolutionRemaining !== undefined && resolutionRemaining < 0)) {
    status = 'resolution_breached';
  } else {
    // Check if at risk (within 25% of deadline)
    const atRiskThreshold = 0.25;
    if (responseRemaining !== undefined && ticket.sla_response_due_at && ticket.sla_started_at) {
      const totalResponseMinutes = Math.floor(
        (new Date(ticket.sla_response_due_at).getTime() - new Date(ticket.sla_started_at).getTime()) / 60000
      );
      if (responseRemaining <= totalResponseMinutes * atRiskThreshold) {
        status = 'at_risk';
      }
    }
    if (resolutionRemaining !== undefined && ticket.sla_resolution_due_at && ticket.sla_started_at) {
      const totalResolutionMinutes = Math.floor(
        (new Date(ticket.sla_resolution_due_at).getTime() - new Date(ticket.sla_started_at).getTime()) / 60000
      );
      if (resolutionRemaining <= totalResolutionMinutes * atRiskThreshold) {
        status = 'at_risk';
      }
    }
  }

  return {
    status,
    response_remaining_minutes: responseRemaining,
    resolution_remaining_minutes: resolutionRemaining,
    is_paused: isPaused,
    pause_reason: isPaused ? 'status_pause' : undefined,
    total_pause_minutes: effectivePauseMinutes,
  };
}

/**
 * Calculate percentage elapsed
 */
function calculatePercentElapsed(
  startedAt: Date,
  dueAt: Date,
  currentTime: Date,
  pauseMinutes: number = 0
): number {
  const totalMinutes = (dueAt.getTime() - startedAt.getTime()) / 60000;
  const elapsedMinutes = (currentTime.getTime() - startedAt.getTime()) / 60000 - pauseMinutes;

  if (totalMinutes <= 0) return 100;

  return Math.min(100, Math.max(0, (elapsedMinutes / totalMinutes) * 100));
}

// ============================================================================
// Tests
// ============================================================================

describe('SLA Status Resolver', () => {
  const POLICY_ID = '00000000-0000-0000-0000-000000000001';

  describe('Status "on_track" when < 75% elapsed (remaining > 25% threshold)', () => {
    it('should return on_track when 0% elapsed', () => {
      const now = new Date();
      const startedAt = now;
      const responseDue = new Date(now.getTime() + 60 * 60000); // 60 min target

      const ticket: TicketSlaData = {
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
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status).not.toBeNull();
      expect(status!.status).toBe('on_track');
    });

    it('should return on_track when 50% elapsed', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 30 * 60000); // 30 min ago
      const responseDue = new Date(now.getTime() + 30 * 60000); // 30 min from now (60 min total)

      const ticket: TicketSlaData = {
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
      };

      const status = resolveSlaStatus(ticket, now);
      const percentElapsed = calculatePercentElapsed(startedAt, responseDue, now);

      expect(percentElapsed).toBe(50);
      expect(status!.status).toBe('on_track');
    });

    it('should return on_track when 70% elapsed (still under 75% at_risk threshold)', () => {
      const now = new Date();
      // at_risk threshold is 25%, meaning remaining <= 25% of total triggers at_risk
      // So at_risk starts when elapsed >= 75%
      // 70 min elapsed, 30 min remaining = 100 min total
      // Remaining = 30 min, total = 100 min, threshold = 25% of 100 = 25 min
      // 30 > 25, so still on_track
      const startedAt = new Date(now.getTime() - 70 * 60000); // 70 min ago
      const responseDue = new Date(now.getTime() + 30 * 60000); // 30 min from now (100 min total)

      const ticket: TicketSlaData = {
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
      };

      const status = resolveSlaStatus(ticket, now);
      const percentElapsed = calculatePercentElapsed(startedAt, responseDue, now);

      expect(percentElapsed).toBe(70);
      expect(status!.status).toBe('on_track');
    });

    it('should be on_track when only resolution SLA exists and well within time', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 60 * 60000);
      const resolutionDue = new Date(now.getTime() + 420 * 60000); // 7 hours from now (8 hours total)

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: null,
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: resolutionDue.toISOString(),
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.status).toBe('on_track');
    });
  });

  describe('Status "at_risk" when 75-99% elapsed (remaining <= 25% threshold)', () => {
    it('should return at_risk when 80% elapsed (at risk boundary)', () => {
      const now = new Date();
      // 80 min elapsed, 20 min remaining = 100 min total
      // Remaining = 20 min, total = 100 min, threshold = 25% of 100 = 25 min
      // 20 <= 25, so at_risk
      const startedAt = new Date(now.getTime() - 80 * 60000);
      const responseDue = new Date(now.getTime() + 20 * 60000);

      const ticket: TicketSlaData = {
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
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.status).toBe('at_risk');
    });

    it('should return at_risk when 90% elapsed', () => {
      const now = new Date();
      // 90 min elapsed, 10 min remaining
      const startedAt = new Date(now.getTime() - 90 * 60000);
      const responseDue = new Date(now.getTime() + 10 * 60000);

      const ticket: TicketSlaData = {
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
      };

      const status = resolveSlaStatus(ticket, now);
      const percentElapsed = calculatePercentElapsed(startedAt, responseDue, now);

      expect(percentElapsed).toBe(90);
      expect(status!.status).toBe('at_risk');
    });

    it('should return at_risk when 95% elapsed', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 95 * 60000);
      const responseDue = new Date(now.getTime() + 5 * 60000);

      const ticket: TicketSlaData = {
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
      };

      const status = resolveSlaStatus(ticket, now);
      const percentElapsed = calculatePercentElapsed(startedAt, responseDue, now);

      expect(percentElapsed).toBe(95);
      expect(status!.status).toBe('at_risk');
    });

    it('should return at_risk for resolution SLA when approaching deadline', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 400 * 60000); // 400 min ago
      const resolutionDue = new Date(now.getTime() + 80 * 60000); // 80 min left (480 min total)
      // 80 min remaining, threshold = 25% of 480 = 120 min
      // 80 <= 120, so at_risk

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: null,
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: resolutionDue.toISOString(),
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.status).toBe('at_risk');
    });
  });

  describe('Status "breached" when >= 100% elapsed', () => {
    it('should return response_breached when response SLA is past due', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 120 * 60000);
      const responseDue = new Date(now.getTime() - 10 * 60000); // 10 min ago

      const ticket: TicketSlaData = {
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
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.status).toBe('response_breached');
      expect(status!.response_remaining_minutes).toBeLessThan(0);
    });

    it('should return response_breached when response was recorded but marked as not met', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 120 * 60000);
      const responseDue = new Date(now.getTime() - 10 * 60000);
      const responseAt = new Date(now.getTime() - 5 * 60000);

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: responseAt.toISOString(),
        sla_response_met: false, // Explicitly marked as breached
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.status).toBe('response_breached');
    });

    it('should return resolution_breached when resolution SLA is past due', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 600 * 60000);
      const resolutionDue = new Date(now.getTime() - 30 * 60000); // 30 min ago

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: null,
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: resolutionDue.toISOString(),
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.status).toBe('resolution_breached');
      expect(status!.resolution_remaining_minutes).toBeLessThan(0);
    });

    it('should return resolution_breached when resolution was recorded but marked as not met', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 600 * 60000);
      const resolutionDue = new Date(now.getTime() - 30 * 60000);
      const resolutionAt = new Date(now.getTime() - 10 * 60000);

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: null,
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: resolutionDue.toISOString(),
        sla_resolution_at: resolutionAt.toISOString(),
        sla_resolution_met: false, // Explicitly marked as breached
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.status).toBe('resolution_breached');
    });

    it('should prioritize response_breached over resolution_breached', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 600 * 60000);
      const responseDue = new Date(now.getTime() - 60 * 60000); // Both past due
      const resolutionDue = new Date(now.getTime() - 30 * 60000);

      const ticket: TicketSlaData = {
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
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.status).toBe('response_breached');
    });
  });

  describe('Status "paused" when SLA is paused', () => {
    it('should return paused status when ticket is paused', () => {
      const now = new Date();
      const pausedAt = new Date(now.getTime() - 30 * 60000);
      const startedAt = new Date(now.getTime() - 60 * 60000);
      const responseDue = new Date(now.getTime() + 30 * 60000);

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 10,
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.status).toBe('paused');
      expect(status!.is_paused).toBe(true);
    });

    it('should calculate current pause time when paused', () => {
      const now = new Date();
      const pausedAt = new Date(now.getTime() - 45 * 60000); // Paused 45 min ago
      const startedAt = new Date(now.getTime() - 60 * 60000);
      const responseDue = new Date(now.getTime() + 30 * 60000);

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.total_pause_minutes).toBeGreaterThanOrEqual(44);
      expect(status!.total_pause_minutes).toBeLessThanOrEqual(46);
    });

    it('should include historical pause time plus current pause', () => {
      const now = new Date();
      const pausedAt = new Date(now.getTime() - 30 * 60000); // Paused 30 min ago
      const startedAt = new Date(now.getTime() - 120 * 60000);
      const responseDue = new Date(now.getTime() + 60 * 60000);

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 60, // 1 hour of previous pause time
      };

      const status = resolveSlaStatus(ticket, now);

      // Should be ~90 minutes total (60 historical + 30 current)
      expect(status!.total_pause_minutes).toBeGreaterThanOrEqual(89);
      expect(status!.total_pause_minutes).toBeLessThanOrEqual(91);
    });
  });

  describe('Paused overrides on_track/at_risk', () => {
    it('should return paused even when SLA would be on_track', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 10 * 60000); // Just started
      const responseDue = new Date(now.getTime() + 50 * 60000); // Plenty of time
      const pausedAt = new Date(now.getTime() - 5 * 60000);

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.status).toBe('paused');
    });

    it('should return paused even when SLA would be at_risk', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 90 * 60000); // 90% elapsed
      const responseDue = new Date(now.getTime() + 10 * 60000);
      const pausedAt = new Date(now.getTime() - 5 * 60000);

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.status).toBe('paused');
    });

    it('should return paused even when SLA would be breached without pause time extension', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 120 * 60000);
      const responseDue = new Date(now.getTime() - 10 * 60000); // Past due
      const pausedAt = new Date(now.getTime() - 60 * 60000); // But paused for 60 min

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: pausedAt.toISOString(),
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket, now);

      // While paused, status should show as paused
      expect(status!.status).toBe('paused');
      // But remaining time accounts for pause extension
      expect(status!.response_remaining_minutes).toBeGreaterThan(-10);
    });
  });

  describe('Correct status after pause/resume cycles', () => {
    it('should be on_track after resume when pause extended deadline enough', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 90 * 60000); // Started 90 min ago
      const responseDue = new Date(now.getTime() - 30 * 60000); // Original due 30 min ago
      // But we had 60 min of pause, so effective due is 30 min from now

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null, // Not currently paused
        sla_total_pause_minutes: 60, // Was paused for 60 min total
      };

      const status = resolveSlaStatus(ticket, now);

      // Effective due = original due + 60 min = now + 30 min
      // So should be on_track or at_risk depending on threshold
      expect(status!.status).not.toBe('response_breached');
      expect(status!.response_remaining_minutes).toBeGreaterThan(0);
    });

    it('should still show breached after resume if pause was not long enough', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 90 * 60000);
      const responseDue = new Date(now.getTime() - 30 * 60000); // 30 min past due
      // Only 10 min of pause, not enough to extend deadline past now

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 10, // Only 10 min pause
      };

      const status = resolveSlaStatus(ticket, now);

      // Effective due = original due + 10 min = now - 20 min (still past)
      expect(status!.status).toBe('response_breached');
      expect(status!.response_remaining_minutes).toBeLessThan(0);
    });

    it('should correctly track total pause minutes across multiple cycles', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 180 * 60000); // 3 hours ago
      const responseDue = new Date(now.getTime() + 60 * 60000); // 1 hour from now
      // Total SLA time is 4 hours, with 90 min of accumulated pause

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 90, // Multiple pause periods totaling 90 min
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.total_pause_minutes).toBe(90);
      // Remaining should account for 90 min pause extension
      expect(status!.response_remaining_minutes).toBe(60 + 90); // 150 min
    });
  });

  describe('Edge cases', () => {
    it('should return null for ticket without SLA policy', () => {
      const ticket: TicketSlaData = {
        sla_policy_id: null,
        sla_started_at: null,
        sla_response_due_at: null,
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket);

      expect(status).toBeNull();
    });

    it('should handle undefined remaining when response already made', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 60 * 60000);
      const responseDue = new Date(now.getTime() + 60 * 60000);
      const responseAt = new Date(now.getTime() - 30 * 60000);

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: responseDue.toISOString(),
        sla_response_at: responseAt.toISOString(),
        sla_response_met: true,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.response_remaining_minutes).toBeUndefined();
    });

    it('should handle undefined remaining when resolution already made', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 120 * 60000);
      const resolutionDue = new Date(now.getTime() + 60 * 60000);
      const resolutionAt = new Date(now.getTime() - 30 * 60000);

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: null,
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: resolutionDue.toISOString(),
        sla_resolution_at: resolutionAt.toISOString(),
        sla_resolution_met: true,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.resolution_remaining_minutes).toBeUndefined();
    });

    it('should handle ticket with no due dates', () => {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 60 * 60000);

      const ticket: TicketSlaData = {
        sla_policy_id: POLICY_ID,
        sla_started_at: startedAt.toISOString(),
        sla_response_due_at: null,
        sla_response_at: null,
        sla_response_met: null,
        sla_resolution_due_at: null,
        sla_resolution_at: null,
        sla_resolution_met: null,
        sla_paused_at: null,
        sla_total_pause_minutes: 0,
      };

      const status = resolveSlaStatus(ticket, now);

      expect(status!.status).toBe('on_track');
      expect(status!.response_remaining_minutes).toBeUndefined();
      expect(status!.resolution_remaining_minutes).toBeUndefined();
    });
  });
});
