import type { EmulatorCore, HostEnv } from '@alga-psa/emulator-host';

/** Stripe-shaped error the wire shell serializes. */
export class StripeWireError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errorType: 'invalid_request_error' | 'authentication_error' | 'api_error' | 'card_error' = 'invalid_request_error',
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'StripeWireError';
  }

  toEnvelope(): { error: { type: string; code?: string; message: string } } {
    return {
      error: {
        type: this.errorType,
        ...(this.code ? { code: this.code } : {}),
        message: this.message,
      },
    };
  }
}

export interface StripeEmulatorConfig {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
  webhookTargets: string[];
  hostedBaseUrl: string | null;
}

export interface StripeCustomer {
  id: string;
  object: 'customer';
  email: string;
  name: string;
  metadata: Record<string, string>;
  created: number;
  livemode: false;
  deleted?: boolean;
  [key: string]: unknown;
}

export interface StripeLineItemInput {
  price_data?: {
    currency?: string;
    unit_amount?: number;
    product_data?: { name?: string; description?: string };
  };
  quantity?: number;
  [key: string]: unknown;
}

export interface StripeCheckoutSession {
  id: string;
  object: 'checkout.session';
  mode: 'payment';
  customer: string;
  line_items: Array<{ price: { currency: string; unit_amount: number; product: { name: string } }; quantity: number }>;
  amount_total: number;
  currency: string;
  success_url: string;
  cancel_url: string;
  expires_at: number;
  payment_intent: string;
  url: string;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'unpaid' | 'paid';
  metadata: Record<string, string>;
  created: number;
  livemode: false;
  [key: string]: unknown;
}

export interface StripePaymentIntent {
  id: string;
  object: 'payment_intent';
  amount: number;
  currency: string;
  status: 'requires_payment_method' | 'requires_action' | 'processing' | 'succeeded' | 'canceled';
  customer: string;
  metadata: Record<string, string>;
  payment_method: string | null;
  created: number;
  last_payment_error?: { type: string; code: string; message: string };
  [key: string]: unknown;
}

export interface StripeEvent {
  id: string;
  object: 'event';
  type: string;
  created: number;
  livemode: false;
  pending_webhooks: number;
  data: { object: StripeCheckoutSession | StripePaymentIntent };
  [key: string]: unknown;
}

export interface WebhookDelivery {
  eventId: string;
  eventType: string;
  target: string;
  attempt: number;
  status: number;
  response: string;
  deliveredAt: string;
}

export interface OperationFault {
  operation: string;
  status: number;
  code: string;
  message: string;
  remaining: number;
}

export interface StripeList<T> {
  object: 'list';
  url: string;
  has_more: false;
  data: T[];
}

const DEFAULT_SECRET_KEY = 'sk_test_algasim';
const DEFAULT_WEBHOOK_SECRET = 'whsec_algasim';
const DEFAULT_PUBLISHABLE_KEY = 'pk_test_algasim';

/**
 * Deterministic Stripe-shaped state machine. No I/O, no wall time
 * (`env.clock`), no `Math.random()` (`env.rng`). The wire shell adapts these
 * operations to Stripe's HTTP surface; the notifier performs webhook I/O.
 */
export class StripeEmulatorCore implements EmulatorCore {
  readonly env: HostEnv;

  secretKey = DEFAULT_SECRET_KEY;
  webhookSecret = DEFAULT_WEBHOOK_SECRET;
  publishableKey = DEFAULT_PUBLISHABLE_KEY;
  webhookTargets: string[] = [];
  hostedBaseUrl: string | null = null;

  readonly customers = new Map<string, StripeCustomer>();
  readonly sessions = new Map<string, StripeCheckoutSession>();
  readonly paymentIntents = new Map<string, StripePaymentIntent>();
  readonly events = new Map<string, StripeEvent>();
  readonly deliveries: WebhookDelivery[] = [];
  readonly operationFaults = new Map<string, OperationFault>();

  private idCounter = 0;

  constructor(env: HostEnv) {
    this.env = env;
  }

  reset(): void {
    this.customers.clear();
    this.sessions.clear();
    this.paymentIntents.clear();
    this.events.clear();
    this.deliveries.length = 0;
    this.operationFaults.clear();
    this.secretKey = DEFAULT_SECRET_KEY;
    this.webhookSecret = DEFAULT_WEBHOOK_SECRET;
    this.publishableKey = DEFAULT_PUBLISHABLE_KEY;
    this.webhookTargets = [];
    this.hostedBaseUrl = null;
    this.idCounter = 0;
  }

  config(): StripeEmulatorConfig {
    return {
      secretKey: this.secretKey,
      webhookSecret: this.webhookSecret,
      publishableKey: this.publishableKey,
      webhookTargets: [...this.webhookTargets],
      hostedBaseUrl: this.hostedBaseUrl,
    };
  }

  configure(config: Partial<StripeEmulatorConfig>): StripeEmulatorConfig {
    if (config.secretKey !== undefined) this.secretKey = config.secretKey;
    if (config.webhookSecret !== undefined) this.webhookSecret = config.webhookSecret;
    if (config.publishableKey !== undefined) this.publishableKey = config.publishableKey;
    if (config.webhookTargets !== undefined) this.webhookTargets = [...config.webhookTargets];
    if (config.hostedBaseUrl !== undefined) this.hostedBaseUrl = config.hostedBaseUrl;
    return this.config();
  }

  private newId(prefix: string): string {
    this.idCounter += 1;
    const entropy = Math.floor(this.env.rng() * 0xffffffff).toString(16).padStart(8, '0');
    return `${prefix}_${this.idCounter.toString(36)}${entropy}`;
  }

  private nowUnix(): number {
    return Math.floor(this.env.clock.now().getTime() / 1000);
  }

  /** Validate a Bearer token against the configured test secret key. */
  authenticate(authorization: string): void {
    const bearer = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!bearer || bearer !== this.secretKey) {
      throw new StripeWireError(401, 'Invalid API Key provided', 'authentication_error');
    }
  }

  // ── Customers ─────────────────────────────────────────────────────────────

  listCustomers(email?: string): StripeList<StripeCustomer> {
    const data = [...this.customers.values()].filter(
      (customer) => !email || customer.email === email,
    );
    return { object: 'list', url: '/v1/customers', has_more: false, data };
  }

  createCustomer(input: { email: string; name?: string; metadata?: Record<string, string> }): StripeCustomer {
    const id = this.newId('cus');
    const customer: StripeCustomer = {
      id,
      object: 'customer',
      email: input.email,
      name: input.name ?? '',
      metadata: input.metadata ?? {},
      created: this.nowUnix(),
      livemode: false,
    };
    this.customers.set(id, customer);
    return customer;
  }

  getCustomer(id: string): StripeCustomer {
    const customer = this.customers.get(id);
    if (!customer) {
      throw new StripeWireError(404, `No such customer: ${id}`);
    }
    return customer;
  }

  // ── Checkout sessions ─────────────────────────────────────────────────────

  createCheckoutSession(
    input: {
      mode: 'payment';
      customer?: string;
      line_items: StripeLineItemInput[];
      success_url: string;
      cancel_url?: string;
      metadata: Record<string, string>;
      expires_at?: number;
      currency?: string;
      amount?: number;
    },
    hostedBaseUrl: string,
  ): StripeCheckoutSession {
    const sessionId = this.newId('cs');
    const paymentIntentId = this.newId('pi');

    const firstItem = input.line_items[0] ?? {};
    const currency = (input.currency ?? firstItem.price_data?.currency ?? 'usd').toLowerCase();
    const unitAmount = input.amount ?? firstItem.price_data?.unit_amount ?? 0;
    const quantity = Number(firstItem.quantity ?? 1);
    const amountTotal = Math.round(unitAmount * quantity);
    const productName = firstItem.price_data?.product_data?.name ?? 'Invoice payment';

    const defaultExpiry = this.nowUnix() + 24 * 60 * 60;
    const expiresAt = input.expires_at ?? defaultExpiry;

    const paymentIntent: StripePaymentIntent = {
      id: paymentIntentId,
      object: 'payment_intent',
      amount: amountTotal,
      currency,
      status: 'requires_payment_method',
      customer: input.customer ?? '',
      metadata: { ...input.metadata },
      payment_method: null,
      created: this.nowUnix(),
    };
    this.paymentIntents.set(paymentIntentId, paymentIntent);

    const session: StripeCheckoutSession = {
      id: sessionId,
      object: 'checkout.session',
      mode: 'payment',
      customer: input.customer ?? '',
      line_items: [
        {
          price: { currency, unit_amount: unitAmount, product: { name: productName } },
          quantity,
        },
      ],
      amount_total: amountTotal,
      currency,
      success_url: input.success_url,
      cancel_url: input.cancel_url ?? '',
      expires_at: expiresAt,
      payment_intent: paymentIntentId,
      url: `${hostedBaseUrl}/checkout/sessions/${sessionId}`,
      status: 'open',
      payment_status: 'unpaid',
      metadata: { ...input.metadata },
      created: this.nowUnix(),
      livemode: false,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  getCheckoutSession(id: string): StripeCheckoutSession {
    const session = this.sessions.get(id);
    if (!session) {
      throw new StripeWireError(404, `No such checkout session: ${id}`);
    }
    return session;
  }

  /** Complete a session and its payment intent; emits checkout.session.completed. */
  completeSession(sessionId: string): StripeEvent {
    const session = this.getCheckoutSession(sessionId);
    session.status = 'complete';
    session.payment_status = 'paid';

    const intent = this.paymentIntents.get(session.payment_intent);
    if (intent) {
      intent.status = 'succeeded';
      intent.payment_method = 'pm_simulated';
    }

    return this.emitEvent('checkout.session.completed', session);
  }

  /** Record a failed attempt; emits payment_intent.payment_failed. */
  failSession(sessionId: string): StripeEvent {
    const session = this.getCheckoutSession(sessionId);
    const intent = this.paymentIntents.get(session.payment_intent);
    if (intent) {
      intent.status = 'requires_payment_method';
      intent.last_payment_error = {
        type: 'card_error',
        code: 'card_declined',
        message: 'Your card was declined.',
      };
    }
    return this.emitEvent('payment_intent.payment_failed', intent ?? {
      id: session.payment_intent,
      object: 'payment_intent',
      amount: session.amount_total,
      currency: session.currency,
      status: 'requires_payment_method',
      customer: session.customer,
      metadata: session.metadata,
      payment_method: null,
      created: session.created,
      last_payment_error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' },
    });
  }

  /**
   * Checkout expiry (session open but past expires_at) without payment.
   * Emits checkout.session.expired and returns the event.
   */
  expireSession(sessionId: string): StripeEvent {
    const session = this.getCheckoutSession(sessionId);
    session.status = 'expired';
    const intent = this.paymentIntents.get(session.payment_intent);
    if (intent && intent.status === 'requires_payment_method') {
      intent.status = 'canceled';
    }
    return this.emitEvent('checkout.session.expired', session);
  }

  // ── Events & webhook deliveries ───────────────────────────────────────────

  emitEvent(type: string, object: StripeCheckoutSession | StripePaymentIntent): StripeEvent {
    const event: StripeEvent = {
      id: this.newId('evt'),
      object: 'event',
      type,
      created: this.nowUnix(),
      livemode: false,
      pending_webhooks: this.webhookTargets.length,
      data: { object },
    };
    this.events.set(event.id, event);
    return event;
  }

  listEvents(): StripeEvent[] {
    return [...this.events.values()];
  }

  recordDelivery(delivery: Omit<WebhookDelivery, 'deliveredAt'>): void {
    this.deliveries.push({
      ...delivery,
      deliveredAt: this.env.clock.now().toISOString(),
    });
  }

  // ── Operation faults ──────────────────────────────────────────────────────

  armOperationFault(fault: OperationFault): void {
    this.operationFaults.set(fault.operation, { ...fault });
  }

  disarmOperationFaults(): void {
    this.operationFaults.clear();
  }

  operationFaultList(): OperationFault[] {
    return [...this.operationFaults.values()];
  }

  /** Returns and consumes a fault for an operation, or null when none armed. */
  consumeOperationFault(operation: string): OperationFault | null {
    const fault = this.operationFaults.get(operation);
    if (!fault) return null;
    fault.remaining -= 1;
    if (fault.remaining <= 0) {
      this.operationFaults.delete(operation);
    }
    return { ...fault, remaining: fault.remaining };
  }
}
