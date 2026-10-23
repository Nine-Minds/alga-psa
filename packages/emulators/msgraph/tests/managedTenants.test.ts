import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MsGraphCore } from '../src/core';
import { wire } from '../src/wire';

let server: Server;
let base: string;
let token: string;
beforeAll(async () => {
  const env = { clock: { now: () => new Date() }, rng: Math.random, log: () => undefined };
  const core = new MsGraphCore(env);
  core.registerClient('test-app', 'test-secret');
  core.addOrganization({ id: 'customer-1', displayName: 'Customer One', primaryDomain: 'one.example' });
  const code = core.authorize('test-app', 'http://localhost/callback', { scope: 'ManagedTenants.Read.All' });
  token = core.grantToken({ grant_type: 'authorization_code', client_id: 'test-app',
    client_secret: 'test-secret', redirect_uri: 'http://localhost/callback', code }).access_token;
  const app = express();
  wire(app, core, env);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

it('serves managed tenants only under beta and requires authentication', async () => {
  const path = '/tenantRelationships/managedTenants/tenants';
  const headers = { authorization: `Bearer ${token}` };
  const beta = await fetch(`${base}/beta${path}`, { headers });
  expect(beta.status).toBe(200);
  expect(await beta.json()).toEqual({ value: [{ tenantId: 'customer-1',
    displayName: 'Customer One', defaultDomainName: 'one.example' }] });
  // Unsupported emulator routes fail loudly instead of simulating a valid API.
  expect((await fetch(`${base}/v1.0${path}`, { headers })).status).toBe(501);
  expect((await fetch(`${base}/beta${path}`)).status).toBe(401);
});
