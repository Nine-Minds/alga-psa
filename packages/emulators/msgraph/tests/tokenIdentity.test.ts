import { expect, it } from 'vitest';
import { MsGraphCore } from '../src/core';

it('keeps same-second access-token grants distinct and bound to their original client', () => {
  const core = new MsGraphCore({
    clock: { now: () => new Date('2026-09-07T00:00:00Z') },
    rng: () => 0.5,
    log: () => undefined,
  });
  function signIn(clientId: string) {
    core.registerClient(clientId, 'synthetic-secret');
    const redirectUri = 'http://localhost/callback';
    const code = core.authorize(clientId, redirectUri, { scope: 'Calendars.ReadWrite offline_access' });
    return core.grantToken({
      client_id: clientId, client_secret: 'synthetic-secret', grant_type: 'authorization_code',
      code, redirect_uri: redirectUri,
    });
  }
  const first = signIn('first-client');
  const refreshed = core.grantToken({
    client_id: 'first-client', client_secret: 'synthetic-secret', grant_type: 'refresh_token',
    refresh_token: first.refresh_token,
  });
  const otherClient = signIn('other-client');
  expect.soft(new Set([first.access_token, refreshed.access_token, otherClient.access_token]).size).toBe(3);
  expect.soft(core.authenticate(first.access_token)).toMatchObject({ clientId: 'first-client' });
  expect.soft(core.authenticate(refreshed.access_token)).toMatchObject({ clientId: 'first-client' });
  expect.soft(core.authenticate(otherClient.access_token)).toMatchObject({ clientId: 'other-client' });
});
