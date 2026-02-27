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
  response_time_minutes: 10,
  resolution_time_minutes: null,
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
  }> = [];
  const statusUpdates: Array<{
    tenantId: string;
    ticketId: string;
    phase: 'response' | 'resolution';
    breached: boolean;
  }> = [];
  const calculateCalls: Array<{ targetMinutes: number; pauseMinutes: number }> = [];

  const activities = {
    calculateNextWakeTime: async ({ targetMinutes, pauseMinutes }: { targetMinutes: number; pauseMinutes: number }) => {
      calculateCalls.push({ targetMinutes, pauseMinutes });
      return new Date(Date.now() + targetMinutes * 60000).toISOString();
    },
    sendSlaNotification: async (input: {
      tenantId: string;
      ticketId: string;
      phase: 'response' | 'resolution';
      thresholdPercent: number;
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
    ...activitiesOverrides,
  };

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: path.resolve(__dirname, '../..'),
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
      expect(responseThresholds).toEqual([50, 75, 90]);

      expect(statusUpdates).toEqual([
        {
          tenantId: 'tenant-thresholds',
          ticketId: 'ticket-thresholds',
          phase: 'response',
          breached: true,
        },
      ]);

      const escalatedThresholds = escalations.map((entry) => entry.thresholdPercent);
      expect(escalatedThresholds).toEqual([50, 75, 90, 100]);
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
                  resolution_time_minutes: 4,
                },
              ],
              businessHoursSchedule: schedule24x7,
            },
          ],
          taskQueue,
          workflowId: 'sla-ticket-tenant-lifecycle-ticket-lifecycle',
        });

        await responseNotification;

        await handle.signal('pause', { reason: 'status_pause' });
        await env.sleep(5 * 60 * 1000);
        expect(
          notifications.filter((entry) => entry.phase === 'response').length
        ).toBe(1);

        await handle.signal('resume');
        await handle.signal('completeResponse', { met: true });

        const state = await handle.query('getState');
        expect(state.currentPhase).toBe('resolution');

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
      calculateNextWakeTime: async ({ targetMinutes }: { targetMinutes: number }) => {
        return new Date(Date.now() + targetMinutes * 60000).toISOString();
      },
      sendSlaNotification: async (input: { thresholdPercent: number }) => {
        notifications.push(input);
      },
      checkAndEscalate: async () => {},
      updateSlaStatus: async () => {},
      recordSlaAuditLog: async () => {},
    };

    const worker1 = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: path.resolve(__dirname, '../..'),
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
        const state = await handle.query('getState');
        expect(state.nextWakeTime).toBeTruthy();
      });

      const worker2 = await Worker.create({
        connection: env.nativeConnection,
        taskQueue,
        workflowsPath: path.resolve(__dirname, '../..'),
        activities,
      });

      await worker2.runUntil(async () => {
        await handle.result();
      });

      expect(notifications.length).toBeGreaterThan(0);
    } finally {
      await env.teardown();
    }
  });
});
