import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { performWebhookDeliveryRequest, performWebhookDeliveryRequestWithPolicy } from '@/lib/webhooks/delivery';

interface Listener {
  server: http.Server;
  port: number;
  requests: Array<{ method?: string; headers: http.IncomingHttpHeaders }>;
}

const listeners: Listener[] = [];

async function listen(host: string, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<Listener> {
  const requests: Listener['requests'] = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, headers: req.headers });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const listener = { server, port: (server.address() as AddressInfo).port, requests };
  listeners.push(listener);
  return listener;
}

const base = (url: string) => ({
  webhook_id: 'webhook-1',
  url,
  method: 'POST',
  headers: { authorization: 'Bearer secret' },
  payload: { hello: 'world' },
  verify_ssl: true,
});

// Allows only the 127.0.0.2 loopback alias, standing in for a "public" first hop.
const allowOnly127_0_0_2 = (address: string) => address === '127.0.0.2';

describe('webhook delivery SSRF guard over real sockets', () => {
  const originalAllowPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;

  beforeEach(() => {
    delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
  });

  afterEach(async () => {
    if (originalAllowPrivate === undefined) delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    else process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = originalAllowPrivate;
    await Promise.all(listeners.splice(0).map((l) => new Promise((r) => l.server.close(r))));
  });

  it('(a) refuses http://0.0.0.0:<port> without opening a connection', async () => {
    const target = await listen('0.0.0.0', (_req, res) => res.end('secret-internal-body'));
    const result = await performWebhookDeliveryRequest(base(`http://0.0.0.0:${target.port}`));

    expect(result.success).toBe(false);
    expect(result.error_type).toBe('ssrf');
    expect(result.response_body).toBeUndefined();
    expect(result.response_headers).toBeUndefined();
    expect(target.requests).toHaveLength(0);
  });

  it('(b) blocks a redirect from an allowed hop to 0.0.0.0 and returns no body', async () => {
    const target = await listen('0.0.0.0', (_req, res) => res.end('secret-internal-body'));
    const first = await listen('127.0.0.2', (_req, res) => {
      res.writeHead(302, { location: `http://0.0.0.0:${target.port}/` });
      res.end('redirect-body');
    });

    const result = await performWebhookDeliveryRequestWithPolicy(
      base(`http://127.0.0.2:${first.port}/`),
      allowOnly127_0_0_2,
    );

    expect(first.requests).toHaveLength(1);
    expect(target.requests).toHaveLength(0);
    expect(result.success).toBe(false);
    expect(result.error_type).toBe('ssrf');
    expect(result.response_body).toBeUndefined();
    expect(result.response_headers).toBeUndefined();
  });

  it('follows a redirect between allowed hops, switching POST to GET on 302 and stripping credentials cross-origin', async () => {
    const second = await listen('127.0.0.2', (_req, res) => res.end('final'));
    const first = await listen('127.0.0.2', (_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.2:${second.port}/next` });
      res.end();
    });

    const result = await performWebhookDeliveryRequestWithPolicy(base(`http://127.0.0.2:${first.port}/`), allowOnly127_0_0_2);

    expect(result.success).toBe(true);
    expect(result.response_body).toBe('final');
    expect(first.requests[0].method).toBe('POST');
    expect(first.requests[0].headers.authorization).toBe('Bearer secret');
    expect(second.requests[0].method).toBe('GET');
    expect(second.requests[0].headers.authorization).toBeUndefined();
    expect(second.requests[0].headers['content-type']).toBeUndefined();
  });

  it('keeps method and body on 307', async () => {
    const second = await listen('127.0.0.2', (_req, res) => res.end('ok'));
    let served = 0;
    const first = await listen('127.0.0.2', (_req, res) => {
      if (served++ === 0) {
        res.writeHead(307, { location: `/relative` });
        res.end();
      } else {
        res.end('ok');
      }
    });
    const result = await performWebhookDeliveryRequestWithPolicy(base(`http://127.0.0.2:${first.port}/`), allowOnly127_0_0_2);
    expect(result.success).toBe(true);
    expect(first.requests).toHaveLength(2);
    expect(first.requests[1].method).toBe('POST');
    expect(first.requests[1].headers.authorization).toBe('Bearer secret'); // same origin
    expect(second.requests).toHaveLength(0);
  });

  it('fails when more than 3 redirect hops are followed', async () => {
    const loop = await listen('127.0.0.2', (_req, res) => {
      res.writeHead(302, { location: '/again' });
      res.end();
    });
    const result = await performWebhookDeliveryRequestWithPolicy(base(`http://127.0.0.2:${loop.port}/`), allowOnly127_0_0_2);
    expect(result.success).toBe(false);
    expect(result.response_body).toBeUndefined();
    expect(result.error_message).toMatch(/redirect/i);
    expect(loop.requests).toHaveLength(4); // initial + 3 followed hops
  });

  it('refuses an https -> http downgrade redirect', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ssrf-cert-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.2',
      '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
    const plain = await listen('127.0.0.2', (_req, res) => res.end('plain-body'));
    const secure = https.createServer(
      { key: readFileSync(path.join(dir, 'k.pem')), cert: readFileSync(path.join(dir, 'c.pem')) },
      (_req, res) => {
        res.writeHead(302, { location: `http://127.0.0.2:${plain.port}/` });
        res.end();
      },
    );
    await new Promise<void>((resolve) => secure.listen(0, '127.0.0.2', resolve));
    listeners.push({ server: secure as unknown as http.Server, port: 0, requests: [] });
    const port = (secure.address() as AddressInfo).port;

    const result = await performWebhookDeliveryRequestWithPolicy(
      { ...base(`https://127.0.0.2:${port}/`), verify_ssl: false },
      allowOnly127_0_0_2,
    );

    expect(result.success).toBe(false);
    expect(result.error_type).toBe('ssrf');
    expect(result.response_body).toBeUndefined();
    expect(plain.requests).toHaveLength(0);
  });
});
