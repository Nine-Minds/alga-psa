import express, { type Request, type Response, type Router } from 'express';
import type { HostEnv } from '@alga-psa/emulator-host';
import { GoogleCalendarApiError, GoogleCalendarCore } from './core';

function fail(res: Response, error: unknown): void {
  if (error instanceof GoogleCalendarApiError) {
    res.status(error.status).json(error.body);
    return;
  }
  res.status(500).json({ error: { code: 500, message: error instanceof Error ? error.message : 'Emulator failure' } });
}

function route(handler: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    try {
      handler(req, res);
    } catch (error) {
      fail(res, error);
    }
  };
}

function flag(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return String(value) === 'true';
}

/**
 * Google Calendar v3 surface, as the googleapis client calls it:
 * `${apiRoot}calendar/v3/...` plus the OAuth token endpoint. Only the routes
 * Alga's adapter uses are modelled.
 */
export function wire(router: Router, core: GoogleCalendarCore, _env: HostEnv): void {
  // google-auth-library posts form-encoded token requests; the Calendar client
  // posts JSON.
  router.use(express.json());
  router.use(express.urlencoded({ extended: false }));

  // OAuth token refresh (GOOGLE_OAUTH_TOKEN_URL points here).
  router.post('/token', route((req, res) => {
    const body = (req.body ?? {}) as Record<string, string>;
    if (body.grant_type !== 'refresh_token') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }
    res.json(core.refreshAccessToken(String(body.refresh_token ?? '')));
  }));

  const api = '/calendar/v3';

  router.use(api, (req, res, next) => {
    try {
      core.authorize(req.get('authorization'));
      next();
    } catch (error) {
      fail(res, error);
    }
  });

  router.get(`${api}/users/me/calendarList`, route((_req, res) => {
    res.json({ kind: 'calendar#calendarList', items: [...core.calendars.values()].map((calendar) => ({ kind: 'calendar#calendarListEntry', ...calendar })) });
  }));

  router.get(`${api}/calendars/:calendarId`, route((req, res) => {
    res.json({ kind: 'calendar#calendar', ...core.getCalendar(String(req.params.calendarId)) });
  }));

  router.get(`${api}/calendars/:calendarId/events`, route((req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const result = core.listEvents({
      calendarId: String(req.params.calendarId),
      singleEvents: flag(query.singleEvents),
      showDeleted: flag(query.showDeleted),
      timeMin: query.timeMin,
      timeMax: query.timeMax,
      maxResults: query.maxResults ? Number(query.maxResults) : undefined,
      pageToken: query.pageToken,
      syncToken: query.syncToken,
      orderBy: query.orderBy,
    });
    res.json({
      kind: 'calendar#events',
      items: result.items,
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
      ...(result.nextSyncToken ? { nextSyncToken: result.nextSyncToken } : {}),
    });
  }));

  router.post(`${api}/calendars/:calendarId/events/watch`, route((req, res) => {
    res.json(core.watch(String(req.params.calendarId), req.body ?? {}));
  }));

  router.post(`${api}/channels/stop`, route((req, res) => {
    const body = (req.body ?? {}) as Record<string, string>;
    core.stopChannel(String(body.id ?? ''), String(body.resourceId ?? ''));
    res.status(204).end();
  }));

  router.get(`${api}/calendars/:calendarId/events/:eventId/instances`, route((req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const master = core.getEvent(String(req.params.calendarId), String(req.params.eventId));
    const items = master.recurrence
      ? core.expandSeries(master, {
          timeMin: query.timeMin ? Date.parse(query.timeMin) : undefined,
          timeMax: query.timeMax ? Date.parse(query.timeMax) : undefined,
          showDeleted: flag(query.showDeleted),
        })
      : [master];
    res.json({ kind: 'calendar#events', items });
  }));

  router.get(`${api}/calendars/:calendarId/events/:eventId`, route((req, res) => {
    res.json({ kind: 'calendar#event', ...core.getEvent(String(req.params.calendarId), String(req.params.eventId)) });
  }));

  router.post(`${api}/calendars/:calendarId/events`, route((req, res) => {
    res.json({ kind: 'calendar#event', ...core.insertEvent(String(req.params.calendarId), req.body ?? {}) });
  }));

  router.put(`${api}/calendars/:calendarId/events/:eventId`, route((req, res) => {
    res.json({ kind: 'calendar#event', ...core.updateEvent(String(req.params.calendarId), String(req.params.eventId), req.body ?? {}, false) });
  }));

  router.patch(`${api}/calendars/:calendarId/events/:eventId`, route((req, res) => {
    res.json({ kind: 'calendar#event', ...core.updateEvent(String(req.params.calendarId), String(req.params.eventId), req.body ?? {}, true) });
  }));

  router.delete(`${api}/calendars/:calendarId/events/:eventId`, route((req, res) => {
    core.deleteEvent(String(req.params.calendarId), String(req.params.eventId));
    res.status(204).end();
  }));
}
