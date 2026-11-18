import http from 'node:http';
import { EmulatorHost } from '@alga-psa/emulator-host';
import levelio from '../src/index';
import type { LevelEmulatorCore } from '../src/core';

export interface Received {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  rawBody: string;
}

/** A local HTTP receiver whose answer is set per test. */
export async function startReceiver() {
  const received: Received[] = [];
  let respond: (req: Received) => { status: number; body?: string } = () => ({ status: 200, body: '{"ok":true}' });
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const entry: Received = {
      method: req.method ?? '',
      path: req.url ?? '',
      headers: req.headers,
      rawBody: Buffer.concat(chunks).toString('utf8'),
    };
    received.push(entry);
    const answer = respond(entry);
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(answer.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    url,
    received,
    respondWith(fn: typeof respond) {
      respond = fn;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function startLevel() {
  const host = new EmulatorHost({ emulators: [levelio], controlPort: 0, ports: { levelio: 0 } });
  const { controlPort, ports } = await host.start();
  const control = `http://127.0.0.1:${controlPort}`;
  const call = async (kind: 'seed' | 'actions', name: string, params: unknown = {}) => {
    const response = await fetch(`${control}/control/levelio/${kind}/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = (await response.json()) as { ok: boolean; result?: any; error?: string };
    if (!json.ok) throw new Error(`${kind}/${name} failed: ${json.error}`);
    return json.result;
  };
  return {
    host,
    control,
    vendor: `http://127.0.0.1:${ports.levelio}`,
    core: host.instance('levelio').core as LevelEmulatorCore,
    seed: (name: string, params?: unknown) => call('seed', name, params),
    action: (name: string, params?: unknown) => call('actions', name, params),
    arm: async (name: string, params: unknown = {}) => {
      const response = await fetch(`${control}/control/levelio/faults/${name}/arm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (response.status !== 200) throw new Error(`arm ${name} failed: ${await response.text()}`);
    },
    state: async (view: string) =>
      ((await (await fetch(`${control}/control/levelio/state/${view}`)).json()) as { result: any }).result,
    reset: () => fetch(`${control}/control/levelio/reset`, { method: 'POST' }),
  };
}
