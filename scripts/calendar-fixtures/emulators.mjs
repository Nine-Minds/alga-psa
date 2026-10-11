import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraph from '@alga-psa/emulator-msgraph';

// Synthetic credentials, valid only on this local fixture server.
export const googleCredentials = {
  clientId: 'shared-calendar-fixture', clientSecret: 'local-calendar-fixture-secret',
  accessToken: 'local-calendar-access', refreshToken: 'local-calendar-refresh',
};
export const fixtureDirectory = resolve(process.env.CALENDAR_FIXTURE_STATE_DIR || '/tmp/alga-shared-calendar-fixtures');
export const endpoints = {
  google: `http://127.0.0.1:${process.env.CALENDAR_FIXTURE_GOOGLE_PORT || 18481}`,
  graph: `http://127.0.0.1:${process.env.CALENDAR_FIXTURE_GRAPH_PORT || 18482}`,
  control: `http://127.0.0.1:${process.env.CALENDAR_FIXTURE_CONTROL_PORT || 18483}`,
};

export async function startEmulators() {
  mkdirSync(fixtureDirectory, { recursive: true, mode: 0o700 });
  const file = resolve(fixtureDirectory, 'google.json');
  const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { events: {} };
  const save = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.get('/health', (_req, res) => res.json({ fixture: 'shared-calendar-google' }));
  app.post('/token', (req, res) => {
    if (req.body.client_id !== googleCredentials.clientId || req.body.client_secret !== googleCredentials.clientSecret ||
        req.body.refresh_token !== googleCredentials.refreshToken || req.body.grant_type !== 'refresh_token') {
      res.status(400).json({ error: 'invalid_grant' }); return;
    }
    res.json({ access_token: googleCredentials.accessToken, refresh_token: googleCredentials.refreshToken, expires_in: 86400, token_type: 'Bearer' });
  });
  app.use('/calendar', (req, res, next) => {
    if (req.header('authorization') !== `Bearer ${googleCredentials.accessToken}`) {
      res.status(401).json({ error: { message: 'Invalid fixture token' } }); return;
    }
    next();
  });
  app.get('/calendar/v3/users/me/calendarList', (_req, res) => res.json({ items: [{ id: 'primary', summary: 'Scoped Google fixture', primary: true }] }));
  app.get('/calendar/v3/calendars/:calendarId', (req, res) => res.json({ id: req.params.calendarId, summary: 'Scoped Google fixture', timeZone: 'UTC' }));
  app.get('/calendar/v3/calendars/:calendarId/events', (req, res) => {
    const items = Object.values(state.events).filter(event => event.calendarId === req.params.calendarId);
    res.json({ items, nextSyncToken: String(Date.now()) });
  });
  app.post('/calendar/v3/calendars/:calendarId/events', (req, res) => {
    const event = { ...req.body, id: randomUUID(), calendarId: req.params.calendarId, status: 'confirmed', updated: new Date().toISOString() };
    state.events[event.id] = event; save(); res.json(event);
  });
  app.all('/calendar/v3/calendars/:calendarId/events/:eventId', (req, res) => {
    const event = state.events[req.params.eventId];
    if (!event || event.calendarId !== req.params.calendarId) { res.status(404).json({ error: { message: 'Not found' } }); return; }
    if (req.method === 'GET') { res.json(event); return; }
    if (req.method === 'PUT' || req.method === 'PATCH') {
      const updated = { ...event, ...req.body, id: event.id, calendarId: event.calendarId, updated: new Date().toISOString() };
      state.events[event.id] = updated; save(); res.json(updated); return;
    }
    if (req.method === 'DELETE') { delete state.events[event.id]; save(); res.status(204).end(); return; }
    res.status(405).end();
  });
  const google = await new Promise((resolveServer, reject) => {
    const server = app.listen(Number(new URL(endpoints.google).port), '127.0.0.1', () => resolveServer(server));
    server.on('error', reject);
  });
  const graph = new EmulatorHost({ emulators: [msgraph], controlPort: Number(new URL(endpoints.control).port),
    ports: { msgraph: Number(new URL(endpoints.graph).port) }, stateFile: resolve(fixtureDirectory, 'graph.json') });
  try { await graph.start(); } catch (error) { await new Promise(resolveClose => google.close(resolveClose)); throw error; }
  return async () => { save(); await graph.stop(); await new Promise(resolveClose => google.close(resolveClose)); };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const stop = await startEmulators();
  console.log('Calendar emulators ready', endpoints);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await stop(); process.exit(0); });
}
