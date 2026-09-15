import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { trialPaymentReminderWorkflow } from '../trial-payment-reminder-workflow.js';
import { tenantCreationWorkflow } from '../tenant-creation-workflow.js';
import type {
  TenantCreationInput,
  TrialPaymentReminderWorkflowInput,
  VerifyTrialReminderActivityResult,
} from '../../types/workflow-types.js';

/**
 * Contract for trialPaymentReminderWorkflow: it waits until two days before the
 * Stripe trial converts, re-checks that the tenant is still billable, and only
 * then sends the reminder email.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 2 * DAY_MS;

const baseInput: TrialPaymentReminderWorkflowInput = {
  tenantId: 'tenant-1',
  stripeSubscriptionId: 'sub_trial',
  tenantName: 'Acme MSP',
  companyName: 'Acme MSP',
};

interface ReminderCalls {
  resolve: any[];
  verifyAtMs: number[];
  verifyInputs: any[];
  send: any[];
}

async function setupReminderTest(options: {
  trialEndIso: string | null;
  verifications: VerifyTrialReminderActivityResult[];
}) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `test-trial-reminder-${Date.now()}`;
  const calls: ReminderCalls = { resolve: [], verifyAtMs: [], verifyInputs: [], send: [] };
  let verificationIndex = 0;

  const activities = {
    resolveTrialEndFromStripe: async (input: any) => {
      calls.resolve.push(input);
      return { trialEndIso: options.trialEndIso };
    },
    verifyTenantBillableForTrialReminder: async (input: any) => {
      calls.verifyInputs.push(input);
      calls.verifyAtMs.push(await env.currentTimeMs());
      const verification = options.verifications[Math.min(verificationIndex, options.verifications.length - 1)];
      verificationIndex += 1;
      return verification;
    },
    sendTrialPaymentReminderEmail: async (input: any) => {
      calls.send.push(input);
      return { emailSent: true, messageId: 'msg-1' };
    },
  };

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: path.resolve(__dirname, '../trial-payment-reminder-workflow.ts'),
    activities,
  });

  return { env, worker, taskQueue, calls };
}

async function runReminder(options: {
  trialEndIso: string | null;
  verifications: VerifyTrialReminderActivityResult[];
  input?: Partial<TrialPaymentReminderWorkflowInput>;
}) {
  const { env, worker, taskQueue, calls } = await setupReminderTest(options);
  try {
    const result = await worker.runUntil(
      env.client.workflow.execute(trialPaymentReminderWorkflow, {
        args: [{ ...baseInput, ...options.input }],
        taskQueue,
        workflowId: `trial-reminder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
    );
    return { result, calls, env };
  } finally {
    await env.teardown();
  }
}

async function trialEndInDays(days: number): Promise<string> {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    return new Date((await env.currentTimeMs()) + days * DAY_MS).toISOString();
  } finally {
    await env.teardown();
  }
}

describe('trialPaymentReminderWorkflow', () => {
  it('sends the reminder two days before the trial ends', async () => {
    const trialEndIso = await trialEndInDays(15);
    const { result, calls } = await runReminder({
      trialEndIso,
      verifications: [{ sendable: true, currentTrialEndIso: trialEndIso }],
    });

    expect(result.emailSent).toBe(true);
    expect(result.messageId).toBe('msg-1');
    expect(result.trialEnd).toBe(trialEndIso);
    expect(calls.resolve[0]).toEqual({ stripeSubscriptionId: 'sub_trial' });
    expect(calls.verifyInputs[0]).toEqual({ tenantId: 'tenant-1', stripeSubscriptionId: 'sub_trial' });
    expect(calls.send).toHaveLength(1);
    expect(calls.send[0]).toMatchObject({
      tenantId: 'tenant-1',
      tenantName: 'Acme MSP',
      trialEndIso,
    });

    // The verification (and therefore the email) happens at trial end minus two days.
    const expectedFireMs = Date.parse(trialEndIso) - TWO_DAYS_MS;
    expect(Math.abs(calls.verifyAtMs[0] - expectedFireMs)).toBeLessThan(60_000);
  });

  it('skips when the subscription has no trial', async () => {
    const { result, calls } = await runReminder({ trialEndIso: null, verifications: [] });

    expect(result).toEqual({ emailSent: false, skipped: 'no_trial' });
    expect(calls.verifyInputs).toHaveLength(0);
    expect(calls.send).toHaveLength(0);
  });

  it('skips when the trial has already ended', async () => {
    const trialEndIso = await trialEndInDays(-1);
    const { result, calls } = await runReminder({
      trialEndIso,
      verifications: [{ sendable: true, currentTrialEndIso: trialEndIso }],
    });

    expect(result.emailSent).toBe(false);
    expect(result.skipped).toBe('trial_already_ended');
    expect(calls.send).toHaveLength(0);
  });

  it('skips when the subscription was cancelled', async () => {
    const trialEndIso = await trialEndInDays(15);
    const { result, calls } = await runReminder({
      trialEndIso,
      verifications: [{ sendable: false, reason: 'subscription_cancelled' }],
    });

    expect(result.emailSent).toBe(false);
    expect(result.skipped).toBe('subscription_cancelled');
    expect(calls.send).toHaveLength(0);
  });

  it('skips when a cancellation is already scheduled', async () => {
    const trialEndIso = await trialEndInDays(15);
    const { result, calls } = await runReminder({
      trialEndIso,
      verifications: [{ sendable: false, reason: 'cancellation_scheduled' }],
    });

    expect(result.emailSent).toBe(false);
    expect(result.skipped).toBe('cancellation_scheduled');
    expect(calls.send).toHaveLength(0);
  });

  it('skips when the tenant has been suspended', async () => {
    const trialEndIso = await trialEndInDays(15);
    const { result, calls } = await runReminder({
      trialEndIso,
      verifications: [{ sendable: false, reason: 'tenant_suspended' }],
    });

    expect(result.emailSent).toBe(false);
    expect(result.skipped).toBe('tenant_suspended');
    expect(calls.send).toHaveLength(0);
  });

  it('re-sleeps and sends against the new date when the trial is extended', async () => {
    const trialEndIso = await trialEndInDays(15);
    const extendedTrialEndIso = new Date(Date.parse(trialEndIso) + 10 * DAY_MS).toISOString();

    const { result, calls } = await runReminder({
      trialEndIso,
      verifications: [
        { sendable: true, currentTrialEndIso: extendedTrialEndIso },
        { sendable: true, currentTrialEndIso: extendedTrialEndIso },
      ],
    });

    expect(result.emailSent).toBe(true);
    expect(result.trialEnd).toBe(extendedTrialEndIso);
    expect(calls.verifyInputs).toHaveLength(2);
    expect(calls.send).toHaveLength(1);
    expect(calls.send[0].trialEndIso).toBe(extendedTrialEndIso);

    const expectedFireMs = Date.parse(extendedTrialEndIso) - TWO_DAYS_MS;
    expect(Math.abs(calls.verifyAtMs[1] - expectedFireMs)).toBeLessThan(60_000);
  });
});

describe('tenantCreationWorkflow trial reminder scheduling', () => {
  const tenantCreationInput: TenantCreationInput = {
    tenantName: 'Acme MSP',
    adminUser: {
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'ada@acme.test',
    },
    companyName: 'Acme MSP',
    clientName: 'Acme MSP',
    productCode: 'psa',
    stripeCustomerId: 'cus_x',
    stripeSubscriptionId: 'sub_trial',
  };

  it('starts the reminder child for a stripe-billed hosted signup', async () => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    const taskQueue = `test-tenant-creation-reminder-${Date.now()}`;
    let resolveReminderStarted: (input: any) => void = () => {};
    const reminderStarted = new Promise<any>(resolve => {
      resolveReminderStarted = resolve;
    });

    const activities = {
      createTenant: async () => ({ tenantId: 'tenant-42', clientId: 'client-1' }),
      run_onboarding_seeds: async () => ({ success: true, seedsApplied: [] }),
      createAdminUser: async () => ({
        userId: 'user-1',
        roleId: 'role-1',
        temporaryPassword: 'generated-password',
      }),
      setupTenantData: async () => ({ setupSteps: [] }),
      sendWelcomeEmail: async () => ({ emailSent: true }),
      createCustomerClientActivity: async () => ({ customerId: 'customer-1' }),
      createCustomerContactActivity: async () => ({ contactId: 'contact-1' }),
      tagCustomerClientActivity: async () => ({ tagId: 'tag-1' }),
      getManagementTenantId: async () => ({ tenantId: 'nineminds-tenant' }),
      createPortalUser: async () => ({ userId: 'portal-user-1', roleId: 'portal-role-1' }),
      fetchStripeDetailsFromCheckout: async () => ({ stripeCustomerId: 'cus_x' }),
      rollbackTenant: async () => {},
      rollbackUser: async () => {},
      rollbackPortalUser: async () => {},
      deleteCustomerClientActivity: async () => {},
      deleteCustomerContactActivity: async () => {},
      resolveTrialEndFromStripe: async (input: any) => {
        resolveReminderStarted(input);
        return { trialEndIso: new Date((await env.currentTimeMs()) + 15 * DAY_MS).toISOString() };
      },
      verifyTenantBillableForTrialReminder: async () => ({ sendable: false, reason: 'tenant_missing' }),
      sendTrialPaymentReminderEmail: async () => ({ emailSent: true }),
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: path.resolve(__dirname, '../../test-utils/tenant-creation-with-reminder.workflows.ts'),
      activities,
    });

    try {
      const { result, reminderInput } = await worker.runUntil(async () => {
        const result = await env.client.workflow.execute(tenantCreationWorkflow, {
          args: [tenantCreationInput],
          taskQueue,
          workflowId: `tenant-creation-reminder-${Date.now()}`,
        });
        return { result, reminderInput: await reminderStarted };
      });

      expect(result.success).toBe(true);

      // The child outlives its parent (ABANDON) and carries the tenant's billing identity.
      const description = await env.client.workflow
        .getHandle('trial-payment-reminder-tenant-42')
        .describe();
      expect(description.type).toBe('trialPaymentReminderWorkflow');
      expect(reminderInput).toEqual({ stripeSubscriptionId: 'sub_trial' });
    } finally {
      await env.teardown();
    }
  });

  // Any signup that must NOT get a reminder: run tenant creation with the
  // reminder activities stubbed out and assert the child never existed.
  async function expectNoReminderChild(options: {
    tenantId: string;
    label: string;
    input: TenantCreationInput;
  }) {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    const taskQueue = `test-tenant-creation-${options.label}-${Date.now()}`;

    const activities = {
      createTenant: async () => ({ tenantId: options.tenantId, clientId: 'client-1' }),
      run_onboarding_seeds: async () => ({ success: true, seedsApplied: [] }),
      createAdminUser: async () => ({
        userId: 'user-1',
        roleId: 'role-1',
        temporaryPassword: 'generated-password',
      }),
      setupTenantData: async () => ({ setupSteps: [] }),
      sendWelcomeEmail: async () => ({ emailSent: true }),
      createCustomerClientActivity: async () => ({ customerId: 'customer-1' }),
      createCustomerContactActivity: async () => ({ contactId: 'contact-1' }),
      tagCustomerClientActivity: async () => ({ tagId: 'tag-1' }),
      getManagementTenantId: async () => ({ tenantId: 'nineminds-tenant' }),
      createPortalUser: async () => ({ userId: 'portal-user-1', roleId: 'portal-role-1' }),
      fetchStripeDetailsFromCheckout: async () => ({ stripeCustomerId: 'cus_x' }),
      rollbackTenant: async () => {},
      rollbackUser: async () => {},
      rollbackPortalUser: async () => {},
      deleteCustomerClientActivity: async () => {},
      deleteCustomerContactActivity: async () => {},
      resolveTrialEndFromStripe: async () => ({ trialEndIso: null }),
      verifyTenantBillableForTrialReminder: async () => ({ sendable: false }),
      sendTrialPaymentReminderEmail: async () => ({ emailSent: false }),
    };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: path.resolve(__dirname, '../../test-utils/tenant-creation-with-reminder.workflows.ts'),
      activities,
    });

    try {
      const result = await worker.runUntil(
        env.client.workflow.execute(tenantCreationWorkflow, {
          args: [options.input],
          taskQueue,
          workflowId: `tenant-creation-${options.label}-${Date.now()}`,
        })
      );

      expect(result.success).toBe(true);
      await expect(
        env.client.workflow.getHandle(`trial-payment-reminder-${options.tenantId}`).describe()
      ).rejects.toThrow();
    } finally {
      await env.teardown();
    }
  }

  it('does not start the reminder when the signup is not stripe-billed', async () => {
    await expectNoReminderChild({
      tenantId: 'tenant-43',
      label: 'no-reminder',
      input: { ...tenantCreationInput, billingSource: 'apple_iap' },
    });
  });

  // AlgaDesk is sold without a trial: scheduling a reminder would burn a child
  // workflow and a Stripe call per signup only to skip with 'no_trial'.
  it('does not start the reminder for an algadesk signup', async () => {
    await expectNoReminderChild({
      tenantId: 'tenant-44',
      label: 'algadesk-no-reminder',
      input: { ...tenantCreationInput, productCode: 'algadesk' },
    });
  });
});
