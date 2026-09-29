import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { tenantCreationWorkflow, getWorkflowStateQuery } from '../tenant-creation-workflow.js';
import type { TenantCreationInput } from '../../types/workflow-types.js';

/**
 * Workflow-level behavior for tenant onboarding into the management tenant.
 * Recorded fake activities stand in for the DB so we can assert the workflow's
 * decisions (reuse is success, portal outcome is threaded to the email) rather
 * than the persistence details, which are covered by the activity tests.
 */

type AnyInput = Record<string, any>;

interface HarnessOverrides {
  createCustomerClientActivity?: (input: AnyInput) => Promise<any>;
  createCustomerContactActivity?: (input: AnyInput) => Promise<any>;
  createPortalUser?: (input: AnyInput) => Promise<any>;
}

interface Harness {
  env: TestWorkflowEnvironment;
  worker: Worker;
  taskQueue: string;
  calls: {
    client: AnyInput[];
    contact: AnyInput[];
    tag: AnyInput[];
    portal: AnyInput[];
    welcomeEmail: AnyInput[];
    order: string[];
    roleGrants: AnyInput[];
  };
}

const baseInput: TenantCreationInput = {
  tenantName: 'CloudVBS',
  adminUser: {
    firstName: 'Lynda',
    lastName: 'Contact',
    email: 'lynda@cloudvbs.test',
  },
  companyName: 'CloudVBS',
  clientName: 'CloudVBS',
  productCode: 'psa',
};

// Temporal derives an activity failure's type from `error.constructor.name`, so
// these must be real named classes (matching the production error names) for
// the proxyActivities `nonRetryableErrorTypes` list to classify them and stop
// retrying. A plain `Error` with `.name` overridden would still retry.
class AmbiguousCustomerMatchError extends Error {}
class UnverifiedCustomerMatchError extends Error {}
class PortalUserIdentityMismatchError extends Error {}

async function setupWorkflowTest(overrides: HarnessOverrides = {}): Promise<Harness> {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `test-portal-access-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const calls: Harness['calls'] = {
    client: [],
    contact: [],
    tag: [],
    portal: [],
    welcomeEmail: [],
    order: [],
    roleGrants: [],
  };

  const activities = {
    createTenant: async (input: AnyInput) => ({
      tenantId: input.tenantId ?? 'generated-tenant-id',
      clientId: 'tenant-client-1',
    }),
    run_onboarding_seeds: async () => ({ success: true, seedsApplied: ['01_roles.cjs'] }),
    createAdminUser: async (input: AnyInput) => ({
      userId: 'user-1',
      roleId: 'role-1',
      temporaryPassword: input.password ?? 'generated-password',
    }),
    setupTenantData: async () => ({ setupSteps: ['tenant_settings'] }),
    sendWelcomeEmail: async (input: AnyInput) => {
      calls.welcomeEmail.push(input);
      return { emailSent: true };
    },
    createCustomerClientActivity: async (input: AnyInput) => {
      calls.client.push(input);
      calls.order.push('client');
      return overrides.createCustomerClientActivity
        ? overrides.createCustomerClientActivity(input)
        : { customerId: 'customer-1', reused: false };
    },
    createCustomerContactActivity: async (input: AnyInput) => {
      calls.contact.push(input);
      calls.order.push('contact');
      return overrides.createCustomerContactActivity
        ? overrides.createCustomerContactActivity(input)
        : { contactId: 'contact-1', reused: false };
    },
    tagCustomerClientActivity: async (input: AnyInput) => {
      calls.tag.push(input);
      calls.order.push('tag');
      return { tagId: 'tag-1' };
    },
    getManagementTenantId: async () => ({ tenantId: 'nineminds-tenant' }),
    createPortalUser: async (input: AnyInput) => {
      calls.portal.push(input);
      calls.order.push('portal');
      const result = overrides.createPortalUser
        ? await overrides.createPortalUser(input)
        : { userId: 'portal-1', roleId: 'portal-role-1', status: 'created' };
      // Provisioning a *new* portal account grants the client-admin role. Record
      // it so the refusal tests can assert the incident's concrete harm — an
      // Admin grant under someone else's client — did not happen.
      if (result.status === 'created') {
        calls.roleGrants.push({
          userId: result.userId,
          roleId: result.roleId,
          contactId: input.contactId,
          clientId: input.clientId,
        });
      }
      return result;
    },
    fetchStripeDetailsFromCheckout: async () => ({ stripeCustomerId: 'cus_x' }),
    rollbackTenant: async () => {},
    rollbackUser: async () => {},
    rollbackPortalUser: async () => {},
    deleteCustomerClientActivity: async () => {},
    deleteCustomerContactActivity: async () => {},
  };

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: path.resolve(__dirname, '../tenant-creation-workflow.ts'),
    activities,
  });

  return { env, worker, taskQueue, calls };
}

async function runWorkflow(
  harness: Harness,
  inputOverrides: Partial<TenantCreationInput> = {}
) {
  const handle = await harness.env.client.workflow.start(tenantCreationWorkflow, {
    args: [{ ...baseInput, ...inputOverrides }],
    taskQueue: harness.taskQueue,
    workflowId: `wf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
  // Keep the worker alive while we read the query: it stops as soon as
  // runUntil's callback resolves, and a stopped worker cannot serve queries.
  return await harness.worker.runUntil(async () => {
    const result = await handle.result();
    const state = await handle.query(getWorkflowStateQuery);
    return { result, state };
  });
}

describe('tenant onboarding portal access', () => {
  it('reuses an existing customer and contact, then provisions the portal', async () => {
    const harness = await setupWorkflowTest({
      createCustomerClientActivity: async () => ({ customerId: 'existing-client', reused: true }),
      createCustomerContactActivity: async () => ({ contactId: 'existing-contact', reused: true }),
      createPortalUser: async () => ({ userId: 'portal-new', roleId: 'portal-role', status: 'created' }),
    });
    try {
      const { result, state } = await runWorkflow(harness);

      expect(result.success).toBe(true);
      expect(harness.calls.order).toEqual(['client', 'contact', 'tag', 'portal']);
      // The resolved customer tenant id is threaded into the client lookup so
      // the association marker can bind the client to this onboarding.
      expect(harness.calls.client[0]).toMatchObject({ tenantId: 'generated-tenant-id' });
      expect(harness.calls.portal).toHaveLength(1);
      expect(harness.calls.portal[0]).toMatchObject({
        contactId: 'existing-contact',
        clientId: 'existing-client',
      });
      expect(harness.calls.welcomeEmail).toHaveLength(1);
      expect(harness.calls.welcomeEmail[0].portalStatus).toBe('created');
      expect(harness.calls.roleGrants).toHaveLength(1);
      expect(state.customerTracking).toMatchObject({
        clientReused: true,
        contactReused: true,
        portalStatus: 'created',
      });
    } finally {
      await harness.env.teardown();
    }
  });

  it('runs the new-customer happy path', async () => {
    const harness = await setupWorkflowTest();
    try {
      const { result, state } = await runWorkflow(harness);

      expect(result.success).toBe(true);
      expect(harness.calls.order).toEqual(['client', 'contact', 'tag', 'portal']);
      expect(harness.calls.welcomeEmail[0].portalStatus).toBe('created');
      expect(harness.calls.roleGrants).toHaveLength(1);
      expect(state.customerTracking).toMatchObject({
        clientReused: false,
        contactReused: false,
        portalStatus: 'created',
      });
    } finally {
      await harness.env.teardown();
    }
  });

  it('converges on rerun without duplicating the client or contact', async () => {
    const clientRecords: string[] = [];
    const contactRecords: string[] = [];
    const harness = await setupWorkflowTest({
      createCustomerClientActivity: async (input) => {
        if (clientRecords.length > 0) {
          return { customerId: clientRecords[0], reused: true };
        }
        clientRecords.push(`client-${input.tenantName}`);
        return { customerId: clientRecords[0], reused: false };
      },
      createCustomerContactActivity: async (input) => {
        if (contactRecords.length > 0) {
          return { contactId: contactRecords[0], reused: true };
        }
        contactRecords.push(`contact-${input.email}`);
        return { contactId: contactRecords[0], reused: false };
      },
    });
    try {
      // Both runs share one worker; runUntil stops the worker when it resolves,
      // so drive both workflows inside a single runUntil callback.
      const startRun = () =>
        harness.env.client.workflow.start(tenantCreationWorkflow, {
          args: [{ ...baseInput }],
          taskQueue: harness.taskQueue,
          workflowId: `wf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
      const { first, second } = await harness.worker.runUntil(async () => {
        const firstHandle = await startRun();
        const firstResult = await firstHandle.result();
        const firstState = await firstHandle.query(getWorkflowStateQuery);

        const secondHandle = await startRun();
        const secondResult = await secondHandle.result();
        const secondState = await secondHandle.query(getWorkflowStateQuery);

        return {
          first: { result: firstResult, state: firstState },
          second: { result: secondResult, state: secondState },
        };
      });

      expect(first.result.success).toBe(true);
      expect(second.result.success).toBe(true);
      expect(clientRecords).toHaveLength(1);
      expect(contactRecords).toHaveLength(1);
      expect(harness.calls.client[0]).toMatchObject({ tenantName: 'CloudVBS' });
      expect(harness.calls.client[1]).toMatchObject({ tenantName: 'CloudVBS' });
      expect(first.state.customerTracking?.clientReused).toBe(false);
      expect(second.state.customerTracking?.clientReused).toBe(true);
      expect(second.result.customerClientId).toBe(first.result.customerClientId);
    } finally {
      await harness.env.teardown();
    }
  });

  it('preserves an existing portal account and tells the truth in the email', async () => {
    const harness = await setupWorkflowTest({
      createPortalUser: async () => ({
        userId: 'portal-existing',
        roleId: 'portal-role-existing',
        status: 'existing',
      }),
    });
    try {
      const { result, state } = await runWorkflow(harness);

      expect(result.success).toBe(true);
      expect(harness.calls.welcomeEmail[0].portalStatus).toBe('existing');
      expect(state.customerTracking?.portalStatus).toBe('existing');
    } finally {
      await harness.env.teardown();
    }
  });

  it('skips the downstream chain and sends conservative email on an ambiguous client match', async () => {
    const harness = await setupWorkflowTest({
      createCustomerClientActivity: async () => {
        throw new AmbiguousCustomerMatchError(
          'Multiple clients named "CloudVBS" exist in the management tenant',
        );
      },
    });
    try {
      const { result, state } = await runWorkflow(harness);

      expect(result.success).toBe(true);
      // Non-retryable: the client activity ran exactly once.
      expect(harness.calls.client).toHaveLength(1);
      expect(harness.calls.contact).toHaveLength(0);
      expect(harness.calls.tag).toHaveLength(0);
      expect(harness.calls.portal).toHaveLength(0);
      expect(harness.calls.roleGrants).toHaveLength(0);
      expect(harness.calls.welcomeEmail[0].portalStatus).toBe('skipped');
      expect(state.customerTracking?.clientError).toContain('Multiple clients named');
      expect(state.customerTracking?.portalStatus).toBe('skipped');
    } finally {
      await harness.env.teardown();
    }
  });

  it('skips downstream customer tracking and sends conservative email when the client is unverified', async () => {
    // The Harbor Point regression at the workflow level: an exact-name client
    // with no trusted association is refused, so no contact, portal user, or
    // role grant is created and the email must not promise portal access.
    const harness = await setupWorkflowTest({
      createCustomerClientActivity: async () => {
        throw new UnverifiedCustomerMatchError(
          'A client named "Harbor Point IT" already exists in the management tenant ' +
            '(harbor-client) but has no trusted association with the onboarding admin',
        );
      },
    });
    try {
      const { result, state } = await runWorkflow(harness);

      expect(result.success).toBe(true);
      // Refusal is non-retryable and non-fatal: one attempt, nothing downstream.
      expect(harness.calls.client).toHaveLength(1);
      expect(harness.calls.contact).toHaveLength(0);
      expect(harness.calls.tag).toHaveLength(0);
      expect(harness.calls.portal).toHaveLength(0);
      expect(harness.calls.roleGrants).toHaveLength(0);
      expect(harness.calls.welcomeEmail[0].portalStatus).toBe('skipped');
      expect(state.customerTracking?.clientError).toContain('no trusted association');
      expect(state.customerTracking?.portalStatus).toBe('skipped');
    } finally {
      await harness.env.teardown();
    }
  });

  it('keeps tenant creation successful when a portal account identity mismatches', async () => {
    const harness = await setupWorkflowTest({
      createPortalUser: async () => {
        throw new PortalUserIdentityMismatchError(
          'A client-portal account already exists but is linked to a different contact; ' +
            'refusing to reuse an unrelated portal account.',
        );
      },
    });
    try {
      const { result, state } = await runWorkflow(harness);

      expect(result.success).toBe(true);
      // Non-retryable: the portal activity ran exactly once.
      expect(harness.calls.order).toEqual(['client', 'contact', 'tag', 'portal']);
      expect(harness.calls.portal).toHaveLength(1);
      expect(harness.calls.roleGrants).toHaveLength(0);
      expect(harness.calls.welcomeEmail[0].portalStatus).toBe('failed');
      expect(state.customerTracking?.portalStatus).toBe('failed');
      expect(state.customerTracking?.portalError).toContain('unrelated portal account');
    } finally {
      await harness.env.teardown();
    }
  });

  it('keeps tenant creation successful when the portal fails, and never claims portal access', async () => {
    const harness = await setupWorkflowTest({
      createPortalUser: async () => {
        throw new Error('Nine Minds portal unavailable');
      },
    });
    try {
      const { result, state } = await runWorkflow(harness);

      expect(result.success).toBe(true);
      expect(harness.calls.portal.length).toBeGreaterThan(0);
      expect(harness.calls.welcomeEmail[0].portalStatus).toBe('failed');
      expect(state.customerTracking?.portalStatus).toBe('failed');
      expect(state.customerTracking?.portalError).toBe('Nine Minds portal unavailable');
    } finally {
      await harness.env.teardown();
    }
  });
});
