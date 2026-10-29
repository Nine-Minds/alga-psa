import { z } from 'zod';
import type { ControlRegistry } from '@alga-psa/emulator-host';
import { ControlError } from '@alga-psa/emulator-host';
import type { StripeEmulatorConfig, StripeEmulatorCore } from './core';
import { deliverEvent } from './notifier';

/**
 * Masks a credential for control-plane responses. The raw value stays internal
 * to the core (auth checks, webhook signing); only masked forms round-trip.
 */
function redactCredential(value: string): string {
  if (!value) return '';
  return value.length <= 8 ? '••••' : `${value.slice(0, 5)}…${value.slice(-4)}`;
}

/** Control-plane view of the configuration with credentials masked. */
function redactedConfig(config: StripeEmulatorConfig) {
  return {
    ...config,
    secretKey: redactCredential(config.secretKey),
    webhookSecret: redactCredential(config.webhookSecret),
  };
}

export function register(reg: ControlRegistry, core: StripeEmulatorCore): void {
  reg.action({
    name: 'redeliver-event',
    description: 'Redeliver an existing event with the same ID and payload and a fresh webhook signature',
    params: z.object({ eventId: z.string() }),
    run: async ({ eventId }) => {
      const event = core.events.get(eventId);
      if (!event) throw new ControlError(404, 'Unknown Stripe event');
      await deliverEvent(core, event, core.env);
      return { eventId: event.id, eventType: event.type };
    },
  });

  reg.seeder({
    name: 'config',
    description: 'Configure test credentials, webhook targets, and the public hosted checkout base URL',
    params: z.object({
      secretKey: z.string().optional(),
      webhookSecret: z.string().optional(),
      publishableKey: z.string().optional(),
      webhookTarget: z.string().optional(),
      hostedBaseUrl: z.string().optional(),
    }),
    run: ({ secretKey, webhookSecret, publishableKey, webhookTarget, hostedBaseUrl }) => {
      if (webhookTarget !== undefined) {
        const targets = core.webhookTargets;
        if (!targets.includes(webhookTarget)) targets.push(webhookTarget);
      }
      return redactedConfig(
        core.configure({
          secretKey,
          webhookSecret,
          publishableKey,
          hostedBaseUrl: hostedBaseUrl ?? null,
        })
      );
    },
  });

  reg.seeder({
    name: 'customer',
    description: 'Create a Stripe customer directly (deterministic test setup)',
    params: z.object({
      email: z.string().email(),
      name: z.string().optional(),
      id: z.string().optional(),
    }),
    run: ({ email, name, id }) => core.createCustomer({ id, email, name }),
  });

  reg.seeder({
    name: 'price',
    description: 'Create a recurring or one-time price for subscription checkout (deterministic test setup)',
    params: z.object({
      id: z.string().optional(),
      unitAmount: z.number().int().nonnegative(),
      currency: z.string().optional(),
      interval: z.enum(['month', 'year']).optional(),
      product: z.string().optional(),
    }),
    run: ({ id, unitAmount, currency, interval, product }) => core.createPrice({ id, unitAmount, currency, interval, product }),
  });

  reg.seeder({
    name: 'subscription',
    description: 'Create a subscription directly for a customer (deterministic test setup)',
    params: z.object({
      customer: z.string(),
      priceId: z.string(),
      quantity: z.number().int().positive().default(1),
      metadata: z.record(z.string()).optional(),
      status: z.enum(['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired']).optional(),
      cancelAtPeriodEnd: z.boolean().optional(),
    }),
    run: ({ customer, priceId, quantity, metadata, status, cancelAtPeriodEnd }) =>
      core.createSubscription({ customer, priceId, quantity, metadata, status, cancelAtPeriodEnd }),
  });

  reg.action({
    name: 'complete-session',
    description: 'Mark a Checkout session paid, emit checkout.session.completed, and deliver the signed webhook',
    params: z.object({ sessionId: z.string() }),
    run: async ({ sessionId }) => {
      const event = core.completeSession(sessionId);
      await deliverEvent(core, event, core.env);
      return { eventId: event.id, eventType: event.type, sessionId };
    },
  });

  reg.action({
    name: 'fail-session',
    description: 'Record a failed attempt, emit payment_intent.payment_failed, and deliver the signed webhook',
    params: z.object({ sessionId: z.string() }),
    run: async ({ sessionId }) => {
      const event = core.failSession(sessionId);
      await deliverEvent(core, event, core.env);
      return { eventId: event.id, eventType: event.type, sessionId };
    },
  });

  reg.action({
    name: 'expire-session',
    description: 'Expire an open Checkout session, emit checkout.session.expired, and deliver the signed webhook',
    params: z.object({ sessionId: z.string() }),
    run: async ({ sessionId }) => {
      const event = core.expireSession(sessionId);
      await deliverEvent(core, event, core.env);
      return { eventId: event.id, eventType: event.type, sessionId };
    },
  });

  reg.fault({
    name: 'operation-fault',
    description:
      'Fail a specific operation ("customers.list", "customers.create", "customers.retrieve", "checkout.sessions.create", "checkout.sessions.retrieve", "checkout.sessions.expire") with a Stripe error envelope, optionally only N times',
    params: z.object({
      operation: z.enum([
        'customers.list',
        'customers.create',
        'customers.retrieve',
        'checkout.sessions.create',
        'checkout.sessions.retrieve',
        'checkout.sessions.expire',
      ]),
      status: z.number().int().min(400).max(599).default(500),
      code: z.string().default('api_error'),
      message: z.string().default('Simulated Stripe operation failure'),
      remaining: z.number().int().positive().optional(),
    }),
    arm: ({ operation, status, code, message, remaining }) => {
      core.armOperationFault({
        operation,
        status: status ?? 500,
        code,
        message,
        remaining: remaining ?? 1,
      });
    },
    disarm: () => core.disarmOperationFaults(),
  });

  reg.stateView({
    name: 'config',
    description: 'Test credentials (masked), webhook targets, and hosted base URL',
    get: () => redactedConfig(core.config()),
  });

  reg.stateView({
    name: 'customers',
    description: 'Stripe customers',
    get: () => [...core.customers.values()],
  });

  reg.stateView({
    name: 'checkout-sessions',
    description: 'Checkout sessions (including payment intent ids and URLs)',
    get: () => [...core.sessions.values()],
  });

  reg.stateView({
    name: 'payment-intents',
    description: 'Payment intents',
    get: () => [...core.paymentIntents.values()],
  });

  reg.stateView({
    name: 'prices',
    description: 'Prices',
    get: () => [...core.prices.values()],
  });

  reg.stateView({
    name: 'subscriptions',
    description: 'Subscriptions',
    get: () => [...core.subscriptions.values()],
  });

  reg.stateView({
    name: 'events',
    description: 'Emitted Stripe events',
    get: () => core.listEvents(),
  });

  reg.stateView({
    name: 'webhook-deliveries',
    description: 'Webhook delivery records (event, target, attempt, status, response)',
    get: () => core.deliveries,
  });

  reg.stateView({
    name: 'operation-faults',
    description: 'Armed operation faults',
    get: () => core.operationFaultList(),
  });
}
