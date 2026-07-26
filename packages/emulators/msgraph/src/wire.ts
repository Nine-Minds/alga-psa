import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import type { HostEnv } from '@alga-psa/emulator-host';
import { GraphApiError, publicSubscription } from './core';
import type { MsGraphCore } from './core';
import { deliverNotifications, validateNotificationUrl } from './notifier';

interface Authed {
  clientId: string;
}

function authed(res: Response): Authed {
  return res.locals.access as Authed;
}

/**
 * Vendor surface: Microsoft login (OAuth2 v2.0) plus the Graph v1.0 routes
 * Alga's email integration uses. Point MICROSOFT_LOGIN_BASE_URL and
 * MICROSOFT_GRAPH_BASE_URL (minus the /v1.0 suffix) at this emulator.
 */
export function wire(router: Router, core: MsGraphCore, env: HostEnv): void {
  router.use(express.json());
  router.use(express.urlencoded({ extended: false }));

  // --- Microsoft login surface ---

  router.get('/:tenant/oauth2/v2.0/authorize', (req, res) => {
    const clientId = String(req.query.client_id ?? '');
    const redirectUri = String(req.query.redirect_uri ?? '');
    if (!clientId || !redirectUri) {
      throw new GraphApiError(400, { error: 'invalid_client' });
    }
    const code = core.authorize(clientId, redirectUri);
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    if (req.query.state) {
      callback.searchParams.set('state', String(req.query.state));
    }
    res.redirect(302, callback.toString());
  });

  router.post('/:tenant/oauth2/v2.0/token', (req, res) => {
    const fault = core.consumeFault('token');
    if (fault) {
      res.status(fault.status).json(fault.body);
      return;
    }
    res.json(core.grantToken(req.body ?? {}));
  });

  // --- Graph v1.0 surface ---

  const graph = express.Router();
  router.use('/v1.0', graph);

  graph.use((req, res, next) => {
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    res.locals.access = core.authenticate(bearer);
    const fault = core.consumeFault(`${req.method} ${req.path}`);
    if (fault) {
      res.status(fault.status).json(fault.body);
      return;
    }
    next();
  });

  const user = { id: 'emulated-user', userPrincipalName: 'support@example.test', mail: 'support@example.test' };
  graph.get('/me', (_req, res) => res.json(user));
  graph.get('/users/:userId', (_req, res) => res.json(user));

  const mailboxRoots = ['/me', '/users/:userId'];
  for (const root of mailboxRoots) {
    graph.get(`${root}/mailFolders`, (_req, res) => {
      res.json({ value: [{ id: 'inbox', displayName: 'Inbox' }] });
    });

    graph.get(`${root}/mailFolders/:folderId/messages`, (req, res) => {
      const filter = String(req.query.$filter ?? '');
      const match = filter.match(/receivedDateTime ge (.+)$/);
      const since = match ? new Date(match[1]).getTime() : 0;
      const top = Number(req.query.$top ?? 100);
      res.json({ value: core.listMessages(since, top) });
    });

    graph.get(`${root}/messages/:messageId`, (req, res) => {
      res.json(core.getMessage(String(req.params.messageId)));
    });

    graph.get(`${root}/messages/:messageId/$value`, (req, res) => {
      const message = core.getMessage(String(req.params.messageId));
      res.type('message/rfc822').send(core.messageMime(message));
    });
  }

  graph.get('/subscriptions', (_req, res) => {
    res.json({ value: core.listSubscriptions(authed(res).clientId).map(publicSubscription) });
  });

  graph.post('/subscriptions', async (req, res) => {
    const input = req.body as { notificationUrl?: string };
    if (!input?.notificationUrl) {
      throw new GraphApiError(400, { error: { code: 'ValidationError', message: 'notificationUrl is required' } });
    }
    const validationToken = `validation-${Math.floor(env.rng() * 0xffffffff).toString(16)}`;
    if (!(await validateNotificationUrl(input.notificationUrl, validationToken))) {
      throw new GraphApiError(400, { error: { code: 'ValidationError', message: 'Notification URL validation failed' } });
    }
    const subscription = core.createSubscription(authed(res).clientId, req.body);
    res.status(201).json(publicSubscription(subscription));
  });

  graph.patch('/subscriptions/:id', (req, res) => {
    const subscription = core.getSubscription(authed(res).clientId, String(req.params.id));
    Object.assign(subscription, req.body);
    res.json(publicSubscription(subscription));
  });

  graph.delete('/subscriptions/:id', (req, res) => {
    core.deleteSubscription(authed(res).clientId, String(req.params.id));
    res.status(204).end();
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof GraphApiError) {
      res.status(err.status).json(err.body);
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });
}

/** Deliver change notifications for a message to all live subscriptions. */
export { deliverNotifications };
