import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { tenantCreationWorkflow } from '../tenant-creation-workflow.js';
import type { TenantCreationInput } from '../../types/workflow-types.js';

/**
 * Which Stripe checkout details reach createTenant. Recorded fake activities
 * capture the createTenant input and whether the fetch ran.
 */

type AnyInput = Record<string, any>;

const baseInput: TenantCreationInput = {
  tenantName: 'CloudVBS',
  adminUser: { firstName: 'Lynda', lastName: 'Contact', email: 'lynda@cloudvbs.test' },
  companyName: 'CloudVBS',
  clientName: 'CloudVBS',
  productCode: 'psa',
};

const fetchedAddress = { line1: '1 Main St', city: 'Seattle', postalCode: '98101', countryCode: 'US' };
const suppliedAddress = { line1: '9 Caller Rd', city: 'Portland', postalCode: '97201', countryCode: 'US' };

const fetchedDetails = {
  stripeCustomerId: 'cus_fetched',
  stripeSubscriptionId: 'sub_fetched',
  stripePriceId: 'price_fetched',
  licenseCount: 7,
  billingAddress: fetchedAddress,
};

async function run(
  inputOverrides: Partial<TenantCreationInput>,
  fetchImpl: (input: AnyInput) => Promise<any> = async () => fetchedDetails,
) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = `test-stripe-merge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fetchCalls: AnyInput[] = [];
  const createTenantCalls: AnyInput[] = [];

  const activities = {
    fetchStripeDetailsFromCheckout: async (input: AnyInput) => {
      fetchCalls.push(input);
      return fetchImpl(input);
    },
    createTenant: async (input: AnyInput) => {
      createTenantCalls.push(input);
      return { tenantId: input.tenantId ?? 'generated-tenant-id', clientId: 'tenant-client-1' };
    },
    run_onboarding_seeds: async () => ({ success: true, seedsApplied: [] }),
    createAdminUser: async () => ({ userId: 'user-1', roleId: 'role-1', temporaryPassword: 'pw' }),
    setupTenantData: async () => ({ setupSteps: [] }),
    sendWelcomeEmail: async () => ({ emailSent: true }),
    createCustomerClientActivity: async () => ({ customerId: 'customer-1', reused: false }),
    createCustomerContactActivity: async () => ({ contactId: 'contact-1', reused: false }),
    tagCustomerClientActivity: async () => ({ tagId: 'tag-1' }),
    getManagementTenantId: async () => ({ tenantId: 'nineminds-tenant' }),
    createPortalUser: async () => ({ userId: 'portal-1', roleId: 'portal-role-1', status: 'created' }),
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

  try {
    const result = await worker.runUntil(
      env.client.workflow.execute(tenantCreationWorkflow, {
        args: [{ ...baseInput, ...inputOverrides }],
        taskQueue,
        workflowId: `wf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      }),
    );
    return { result, fetchCalls, createTenantCalls };
  } finally {
    await env.teardown();
  }
}

describe('tenant creation: Stripe checkout detail merge', () => {
  it('T001: fetches and passes the address when the caller sent a customer ID but no address', async () => {
    const { result, fetchCalls, createTenantCalls } = await run({
      checkoutSessionId: 'cs_1',
      stripeCustomerId: 'cus_supplied',
    });

    expect(result.success).toBe(true);
    expect(fetchCalls).toEqual([{ checkoutSessionId: 'cs_1' }]);
    expect(createTenantCalls[0].billingAddress).toEqual(fetchedAddress);
  });

  it('T002: caller-supplied Stripe IDs win over fetched ones; fetched fills the gaps', async () => {
    const { createTenantCalls } = await run({
      checkoutSessionId: 'cs_1',
      stripeCustomerId: 'cus_supplied',
      stripeSubscriptionId: 'sub_supplied',
      stripePriceId: 'price_supplied',
    });

    expect(createTenantCalls[0]).toMatchObject({
      stripeCustomerId: 'cus_supplied',
      stripeSubscriptionId: 'sub_supplied',
      stripePriceId: 'price_supplied',
      licenseCount: 7,
      billingAddress: fetchedAddress,
    });
  });

  it('T003: does not fetch when the caller supplied both customer ID and address', async () => {
    const { result, fetchCalls, createTenantCalls } = await run({
      checkoutSessionId: 'cs_1',
      stripeCustomerId: 'cus_supplied',
      billingAddress: suppliedAddress,
    });

    expect(result.success).toBe(true);
    expect(fetchCalls).toHaveLength(0);
    expect(createTenantCalls[0]).toMatchObject({
      stripeCustomerId: 'cus_supplied',
      billingAddress: suppliedAddress,
    });
  });

  it('T004: checkout session only still resolves IDs and address from the fetch', async () => {
    const { fetchCalls, createTenantCalls } = await run({ checkoutSessionId: 'cs_1' });

    expect(fetchCalls).toHaveLength(1);
    expect(createTenantCalls[0]).toMatchObject({
      stripeCustomerId: 'cus_fetched',
      stripeSubscriptionId: 'sub_fetched',
      stripePriceId: 'price_fetched',
      billingAddress: fetchedAddress,
    });
  });

  it('keeps a caller-supplied address when the customer ID is missing and the fetch returns another', async () => {
    const { createTenantCalls } = await run({
      checkoutSessionId: 'cs_1',
      billingAddress: suppliedAddress,
    });

    expect(createTenantCalls[0]).toMatchObject({
      stripeCustomerId: 'cus_fetched',
      billingAddress: suppliedAddress,
    });
  });

  it('T005: a failing fetch does not stop tenant creation', async () => {
    const { result, fetchCalls, createTenantCalls } = await run(
      { checkoutSessionId: 'cs_1', stripeCustomerId: 'cus_supplied' },
      async () => {
        throw new Error('Stripe unavailable');
      },
    );

    expect(result.success).toBe(true);
    expect(fetchCalls.length).toBeGreaterThan(0);
    expect(createTenantCalls).toHaveLength(1);
    expect(createTenantCalls[0].stripeCustomerId).toBe('cus_supplied');
    expect(createTenantCalls[0].billingAddress).toBeUndefined();
  });
});
