/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import jwt from 'jsonwebtoken';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as editor from '@alga-psa/ui/editor';
import { useTicketListChanges } from './useTicketListChanges';

const secret = 'ticket-list-provider-protocol-test';
const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';

function issueToken() {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ scope: 'ticket-changes', tenantId, userId, sessionId, iat: now, exp: now + 300 }, secret,
    { algorithm: 'HS256', audience: 'ticket-changes' });
}

async function waitUntil(predicate: () => boolean, timeout = 20_000) {
  await waitFor(() => expect(predicate()).toBe(true), { timeout, interval: 20 });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ticket list hook with installed Hocuspocus transport', () => {
  it('retries rejected auth exponentially, reuses one provider after socket loss, bounds recovery queries, and delivers authorized stateless changes', async () => {
    process.env.HOCUSPOCUS_JWT_SECRET = secret;
    let repositoryRoot = process.cwd();
    while (!existsSync(resolve(repositoryRoot, 'hocuspocus/node_modules/@hocuspocus/server/package.json'))) {
      const parent = dirname(repositoryRoot);
      if (parent === repositoryRoot) throw new Error('Could not locate installed Hocuspocus server package');
      repositoryRoot = parent;
    }
    const requireFromRepository = createRequire(resolve(repositoryRoot, 'package.json'));
    const { Hocuspocus } = requireFromRepository(resolve(repositoryRoot, 'hocuspocus/node_modules/@hocuspocus/server/dist/hocuspocus-server.cjs'));
    const { resolveDocumentAuthenticationContext, resolveDocumentConnectionContext } = await import('../../../../hocuspocus/ticketChangeConnectionContext.js');
    const { TicketUpdatesExtension } = await import('../../../../hocuspocus/TicketUpdatesExtension.js');
    const extension = new TicketUpdatesExtension({ listChangeAuthorizationUrl: 'http://internal/api/internal/tickets/live-change', listChangeApiKey: 'key' });
    extension.onConfigure = async ({ instance }: any) => { extension.instance = instance; };

    const authenticationTimes: number[] = [];
    let authenticatedHandshakes = 0;
    const server = new Hocuspocus({
      extensions: [extension],
      onConnect: resolveDocumentConnectionContext,
      onAuthenticate: async (data: any) => {
        authenticationTimes.push(Date.now());
        authenticatedHandshakes += 1;
        if (authenticatedHandshakes <= 2) throw new Error('simulated temporary auth rejection');
        return resolveDocumentAuthenticationContext(data);
      },
      quiet: true,
    });
    await server.listen(0);
    const oldUrl = process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
    process.env.NEXT_PUBLIC_HOCUSPOCUS_URL = server.webSocketURL;

    const changed = {
      ticketId: 'ticket-live', statusId: 'status-open', assigneeIds: [userId],
      boardId: 'board-a', actorUserId: 'another-user', updatedAt: new Date().toISOString(),
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/tickets/live-token')) return { ok: true, json: async () => ({ token: issueToken() }) };
      if (url.includes('/api/internal/tickets/live-change')) return { ok: true, json: async () => ({ change: changed }) };
      throw new Error(`Unexpected fetch: ${url}`);
    }) as any);

    const providers: any[] = [];
    // Wrap the real helper without replacing its installed Hocuspocus provider.
    const realCreate = editor.createYjsProvider;
    const providerSpy = vi.spyOn(editor, 'createYjsProvider');
    providerSpy.mockImplementation((...args: any[]) => {
      const result = (realCreate as any)(...args);
      providers.push(result.provider);
      return result;
    });

    const onChange = vi.fn();
    const recoveryQueries = vi.fn();
    const { unmount } = renderHook(() => useTicketListChanges(tenantId, onChange, {
      onUnavailable: recoveryQueries,
      onRecovered: recoveryQueries,
    }));

    try {
      await waitUntil(() => authenticatedHandshakes >= 3).catch(() => {
        const p = providers[0];
        throw new Error(`Auth retry stalled: handshakes=${authenticatedHandshakes}, retries=${p?.configuration.websocketProvider.shouldConnect}, socketStatus=${p?.configuration.websocketProvider.status}, providerStatus=${p?.status}, isConnected=${p?.isConnected}`);
      });
      await waitUntil(() => recoveryQueries.mock.calls.length === 1);
      expect(authenticationTimes[1] - authenticationTimes[0]).toBeGreaterThanOrEqual(1_800);
      expect(authenticationTimes[2] - authenticationTimes[1]).toBeGreaterThanOrEqual(3_800);
      expect(providers).toHaveLength(1);
      expect(providers[0].configuration.websocketProvider.configuration.maxAttempts).toBe(0);

      const room = `tenant:${tenantId}:ticket-changes`;
      expect(server.documents.has(room)).toBe(true);
      expect(extension.listConnections.get(room)?.size).toBe(1);
      const received = new Promise<void>(resolve => onChange.mockImplementationOnce(() => resolve()));
      await extension.handleListMessage(JSON.stringify({ ticketId: changed.ticketId, updatedAt: changed.updatedAt }), `ticket-list-changes:${tenantId}`);
      await received;
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining(changed));
      expect(recoveryQueries).toHaveBeenCalledTimes(1);

      providers[0].configuration.websocketProvider.webSocket.close();
      await waitUntil(() => authenticatedHandshakes === 4);
      await waitUntil(() => recoveryQueries.mock.calls.length === 2);
      await new Promise(resolve => setTimeout(resolve, 2_300));
      expect(authenticationTimes).toHaveLength(4);
      expect(providers).toHaveLength(1);
      expect(recoveryQueries).toHaveBeenCalledTimes(2);
      expect(server.documents.get(room)?.connections.size).toBe(1);
    } finally {
      unmount();
      await server.destroy();
      if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_HOCUSPOCUS_URL;
      else process.env.NEXT_PUBLIC_HOCUSPOCUS_URL = oldUrl;
      await extension.onDestroy();
    }
  }, 45_000);
});
