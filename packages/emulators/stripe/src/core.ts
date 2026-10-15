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
  price?: string;
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
  mode: 'payment' | 'subscription';
  customer: string;
  line_items: Array<{ price: { currency: string; unit_amount: number; product: { name: string } }; quantity: number }>;
  amount_total: number;
  currency: string;
  success_url: string;
  cancel_url: string;
  expires_at: number;
  /** Null until confirmation, mirroring Stripe apiVersion 2024-12-18.acacia. */
  payment_intent: string | null;
  /** Subscription created on completion for a subscription-mode session. */
  subscription?: string | null;
  ui_mode?: string;
  return_url?: string;
  client_secret?: string;
  url: string;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'unpaid' | 'paid' | 'no_payment_required';
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

export interface StripePrice {
  id: string;
  object: 'price';
  unit_amount: number;
  currency: string;
  recurring: { interval: 'month' | 'year'; interval_count: number; usage_type: 'licensed' } | null;
  product: string;
  active: boolean;
  livemode: false;
  [key: string]: unknown;
}

export interface StripeSubscriptionItem {
  id: string;
  object: 'subscription_item';
  price: StripePrice;
  quantity: number;
}

export interface StripeSubscription {
  id: string;
  object: 'subscription';
  customer: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired';
  items: { object: 'list'; data: StripeSubscriptionItem[] };
  metadata: Record<string, string>;
  cancel_at_period_end: boolean;
  current_period_end: number;
  created: number;
  started_at: number;
  /** Expanded on retrieve; a paid invoice so a co-managed subscription verifies as active. */
  latest_invoice?: StripeInvoice;
  ended_at?: number | null;
  livemode: false;
  [key: string]: unknown;
}

export interface StripeInvoice {
  id: string;
  object: 'invoice';
  customer: string;
  subscription: string | null;
  amount_due: number;
  currency: string;
  status: 'draft' | 'open' | 'paid';
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
  readonly prices = new Map<string, StripePrice>();
  readonly subscriptions = new Map<string, StripeSubscription>();
  readonly events = new Map<string, StripeEvent>();
  /** Subscription-mode checkout inputs retained until completion creates the subscription. */
  private readonly checkoutSubscriptions = new Map<string, { priceId: string; quantity: number }>();
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
    this.prices.clear();
    this.subscriptions.clear();
    this.events.clear();
    this.checkoutSubscriptions.clear();
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

  createCustomer(input: { id?: string; email: string; name?: string; metadata?: Record<string, string> }): StripeCustomer {
    const id = input.id ?? this.newId('cus');
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

  // ── Prices ────────────────────────────────────────────────────────────────

  listPrices(): StripeList<StripePrice> {
    return { object: 'list', url: '/v1/prices', has_more: false, data: [...this.prices.values()] };
  }

  createPrice(input: { id?: string; unitAmount: number; currency?: string; interval?: 'month' | 'year'; product?: string }): StripePrice {
    const id = input.id ?? this.newId('price');
    const price: StripePrice = {
      id,
      object: 'price',
      unit_amount: Math.round(input.unitAmount),
      currency: (input.currency ?? 'usd').toLowerCase(),
      recurring: input.interval ? { interval: input.interval, interval_count: 1, usage_type: 'licensed' } : null,
      product: input.product ?? this.newId('prod'),
      active: true,
      livemode: false,
    };
    this.prices.set(id, price);
    return price;
  }

  getPrice(id: string): StripePrice {
    const price = this.prices.get(id);
    if (!price) throw new StripeWireError(404, `No such price: ${id}`);
    return price;
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  listSubscriptions(customer?: string, status?: string): StripeList<StripeSubscription> {
    const data = [...this.subscriptions.values()].filter((subscription) => {
      if (customer && subscription.customer !== customer) return false;
      if (status && status !== 'all' && subscription.status !== status) return false;
      return true;
    });
    return { object: 'list', url: '/v1/subscriptions', has_more: false, data };
  }

  getSubscription(id: string): StripeSubscription {
    const subscription = this.subscriptions.get(id);
    if (!subscription) throw new StripeWireError(404, `No such subscription: ${id}`);
    return subscription;
  }

  createSubscription(input: {
    customer: string; priceId: string; quantity: number; metadata?: Record<string, string>;
    status?: StripeSubscription['status']; cancelAtPeriodEnd?: boolean;
  }): StripeSubscription {
    const price = this.getPrice(input.priceId);
    const now = this.nowUnix();
    const periodEnd = price.recurring?.interval === 'year' ? now + 365 * 24 * 60 * 60 : now + 30 * 24 * 60 * 60;
    const subscription: StripeSubscription = {
      id: this.newId('sub'),
      object: 'subscription',
      customer: input.customer,
      status: input.status ?? 'active',
      items: { object: 'list', data: [{ id: this.newId('si'), object: 'subscription_item', price, quantity: input.quantity }] },
      metadata: { ...(input.metadata ?? {}) },
      cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
      current_period_end: periodEnd,
      created: now,
      started_at: now,
      latest_invoice: { id: this.newId('in'), object: 'invoice', customer: input.customer, subscription: null,
        amount_due: 0, currency: 'usd', status: 'paid' },
      livemode: false,
    };
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  updateSubscription(id: string, input: {
    itemId?: string; quantity?: number; cancelAtPeriodEnd?: boolean; metadata?: Record<string, string>;
  }): StripeSubscription {
    const subscription = this.getSubscription(id);
    const item = subscription.items.data[0];
    if (!item) throw new StripeWireError(400, `Subscription ${id} has no items.`);
    if (input.quantity !== undefined) item.quantity = input.quantity;
    if (input.cancelAtPeriodEnd !== undefined) subscription.cancel_at_period_end = input.cancelAtPeriodEnd;
    if (input.metadata !== undefined) subscription.metadata = { ...subscription.metadata, ...input.metadata };
    return subscription;
  }

  cancelSubscription(id: string): StripeSubscription {
    const subscription = this.getSubscription(id);
    subscription.status = 'canceled';
    return subscription;
  }

  /** Proration preview: the difference between the current and requested item quantity. */
  createInvoicePreview(input: { customer: string; subscription?: string; quantity?: number; cancelAt?: number }): StripeInvoice {
    let amountDue = 0;
    let currency = 'usd';
    if (input.subscription) {
      const subscription = this.getSubscription(input.subscription);
      const item = subscription.items.data[0];
      if (item) {
        currency = item.price.currency;
        if (!input.cancelAt && input.quantity !== undefined) {
          amountDue = Math.max(0, (input.quantity - item.quantity) * item.price.unit_amount);
        }
      }
    }
    return { id: this.newId('in'), object: 'invoice', customer: input.customer, subscription: input.subscription ?? null,
      amount_due: Math.round(amountDue), currency, status: 'draft' };
  }

  // ── Checkout sessions ─────────────────────────────────────────────────────

  createCheckoutSession(
    input: {
      mode: 'payment' | 'subscription';
      customer?: string;
      line_items: StripeLineItemInput[];
      success_url?: string;
      cancel_url?: string;
      return_url?: string;
      ui_mode?: string;
      metadata: Record<string, string>;
      subscription_data?: { metadata?: Record<string, string> };
      expires_at?: number;
      currency?: string;
      amount?: number;
    },
    hostedBaseUrl: string,
  ): StripeCheckoutSession {
    const sessionId = this.newId('cs');

    const firstItem = input.line_items[0] ?? {};
    const subscriptionPrice = input.mode === 'subscription' && firstItem.price ? this.getPrice(String(firstItem.price)) : null;
    const currency = (subscriptionPrice?.currency ?? input.currency ?? firstItem.price_data?.currency ?? 'usd').toLowerCase();
    const unitAmount = subscriptionPrice?.unit_amount ?? input.amount ?? firstItem.price_data?.unit_amount ?? 0;
    const quantity = Number(firstItem.quantity ?? 1);
    const amountTotal = Math.round(unitAmount * quantity);
    const productName = subscriptionPrice?.product ?? firstItem.price_data?.product_data?.name ?? 'Invoice payment';

    const defaultExpiry = this.nowUnix() + 24 * 60 * 60;
    const expiresAt = input.expires_at ?? defaultExpiry;

    const session: StripeCheckoutSession = {
      id: sessionId,
      object: 'checkout.session',
      mode: input.mode,
      customer: input.customer ?? '',
      line_items: [
        {
          price: { currency, unit_amount: unitAmount, product: { name: productName } },
          quantity,
        },
      ],
      amount_total: amountTotal,
      currency,
      success_url: input.success_url ?? input.return_url ?? '',
      cancel_url: input.cancel_url ?? '',
      expires_at: expiresAt,
      // Mirrors Stripe apiVersion 2024-12-18.acacia: payment-mode Checkout
      // Sessions defer PaymentIntent creation until confirmation, so an open
      // session carries no payment_intent yet.
      payment_intent: null,
      subscription: null,
      ui_mode: input.ui_mode,
      return_url: input.return_url,
      client_secret: `${sessionId}_secret_${this.newId('cs')}`,
      url: `${hostedBaseUrl}/checkout/sessions/${sessionId}`,
      status: 'open',
      payment_status: input.mode === 'subscription' ? 'no_payment_required' : 'unpaid',
      metadata: { ...input.metadata, ...(input.subscription_data?.metadata ?? {}) },
      created: this.nowUnix(),
      livemode: false,
    };
    if (subscriptionPrice) this.checkoutSubscriptions.set(sessionId, { priceId: subscriptionPrice.id, quantity });
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

  listCheckoutSessions(customer?: string): StripeList<StripeCheckoutSession> {
    const data = [...this.sessions.values()].filter((session) => !customer || session.customer === customer);
    return { object: 'list', url: '/v1/checkout/sessions', has_more: false, data };
  }

  /**
   * Creates the PaymentIntent for a session on first confirmation, mirroring
   * 2024-12-18.acacia: Checkout Sessions defer PI creation until the customer
   * submits the payment form.
   */
  private ensurePaymentIntent(session: StripeCheckoutSession): StripePaymentIntent {
    if (session.payment_intent) {
      const existing = this.paymentIntents.get(session.payment_intent);
      if (existing) return existing;
    }

    const intentId = this.newId('pi');
    const intent: StripePaymentIntent = {
      id: intentId,
      object: 'payment_intent',
      amount: session.amount_total,
      currency: session.currency,
      status: 'requires_payment_method',
      customer: session.customer,
      metadata: { ...session.metadata },
      payment_method: null,
      created: this.nowUnix(),
    };
    this.paymentIntents.set(intentId, intent);
    session.payment_intent = intentId;
    return intent;
  }

  /** Complete a session and its payment intent; emits checkout.session.completed. */
  completeSession(sessionId: string): StripeEvent {
    const session = this.getCheckoutSession(sessionId);
    if (session.status === 'expired') {
      // Stripe rejects completion of an expired Checkout Session; an expired
      // session must never become payable again.
      throw new StripeWireError(400, 'This Checkout Session has expired and cannot be completed.');
    }
    session.status = 'complete';
    session.payment_status = session.mode === 'subscription' ? 'no_payment_required' : 'paid';

    if (session.mode === 'subscription') {
      // Subscription-mode Checkout creates the subscription on completion and
      // stamps the session's metadata (including subscription_data metadata).
      const input = this.checkoutSubscriptions.get(sessionId);
      if (input && !session.subscription) {
        const subscription = this.createSubscription({
          customer: session.customer,
          priceId: input.priceId,
          quantity: input.quantity,
          metadata: { ...session.metadata },
        });
        session.subscription = subscription.id;
      }
    } else {
      const intent = this.ensurePaymentIntent(session);
      intent.status = 'succeeded';
      intent.payment_method = 'pm_simulated';
    }

    return this.emitEvent('checkout.session.completed', session);
  }

  /** Record a failed attempt; emits payment_intent.payment_failed. */
  failSession(sessionId: string): StripeEvent {
    const session = this.getCheckoutSession(sessionId);
    if (session.status !== 'open') {
      throw new StripeWireError(400, 'This Checkout Session is no longer open.');
    }
    const intent = this.ensurePaymentIntent(session);
    intent.status = 'requires_payment_method';
    intent.last_payment_error = {
      type: 'card_error',
      code: 'card_declined',
      message: 'Your card was declined.',
    };
    return this.emitEvent('payment_intent.payment_failed', intent);
  }

  /**
   * Checkout expiry (session open but past expires_at) without payment.
   * Emits checkout.session.expired and returns the event. A completed session
   * cannot be expired; an already-expired session is idempotent.
   */
  expireSession(sessionId: string): StripeEvent {
    const session = this.getCheckoutSession(sessionId);
    if (session.status === 'complete') {
      throw new StripeWireError(400, 'A completed Checkout Session cannot be expired.');
    }
    if (session.status === 'open') {
      session.status = 'expired';
      if (session.payment_intent) {
        const intent = this.paymentIntents.get(session.payment_intent);
        if (intent && intent.status === 'requires_payment_method') {
          intent.status = 'canceled';
        }
      }
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
      // Snapshot v1 event data at emission. Retries must retain the original
      // state even when the live PaymentIntent or Checkout Session changes.
      data: { object: structuredClone(object) },
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
