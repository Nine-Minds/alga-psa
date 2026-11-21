import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { postImapOAuthToken } from '@alga-psa/shared/services/email/imapOauthToken';

const servers: Server[] = [];

async function listen(server: Server): Promise<number> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as { port: number }).port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

describe('credential-bearing IMAP OAuth POST redirect handling', () => {
  it('stops at the redirect response and sends no form data to the redirected recipient', async () => {
    let originalBody = '';
    const redirectedRequests: Array<{ body: string; headers: Record<string, string | string[] | undefined> }> = [];
    const recipient = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        redirectedRequests.push({ body, headers: request.headers });
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'redirected-token' }));
      });
    });
    const recipientPort = await listen(recipient);

    const original = createServer((request, response) => {
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { originalBody += chunk; });
      request.on('end', () => {
        response.writeHead(302, { Location: `http://127.0.0.1:${recipientPort}/token` }).end();
      });
    });
    const originalPort = await listen(original);

    await expect(postImapOAuthToken(
      `http://127.0.0.1:${originalPort}/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'synthetic-refresh-credential',
        client_secret: 'synthetic-client-secret',
      })
    )).rejects.toMatchObject({ response: { status: 302 } });

    expect(originalBody).toContain('synthetic-refresh-credential');
    expect(originalBody).toContain('synthetic-client-secret');
    expect(redirectedRequests).toEqual([]);
  });
});
