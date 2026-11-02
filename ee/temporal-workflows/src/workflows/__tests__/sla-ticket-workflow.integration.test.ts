import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { slaTicketWorkflow } from '../sla-ticket-workflow.js';
import { slaTicketWorkflow as slaTicketWorkflowParent } from './fixtures/sla-ticket-workflow-parent.js';

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
  response_time_minutes: 10,
  resolution_time_minutes: null,
  escalation_1_percent: 70,
  escalation_2_percent: 90,
  escalation_3_percent: 110,
  is_24x7: true,
};

async function setupWorkflowTest(activitiesOverrides: Record<string, any> = {}) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `test-sla-integration-${Date.now()}`;
  const notifications: Array<{
    tenantId: string;
    ticketId: string;
    phase: 'response' | 'resolution';
    thresholdPercent: number;
  }> = [];
  const escalations: Array<{
    tenantId: string;
    ticketId: string;
    phase: 'response' | 'resolution';
    thresholdPercent: number;
    escalationLevel?: 1 | 2 | 3;
  }> = [];
  const statusUpdates: Array<{
    tenantId: string;
    ticketId: string;
    phase: 'response' | 'resolution';
    breached: boolean;
  }> = [];
  const calculateCalls: Array<{ targetMinutes: number; pauseMinutes: number }> = [];

  const activities = {
    calculateNextWakeTime: async ({ currentTime, targetMinutes, pauseMinutes }: { currentTime: string; targetMinutes: number; pauseMinutes: number }) => {
      calculateCalls.push({ targetMinutes, pauseMinutes });
      return new Date(new Date(currentTime).getTime() + (targetMinutes + pauseMinutes) * 60000).toISOString();
    },
    sendSlaNotification: async (input: {
      tenantId: string;
      ticketId: string;
      phase: 'response' | 'resolution';
      thresholdPercent: number;
      escalationLevel?: 1 | 2 | 3;
    }) => {
      notifications.push(input);
    },
    checkAndEscalate: async (input: {
      tenantId: string;
      ticketId: string;
      phase: 'response' | 'resolution';
      thresholdPercent: number;
    }) => {
      escalations.push(input);
    },
    updateSlaStatus: async (input: {
      tenantId: string;
      ticketId: string;
      phase: 'response' | 'resolution';
      breached: boolean;
    }) => {
      statusUpdates.push(input);
    },
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

  return { env, worker, taskQueue, notifications, escalations, statusUpdates, calculateCalls };
}

describe('slaTicketWorkflow integration', () => {
  it('sends notifications and escalations at thresholds and marks breach at 100%', async () => {
    const { env, worker, taskQueue, notifications, escalations, statusUpdates } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-thresholds',
              tenantId: 'tenant-thresholds',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-thresholds-ticket-thresholds',
        });

        await handle.result();
      });

      const responseThresholds = notifications
        .filter((entry) => entry.phase === 'response')
        .map((entry) => entry.thresholdPercent);
      expect(responseThresholds).toEqual([50, 75, 90, 100]);

      expect(statusUpdates).toEqual([
        {
          tenantId: 'tenant-thresholds',
          ticketId: 'ticket-thresholds',
          phase: 'response',
          breached: true,
        },
      ]);

      const escalatedThresholds = escalations.map((entry) => entry.thresholdPercent);
      expect(escalatedThresholds).toEqual([70, 90, 110]);
    } finally {
      await env.teardown();
    }
  });

  it('evaluates policy escalation thresholds at 70%, 90%, and 110%, only when due', async () => {
    const { env, worker, taskQueue, escalations } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [{
            ticketId: 'ticket-escalation-timing',
            tenantId: 'tenant-escalation-timing',
            policyTargets: [{ ...target, response_time_minutes: 10 }],
            businessHoursSchedule: schedule24x7,
          }],
          taskQueue,
          workflowId: 'sla-ticket-tenant-escalation-timing-ticket-escalation-timing',
        });

        await expect.poll(async () => (await handle.query<any>('getState')).nextWakeTime).toBeTruthy();
        await env.sleep(6 * 60 * 1000);
        expect(escalations.map((entry) => entry.thresholdPercent)).toEqual([]);
        await env.sleep(1 * 60 * 1000);
        await expect.poll(() => escalations.map((entry) => entry.thresholdPercent)).toEqual([70]);
        await env.sleep(2 * 60 * 1000);
        await expect.poll(() => escalations.map((entry) => entry.thresholdPercent)).toEqual([70, 90]);
        await env.sleep(2 * 60 * 1000);
        await handle.result();
      });

      expect(escalations.map((entry) => entry.thresholdPercent)).toEqual([70, 90, 110]);
    } finally {
      await env.teardown();
    }
  });

  it('uses configured policy thresholds, deduplicates coincident notification points, and keeps 110% reachable in resolution', async () => {
    const { env, worker, taskQueue, notifications, escalations } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [{
            ticketId: 'ticket-policy-thresholds',
            tenantId: 'tenant-policy-thresholds',
            policyTargets: [{
              ...target,
              response_time_minutes: 4,
              resolution_time_minutes: 8,
              escalation_1_percent: 50,
              escalation_2_percent: 80,
              escalation_3_percent: 110,
            }],
            notificationThresholds: [50, 80, 100],
            businessHoursSchedule: schedule24x7,
          }],
          taskQueue,
          workflowId: 'sla-ticket-tenant-policy-thresholds-ticket-policy-thresholds',
        });
        await handle.result();
      });

      expect(notifications.filter((entry) => entry.phase === 'response').map((entry) => entry.thresholdPercent))
        .toEqual([50, 80, 100]);
      expect(escalations.filter((entry) => entry.phase === 'response').map((entry) => entry.thresholdPercent))
        .toEqual([50, 80, 110]);
      expect(escalations.filter((entry) => entry.phase === 'resolution').map((entry) => entry.thresholdPercent))
        .toEqual([50, 80, 110]);
    } finally {
      await env.teardown();
    }
  });

  it('cancels pending response escalations when response is completed before the response threshold', async () => {
    const { env, worker, taskQueue, escalations } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [{
            ticketId: 'ticket-response-carry',
            tenantId: 'tenant-response-carry',
            policyTargets: [{ ...target, response_time_minutes: 4, resolution_time_minutes: 10 }],
            businessHoursSchedule: schedule24x7,
          }],
          taskQueue,
          workflowId: 'sla-ticket-tenant-response-carry-ticket-response-carry',
        });

        await handle.signal('completeResponse', { met: true });
        await env.sleep(12 * 60 * 1000);
        await expect.poll(async () => (await handle.query<any>('getState')).currentPhase).toBe('resolution');
        expect(escalations.filter((entry) => entry.phase === 'response')).toEqual([]);
      });
    } finally {
      await env.teardown();
    }
  });

  it('cancels deferred response escalations when response completes during resolution', async () => {
    const { env, worker, taskQueue, escalations } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [{
            ticketId: 'ticket-response-complete-in-resolution',
            tenantId: 'tenant-response-complete-in-resolution',
            policyTargets: [{ ...target, response_time_minutes: 10, resolution_time_minutes: 30 }],
            businessHoursSchedule: schedule24x7,
          }],
          taskQueue,
          workflowId: 'sla-ticket-tenant-response-complete-in-resolution-ticket',
        });

        await env.sleep(10 * 60 * 1000);
        await expect.poll(async () => (await handle.query<any>('getState')).currentPhase).toBe('resolution');
        await handle.signal('completeResponse', { met: false });
        await env.sleep(2 * 60 * 1000);
        await expect.poll(() => escalations.filter((entry) => entry.phase === 'response').length).toBe(2);
        expect(escalations.filter((entry) => entry.phase === 'response').map((entry) => entry.thresholdPercent))
          .toEqual([70, 90]);
        await handle.signal('completeResolution', { met: true });
        await handle.result();
      });
    } finally {
      await env.teardown();
    }
  });

  it('exits a paused response escalation when response completes while resolution stays paused', async () => {
    const { env, worker, taskQueue, notifications, escalations } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [{
            ticketId: 'ticket-response-complete-while-paused',
            tenantId: 'tenant-response-complete-while-paused',
            policyTargets: [{ ...target, response_time_minutes: 10, resolution_time_minutes: 30 }],
            businessHoursSchedule: schedule24x7,
          }],
          taskQueue,
          workflowId: 'sla-ticket-tenant-response-complete-while-paused-ticket',
        });

        await env.sleep(10 * 60 * 1000);
        await expect.poll(async () => (await handle.query<any>('getState')).currentPhase).toBe('resolution');

        await handle.signal('pause', { reason: 'status_pause' });
        await expect.poll(async () => (await handle.query<any>('getState')).pauseState.isPaused).toBe(true);
        await handle.signal('completeResponse', { met: false });

        // Queries must remain responsive after completion interrupts the paused event.
        await expect.poll(async () => {
          const state = await handle.query<any>('getState');
          return { phase: state.currentPhase, paused: state.pauseState.isPaused };
        }).toEqual({ phase: 'resolution', paused: true });

        await env.sleep(2 * 60 * 1000);
        expect(escalations.filter((entry) => entry.phase === 'response').map((entry) => entry.thresholdPercent))
          .toEqual([70, 90]);
        expect(notifications.filter((entry) => entry.phase === 'resolution')).toEqual([]);

        await handle.signal('resume');
        await expect.poll(async () => (await handle.query<any>('getState')).pauseState.isPaused).toBe(false);
        await env.sleep(6 * 60 * 1000);
        await expect.poll(() => notifications.some(
          (entry) => entry.phase === 'resolution' && entry.thresholdPercent === 50
        )).toBe(true);
        expect(escalations.filter((entry) => entry.phase === 'response').map((entry) => entry.thresholdPercent))
          .toEqual([70, 90]);

        await handle.signal('completeResolution', { met: true });
        await handle.result();
      });
    } finally {
      await env.teardown();
    }
  });

  it('evaluates coincident escalation levels independently at one shared wake point', async () => {
    const { env, worker, taskQueue, notifications, escalations } = await setupWorkflowTest();
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [{
            ticketId: 'ticket-coincident',
            tenantId: 'tenant-coincident',
            policyTargets: [{
              ...target,
              response_time_minutes: 2,
              escalation_1_percent: 80,
              escalation_2_percent: 80,
              escalation_3_percent: 80,
            }],
            notificationThresholds: [80, 100],
            businessHoursSchedule: schedule24x7,
          }],
          taskQueue,
          workflowId: 'sla-ticket-tenant-coincident-ticket-coincident',
        });
        await env.sleep(2 * 60 * 1000);
        await expect.poll(() => escalations.filter((entry) => entry.phase === 'response' && entry.thresholdPercent === 80).length)
          .toBe(3);
        await handle.result();
      });
      expect(escalations.filter((entry) => entry.phase === 'response' && entry.thresholdPercent === 80))
        .toHaveLength(3);
      expect(notifications.filter((entry) => entry.phase === 'response').map((entry) => entry.thresholdPercent))
        .toEqual([80, 100]);
    } finally {
      await env.teardown();
    }
  });

  it('keeps tracking SLA (breach at 100%, resolution phase) when checkAndEscalate always fails', async () => {
    let escalationAttempts = 0;
    const { env, worker, taskQueue, notifications, statusUpdates } = await setupWorkflowTest({
      checkAndEscalate: async () => {
        escalationAttempts += 1;
        throw new Error('SLA escalation failed for ticket ticket-esc-fail (level 1): boom');
      },
    });

    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-esc-fail',
              tenantId: 'tenant-esc-fail',
              policyTargets: [{ ...target, resolution_time_minutes: 20 }],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-esc-fail-ticket-esc-fail',
        });

        await expect.poll(async () => (await handle.query<any>('getState')).nextWakeTime, { timeout: 15_000 }).toBeTruthy();
        // Let the 10-minute response phase run to its 100% threshold (time-skipping).
        await env.sleep(15 * 60 * 1000);
        await expect
          .poll(async () => (await handle.query<any>('getState')).currentPhase, { timeout: 30_000 })
          .toBe('resolution');

        await handle.signal('completeResolution', { met: true });
        await handle.result();
      });

      // Every response threshold still notified, and the 100% breach was recorded.
      expect(
        notifications.filter((entry) => entry.phase === 'response').map((entry) => entry.thresholdPercent)
      ).toEqual([50, 75, 90, 100]);
      expect(statusUpdates).toContainEqual({
        tenantId: 'tenant-esc-fail',
        ticketId: 'ticket-esc-fail',
        phase: 'response',
        breached: true,
      });
      // Retries ran (maximumAttempts: 3) for each failing threshold before the workflow moved on.
      expect(escalationAttempts).toBeGreaterThanOrEqual(3);
    } finally {
      await env.teardown();
    }
  });

  it('pauses and resumes timers without firing notifications while paused', async () => {
    let notificationResolve: (() => void) | null = null;
    const notificationPromise = new Promise<void>((resolve) => {
      notificationResolve = resolve;
    });

    const { env, worker, taskQueue, notifications, calculateCalls } = await setupWorkflowTest({
      sendSlaNotification: async (input: {
        tenantId: string;
        ticketId: string;
        phase: 'response' | 'resolution';
        thresholdPercent: number;
      }) => {
        notifications.push(input);
        if (notificationResolve) {
          notificationResolve();
        }
      },
    });

    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-pause',
              tenantId: 'tenant-pause',
              policyTargets: [target],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-pause-ticket-pause',
        });

        await handle.signal('pause', { reason: 'awaiting_client' });
        await env.sleep(10 * 60 * 1000);
        expect(notifications).toHaveLength(0);

        await handle.signal('resume');
        await env.sleep(5 * 60 * 1000);
        await notificationPromise;

        expect(calculateCalls.some((call) => call.pauseMinutes > 0)).toBe(true);

        await handle.signal('cancel');
        await handle.result();
      });
    } finally {
      await env.teardown();
    }
  });

  it('runs full lifecycle with pause/resume, response completion, and resolution notification', async () => {
    let responseNotificationResolve: (() => void) | null = null;
    let resolutionNotificationResolve: (() => void) | null = null;

    const responseNotification = new Promise<void>((resolve) => {
      responseNotificationResolve = resolve;
    });
    const resolutionNotification = new Promise<void>((resolve) => {
      resolutionNotificationResolve = resolve;
    });

    const { env, worker, taskQueue, notifications } = await setupWorkflowTest({
      sendSlaNotification: async (input: {
        tenantId: string;
        ticketId: string;
        phase: 'response' | 'resolution';
        thresholdPercent: number;
      }) => {
        notifications.push(input);
        if (input.phase === 'response' && input.thresholdPercent === 50 && responseNotificationResolve) {
          responseNotificationResolve();
        }
        if (input.phase === 'resolution' && input.thresholdPercent === 50 && resolutionNotificationResolve) {
          resolutionNotificationResolve();
        }
      },
    });

    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflow, {
          args: [
            {
              ticketId: 'ticket-lifecycle',
              tenantId: 'tenant-lifecycle',
              policyTargets: [
                {
                  ...target,
                  response_time_minutes: 4,
                  resolution_time_minutes: 10,
                },
              ],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-lifecycle-ticket-lifecycle',
        });

        await expect.poll(async () => (await handle.query<any>('getState')).nextWakeTime, { timeout: 15_000 }).toBeTruthy();
        await env.sleep(2 * 60 * 1000);
        await responseNotification;

        await handle.signal('pause', { reason: 'status_pause' });
        await env.sleep(5 * 60 * 1000);
        expect(
          notifications.filter((entry) => entry.phase === 'response').length
        ).toBe(1);

        await handle.signal('resume');
        await handle.signal('completeResponse', { met: true });

        // The pause sweep may be mid-activity when these signals land; give the
        // worker time to process them before asserting on the phase.
        await expect.poll(async () => (await handle.query<any>('getState')).currentPhase, { timeout: 15_000 }).toBe('resolution');

        await env.sleep(3 * 60 * 1000);
        await resolutionNotification;

        await handle.signal('completeResolution', { met: true });
        await handle.result();
      });
    } finally {
      await env.teardown();
    }
  });

  it('survives worker restart and replays deterministically', async () => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    const taskQueue = `test-sla-replay-${Date.now()}`;
    const notifications: Array<{ thresholdPercent: number }> = [];

    const activities = {
      calculateNextWakeTime: async ({ currentTime, targetMinutes, pauseMinutes }: { currentTime: string; targetMinutes: number; pauseMinutes: number }) => {
        return new Date(new Date(currentTime).getTime() + (targetMinutes + pauseMinutes) * 60000).toISOString();
      },
      sendSlaNotification: async (input: { thresholdPercent: number }) => {
        notifications.push(input);
      },
      checkAndEscalate: async () => {},
      updateSlaStatus: async () => {},
      recordSlaAuditLog: async () => {},
      completeIfTicketClosed: async () => ({
        closed: false,
        responseMet: null,
        resolutionMet: null,
      }),
    };

    const worker1 = await Worker.create({
      maxCachedWorkflows: 0,
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: path.resolve(__dirname, '../sla-ticket-workflow.ts'),
      activities,
    });

    const handle = await env.client.workflow.start(slaTicketWorkflow, {
      args: [
        {
          ticketId: 'ticket-restart',
          tenantId: 'tenant-restart',
          policyTargets: [target],
          businessHoursSchedule: schedule24x7,
        },
      ],
      taskQueue,
      workflowId: 'sla-ticket-tenant-restart-ticket-restart',
    });

    try {
      await worker1.runUntil(async () => {
        await expect.poll(async () => (await handle.query<any>('getState')).nextWakeTime, { timeout: 15_000 }).toBeTruthy();
      });

      const worker2 = await Worker.create({
        maxCachedWorkflows: 0,
        connection: env.nativeConnection,
        taskQueue,
        workflowsPath: path.resolve(__dirname, '../sla-ticket-workflow.ts'),
        activities,
      });

      await worker2.runUntil(async () => {
        await env.sleep(11 * 60 * 1000);
        await handle.result();
      });

      expect(notifications.map(({ thresholdPercent }) => thresholdPercent)).toEqual([50, 75, 90, 100]);
    } finally {
      await env.teardown();
    }
  });

  it('replays a completed history generated by the parent workflow revision', async () => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    const taskQueue = `test-sla-parent-history-${Date.now()}`;
    const workflowId = `sla-ticket-legacy-history-${Date.now()}`;
    const activities = {
      calculateNextWakeTime: async ({ currentTime, targetMinutes, pauseMinutes }: {
        currentTime: string;
        targetMinutes: number;
        pauseMinutes: number;
      }) => new Date(new Date(currentTime).getTime() + (targetMinutes + pauseMinutes) * 60000).toISOString(),
      sendSlaNotification: async () => {},
      checkAndEscalate: async () => {},
      updateSlaStatus: async () => {},
      recordSlaAuditLog: async () => {},
      completeIfTicketClosed: async () => ({ closed: false, responseMet: null, resolutionMet: null }),
    };

    try {
      const parentWorker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue,
        workflowsPath: path.resolve(__dirname, './fixtures/sla-ticket-workflow-parent.ts'),
        activities,
      });
      let legacyHistory: unknown;
      await parentWorker.runUntil(async () => {
        const handle = await env.client.workflow.start(slaTicketWorkflowParent, {
          args: [{
            ticketId: 'ticket-parent-history',
            tenantId: 'tenant-parent-history',
            policyTargets: [target],
            businessHoursSchedule: schedule24x7,
          }],
          taskQueue,
          workflowId,
        });
        await handle.result();
        legacyHistory = await handle.fetchHistory();
      });

      expect(legacyHistory).toBeDefined();
      await Worker.runReplayHistory({
        workflowsPath: path.resolve(__dirname, '../sla-ticket-workflow.ts'),
      }, legacyHistory!, workflowId);
    } finally {
      await env.teardown();
    }
  });
});
