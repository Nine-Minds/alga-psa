import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { managedEmailDomainWorkflow } from '../managed-email-domain-workflow.js';

const baseInput = {
  tenantId: 'tenant-1',
  domain: 'example.com',
};

const pendingCheckResult = {
  providerDomainId: 'domain-123',
  status: 'pending',
  verifiedAt: null,
  failureReason: null,
  provider: { domain: 'example.com', status: 'pending', providerId: 'managed-resend' },
  dnsLookup: [],
};

async function setupWorkflowTest(activityOverrides: Record<string, any> = {}) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `test-managed-email-${Date.now()}`;
  const calls = {
    provision: [] as any[],
    check: [] as any[],
    activate: [] as any[],
    delete: [] as any[],
    markFailed: [] as any[],
  };

  const impl = {
    provisionManagedEmailDomain: async (_input: any) => ({
      providerDomainId: 'domain-123',
      status: 'pending',
      dnsRecords: [],
    }),
    checkManagedEmailDomainStatus: async (_input: any) => pendingCheckResult,
    activateManagedEmailDomain: async (_input: any) => {},
    deleteManagedEmailDomain: async (_input: any) => {},
    markManagedEmailDomainFailed: async (_input: any) => {},
    ...activityOverrides,
  };

  const activities = {
    provisionManagedEmailDomain: async (input: any) => {
      calls.provision.push(input);
      return impl.provisionManagedEmailDomain(input);
    },
    checkManagedEmailDomainStatus: async (input: any) => {
      calls.check.push(input);
      return impl.checkManagedEmailDomainStatus(input);
    },
    activateManagedEmailDomain: async (input: any) => {
      calls.activate.push(input);
      return impl.activateManagedEmailDomain(input);
    },
    deleteManagedEmailDomain: async (input: any) => {
      calls.delete.push(input);
      return impl.deleteManagedEmailDomain(input);
    },
    markManagedEmailDomainFailed: async (input: any) => {
      calls.markFailed.push(input);
      return impl.markManagedEmailDomainFailed(input);
    },
  };

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: path.resolve(__dirname, '../managed-email-domain-workflow.ts'),
    activities,
  });

  return { env, worker, taskQueue, calls };
}

describe('managedEmailDomainWorkflow', () => {
  it('deletes immediately when started with a delete trigger', async () => {
    const { env, worker, taskQueue, calls } = await setupWorkflowTest();
    try {
      const result = await worker.runUntil(
        env.client.workflow.execute(managedEmailDomainWorkflow, {
          args: [{ ...baseInput, trigger: 'delete' as const }],
          taskQueue,
          workflowId: `delete-${Date.now()}`,
        })
      );

      expect(result.activated).toBe(false);
      expect(calls.delete).toHaveLength(1);
      expect(calls.provision).toHaveLength(0);
      expect(calls.check).toHaveLength(0);
    } finally {
      await env.teardown();
    }
  });

  it('provisions then activates once verification succeeds', async () => {
    const { env, worker, taskQueue, calls } = await setupWorkflowTest({
      checkManagedEmailDomainStatus: async () => ({
        ...pendingCheckResult,
        status: 'verified',
        verifiedAt: new Date().toISOString(),
      }),
    });
    try {
      const result = await worker.runUntil(
        env.client.workflow.execute(managedEmailDomainWorkflow, {
          args: [baseInput],
          taskQueue,
          workflowId: `verify-${Date.now()}`,
        })
      );

      expect(result.activated).toBe(true);
      expect(calls.provision).toHaveLength(1);
      expect(calls.activate).toHaveLength(1);
    } finally {
      await env.teardown();
    }
  });

  it('skips provisioning when a provider domain id is supplied', async () => {
    const { env, worker, taskQueue, calls } = await setupWorkflowTest({
      checkManagedEmailDomainStatus: async () => ({
        ...pendingCheckResult,
        status: 'verified',
      }),
    });
    try {
      const result = await worker.runUntil(
        env.client.workflow.execute(managedEmailDomainWorkflow, {
          args: [{ ...baseInput, providerDomainId: 'domain-123' }],
          taskQueue,
          workflowId: `adopt-${Date.now()}`,
        })
      );

      expect(result.activated).toBe(true);
      expect(calls.provision).toHaveLength(0);
    } finally {
      await env.teardown();
    }
  });

  it('stops on a failed verification result', async () => {
    const { env, worker, taskQueue, calls } = await setupWorkflowTest({
      checkManagedEmailDomainStatus: async () => ({
        ...pendingCheckResult,
        status: 'failed',
        failureReason: 'dns_failure',
      }),
    });
    try {
      const result = await worker.runUntil(
        env.client.workflow.execute(managedEmailDomainWorkflow, {
          args: [baseInput],
          taskQueue,
          workflowId: `failed-${Date.now()}`,
        })
      );

      expect(result.activated).toBe(false);
      expect(calls.check).toHaveLength(1);
      expect(calls.activate).toHaveLength(0);
    } finally {
      await env.teardown();
    }
  });

  it('marks the domain failed when verification never completes before the deadline', async () => {
    const { env, worker, taskQueue, calls } = await setupWorkflowTest();
    try {
      const result = await worker.runUntil(
        env.client.workflow.execute(managedEmailDomainWorkflow, {
          args: [baseInput],
          taskQueue,
          workflowId: `timeout-${Date.now()}`,
        })
      );

      expect(result.timedOut).toBe(true);
      expect(result.activated).toBe(false);
      expect(calls.markFailed).toHaveLength(1);
      expect(calls.markFailed[0].reason).toContain('timed out');
      // Backoff must keep the total poll count far below the ~864 checks
      // a fixed 5-minute interval would produce over 72 hours
      expect(calls.check.length).toBeGreaterThan(10);
      expect(calls.check.length).toBeLessThan(150);
    } finally {
      await env.teardown();
    }
  }, 240000);

  it('processes a delete signal that arrives while a check activity is in flight', async () => {
    let releaseCheck!: () => void;
    let signalCheckStarted!: () => void;
    const checkStarted = new Promise<void>((resolve) => {
      signalCheckStarted = resolve;
    });
    const checkGate = new Promise<void>((resolve) => {
      releaseCheck = resolve;
    });

    const { env, worker, taskQueue, calls } = await setupWorkflowTest({
      checkManagedEmailDomainStatus: async () => {
        signalCheckStarted();
        await checkGate;
        return pendingCheckResult;
      },
    });
    try {
      const result = await worker.runUntil(async () => {
        const handle = await env.client.workflow.start(managedEmailDomainWorkflow, {
          args: [{ ...baseInput, providerDomainId: 'domain-123' }],
          taskQueue,
          workflowId: `signal-race-${Date.now()}`,
        });

        await checkStarted;
        await handle.signal('refreshManagedEmailDomain', { ...baseInput, trigger: 'delete' });
        releaseCheck();

        return handle.result();
      });

      expect(result.activated).toBe(false);
      expect(calls.delete).toHaveLength(1);
      expect(calls.check).toHaveLength(1);
    } finally {
      await env.teardown();
    }
  });
});
