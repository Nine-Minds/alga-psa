import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hostnames below are non-resolvable (.test); the mocked resolver is the only
// thing that can map them, so a connection can only succeed if the socket was
// pinned to the address the validating lookup returned.
const dnsState = vi.hoisted(() => ({ table: new Map<string, string[]>() }));

vi.mock('node:dns/promises', () => {
  const lookup = async (hostname: string) => {
    const addresses = dnsState.table.get(hostname);
    if (!addresses) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return { default: { lookup }, lookup };
});

import { performWebhookDeliveryRequestWithPolicy } from '@/lib/webhooks/delivery';

interface Listener {
  server: http.Server;
  port: number;
  requests: number;
}

const listeners: Listener[] = [];

async function listen(host: string, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<Listener> {
  const server = http.createServer((req, res) => {
    listener.requests++;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const listener: Listener = { server, port: (server.address() as AddressInfo).port, requests: 0 };
  listeners.push(listener);
  return listener;
}

const base = (url: string) => ({
  webhook_id: 'webhook-1',
  url,
  method: 'POST',
  headers: {},
  payload: { hello: 'world' },
  verify_ssl: true,
});

const allowOnly127_0_0_2 = (address: string) => address === '127.0.0.2';

describe('webhook delivery SSRF guard: hostnames and pinned lookup over real sockets', () => {
  const originalAllowPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;

  beforeEach(() => {
    delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    dnsState.table.clear();
  });

  afterEach(async () => {
    if (originalAllowPrivate === undefined) delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    else process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = originalAllowPrivate;
    await Promise.all(listeners.splice(0).map((l) => new Promise((r) => l.server.close(r))));
  });

  it('connects a hostname to the validated address returned by the pinned lookup', async () => {
    const allowed = await listen('127.0.0.2', (_req, res) => res.end('pinned-ok'));
    dnsState.table.set('rebind.test', ['127.0.0.2']);

    const result = await performWebhookDeliveryRequestWithPolicy(
      base(`http://rebind.test:${allowed.port}/`),
      allowOnly127_0_0_2,
    );

    expect(result.success).toBe(true);
    expect(result.response_body).toBe('pinned-ok');
    expect(allowed.requests).toBe(1);
  });

  it.each([
    ['resolves to a blocked address', ['127.0.0.1']],
    ['rebinds to a mix of allowed and blocked addresses', ['127.0.0.2', '127.0.0.1']],
  ])('refuses a hostname that %s', async (_label, addresses) => {
    const blockedTarget = await listen('127.0.0.1', (_req, res) => res.end('secret-internal-body'));
    const allowed = await listen('127.0.0.2', (_req, res) => res.end('should-not-be-reached'));
    dnsState.table.set('rebind.test', addresses);

    const result = await performWebhookDeliveryRequestWithPolicy(
      base(`http://rebind.test:${blockedTarget.port}/`),
      allowOnly127_0_0_2,
    );

    expect(result.success).toBe(false);
    expect(result.error_type).toBe('ssrf');
    expect(result.response_body).toBeUndefined();
    expect(result.response_headers).toBeUndefined();
    expect(blockedTarget.requests).toBe(0);
    expect(allowed.requests).toBe(0);
  });

  it('blocks a redirect whose Location is a hostname resolving to a blocked address', async () => {
    const target = await listen('127.0.0.1', (_req, res) => res.end('secret-internal-body'));
    const first = await listen('127.0.0.2', (_req, res) => {
      res.writeHead(302, { location: `http://internal.test:${target.port}/` });
      res.end('redirect-body');
    });
    dnsState.table.set('first.test', ['127.0.0.2']);
    dnsState.table.set('internal.test', ['127.0.0.1']);

    const result = await performWebhookDeliveryRequestWithPolicy(
      base(`http://first.test:${first.port}/`),
      allowOnly127_0_0_2,
    );

    expect(first.requests).toBe(1);
    expect(target.requests).toBe(0);
    expect(result.success).toBe(false);
    expect(result.error_type).toBe('ssrf');
    expect(result.response_body).toBeUndefined();
    expect(result.response_headers).toBeUndefined();
  });
});
