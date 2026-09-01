import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { route } from '@alga-psa/emulator-host';
import type { HostEnv } from '@alga-psa/emulator-host';
import { StripeWireError } from './core';
import type { StripeEmulatorCore, StripeCheckoutSession, StripeEvent } from './core';
import { deliverEvent } from './notifier';

const OPERATIONS = [
  'customers.list',
  'customers.create',
  'customers.retrieve',
  'checkout.sessions.create',
  'checkout.sessions.retrieve',
] as const;

const KNOWN_ERROR_TYPES = new Set([
  'invalid_request_error',
  'authentication_error',
  'api_error',
  'card_error',
]);

function checkFault(core: StripeEmulatorCore, operation: string): void {
  const fault = core.consumeOperationFault(operation);
  if (fault) {
    const errorType = KNOWN_ERROR_TYPES.has(fault.code)
      ? (fault.code as 'invalid_request_error' | 'authentication_error' | 'api_error' | 'card_error')
      : 'api_error';
    throw new StripeWireError(fault.status, fault.message, errorType, fault.code);
  }
}

function bearerAuth(core: StripeEmulatorCore): RequestHandler {
  return (req, _res, next) => {
    try {
      core.authenticate(String(req.headers.authorization ?? ''));
      next();
    } catch (error) {
      next(error);
    }
  };
}

function hostedBaseFromRequest(req: Request, core: StripeEmulatorCore): string {
  if (core.hostedBaseUrl) return core.hostedBaseUrl.replace(/\/$/, '');
  const host = req.get('host') || 'localhost';
  const protocol = req.protocol || 'http';
  return `${protocol}://${host}`;
}

function expandIncludes(expand: unknown, name: string): boolean {
  // Express 5's default "simple" query parser leaves `expand[]=` as the literal
  // key `expand[]`; normalize both forms.
  const raw = Array.isArray(expand) ? expand : expand ? [expand] : [];
  return raw.map(String).includes(name);
}

function sessionResponse(core: StripeEmulatorCore, session: StripeCheckoutSession, expand: unknown): StripeCheckoutSession {
  if (expandIncludes(expand, 'payment_intent') && session.payment_intent) {
    const intent = core.paymentIntents.get(session.payment_intent);
    return { ...session, payment_intent: intent ?? session.payment_intent } as StripeCheckoutSession;
  }
  return { ...session };
}

function formatMoney(cents: number, currency: string): string {
  return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
}

function hostedCheckoutPage(session: StripeCheckoutSession): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Simulated Stripe Checkout</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;text-align:center;">
  <h1>Simulated Stripe Checkout</h1>
  <p>Invoice total: <strong>${formatMoney(session.amount_total, session.currency)}</strong></p>
  <form method="POST" action="/checkout/sessions/${session.id}/pay" style="margin:16px 0;">
    <button type="submit" style="background:#635bff;color:#fff;border:0;padding:12px 28px;border-radius:6px;font-size:16px;cursor:pointer;">Pay</button>
  </form>
  <form method="POST" action="/checkout/sessions/${session.id}/decline" style="margin:8px 0;">
    <button type="submit" style="background:#eee;color:#333;border:1px solid #ccc;padding:10px 24px;border-radius:6px;font-size:14px;cursor:pointer;">Decline</button>
  </form>
  <form method="POST" action="/checkout/sessions/${session.id}/cancel" style="margin:8px 0;">
    <button type="submit" style="background:none;color:#666;border:0;text-decoration:underline;cursor:pointer;">Cancel</button>
  </form>
</body>
</html>`;
}

function hostedDeclinePage(session: StripeCheckoutSession, message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Payment declined</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;text-align:center;">
  <h1>Payment declined</h1>
  <p>${message}</p>
  <form method="POST" action="/checkout/sessions/${session.id}/pay" style="margin:16px 0;">
    <button type="submit" style="background:#635bff;color:#fff;border:0;padding:12px 28px;border-radius:6px;font-size:16px;cursor:pointer;">Try again</button>
  </form>
  <form method="POST" action="/checkout/sessions/${session.id}/cancel" style="margin:8px 0;">
    <button type="submit" style="background:none;color:#666;border:0;text-decoration:underline;cursor:pointer;">Cancel</button>
  </form>
</body>
</html>`;
}

/**
 * Stripe-shaped vendor surface: the /v1 API (customers + checkout sessions)
 * and the browser-facing simulated Checkout page with Pay / Decline / Cancel
 * controls. Point STRIPE_API_BASE_URL at the /v1 origin.
 */
export function wire(router: Router, core: StripeEmulatorCore, env: HostEnv): void {
  router.use(express.json());
  router.use(express.urlencoded({ extended: true }));

  const v1 = express.Router();
  router.use('/v1', bearerAuth(core), v1);

  v1.get('/customers', route((req, res) => {
    checkFault(core, 'customers.list');
    const email = typeof req.query.email === 'string' ? req.query.email : undefined;
    res.json(core.listCustomers(email));
  }));

  v1.post('/customers', route((req, res) => {
    checkFault(core, 'customers.create');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email : '';
    if (!email) {
      throw new StripeWireError(400, 'Missing required param: email.');
    }
    res.json(core.createCustomer({
      email,
      name: typeof body.name === 'string' ? body.name : undefined,
      metadata: (body.metadata ?? {}) as Record<string, string>,
    }));
  }));

  v1.get('/customers/:id', route((req, res) => {
    checkFault(core, 'customers.retrieve');
    res.json(core.getCustomer(String(req.params.id)));
  }));

  v1.post('/checkout/sessions', route((req, res) => {
    checkFault(core, 'checkout.sessions.create');
    const body = (req.body ?? {}) as Record<string, any>;
    const lineItems = Array.isArray(body.line_items) ? body.line_items : [];
    const metadata = (body.metadata ?? {}) as Record<string, string>;

    const session = core.createCheckoutSession(
      {
        mode: 'payment',
        customer: typeof body.customer === 'string' ? body.customer : undefined,
        line_items: lineItems,
        success_url: typeof body.success_url === 'string' ? body.success_url : '',
        cancel_url: typeof body.cancel_url === 'string' ? body.cancel_url : undefined,
        metadata,
        expires_at: typeof body.expires_at === 'number' ? body.expires_at : undefined,
        currency: body.currency !== undefined ? String(body.currency) : undefined,
        amount: body.amount !== undefined ? Number(body.amount) : undefined,
      },
      hostedBaseFromRequest(req, core),
    );
    res.status(200).json(session);
  }));

  v1.get('/checkout/sessions/:id', route((req, res) => {
    checkFault(core, 'checkout.sessions.retrieve');
    const session = core.getCheckoutSession(String(req.params.id));
    res.json(sessionResponse(core, session, req.query.expand ?? (req.query as Record<string, unknown>)['expand[]']));
  }));

  v1.post('/checkout/sessions/:id/expire', route(async (req, res) => {
    checkFault(core, 'checkout.sessions.expire');
    const sessionId = String(req.params.id);
    const event = core.expireSession(sessionId);
    // Real Stripe delivers a signed checkout.session.expired webhook when a
    // session is expired through the API; the emulator must too, or lifecycle
    // reconciliation on the application side never learns of the expiry.
    await deliverEvent(core, event, env);
    res.json(core.getCheckoutSession(sessionId));
  }));

  // ── Browser-facing simulated Checkout ────────────────────────────────────

  router.get('/checkout/sessions/:id', route((req, res) => {
    const session = core.getCheckoutSession(String(req.params.id));
    res.type('html').send(hostedCheckoutPage(session));
  }));

  router.post('/checkout/sessions/:id/pay', route(async (req, res) => {
    const sessionId = String(req.params.id);
    const session = core.getCheckoutSession(sessionId);
    if (session.status === 'complete') {
      res.redirect(303, session.success_url.replace('{CHECKOUT_SESSION_ID}', session.id));
      return;
    }
    const event: StripeEvent = core.completeSession(sessionId);
    await deliverEvent(core, event, env);
    res.redirect(303, session.success_url.replace('{CHECKOUT_SESSION_ID}', session.id));
  }));

  router.post('/checkout/sessions/:id/decline', route(async (req, res) => {
    const sessionId = String(req.params.id);
    const session = core.getCheckoutSession(sessionId);
    if (session.status !== 'complete') {
      const event = core.failSession(sessionId);
      await deliverEvent(core, event, env);
    }
    res.status(200).type('html').send(hostedDeclinePage(session, 'Your card was declined.'));
  }));

  router.post('/checkout/sessions/:id/cancel', route((req, res) => {
    const sessionId = String(req.params.id);
    const session = core.getCheckoutSession(sessionId);
    res.redirect(303, session.cancel_url || session.success_url);
  }));

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof StripeWireError) {
      res.status(err.status).json(err.toEnvelope());
      return;
    }
    res.status(500).json({ error: { type: 'api_error', message: err instanceof Error ? err.message : String(err) } });
  });
}
