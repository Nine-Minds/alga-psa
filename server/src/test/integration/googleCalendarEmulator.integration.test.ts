import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CalendarProviderConfig, ExternalCalendarEvent } from '@alga-psa/types';

const { persistTokens } = vi.hoisted(() => ({ persistTokens: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class { updateProvider = persistTokens; },
}));

import { GoogleCalendarAdapter } from '@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter';

let server: Server;
let base: string;
const requests: Array<{ method: string; path: string; body?: any; authorization?: string }> = [];
const events = new Map<string, any>();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.post('/token', (req, res) => {
    requests.push({ method: req.method, path: req.path, body: req.body });
    if (req.body.grant_type !== 'refresh_token' || req.body.refresh_token !== 'fixture-refresh-token') {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    res.json({ access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', expires_in: 3600, token_type: 'Bearer' });
  });
  app.all(['/calendar/v3/calendars/:calendarId/events', '/calendar/v3/calendars/:calendarId/events/:eventId'], (req, res) => {
    requests.push({ method: req.method, path: req.path, body: req.body, authorization: req.header('authorization') });
    if (req.header('authorization') !== 'Bearer fixture-access-token') {
      res.status(401).json({ error: { message: 'unauthorized' } });
      return;
    }
    if (req.method === 'POST') {
      const id = 'google-emulator-event-1';
      const saved = { ...req.body, id, htmlLink: `http://127.0.0.1/events/${id}`, status: req.body.status || 'confirmed' };
      events.set(id, saved);
      res.status(200).json(saved);
      return;
    }
    const current = events.get(String(req.params.eventId));
    if (!current) {
      res.status(404).json({ error: { message: 'Not found' } });
      return;
    }
    if (req.method === 'GET') {
      res.json(current);
      return;
    }
    if (req.method === 'PUT') {
      const saved = { ...current, ...req.body, id: current.id };
      events.set(current.id, saved);
      res.json(saved);
      return;
    }
    res.status(405).end();
  });
  server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('Google Calendar adapter against scoped local emulator', () => {
  it('refreshes fixture tokens and creates, reads, and updates an event through the adapter', async () => {
    requests.length = 0;
    events.clear();
    persistTokens.mockClear();
    const config: CalendarProviderConfig = {
      id: 'google-emulator-fixture', tenant: 'isolated-google-emulator-fixture', user_id: 'fixture-user',
      name: 'Google emulator fixture', provider_type: 'google', calendar_id: 'fixture-calendar', active: true,
      sync_direction: 'bidirectional', connection_status: 'connected', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      provider_config: {
        clientId: 'fixture-google-client', clientSecret: 'fixture-google-secret',
        accessToken: 'expired-fixture-token', refreshToken: 'fixture-refresh-token', tokenExpiresAt: new Date(0).toISOString(),
        apiRoot: `${base}/`, tokenEndpoint: `${base}/token`,
      },
    };
    const adapter = new GoogleCalendarAdapter(config);
    const input: ExternalCalendarEvent = {
      provider: 'google', title: 'Scoped fixture event', description: 'Created by the Google adapter emulator test',
      start: { dateTime: '2026-09-29T10:00:00Z', timeZone: 'UTC' }, end: { dateTime: '2026-09-29T11:00:00Z', timeZone: 'UTC' },
    };
    const created = await adapter.createEvent(input);
    expect(created).toMatchObject({ title: input.title, description: input.description, id: 'google-emulator-event-1' });
    expect(await adapter.getEvent(created.id!)).toMatchObject({ title: input.title, id: created.id });
    const updated = await adapter.updateEvent(created.id!, { title: 'Updated fixture event' });
    expect(updated).toMatchObject({ title: 'Updated fixture event', id: created.id });
    expect(events.get(created.id!)).toMatchObject({ summary: 'Updated fixture event' });
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'POST', path: '/token' }),
      expect.objectContaining({ method: 'POST', path: '/calendar/v3/calendars/fixture-calendar/events', authorization: 'Bearer fixture-access-token' }),
      expect.objectContaining({ method: 'GET', path: `/calendar/v3/calendars/fixture-calendar/events/${created.id}` }),
      expect.objectContaining({ method: 'PUT', path: `/calendar/v3/calendars/fixture-calendar/events/${created.id}` }),
    ]));
    expect(persistTokens).toHaveBeenCalledOnce();
  });
});
