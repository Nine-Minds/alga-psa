import path from 'node:path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { describe, expect, it, vi } from 'vitest';
import {
  productUpgradeStatusQuery,
  tenantProductUpgradeWorkflow,
} from '../tenant-product-upgrade-workflow.js';

const STEP_NAMES = [
  'product_upgrade_preflight',
  'product_upgrade_backfill_seeds',
  'product_upgrade_rbac_delta',
  'product_upgrade_client_backfill',
  'product_upgrade_sla_parity',
  'product_upgrade_stripe_swap',
  'product_upgrade_flip',
  'product_upgrade_verify',
] as const;

type StepName = (typeof STEP_NAMES)[number];
type ActivityMocks = Record<StepName, ReturnType<typeof vi.fn>>;

class Deferred {
  readonly promise: Promise<void>;
  private resolvePromise!: () => void;

  constructor() {
    this.promise = new Promise(resolve => {
      this.resolvePromise = resolve;
    });
  }

  resolve() {
    this.resolvePromise();
  }
}

function createActivities(order: string[]): ActivityMocks {
  return Object.fromEntries(STEP_NAMES.map(name => [
    name,
    vi.fn(async () => {
      order.push(name);
      return name === 'product_upgrade_stripe_swap' ? { swapped: true } : undefined;
    }),
  ])) as ActivityMocks;
}

async function setupWorkflowTest(activities: ActivityMocks) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `test-product-upgrade-${Date.now()}-${Math.random()}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: path.resolve(__dirname, '../tenant-product-upgrade-workflow.ts'),
    activities,
  });
  return { env, taskQueue, worker };
}

const input = {
  tenantId: 'tenant-upgrade-1',
  requestedByUserId: 'user-admin-1',
};

describe('tenantProductUpgradeWorkflow', () => {
  it('T042 executes every activity in contract order', async () => {
    const order: string[] = [];
    const activities = createActivities(order);
    const { env, taskQueue, worker } = await setupWorkflowTest(activities);

    try {
      await worker.runUntil(env.client.workflow.execute(tenantProductUpgradeWorkflow, {
        args: [input],
        taskQueue,
        workflowId: `tenant-product-upgrade-happy-${Date.now()}`,
      }));

      expect(order).toEqual(STEP_NAMES);
      for (const name of STEP_NAMES) {
        expect(activities[name]).toHaveBeenCalledWith(input.tenantId);
      }
    } finally {
      await env.teardown();
    }
  });

  // T043 belongs to the caller: it applies the deterministic workflow id and
  // translates WorkflowExecutionAlreadyStarted into alreadyRunning=true.

  it('T044 never invokes flip when the Stripe activity fails', async () => {
    const order: string[] = [];
    const activities = createActivities(order);
    activities.product_upgrade_stripe_swap.mockImplementation(async () => {
      order.push('product_upgrade_stripe_swap');
      throw new Error('transient Stripe failure');
    });
    const { env, taskQueue, worker } = await setupWorkflowTest(activities);

    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(tenantProductUpgradeWorkflow, {
          args: [input],
          taskQueue,
          workflowId: `tenant-product-upgrade-stripe-failure-${Date.now()}`,
        });
        // Temporal wraps activity failures: the WorkflowFailedError's cause chain
        // carries the original message, not the top-level error.
        const failure = await handle.result().then(
          () => { throw new Error('expected workflow to fail'); },
          (error: unknown) => error as Error,
        );
        let cause: unknown = failure;
        const messages: string[] = [];
        while (cause instanceof Error) {
          messages.push(cause.message);
          cause = cause.cause;
        }
        expect(messages.join(' | ')).toContain('transient Stripe failure');
      });

      expect(activities.product_upgrade_stripe_swap).toHaveBeenCalledTimes(3);
      expect(activities.product_upgrade_flip).not.toHaveBeenCalled();
      expect(activities.product_upgrade_verify).not.toHaveBeenCalled();
    } finally {
      await env.teardown();
    }
  });

  it('T045 retries a transient DB step without replaying completed seed or RBAC steps', async () => {
    const order: string[] = [];
    const activities = createActivities(order);
    activities.product_upgrade_client_backfill
      .mockRejectedValueOnce(new Error('temporary read-only connection'))
      .mockImplementationOnce(async () => {
        order.push('product_upgrade_client_backfill');
      });
    const { env, taskQueue, worker } = await setupWorkflowTest(activities);

    try {
      await worker.runUntil(env.client.workflow.execute(tenantProductUpgradeWorkflow, {
        args: [input],
        taskQueue,
        workflowId: `tenant-product-upgrade-db-retry-${Date.now()}`,
      }));

      expect(activities.product_upgrade_backfill_seeds).toHaveBeenCalledTimes(1);
      expect(activities.product_upgrade_rbac_delta).toHaveBeenCalledTimes(1);
      expect(activities.product_upgrade_client_backfill).toHaveBeenCalledTimes(2);
      expect(activities.product_upgrade_flip).toHaveBeenCalledTimes(1);
    } finally {
      await env.teardown();
    }
  });

  it('T046 reports the current and completed steps as execution progresses', async () => {
    const order: string[] = [];
    const activities = createActivities(order);
    const gates = Object.fromEntries(STEP_NAMES.map(name => [name, {
      started: new Deferred(),
      release: new Deferred(),
    }])) as Record<StepName, { started: Deferred; release: Deferred }>;

    for (const name of STEP_NAMES) {
      activities[name].mockImplementation(async () => {
        order.push(name);
        gates[name].started.resolve();
        await gates[name].release.promise;
        return name === 'product_upgrade_stripe_swap' ? { swapped: true } : undefined;
      });
    }

    const { env, taskQueue, worker } = await setupWorkflowTest(activities);
    try {
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(tenantProductUpgradeWorkflow, {
          args: [input],
          taskQueue,
          workflowId: `tenant-product-upgrade-query-${Date.now()}`,
        });

        for (const [index, name] of STEP_NAMES.entries()) {
          await gates[name].started.promise;
          await expect(handle.query(productUpgradeStatusQuery)).resolves.toEqual({
            currentStep: name,
            completedSteps: STEP_NAMES.slice(0, index),
          });
          gates[name].release.resolve();
        }

        await handle.result();
        await expect(handle.query(productUpgradeStatusQuery)).resolves.toEqual({
          currentStep: null,
          completedSteps: STEP_NAMES,
        });
      });
    } finally {
      await env.teardown();
    }
  });
});
