import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveTrialEndFromStripe,
  sendTrialPaymentReminderEmail,
  verifyTenantBillableForTrialReminder,
  type TrialReminderLog,
} from '../trial-payment-reminder-activities.js';

const log: TrialReminderLog = { info: () => {}, warn: () => {} };

const TRIAL_END_SECONDS = Math.floor(Date.parse('2026-03-14T12:00:00.000Z') / 1000);

function subscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_trial',
    status: 'trialing',
    trial_end: TRIAL_END_SECONDS,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function stripeStub(live: Stripe.Subscription) {
  return { subscriptions: { retrieve: vi.fn(async () => live) } };
}

describe('resolveTrialEndFromStripe', () => {
  it('returns the trial end as an ISO timestamp', async () => {
    const result = await resolveTrialEndFromStripe(
      { stripeSubscriptionId: 'sub_trial' },
      { log, stripe: stripeStub(subscription()) }
    );

    expect(result.trialEndIso).toBe('2026-03-14T12:00:00.000Z');
  });

  it('returns null when the subscription never had a trial', async () => {
    const result = await resolveTrialEndFromStripe(
      { stripeSubscriptionId: 'sub_trial' },
      { log, stripe: stripeStub(subscription({ trial_end: null })) }
    );

    expect(result.trialEndIso).toBeNull();
  });
});

describe('verifyTenantBillableForTrialReminder', () => {
  const input = { tenantId: 'tenant-1', stripeSubscriptionId: 'sub_trial' };

  function deps(overrides: Record<string, unknown> = {}) {
    return {
      log,
      loadTenantRow: async () => ({ tenant: 'tenant-1', suspended_at: null }),
      loadSubscriptionRow: async () => ({ status: 'trialing', canceled_at: null }),
      stripe: stripeStub(subscription()),
      ...overrides,
    };
  }

  it('is sendable while the subscription is trialing with no cancellation', async () => {
    const result = await verifyTenantBillableForTrialReminder(input, deps());

    expect(result).toEqual({ sendable: true, currentTrialEndIso: '2026-03-14T12:00:00.000Z' });
  });

  it('refuses when the tenant row is gone', async () => {
    const result = await verifyTenantBillableForTrialReminder(
      input,
      deps({ loadTenantRow: async () => null })
    );

    expect(result).toEqual({ sendable: false, reason: 'tenant_missing' });
  });

  it('refuses when the tenant is suspended', async () => {
    const result = await verifyTenantBillableForTrialReminder(
      input,
      deps({ loadTenantRow: async () => ({ suspended_at: new Date('2026-03-01T00:00:00.000Z') }) })
    );

    expect(result).toEqual({ sendable: false, reason: 'tenant_suspended' });
  });

  it('refuses on a locally cancelled subscription without calling Stripe', async () => {
    const stripe = stripeStub(subscription());
    const result = await verifyTenantBillableForTrialReminder(
      input,
      deps({ loadSubscriptionRow: async () => ({ status: 'canceled', canceled_at: null }), stripe })
    );

    expect(result).toEqual({ sendable: false, reason: 'subscription_cancelled' });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it('refuses when Stripe reports a non-billable status', async () => {
    const result = await verifyTenantBillableForTrialReminder(
      input,
      deps({ stripe: stripeStub(subscription({ status: 'canceled' })) })
    );

    expect(result).toEqual({ sendable: false, reason: 'subscription_cancelled' });
  });

  it('refuses when a cancellation is scheduled for the end of the period', async () => {
    const result = await verifyTenantBillableForTrialReminder(
      input,
      deps({ stripe: stripeStub(subscription({ cancel_at_period_end: true })) })
    );

    expect(result).toEqual({ sendable: false, reason: 'cancellation_scheduled' });
  });

  it('falls back to Stripe when there is no local subscription row', async () => {
    const result = await verifyTenantBillableForTrialReminder(
      input,
      deps({ loadSubscriptionRow: async () => null })
    );

    expect(result.sendable).toBe(true);
  });
});

describe('sendTrialPaymentReminderEmail', () => {
  const input = {
    tenantId: 'tenant-1',
    tenantName: 'Acme MSP',
    trialEndIso: '2026-03-14T12:00:00.000Z',
  };

  it('resolves the current admin at send time and tags the email type', async () => {
    const sendEmail = vi.fn(async () => ({ messageId: 'msg-1' }));

    const result = await sendTrialPaymentReminderEmail(input, {
      log,
      loadTenantRow: async () => ({ client_name: 'Acme MSP' }),
      loadAdminUser: async () => ({
        user_id: 'user-1',
        email: 'ada@acme.test',
        first_name: 'Ada',
        last_name: 'Admin',
      }),
      validateEmail: () => true,
      sendEmail,
    });

    expect(result).toEqual({ emailSent: true, messageId: 'msg-1' });
    const params = sendEmail.mock.calls[0][0] as any;
    expect(params.to).toBe('ada@acme.test');
    expect(params.subject).toContain('March 14, 2026');
    expect(params.metadata).toMatchObject({
      tenantId: 'tenant-1',
      userId: 'user-1',
      emailType: 'trial_payment_reminder',
    });
    expect(params.html).toContain('Hello Ada Admin,');
    expect(params.text).toContain('March 14, 2026');
  });

  it('does not send when the tenant has no active admin user', async () => {
    const sendEmail = vi.fn(async () => ({ messageId: 'msg-1' }));

    const result = await sendTrialPaymentReminderEmail(input, {
      log,
      loadTenantRow: async () => ({ client_name: 'Acme MSP' }),
      loadAdminUser: async () => undefined,
      validateEmail: () => true,
      sendEmail,
    });

    expect(result.emailSent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
