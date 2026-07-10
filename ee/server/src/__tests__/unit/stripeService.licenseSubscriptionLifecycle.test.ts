import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeService } from '../../lib/stripe/StripeService';

const getConnectionMock = vi.hoisted(() => vi.fn());
const startTenantDeletionWorkflowMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/db', () => ({
  getConnection: getConnectionMock,
}));

vi.mock('@ee/lib/tenant-management/workflowClient', () => ({
  startTenantDeletionWorkflow: startTenantDeletionWorkflowMock,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where('tenant', tenant),
  }),
}));

const TENANT = 'tenant-1';

type Call = { method: string; args: any[] };

interface FakeDbState {
  rows: Record<string, Record<string, any>[]>;
  updates: Array<{ table: string; calls: Call[]; values: Record<string, any> }>;
}

function applyFilters(rows: Record<string, any>[], calls: Call[]) {
  let out = [...rows];
  for (const call of calls) {
    const [first, second] = call.args;
    if (call.method === 'where' && typeof first === 'object') {
      out = out.filter((row) => Object.entries(first).every(([key, value]) => row[key] === value));
    } else if (call.method === 'where' && typeof first === 'string' && call.args.length === 2) {
      out = out.filter((row) => row[first] === second);
    } else if (call.method === 'whereNot' && typeof first === 'string' && call.args.length === 2) {
      out = out.filter((row) => row[first] !== second);
    } else if (call.method === 'whereIn') {
      out = out.filter((row) => (second as any[]).includes(row[first]));
    } else if (call.method === 'whereRaw' && String(first).includes('addon_key')) {
      out = out.filter((row) => !row.metadata?.addon_key);
    } else if (call.method === 'orderByRaw' && String(first).includes("'active'")) {
      out = [...out].sort(
        (a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1),
      );
    }
  }
  return out;
}

function createFakeKnex(state: FakeDbState) {
  const knex: any = (table: string) => {
    const calls: Call[] = [];
    const builder: any = {};
    for (const method of ['where', 'whereNot', 'whereIn', 'whereRaw', 'orderByRaw', 'orderBy', 'select']) {
      builder[method] = (...args: any[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    builder.first = async (..._columns: any[]) =>
      applyFilters(state.rows[table] ?? [], calls)[0] ?? null;
    builder.update = async (values: Record<string, any>) => {
      state.updates.push({ table, calls, values });
      return 1;
    };
    return builder;
  };

  knex.fn = {
    now: () => new Date('2026-07-10T00:00:00.000Z'),
  };

  return knex;
}

function trialSubscription(overrides: Record<string, any> = {}) {
  return {
    tenant: TENANT,
    stripe_subscription_id: 'dbsub_trial',
    stripe_subscription_external_id: 'sub_ext_trial',
    stripe_subscription_item_id: 'si_trial',
    stripe_customer_id: 'cust_db_1',
    status: 'trialing',
    quantity: 1,
    stripe_base_item_id: null,
    metadata: {},
    ...overrides,
  };
}

function activeSubscription(overrides: Record<string, any> = {}) {
  return {
    tenant: TENANT,
    stripe_subscription_id: 'dbsub_active',
    stripe_subscription_external_id: 'sub_ext_active',
    stripe_subscription_item_id: 'si_active',
    stripe_customer_id: 'cust_db_1',
    status: 'active',
    quantity: 2,
    stripe_base_item_id: null,
    metadata: {},
    ...overrides,
  };
}

function createService(state: FakeDbState) {
  const knex = createFakeKnex(state);
  const service = new StripeService() as any;

  service.initPromise = Promise.resolve();
  service.config = {
    soloBasePriceId: 'price_solo_month',
    soloBaseAnnualPriceId: 'price_solo_year',
    proPriceId: 'price_pro_seat',
    proAnnualPriceId: 'price_pro_seat_year',
    premiumBasePriceId: 'price_premium_base',
    premiumUserPriceId: 'price_premium_user',
    premiumBaseAnnualPriceId: 'price_premium_base_year',
    premiumUserAnnualPriceId: 'price_premium_user_year',
    aiAddOnPriceId: 'price_ai_addon',
    aiAddOnAnnualPriceId: 'price_ai_addon_year',
    teamsAddOnPriceId: 'price_teams_addon',
    teamsAddOnAnnualPriceId: 'price_teams_addon_year',
    enterpriseAddOnPriceId: 'price_enterprise_addon',
    enterpriseAddOnAnnualPriceId: 'price_enterprise_addon_year',
    earlyAdoptersBasePriceId: null,
    earlyAdoptersUserPriceId: null,
    earlyAdoptersBaseAnnualPriceId: null,
    earlyAdoptersUserAnnualPriceId: null,
  };
  service.stripe = {
    subscriptions: {
      update: vi.fn().mockResolvedValue({ id: 'sub_ext_updated', status: 'active' }),
    },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ id: 'cs_test_1', client_secret: 'cs_secret_1' }),
      },
    },
  };
  service.getOrImportCustomer = vi.fn().mockResolvedValue({
    stripe_customer_id: 'cust_db_1',
    stripe_customer_external_id: 'cus_ext_1',
  });

  getConnectionMock.mockResolvedValue(knex);

  return { service, knex };
}

function createState(subscriptions: Record<string, any>[]): FakeDbState {
  return {
    rows: {
      tenants: [{ tenant: TENANT, plan: 'pro', billing_source: 'stripe' }],
      stripe_subscriptions: subscriptions,
    },
    updates: [],
  };
}

describe('StripeService license subscription lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startTenantDeletionWorkflowMock.mockResolvedValue({ available: true, workflowId: 'wf-1' });
  });

  describe('updateOrCreateLicenseSubscription', () => {
    it('increases a trialing subscription in place with no charge', async () => {
      const state = createState([trialSubscription()]);
      const { service } = createService(state);

      const result = await service.updateOrCreateLicenseSubscription(TENANT, 3);

      expect(result).toEqual(
        expect.objectContaining({ type: 'updated', scheduledChange: false }),
      );

      expect(service.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
      const [subscriptionId, params] = service.stripe.subscriptions.update.mock.calls[0];
      expect(subscriptionId).toBe('sub_ext_trial');
      expect(params.items).toEqual([{ id: 'si_trial', quantity: 3 }]);
      expect(params.proration_behavior).toBe('none');
      expect(params.payment_behavior).toBeUndefined();

      expect(service.stripe.checkout.sessions.create).not.toHaveBeenCalled();

      const subscriptionUpdate = state.updates.find((u) => u.table === 'stripe_subscriptions');
      expect(subscriptionUpdate?.values.quantity).toBe(3);
      const tenantUpdate = state.updates.find((u) => u.table === 'tenants');
      expect(tenantUpdate?.values.licensed_user_count).toBe(3);
    });

    it('charges immediately when increasing an active subscription', async () => {
      const state = createState([activeSubscription()]);
      const { service } = createService(state);

      const result = await service.updateOrCreateLicenseSubscription(TENANT, 3);

      expect(result).toEqual(
        expect.objectContaining({ type: 'updated', scheduledChange: false }),
      );

      expect(service.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
      const [subscriptionId, params] = service.stripe.subscriptions.update.mock.calls[0];
      expect(subscriptionId).toBe('sub_ext_active');
      expect(params.proration_behavior).toBe('always_invoice');
      expect(params.payment_behavior).toBe('error_if_incomplete');
      expect(service.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('prefers the active subscription when a leftover trial row exists', async () => {
      const state = createState([trialSubscription(), activeSubscription()]);
      const { service } = createService(state);

      await service.updateOrCreateLicenseSubscription(TENANT, 3);

      expect(service.stripe.subscriptions.update).toHaveBeenCalledTimes(1);
      expect(service.stripe.subscriptions.update.mock.calls[0][0]).toBe('sub_ext_active');
    });

    it('ignores add-on subscriptions when looking for the license subscription', async () => {
      const state = createState([
        activeSubscription({
          stripe_subscription_id: 'dbsub_addon',
          stripe_subscription_external_id: 'sub_ext_addon',
          stripe_subscription_item_id: 'si_addon',
          metadata: { addon_key: 'ai_assistant' },
        }),
      ]);
      const { service } = createService(state);

      const result = await service.updateOrCreateLicenseSubscription(TENANT, 3);

      // No license subscription found: falls through to a new checkout session
      expect(result.type).toBe('checkout');
      expect(service.stripe.subscriptions.update).not.toHaveBeenCalled();
      expect(service.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleSubscriptionUpdated', () => {
    function subscriptionUpdatedEvent(overrides: Record<string, any> = {}) {
      return {
        data: {
          object: {
            id: 'sub_ext_trial',
            status: 'trialing',
            metadata: {},
            items: {
              data: [
                {
                  id: 'si_trial',
                  quantity: 1,
                  price: { id: 'price_pro_seat', recurring: { interval: 'month' }, product: 'prod_1' },
                },
              ],
            },
            current_period_start: 1780000000,
            current_period_end: 1781000000,
            cancel_at: 1781000000,
            canceled_at: null,
            trial_end: 1781000000,
            ...overrides,
          },
        },
      };
    }

    function prepareUpdateHandler(service: any) {
      service.stripe.prices = {
        retrieve: vi.fn().mockResolvedValue({
          id: 'price_pro_seat',
          recurring: { interval: 'month' },
          product: { name: 'alga-psa-pro' },
        }),
      };
      service.ensureStripePriceRecord = vi.fn().mockResolvedValue(null);
    }

    it('does not clobber licensed_user_count from a non-canonical trialing subscription', async () => {
      const state = createState([trialSubscription(), activeSubscription()]);
      const { service, knex } = createService(state);
      prepareUpdateHandler(service);

      await service.handleSubscriptionUpdated(subscriptionUpdatedEvent(), TENANT, knex);

      // The trial sub's own row is still synced
      const subscriptionUpdate = state.updates.find((u) => u.table === 'stripe_subscriptions');
      expect(subscriptionUpdate?.values.quantity).toBe(1);

      // ...but the tenant seat count is not driven by the non-canonical trial sub
      expect(state.updates.find((u) => u.table === 'tenants')).toBeUndefined();
    });

    it('syncs licensed_user_count from the canonical subscription', async () => {
      const state = createState([trialSubscription(), activeSubscription()]);
      const { service, knex } = createService(state);
      prepareUpdateHandler(service);

      await service.handleSubscriptionUpdated(
        subscriptionUpdatedEvent({
          id: 'sub_ext_active',
          status: 'active',
          items: {
            data: [
              {
                id: 'si_active',
                quantity: 3,
                price: { id: 'price_pro_seat', recurring: { interval: 'month' }, product: 'prod_1' },
              },
            ],
          },
          cancel_at: null,
          trial_end: null,
        }),
        TENANT,
        knex,
      );

      const tenantUpdate = state.updates.find((u) => u.table === 'tenants');
      expect(tenantUpdate?.values.licensed_user_count).toBe(3);
    });

    it('syncs licensed_user_count normally for a tenant with a single trialing subscription', async () => {
      const state = createState([trialSubscription()]);
      const { service, knex } = createService(state);
      prepareUpdateHandler(service);

      await service.handleSubscriptionUpdated(subscriptionUpdatedEvent(), TENANT, knex);

      const tenantUpdate = state.updates.find((u) => u.table === 'tenants');
      expect(tenantUpdate?.values.licensed_user_count).toBe(1);
    });
  });

  describe('handleSubscriptionDeleted', () => {
    const deletionEvent = {
      data: {
        object: {
          id: 'sub_ext_trial',
          status: 'canceled',
          metadata: {},
        },
      },
    };

    it('skips the tenant deletion workflow when another license subscription survives', async () => {
      const state = createState([trialSubscription(), activeSubscription()]);
      const { service, knex } = createService(state);

      await service.handleSubscriptionDeleted(deletionEvent, TENANT, knex);

      const cancelUpdate = state.updates.find((u) => u.table === 'stripe_subscriptions');
      expect(cancelUpdate?.values.status).toBe('canceled');
      expect(startTenantDeletionWorkflowMock).not.toHaveBeenCalled();
    });

    it('starts the tenant deletion workflow when only add-on subscriptions survive', async () => {
      const state = createState([
        trialSubscription(),
        activeSubscription({
          stripe_subscription_id: 'dbsub_addon',
          stripe_subscription_external_id: 'sub_ext_addon',
          metadata: { addon_key: 'ai_assistant' },
        }),
      ]);
      const { service, knex } = createService(state);

      await service.handleSubscriptionDeleted(deletionEvent, TENANT, knex);

      expect(startTenantDeletionWorkflowMock).toHaveBeenCalledTimes(1);
    });

    it('starts the tenant deletion workflow when no live subscription remains', async () => {
      const state = createState([trialSubscription()]);
      const { service, knex } = createService(state);

      await service.handleSubscriptionDeleted(deletionEvent, TENANT, knex);

      expect(startTenantDeletionWorkflowMock).toHaveBeenCalledTimes(1);
      expect(startTenantDeletionWorkflowMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          triggerSource: 'stripe_webhook',
          subscriptionExternalId: 'sub_ext_trial',
        }),
      );
    });
  });
});
