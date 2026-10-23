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
    completeIfTicketClosed: async () => ({
      closed: false,
      responseMet: null,
      resolutionMet: null,
    }),
    getTicketSlaPauseState: async () => ({ paused: true, reason: 'awaiting_client' }),
    ...activitiesOverrides,
  };

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: path.resolve(__dirname, '../sla-ticket-workflow.ts'),
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
    let signalFirstCalculate!: () => void;
    const firstCalculateDone = new Promise<void>((resolve) => {
      signalFirstCalculate = resolve;
    });
    const { env, worker, taskQueue, calculateCalls } = await setupWorkflowTest({
      calculateNextWakeTime: async ({ targetMinutes, pauseMinutes }: { targetMinutes: number; pauseMinutes: number }) => {
        calculateCalls.push({ targetMinutes, pauseMinutes });
        signalFirstCalculate();
        return new Date(Date.now() + targetMinutes * 60000).toISOString();
      },
    });
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

        // Pause only after the workflow has entered its first sleep race;
        // pausing earlier is a different interleaving where no pause time accrues
        await firstCalculateDone;
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

        await handle.signal('cancel');
        await handle.result();

        expect(calculateCalls.some((call) => call.pauseMinutes > 0)).toBe(true);
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

  it('self-completes on startup when ticket is already closed', async () => {
    const sendCalls: Array<unknown> = [];
    const { env, worker, taskQueue } = await setupWorkflowTest({
      completeIfTicketClosed: async () => ({
        closed: true,
        responseMet: true,
        resolutionMet: true,
      }),
      sendSlaNotification: async (input: unknown) => {
        sendCalls.push(input);
      },
    });
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-closed',
              tenantId: 'tenant-closed',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-closed-ticket-closed',
        });

        await handle.result();
      });

      // Self-heal must short-circuit before any notification fires.
      expect(sendCalls).toEqual([]);
    } finally {
      await env.teardown();
    }
  });

  it('self-completes while paused when the close signal was missed', async () => {
    let closeChecks = 0;
    const sendCalls: Array<unknown> = [];
    const { env, worker, taskQueue } = await setupWorkflowTest({
      completeIfTicketClosed: async () => {
        closeChecks += 1;
        if (closeChecks < 2) {
          return {
            closed: false,
            responseMet: null,
            resolutionMet: null,
          };
        }

        return {
          closed: true,
          responseMet: true,
          resolutionMet: true,
        };
      },
      sendSlaNotification: async (input: unknown) => {
        sendCalls.push(input);
      },
    });
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-paused-close',
              tenantId: 'tenant-paused-close',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-paused-close-ticket-paused-close',
        });

        await handle.signal('pause', { reason: 'awaiting_client' });
        await handle.result();
      });

      expect(closeChecks).toBeGreaterThanOrEqual(2);
      expect(sendCalls).toEqual([]);
    } finally {
      await env.teardown();
    }
  });
  it('self-heals a missed resume from the ticket pause state', async () => {
    let pauseChecks = 0;
    const sendCalls: Array<{ phase: string; thresholdPercent: number }> = [];
    const { env, worker, taskQueue, calculateCalls } = await setupWorkflowTest({
      getTicketSlaPauseState: async () => {
        pauseChecks += 1;
        // First sweep still paused, second sweep finds the ticket active again.
        return pauseChecks < 2
          ? { paused: true, reason: 'awaiting_client' }
          : { paused: false, reason: null };
      },
      sendSlaNotification: async (input: { phase: string; thresholdPercent: number }) => {
        sendCalls.push(input);
      },
    });
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-lost-resume',
              tenantId: 'tenant-lost-resume',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-lost-resume-ticket-lost-resume',
        });

        await handle.signal('pause', { reason: 'awaiting_client' });
        // No resume signal is ever sent; the sweep must notice on its own.
        await handle.result();
      });

      expect(pauseChecks).toBeGreaterThanOrEqual(2);
      expect(calculateCalls.some((call) => call.pauseMinutes >= 5)).toBe(true);
      expect(sendCalls.map((c) => `${c.phase}:${c.thresholdPercent}`)).toEqual([
        'response:50', 'response:75', 'response:90', 'response:100',
        'resolution:50', 'resolution:75', 'resolution:90', 'resolution:100',
      ]);
    } finally {
      await env.teardown();
    }
  });

  it('continues as new while paused and carries the pause across runs', async () => {
    const { env, worker, taskQueue } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const workflowId = 'sla-ticket-tenant-can-ticket-can';
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-can',
              tenantId: 'tenant-can',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
              continueAsNewAfterEvents: 40,
            },
          ],
          taskQueue,
          workflowId,
        });
        const firstRunId = handle.firstExecutionRunId;

        await handle.signal('pause', { reason: 'awaiting_client' });
        const pausedState = await handle.query('getState');
        expect(pausedState.pauseState.isPaused).toBe(true);

        // Let a few sweeps run; each adds history until the run rolls over.
        for (let i = 0; i < 10; i += 1) {
          await env.sleep(5 * 60 * 1000);
          const desc = await env.client.workflow.getHandle(workflowId, firstRunId).describe();
          if (desc.status.name === 'CONTINUED_AS_NEW') break;
        }
        const firstRun = await env.client.workflow.getHandle(workflowId, firstRunId).describe();
        expect(firstRun.status.name).toBe('CONTINUED_AS_NEW');

        const latest = env.client.workflow.getHandle(workflowId);
        const carried = await latest.query('getState');
        expect(carried.pauseState.isPaused).toBe(true);
        expect(carried.pauseState.pauseStartedAt).toBe(pausedState.pauseState.pauseStartedAt);
        expect(carried.currentStatus).toBe('paused');

        await latest.signal('resume');
        await latest.signal('cancel');
        await handle.result();
      });
    } finally {
      await env.teardown();
    }
  });

  it('continues as new while active without repeating or skipping thresholds', async () => {
    const sendCalls: Array<{ phase: string; thresholdPercent: number }> = [];
    const { env, worker, taskQueue } = await setupWorkflowTest({
      sendSlaNotification: async (input: { phase: string; thresholdPercent: number }) => {
        sendCalls.push(input);
      },
    });
    try {
      await worker.runUntil(async () => {
        const workflowId = 'sla-ticket-tenant-can-active-ticket-can-active';
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-can-active',
              tenantId: 'tenant-can-active',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
              continueAsNewAfterEvents: 30,
            },
          ],
          taskQueue,
          workflowId,
        });
        await handle.result();

        const firstRun = await env.client.workflow.getHandle(workflowId, handle.firstExecutionRunId).describe();
        expect(firstRun.status.name).toBe('CONTINUED_AS_NEW');
      });

      expect(sendCalls.map((c) => `${c.phase}:${c.thresholdPercent}`)).toEqual([
        'response:50', 'response:75', 'response:90', 'response:100',
        'resolution:50', 'resolution:75', 'resolution:90', 'resolution:100',
      ]);
    } finally {
      await env.teardown();
    }
  });
});
