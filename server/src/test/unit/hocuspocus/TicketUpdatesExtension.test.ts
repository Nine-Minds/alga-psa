import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const createClientMock = vi.fn();

vi.mock('redis', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

describe('TicketUpdatesExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createSubscriberHarness() {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const pSubscribeMock = vi.fn();
    const subscriber = {
      on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        handlers.set(event, handler);
      }),
      connect: vi.fn(async () => {
        const readyHandler = handlers.get('ready');
        if (readyHandler) {
          await readyHandler();
        }
      }),
      pSubscribe: vi.fn(async (...args: any[]) => pSubscribeMock(...args)),
      quit: vi.fn(async () => undefined),
    };

    createClientMock.mockReturnValue(subscriber);

    return { handlers, pSubscribeMock, subscriber };
  }

  it('T018: Redis publishes are bridged into the matching ticket room as stateless broadcasts', async () => {
    const { pSubscribeMock } = createSubscriberHarness();
    const broadcastStateless = vi.fn();
    const instance = {
      documents: new Map([
        ['ticket:tenant-1:ticket-1', { broadcastStateless }],
      ]),
    };

    const { TicketUpdatesExtension } = await import('../../../../../hocuspocus/TicketUpdatesExtension.js');
    const extension = new TicketUpdatesExtension({ redisPrefix: 'alga-psa:' });
    await extension.onConfigure({ instance });

    expect(pSubscribeMock).toHaveBeenCalledWith('alga-psa:ticket-updates:*', expect.any(Function));

    const callback = pSubscribeMock.mock.calls[0][1];
    const payload = {
      updatedFields: ['status_id'],
      updatedBy: { userId: 'user-1', displayName: 'Pat Agent' },
      updatedAt: '2026-05-07T12:00:00.000Z',
    };
    await callback(JSON.stringify(payload), 'alga-psa:ticket-updates:tenant-1:ticket-1');

    expect(broadcastStateless).toHaveBeenCalledWith(JSON.stringify(payload));
  });

  it('T019: publishes for rooms without active clients are a no-op', async () => {
    const { pSubscribeMock } = createSubscriberHarness();
    const instance = {
      documents: new Map(),
    };

    const { TicketUpdatesExtension } = await import('../../../../../hocuspocus/TicketUpdatesExtension.js');
    const extension = new TicketUpdatesExtension({ redisPrefix: 'alga-psa:' });
    await extension.onConfigure({ instance });

    const callback = pSubscribeMock.mock.calls[0][1];
    await expect(
      callback(
        JSON.stringify({
          updatedFields: ['status_id'],
          updatedBy: { userId: 'user-1', displayName: 'Pat Agent' },
          updatedAt: '2026-05-07T12:00:00.000Z',
        }),
        'alga-psa:ticket-updates:tenant-1:ticket-1'
      )
    ).resolves.toBeUndefined();
  });

  it('T020: subscriber reconnects re-establish the Redis pattern subscription', async () => {
    const { handlers, pSubscribeMock } = createSubscriberHarness();
    const instance = {
      documents: new Map(),
    };

    const { TicketUpdatesExtension } = await import('../../../../../hocuspocus/TicketUpdatesExtension.js');
    const extension = new TicketUpdatesExtension({ redisPrefix: 'alga-psa:' });
    await extension.onConfigure({ instance });

    expect(pSubscribeMock).toHaveBeenCalledTimes(2);

    const endHandler = handlers.get('end');
    const readyHandler = handlers.get('ready');
    expect(endHandler).toBeDefined();
    expect(readyHandler).toBeDefined();

    endHandler?.();
    await readyHandler?.();

    expect(pSubscribeMock).toHaveBeenCalledTimes(4);
  });

  it('authorizes each connected principal before delivering an enriched tenant-room event', async () => {
    const { pSubscribeMock } = createSubscriberHarness();
    const document = { broadcastStateless: vi.fn() };
    const instance = { documents: new Map([['tenant:tenant-1:ticket-changes', document]]) };
    const { TicketUpdatesExtension } = await import('../../../../../hocuspocus/TicketUpdatesExtension.js');
    const extension = new TicketUpdatesExtension({ redisPrefix: 'alga-psa:', listChangeApiKey: 'internal-key' });
    await extension.onConfigure({ instance });
    const allowed = { sendStateless: vi.fn(), context: { ticketChangesAccess: { tenantId: 'tenant-1', userId: 'allowed', expiresAt: Date.now() + 60_000 } } };
    const denied = { sendStateless: vi.fn(), context: { ticketChangesAccess: { tenantId: 'tenant-1', userId: 'denied', expiresAt: Date.now() + 60_000 } } };
    await extension.connected({ documentName: 'tenant:tenant-1:ticket-changes', context: allowed.context, connectionInstance: allowed });
    await extension.connected({ documentName: 'tenant:tenant-1:ticket-changes', context: denied.context, connectionInstance: denied });
    const oldFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ change: body.userId === 'allowed' ? { ticketId: body.ticketId, boardId: 'board-a', statusId: 'open', assigneeIds: [], searchText: 'printer', actorUserId: 'other', updatedAt: body.event.updatedAt } : null }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await extension.handleListMessage(JSON.stringify({ ticketId: 'ticket-1', changeKind: 'updated', changedFields: ['status_id'], actorUserId: 'other', updatedAt: '2026-01-01T00:00:00Z' }), 'alga-psa:ticket-list-changes:tenant-1');
    } finally {
      vi.stubGlobal('fetch', oldFetch);
    }
    expect(pSubscribeMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(allowed.sendStateless).toHaveBeenCalledTimes(1);
    expect(denied.sendStateless).not.toHaveBeenCalled();
    expect(document.broadcastStateless).not.toHaveBeenCalled();
    expect(JSON.parse(allowed.sendStateless.mock.calls[0][0]).boardId).toBe('board-a');
    await extension.onDisconnect({ documentName: 'tenant:tenant-1:ticket-changes', connectionInstance: allowed });
    await extension.onDisconnect({ documentName: 'tenant:tenant-1:ticket-changes', connectionInstance: denied });
    await extension.onDestroy();
  });

  it('propagates the validated authentication principal into connected relay delivery', async () => {
    process.env.HOCUSPOCUS_JWT_SECRET = 'ticket-change-test-secret';
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign({
      scope: 'ticket-changes', tenantId, userId, sessionId,
      iat: now, exp: now + 300,
    }, process.env.HOCUSPOCUS_JWT_SECRET, { algorithm: 'HS256', audience: 'ticket-changes' });
    const { Hocuspocus } = await import('../../../../../hocuspocus/node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js');
    const { resolveDocumentAuthenticationContext, resolveDocumentConnectionContext } = await import('../../../../../hocuspocus/ticketChangeConnectionContext.js');
    const roomName = `tenant:${tenantId}:ticket-changes`;
    const hocuspocus = new Hocuspocus({ onAuthenticate: resolveDocumentAuthenticationContext, onConnect: resolveDocumentConnectionContext });
    let context: Record<string, unknown> = {};
    await hocuspocus.hooks('onAuthenticate', {
      documentName: roomName,
      request: { url: 'ws://localhost' },
      token,
      context,
    }, additions => { context = { ...context, ...(additions as object) }; });
    expect(context?.ticketChangesAccess).toMatchObject({ tenantId, userId });

    const { pSubscribeMock } = createSubscriberHarness();
    const document = { broadcastStateless: vi.fn() };
    const instance = { documents: new Map([[roomName, document]]) };
    const { TicketUpdatesExtension } = await import('../../../../../hocuspocus/TicketUpdatesExtension.js');
    const extension = new TicketUpdatesExtension({ redisPrefix: 'alga-psa:', listChangeApiKey: 'internal-key' });
    await extension.onConfigure({ instance });
    hocuspocus.configuration.extensions.push(extension);
    const connection = { context, socketId: 'socket-1', close: vi.fn(), sendStateless: vi.fn() };
    await hocuspocus.hooks('connected', { documentName: roomName, context, connectionInstance: connection });
    const oldFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ change: { ticketId: 'ticket-a', boardId: 'board-a', statusId: 'status-a', assigneeIds: [], actorUserId: 'other', updatedAt: new Date().toISOString() } }) })) as any);
    try {
      const listSubscription = pSubscribeMock.mock.calls.find(([pattern]) => pattern === 'alga-psa:ticket-list-changes:*')?.[1];
      await listSubscription?.(JSON.stringify({ ticketId: 'ticket-a', updatedAt: new Date().toISOString() }), `alga-psa:ticket-list-changes:${tenantId}`);
    } finally {
      vi.stubGlobal('fetch', oldFetch);
      await hocuspocus.hooks('onDisconnect', { documentName: roomName, socketId: connection.socketId });
      expect(extension.listConnections.size).toBe(0);
      expect(extension.connectionExpiryTimers.size).toBe(0);
      await hocuspocus.destroy();
    }
    expect(pSubscribeMock).toHaveBeenCalled();
    expect(connection.sendStateless).toHaveBeenCalledTimes(1);
    expect(document.broadcastStateless).not.toHaveBeenCalled();
  });
  it('uses the installed Hocuspocus authentication message for authorized ticket room readiness', async () => {
    process.env.HOCUSPOCUS_JWT_SECRET = 'ticket-change-test-secret';
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign({ scope: 'ticket-changes', tenantId, userId, sessionId, iat: now, exp: now + 300 },
      process.env.HOCUSPOCUS_JWT_SECRET, { algorithm: 'HS256', audience: 'ticket-changes' });
    const { Hocuspocus } = await import('../../../../../hocuspocus/node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js');
    const { HocuspocusProvider } = await import('@hocuspocus/provider');
    const { resolveDocumentAuthenticationContext, resolveDocumentConnectionContext } = await import('../../../../../hocuspocus/ticketChangeConnectionContext.js');
    let authenticatedContext: Record<string, unknown> | undefined;
    const authenticate = async (data: any) => {
      const result = await resolveDocumentAuthenticationContext(data);
      authenticatedContext = result;
      return result;
    };
    const server = new Hocuspocus({ onAuthenticate: authenticate, onConnect: resolveDocumentConnectionContext, quiet: true });
    await server.listen(0);
    const room = `tenant:${tenantId}:ticket-changes`;
    const makeProvider = (authToken: string) => new HocuspocusProvider({ url: server.webSocketURL, name: room, token: authToken, preserveConnection: false });
    const waitFor = (provider: InstanceType<typeof HocuspocusProvider>, event: string) => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 3000);
      provider.on(event, () => { clearTimeout(timeout); resolve(); });
    });
    const accepted = makeProvider(token);
    try {
      await waitFor(accepted, 'authenticated');
      expect(server.documents.get(room)?.connections.size).toBe(1);
      expect(authenticatedContext?.ticketChangesAccess).toMatchObject({ tenantId, userId });

      const rejected = makeProvider('invalid');
      try {
        await waitFor(rejected, 'authenticationFailed');
        expect(server.documents.get(room)?.connections.size).toBe(1);
      } finally { rejected.destroy(); }

    } finally {
      accepted.destroy();
      await server.destroy();
    }
  });
  it('keeps recipient-only payloads off the cross-instance Redis broadcast bus', async () => {
    const { Document, OutgoingMessage, IncomingMessage, MessageReceiver } = await import('../../../../../hocuspocus/node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js');
    const { TicketUpdatesExtension } = await import('../../../../../hocuspocus/TicketUpdatesExtension.js');
    const room = 'tenant:tenant-a:ticket-changes';
    const local = new Document(room);
    const remote = new Document(room);
    const principal = (userId: string) => ({
      webSocket: {}, send: vi.fn(), sendStateless: vi.fn(), close: vi.fn(),
      context: { ticketChangesAccess: { tenantId: 'tenant-a', userId, expiresAt: Date.now() + 60_000 } },
    });
    const allowed = principal('allowed');
    const localDenied = principal('denied');
    const remoteDenied = principal('remote-denied');
    local.addConnection(allowed as any).addConnection(localDenied as any);
    remote.addConnection(remoteDenied as any);
    // Match extension-redis's actual encoding and receiving path. A filtered
    // Document.broadcastStateless still invokes this hook without its filter.
    const forwarded = vi.fn((_document: unknown, payload: string) => {
      const wire = new OutgoingMessage(room).writeBroadcastStateless(payload).toUint8Array();
      const incoming = new IncomingMessage(wire);
      incoming.writeVarString(incoming.readVarString());
      new MessageReceiver(incoming).apply(remote);
    });
    local.beforeBroadcastStateless(forwarded);
    const extension = new TicketUpdatesExtension({ listChangeApiKey: 'internal-key' });
    extension.instance = { documents: new Map([[room, local]]) };
    await extension.connected({ documentName: room, context: allowed.context, connectionInstance: allowed });
    await extension.connected({ documentName: room, context: localDenied.context, connectionInstance: localDenied });
    const change = { ticketId: 'restricted-ticket', updatedAt: new Date().toISOString(), searchText: 'restricted title' };
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({
      ok: true, json: async () => ({ change: JSON.parse(init.body as string).userId === 'allowed' ? change : null }),
    })));
    try {
      await extension.handleListMessage(JSON.stringify(change), 'ticket-list-changes:tenant-a');
      expect(allowed.sendStateless).toHaveBeenCalledWith(JSON.stringify(change));
      expect(localDenied.sendStateless).not.toHaveBeenCalled();
      expect(remoteDenied.sendStateless).not.toHaveBeenCalled();
      expect(forwarded).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      await extension.onDestroy();
      local.destroy();
      remote.destroy();
    }
  });

});
