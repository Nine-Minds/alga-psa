import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import threecxEmulator from '../src/index';

let host: EmulatorHost;
let base: string;
let control: string;
let server: http.Server;
let serverPort: number;
const received: Array<{ method: string; url: string; body: string }> = [];

async function controlPost(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${control}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
}

beforeAll(async () => {
  // A stand-in AlgaPSA server: lookup returns a contact, report-call returns 202.
  server = http
    .createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      received.push({ method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
      if ((req.url ?? '').includes('report-call')) {
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accepted: true, providerCallId: 'hash-1' }));
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ contacts: [{ contactUrl: 'x', firstName: 'A', lastName: 'B', companyName: '', email: '', phone: '+15551234567' }] }));
      }
    })
    .listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  serverPort = (server.address() as { port: number }).port;

  host = new EmulatorHost({ emulators: [threecxEmulator], controlPort: 0, ports: { threecx: 0 } });
  const { controlPort, ports } = await host.start();
  base = `http://127.0.0.1:${ports.threecx}`;
  control = `http://127.0.0.1:${controlPort}`;
});

afterAll(async () => {
  await host?.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('threecx emulator suite integration', () => {
  it('T115: the host binds the vendor surface and the control API lists the crm actions', async () => {
    const health = await fetch(`${base}/`).then((r) => r.json());
    expect(health).toMatchObject({ ok: true, emulator: 'threecx' });

    const manifest = await fetch(`${control}/control/catalog`).then((r) => r.json());
    const text = JSON.stringify(manifest);
    expect(text).toContain('threecx');
    for (const action of ['crm-configure', 'crm-inbound-call', 'crm-outbound-call', 'crm-search']) {
      expect(text).toContain(action);
    }
  });

  it('T124: drives the whole loop against a running server and records both exchanges', async () => {
    await controlPost('/control/threecx/actions/crm-configure', {
      baseUrl: `http://127.0.0.1:${serverPort}`,
      tenantSlug: 'abcdef012345',
      apiKey: 'the-key',
    });

    const result = await controlPost('/control/threecx/actions/crm-inbound-call', {
      number: '+15551234567',
      agentEmail: 'agent@example.com',
      durationSeconds: 20,
    });
    expect(result.ok).toBe(true);

    const exchanges = await fetch(`${control}/control/threecx/state/exchanges`).then((r) => r.json());
    const list = exchanges.result ?? exchanges;
    expect(Array.isArray(list) ? list.length : 0).toBe(2);

    // The stand-in server saw a GET lookup and a POST report-call.
    expect(received.some((r) => r.method === 'GET' && r.url.includes('/lookup'))).toBe(true);
    expect(received.some((r) => r.method === 'POST' && r.url.includes('/report-call'))).toBe(true);
  });
});
