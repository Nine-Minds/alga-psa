/**
 * Regression guard for the 2026-11 appliance incident: the server declares a
 * top-level onAuthenticate hook (ticket-change rooms), which makes Hocuspocus
 * require an Auth protocol message from EVERY client on EVERY room. Providers
 * that pass the token only as a URL parameter never send that message, so the
 * server's idle-connection timeout closes their sockets with code 4401 and the
 * clients reconnect forever. These tests drive the installed server and the
 * real provider over a real WebSocket to pin both halves of the contract.
 */
import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';

const SECRET = 'auth-required-protocol-test-secret';
const IDLE_TIMEOUT_MS = 500;

function signalToken(secret: string, tenantId: string, userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      scope: 'notification-signals',
      tenantId,
      userId,
      sessionId: '33333333-3333-4333-8333-333333333333',
      iat: now,
      exp: now + 300,
    },
    secret,
    { algorithm: 'HS256', audience: 'notification-signals' },
  );
}

async function startServer() {
  const { Hocuspocus } = await import('../../../../../hocuspocus/node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js');
  const { resolveDocumentAuthenticationContext, resolveDocumentConnectionContext } = await import('../../../../../hocuspocus/ticketChangeConnectionContext.js');
  const server = new Hocuspocus({
    onAuthenticate: resolveDocumentAuthenticationContext,
    onConnect: resolveDocumentConnectionContext,
    timeout: IDLE_TIMEOUT_MS,
    quiet: true,
  });
  await server.listen(0);
  return server;
}

function once(target: { on: (e: string, cb: (arg: any) => void) => void }, event: string, timeoutMs = 3000) {
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    target.on(event, (arg: any) => { clearTimeout(timeout); resolve(arg); });
  });
}

describe('auth-required protocol contract (production hook wiring)', () => {
  it('signal room: a provider with the token option authenticates; a parameters-only provider is closed with 4401', async () => {
    process.env.HOCUSPOCUS_JWT_SECRET = SECRET;
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';
    const token = signalToken(SECRET, tenantId, userId);
    const server = await startServer();
    const { HocuspocusProvider } = await import('@hocuspocus/provider');
    const room = `notification-signals:${tenantId}:${userId}`;
    try {
      // Fixed shape (useInternalNotifications): token option AND URL parameter.
      const fixed = new HocuspocusProvider({
        url: server.webSocketURL,
        name: room,
        token,
        parameters: { token },
        preserveConnection: false,
      });
      try {
        await once(fixed, 'authenticated');
        expect(server.documents.get(room)?.connections.size).toBe(1);
      } finally { fixed.destroy(); }

      // Broken shape: token only in URL parameters, so no Auth message is sent.
      // onConnect still passes (the signal validator reads ?token=), but the
      // server then waits for authentication and kills the idle socket.
      const broken = new HocuspocusProvider({
        url: server.webSocketURL,
        name: room,
        parameters: { token },
        preserveConnection: false,
      });
      try {
        const closed = await once(broken, 'close');
        expect(closed?.event?.code).toBe(4401);
        expect(broken.synced).toBe(false);
      } finally { broken.destroy(); }
    } finally {
      await server.destroy();
    }
  });

  it('document room: the non-empty token option satisfies the handshake while the tenantId URL parameter gates the room', async () => {
    process.env.HOCUSPOCUS_JWT_SECRET = SECRET;
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const documentId = '44444444-4444-4444-8444-444444444444';
    const userId = '22222222-2222-4222-8222-222222222222';
    const server = await startServer();
    const { HocuspocusProvider } = await import('@hocuspocus/provider');
    const room = `document:${tenantId}:${documentId}`;
    try {
      // Fixed shape (CollaborativeEditor / syncCollabSnapshot): the token value
      // is not verified for document rooms; any non-empty string passes.
      const fixed = new HocuspocusProvider({
        url: server.webSocketURL,
        name: room,
        token: userId,
        parameters: { tenantId, userId },
        preserveConnection: false,
      });
      try {
        await once(fixed, 'authenticated');
        expect(server.documents.get(room)?.connections.size).toBe(1);
      } finally { fixed.destroy(); }

      // Broken shape: parameters only. The room gate passes at onConnect, but
      // the missing Auth message means the socket dies at the idle timeout.
      const broken = new HocuspocusProvider({
        url: server.webSocketURL,
        name: room,
        parameters: { tenantId, userId },
        preserveConnection: false,
      });
      try {
        const closed = await once(broken, 'close');
        expect(closed?.event?.code).toBe(4401);
      } finally { broken.destroy(); }

      // A wrong tenant in the URL parameter is still rejected at onConnect.
      const mismatched = new HocuspocusProvider({
        url: server.webSocketURL,
        name: room,
        token: userId,
        parameters: { tenantId: '99999999-9999-4999-8999-999999999999', userId },
        preserveConnection: false,
      });
      try {
        const closed = await once(mismatched, 'close');
        expect(closed?.event?.code).not.toBe(1000);
      } finally { mismatched.destroy(); }
    } finally {
      await server.destroy();
    }
  });
});
