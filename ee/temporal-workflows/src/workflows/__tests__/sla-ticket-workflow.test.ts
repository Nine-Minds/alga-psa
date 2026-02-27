import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { slaTicketWorkflow } from '../sla-ticket-workflow.js';

const schedule24x7 = {
  schedule_id: '24x7',
  schedule_name: '24x7',
  timezone: 'UTC',
  is_default: false,
  is_24x7: true,
  entries: [],
  holidays: [],
};

const target = {
  sla_policy_id: 'policy-1',
  priority_id: 'priority-1',
  response_time_minutes: 100,
  resolution_time_minutes: 200,
  is_24x7: true,
};

async function setupWorkflowTest(activitiesOverrides: Record<string, any> = {}) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `test-sla-${Date.now()}`;
  const calculateCalls: Array<{ targetMinutes: number; pauseMinutes: number }> = [];

  const activities = {
    calculateNextWakeTime: async ({ targetMinutes, pauseMinutes }: { targetMinutes: number; pauseMinutes: number }) => {
      calculateCalls.push({ targetMinutes, pauseMinutes });
      return new Date(Date.now() + targetMinutes * 60000).toISOString();
    },
    sendSlaNotification: async () => {},
    checkAndEscalate: async () => {},
    updateSlaStatus: async () => {},
    recordSlaAuditLog: async () => {},
    ...activitiesOverrides,
  };

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: path.resolve(__dirname, '../..'),
    activities,
  });

  return { env, worker, taskQueue, calculateCalls };
}

describe('slaTicketWorkflow', () => {
  it('initializes with correct input parameters', async () => {
    const { env, worker, taskQueue } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-1',
              tenantId: 'tenant-1',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-1-ticket-1',
        });

        await handle.result();
      });
    } finally {
      await env.teardown();
    }
  });

  it("initial state has currentPhase='response' and empty notifiedThresholds", async () => {
    const { env, worker, taskQueue } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-2',
              tenantId: 'tenant-2',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-2-ticket-2',
        });

        const state = await handle.query('getState');
        expect(state.currentPhase).toBe('response');
        expect(state.notifiedThresholds.response).toEqual([]);
      });
    } finally {
      await env.teardown();
    }
  });

  it('calculates correct threshold minutes for response SLA', async () => {
    const { env, worker, taskQueue, calculateCalls } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-3',
              tenantId: 'tenant-3',
              policyTargets: [{ ...target, resolution_time_minutes: null }],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-3-ticket-3',
        });

        await handle.result();
      });

      const targetMinutes = calculateCalls.map((call) => call.targetMinutes);
      expect(targetMinutes).toContain(50);
      expect(targetMinutes).toContain(75);
      expect(targetMinutes).toContain(90);
      expect(targetMinutes).toContain(100);
    } finally {
      await env.teardown();
    }
  });

  it('pause and resume update pause state', async () => {
    const { env, worker, taskQueue, calculateCalls } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-4',
              tenantId: 'tenant-4',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-4-ticket-4',
        });

        await handle.signal('pause', { reason: 'status_pause' });
        const paused = await handle.query('getState');
        expect(paused.pauseState.isPaused).toBe(true);
        expect(paused.pauseState.pauseStartedAt).toBeTruthy();

        await env.sleep(60_000);
        await handle.signal('resume');

        const resumed = await handle.query('getState');
        expect(resumed.pauseState.isPaused).toBe(false);
        expect(resumed.pauseState.pauseStartedAt).toBeNull();
        expect(resumed.pauseState.totalPauseMinutes).toBeGreaterThanOrEqual(1);
        expect(calculateCalls.some((call) => call.pauseMinutes > 0)).toBe(true);

        await handle.signal('cancel');
        await handle.result();
      });
    } finally {
      await env.teardown();
    }
  });

  it('completeResponse transitions to resolution phase', async () => {
    const { env, worker, taskQueue } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-5',
              tenantId: 'tenant-5',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-5-ticket-5',
        });

        await handle.signal('completeResponse', { met: true });
        const state = await handle.query('getState');
        expect(state.currentPhase).toBe('resolution');

        await handle.signal('cancel');
        await handle.result();
      });
    } finally {
      await env.teardown();
    }
  });

  it('completeResolution terminates workflow', async () => {
    const { env, worker, taskQueue } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-6',
              tenantId: 'tenant-6',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-6-ticket-6',
        });

        await handle.signal('completeResolution', { met: true });
        await handle.result();
      });
    } finally {
      await env.teardown();
    }
  });

  it('cancel signal terminates workflow without breach', async () => {
    const { env, worker, taskQueue } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-7',
              tenantId: 'tenant-7',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-7-ticket-7',
        });

        await handle.signal('cancel');
        await handle.result();
      });
    } finally {
      await env.teardown();
    }
  });

  it('getState query returns remaining time', async () => {
    const { env, worker, taskQueue } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-8',
              tenantId: 'tenant-8',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-8-ticket-8',
        });

        const state = await handle.query('getState');
        expect(state.currentStatus).toBeDefined();
        expect(state.remainingTimeMinutes).not.toBeUndefined();

        await handle.signal('cancel');
        await handle.result();
      });
    } finally {
      await env.teardown();
    }
  });
});
