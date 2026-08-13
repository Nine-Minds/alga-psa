import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import { route } from '@alga-psa/emulator-host';
import type { HostEnv } from '@alga-psa/emulator-host';
import { GraphApiError, publicEvent, publicOnlineMeeting, publicSubscription, publicTeam } from './core';
import type { MsGraphCore } from './core';
import { BOT_FRAMEWORK_ISSUER, botFrameworkJwks } from './botFramework';
import { deliverNotifications, validateNotificationUrl } from './notifier';

interface Authed {
  clientId: string;
}

function authed(res: Response): Authed {
  return res.locals.access as Authed;
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Vendor surface: Microsoft login (OAuth2 v2.0), the Graph v1.0 routes Alga's
 * email and Teams integrations use, and the Bot Framework connector plus its
 * OpenID/JWKS surface. Point MICROSOFT_LOGIN_BASE_URL, MICROSOFT_GRAPH_BASE_URL
 * (including the /v1.0 suffix) and TEAMS_BOT_OPENID_CONFIG_URL at this emulator.
 */
export function wire(router: Router, core: MsGraphCore, env: HostEnv): void {
  router.use(express.json());
  router.use(express.urlencoded({ extended: false }));

  // --- Bot Framework identity provider ---
  // Registered before the /:tenant login routes so the well-known paths win.

  router.get('/v1/.well-known/openidconfiguration', (req, res) => {
    res.json({
      issuer: BOT_FRAMEWORK_ISSUER,
      jwks_uri: `${req.protocol}://${req.get('host')}/v1/.well-known/keys`,
      id_token_signing_alg_values_supported: ['RS256'],
    });
  });

  router.get('/v1/.well-known/keys', (_req, res) => {
    res.json(botFrameworkJwks());
  });

  // --- Microsoft login surface ---

  router.get('/:tenant/oauth2/v2.0/authorize', (req, res) => {
    const clientId = String(req.query.client_id ?? '');
    const redirectUri = String(req.query.redirect_uri ?? '');
    if (!clientId || !redirectUri) {
      throw new GraphApiError(400, { error: 'invalid_client' });
    }
    const code = core.authorize(clientId, redirectUri, {
      nonce: req.query.nonce ? String(req.query.nonce) : undefined,
      scope: req.query.scope ? String(req.query.scope) : undefined,
    });
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

  router.get('/:tenant/v2.0/adminconsent', (req, res) => {
    const clientId = String(req.query.client_id ?? '');
    const redirectUri = String(req.query.redirect_uri ?? '');
    if (!clientId || !redirectUri) {
      throw new GraphApiError(400, { error: 'invalid_request' });
    }
    const callback = new URL(redirectUri);
    callback.searchParams.set('admin_consent', 'true');
    callback.searchParams.set('tenant', '11111111-2222-4333-8444-555555555555');
    if (req.query.state) callback.searchParams.set('state', String(req.query.state));
    res.redirect(302, callback.toString());
  });

  // --- Bot Framework connector surface ---
  // These hang off the root router, so they need their own auth + fault gate;
  // the /v1.0 middleware below does not reach them.

  router.use('/v3', (req, res, next) => {
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    res.locals.access = core.authenticate(bearer);
    // req.path is mount-relative here, so fault keys read "POST /v3/...".
    // Decoded, because the connector percent-encodes conversation ids and
    // faults are armed with the readable id ("19:...@thread.v2").
    const fault = core.consumeFault(`${req.method} /v3${decodePath(req.path)}`);
    if (fault) {
      res.status(fault.status).json(fault.body);
      return;
    }
    next();
  });

  router.post('/v3/conversations', (req, res) => {
    res.status(201).json({ id: core.createConversation(req.body ?? {}).id });
  });

  router.post('/v3/conversations/:conversationId/activities', (req, res) => {
    const captured = core.recordBotActivity({
      method: 'POST',
      conversationId: String(req.params.conversationId),
      activity: req.body ?? {},
    });
    res.json({ id: captured.id });
  });

  router.post('/v3/conversations/:conversationId/activities/:activityId', (req, res) => {
    const captured = core.recordBotActivity({
      method: 'POST',
      conversationId: String(req.params.conversationId),
      pathActivityId: String(req.params.activityId),
      activity: req.body ?? {},
    });
    res.json({ id: captured.id });
  });

  router.put('/v3/conversations/:conversationId/activities/:activityId', (req, res) => {
    const captured = core.recordBotActivity({
      method: 'PUT',
      conversationId: String(req.params.conversationId),
      pathActivityId: String(req.params.activityId),
      activity: req.body ?? {},
    });
    res.json({ id: captured.id });
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

  const mailboxUser = { id: 'emulated-user', userPrincipalName: 'support@example.test', mail: 'support@example.test' };
  graph.get('/me', (_req, res) => res.json(mailboxUser));

  // Entra self-tenant smoke surface. The production adapter deliberately uses
  // these standard Graph routes when ENTRA_DIRECT_SMOKE_SELF_TENANT_MODE=true,
  // avoiding a dependency on a real CSP/GDAP relationship during local tests.
  graph.get('/organization', (_req, res) => {
    res.json({ value: core.listOrganizations() });
  });

  graph.get('/users', (_req, res) => {
    res.json({ value: core.listDirectoryUsers() });
  });

  graph.get('/users/:userId', (req, res) => {
    const userId = String(req.params.userId);
    if (core.directoryUsers.has(userId)) {
      res.json(core.getDirectoryUser(userId));
      return;
    }
    res.json(mailboxUser);
  });

  // Teams surface: activity feed notifications plus the channel/chat lookups
  // the Teams add-on resolves conversation targets with.
  graph.post('/users/:userId/teamwork/sendActivityNotification', (req, res) => {
    core.recordActivityNotification(String(req.params.userId), req.body ?? {});
    res.status(202).end();
  });

  graph.get('/teams', (_req, res) => {
    res.json({ value: [...core.teams.values()].map(publicTeam) });
  });

  graph.get('/teams/:teamId', (req, res) => {
    res.json(publicTeam(core.getTeam(String(req.params.teamId))));
  });

  graph.get('/teams/:teamId/channels', (req, res) => {
    res.json({ value: core.getTeam(String(req.params.teamId)).channels });
  });

  graph.get('/chats', (_req, res) => {
    res.json({ value: [...core.chats.values()] });
  });

  graph.get('/chats/:chatId', (req, res) => {
    res.json(core.getChat(String(req.params.chatId)));
  });

  graph.get('/chats/:chatId/messages', (req, res) => {
    res.json({ value: core.listChatMessages(String(req.params.chatId)) });
  });

  // Meetings surface: calendar events that carry a Teams meeting, onlineMeetings
  // (creation probe, join-URL resolution), and recording/transcript artifacts.
  graph.post('/users/:userId/events', (req, res) => {
    res.status(201).json(publicEvent(core.createCalendarEvent(String(req.params.userId), req.body ?? {})));
  });

  graph.patch('/users/:userId/events/:eventId', (req, res) => {
    res.json(publicEvent(core.updateCalendarEvent(String(req.params.eventId), req.body ?? {})));
  });

  graph.delete('/users/:userId/events/:eventId', (req, res) => {
    core.deleteCalendarEvent(String(req.params.eventId));
    res.status(204).end();
  });

  graph.get('/users/:userId/onlineMeetings', (req, res) => {
    const filter = String(req.query.$filter ?? '');
    const match = filter.match(/JoinWebUrl\s+eq\s+'(.+)'$/i);
    if (!match) {
      res.json({ value: [...core.onlineMeetings.values()].map(publicOnlineMeeting) });
      return;
    }
    const joinWebUrl = match[1].replace(/''/g, "'");
    res.json({ value: core.findOnlineMeetingsByJoinUrl(joinWebUrl).map(publicOnlineMeeting) });
  });

  graph.post('/users/:userId/onlineMeetings', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const meeting = core.createOnlineMeeting(String(req.params.userId), {
      subject: typeof body.subject === 'string' ? body.subject : null,
      startDateTime: typeof body.startDateTime === 'string' ? body.startDateTime : null,
      endDateTime: typeof body.endDateTime === 'string' ? body.endDateTime : null,
    });
    res.status(201).json(publicOnlineMeeting(meeting));
  });

  graph.get('/users/:userId/onlineMeetings/:meetingId', (req, res) => {
    res.json(publicOnlineMeeting(core.getOnlineMeeting(String(req.params.meetingId))));
  });

  graph.delete('/users/:userId/onlineMeetings/:meetingId', (req, res) => {
    core.deleteOnlineMeeting(String(req.params.meetingId));
    res.status(204).end();
  });

  for (const kind of ['recording', 'transcript'] as const) {
    const segment = kind === 'recording' ? 'recordings' : 'transcripts';

    graph.get(`/users/:userId/onlineMeetings/:meetingId/${segment}`, (req, res) => {
      res.json({
        value: core.listMeetingArtifacts(kind, String(req.params.meetingId)).map((artifact) => ({
          id: artifact.id,
          createdDateTime: artifact.createdDateTime,
        })),
      });
    });

    graph.get(`/users/:userId/onlineMeetings/:meetingId/${segment}/:artifactId/content`, (req, res) => {
      const artifact = core.getMeetingArtifact(kind, String(req.params.meetingId), String(req.params.artifactId));
      res.type(artifact.contentType).send(artifact.content);
    });
  }

  graph.post('/applications', (req, res) => {
    res.status(201).json(core.createApplication(req.body ?? {}));
  });

  graph.post('/applications/:applicationId/addPassword', (req, res) => {
    res.json(core.addApplicationPassword(String(req.params.applicationId)));
  });

  graph.delete('/applications/:applicationId', (req, res) => {
    core.deleteApplication(String(req.params.applicationId));
    res.status(204).end();
  });

  graph.post('/servicePrincipals', (req, res) => {
    res.status(201).json(core.createServicePrincipal(String(req.body?.appId ?? '')));
  });

  graph.delete('/servicePrincipals/:servicePrincipalId', (req, res) => {
    core.deleteServicePrincipal(String(req.params.servicePrincipalId));
    res.status(204).end();
  });

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

    // "$value" is matched as a param: a literal "$" in the route pattern
    // behaves differently across path-to-regexp builds.
    graph.get(`${root}/messages/:messageId/:variant`, (req, res) => {
      if (req.params.variant !== '$value') {
        throw new GraphApiError(404, { error: { code: 'NotFound', message: String(req.params.variant) } });
      }
      const message = core.getMessage(String(req.params.messageId));
      res.type('message/rfc822').send(core.messageMime(message));
    });
  }

  graph.get('/subscriptions', (_req, res) => {
    res.json({ value: core.listSubscriptions(authed(res).clientId).map(publicSubscription) });
  });

  graph.post('/subscriptions', route(async (req, res) => {
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
  }));

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
