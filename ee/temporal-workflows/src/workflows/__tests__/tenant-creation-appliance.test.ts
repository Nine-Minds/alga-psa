import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { tenantCreationWorkflow } from '../tenant-creation-workflow.js';
import type { TenantCreationInput } from '../../types/workflow-types.js';

/**
 * Appliance-mode contract for tenantCreationWorkflow: the appliance bootstrap
 * (server/scripts/appliance-create-tenant.mjs) starts this workflow with a
 * pre-minted tenant id, a pre-set admin password, and the hosted-only steps
 * (customer tracking in the nineminds tenant, welcome email) skipped.
 */

interface RecordedCalls {
  createTenant: any[];
  createAdminUser: any[];
  setupTenantData: any[];
  customerTracking: number;
  welcomeEmail: number;
}

async function setupWorkflowTest() {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `test-tenant-creation-${Date.now()}`;
  const calls: RecordedCalls = {
    createTenant: [],
    createAdminUser: [],
    setupTenantData: [],
    customerTracking: 0,
    welcomeEmail: 0,
  };

  const activities = {
    createTenant: async (input: any) => {
      calls.createTenant.push(input);
      return { tenantId: input.tenantId ?? 'generated-tenant-id', clientId: 'client-1' };
    },
    run_onboarding_seeds: async () => ({ success: true, seedsApplied: ['01_roles.cjs'] }),
    createAdminUser: async (input: any) => {
      calls.createAdminUser.push(input);
      return {
        userId: 'user-1',
        roleId: 'role-1',
        temporaryPassword: input.password ?? 'generated-password',
      };
    },
    setupTenantData: async (input: any) => {
      calls.setupTenantData.push(input);
      return { setupSteps: ['tenant_settings'] };
    },
    sendWelcomeEmail: async () => {
      calls.welcomeEmail += 1;
      return { emailSent: true };
    },
    createCustomerClientActivity: async () => {
      calls.customerTracking += 1;
      return { customerId: 'customer-1' };
    },
    createCustomerContactActivity: async () => {
      calls.customerTracking += 1;
      return { contactId: 'contact-1' };
    },
    tagCustomerClientActivity: async () => {
      calls.customerTracking += 1;
      return { tagId: 'tag-1' };
    },
    getManagementTenantId: async () => ({ tenantId: 'nineminds-tenant' }),
    createPortalUser: async () => ({ userId: 'portal-user-1', roleId: 'portal-role-1' }),
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

const baseInput: TenantCreationInput = {
  tenantName: 'Acme MSP',
  adminUser: {
    firstName: 'Ada',
    lastName: 'Admin',
    email: 'ada@acme.test',
  },
  companyName: 'Acme MSP',
  clientName: 'Acme MSP',
  productCode: 'psa',
};

describe('tenantCreationWorkflow appliance mode', () => {
  it('adopts the pre-minted tenant id, uses the supplied password, and skips hosted-only steps', async () => {
    const { env, worker, taskQueue, calls } = await setupWorkflowTest();
    try {
      const result = await worker.runUntil(
        env.client.workflow.execute(tenantCreationWorkflow, {
          args: [
            {
              ...baseInput,
              tenantId: 'pre-minted-tenant-id',
              adminUser: { ...baseInput.adminUser, password: 'operator-chosen-password' },
              billingSource: 'manual',
              emailProvider: 'smtp',
              skipCustomerTracking: true,
              skipWelcomeEmail: true,
            },
          ],
          taskQueue,
          workflowId: `appliance-${Date.now()}`,
        })
      );

      expect(result.success).toBe(true);
      expect(result.tenantId).toBe('pre-minted-tenant-id');
      expect(calls.createTenant[0].tenantId).toBe('pre-minted-tenant-id');
      expect(calls.createAdminUser[0].password).toBe('operator-chosen-password');
      expect(calls.setupTenantData[0].emailProvider).toBe('smtp');
      expect(calls.customerTracking).toBe(0);
      expect(calls.welcomeEmail).toBe(0);
      expect(result.emailSent).toBe(false);
    } finally {
      await env.teardown();
    }
  });

  it('keeps the hosted flow unchanged when the appliance fields are omitted', async () => {
    const { env, worker, taskQueue, calls } = await setupWorkflowTest();
    try {
      const result = await worker.runUntil(
        env.client.workflow.execute(tenantCreationWorkflow, {
          args: [baseInput],
          taskQueue,
          workflowId: `hosted-${Date.now()}`,
        })
      );

      expect(result.success).toBe(true);
      expect(result.tenantId).toBe('generated-tenant-id');
      expect(calls.createTenant[0].tenantId).toBeUndefined();
      expect(calls.createAdminUser[0].password).toBeUndefined();
      expect(calls.setupTenantData[0].emailProvider).toBeUndefined();
      expect(calls.customerTracking).toBe(3);
      expect(calls.welcomeEmail).toBe(1);
      expect(result.emailSent).toBe(true);
    } finally {
      await env.teardown();
    }
  });
});
