import { afterEach, describe, expect, it } from 'vitest';
import { EmulatorHost } from '../src/host';
import type { EmulatorPackage } from '../src/types';

describe('vendor request evidence', () => {
  let host: EmulatorHost | undefined;
  afterEach(async () => { await host?.stop(); host = undefined; });

  async function start(options: { limit?: number; arrived?: () => void; release?: Promise<void>; nonHttp?: boolean } = {}) {
    const pkg: EmulatorPackage = {
      id: 'probe', displayName: 'Request evidence probe', defaultPort: 0,
      createCore: () => ({ reset() {} }), register() {},
      ...(options.nonHttp ? { serve: async () => ({ port: 0, async close() {} }) } : {
        wire(router) {
          router.get('/ok', (_req, res) => { res.json({ value: 'ok' }); });
          router.get('/delayed', async (_req, res) => {
            options.arrived?.();
            await options.release;
            res.json({ value: 'delayed' });
          });
        },
      }),
    };
    host = new EmulatorHost({ emulators: [pkg], controlPort: 0, requestHistoryLimit: options.limit, log() {} });
    await host.start();
    return { vendor: `http://127.0.0.1:${host.instance('probe').port}`, control: `http://127.0.0.1:${host.controlPort}` };
  }

  async function control(base: string, suffix: string, body?: unknown) {
    const response = await fetch(`${base}/control/probe/${suffix}`, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(response.ok).toBe(true);
    const payload = await response.json() as { ok: boolean; result: any };
    expect(payload.ok).toBe(true);
    return payload.result;
  }

  it('records real vendor requests including transport failures without credentials or response bodies', async () => {
    const { vendor, control: base } = await start();
    expect(await (await fetch(`${vendor}/ok?access_token=query-secret`, {
      headers: { authorization: 'Bearer header-secret', cookie: 'session=cookie-secret' },
    })).json()).toEqual({ value: 'ok' });
    await control(base, 'faults/transport:error/arm', { status: 429 });
    const failed = await fetch(`${vendor}/ok`);
    expect(failed.status).toBe(429);
    expect(failed.headers.get('retry-after')).toBe('1');
    const evidence = await control(base, 'requests');
    expect(evidence).toMatchObject({ supported: true, complete: true, dropped: 0 });
    expect(evidence.requests).toEqual([
      expect.objectContaining({ sequence: 1, method: 'GET', path: '/ok', status: 200, aborted: false }),
      expect.objectContaining({ sequence: 2, method: 'GET', path: '/ok', status: 429, aborted: false }),
    ]);
    for (const item of evidence.requests) {
      expect(Number.isFinite(Date.parse(item.startedAt))).toBe(true);
      expect(item.durationMs).toBeGreaterThanOrEqual(0);
    }
    for (const secret of ['query-secret', 'header-secret', 'cookie-secret', 'access_token']) {
      expect(JSON.stringify(evidence)).not.toContain(secret);
    }
  });

  it('marks truncated history incomplete and resets records and faults for the next scenario', async () => {
    const { vendor, control: base } = await start({ limit: 2 });
    for (let index = 0; index < 3; index++) await (await fetch(`${vendor}/ok`)).text();
    const before = await control(base, 'requests');
    expect(before).toMatchObject({ complete: false, capacity: 2, dropped: 1 });
    expect(before.requests.map((item: { sequence: number }) => item.sequence)).toEqual([2, 3]);
    await control(base, 'faults/transport:error/arm', { status: 503 });
    await control(base, 'reset', {});
    expect(await control(base, 'requests')).toMatchObject({ complete: true, dropped: 0, requests: [], generation: before.generation + 1 });
    expect((await fetch(`${vendor}/ok`)).status).toBe(200);
    expect((await control(base, 'requests')).requests).toEqual([expect.objectContaining({ sequence: 1, status: 200 })]);
  });

  it('does not carry a previous scenario’s delayed completion into the new history', async () => {
    let arrived!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { arrived = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const { vendor, control: base } = await start({ arrived, release: waiting });
    const delayed = fetch(`${vendor}/delayed`);
    await started;
    try {
      expect(await control(base, 'requests')).toMatchObject({ complete: false, inFlight: 1, requests: [] });
      await control(base, 'reset', {});
    } finally { release(); }
    expect((await delayed).status).toBe(200);
    await (await fetch(`${vendor}/ok`)).text();
    const evidence = await control(base, 'requests');
    expect(evidence).toMatchObject({ complete: true, inFlight: 0 });
    expect(evidence.requests).toEqual([expect.objectContaining({ sequence: 1, path: '/ok' })]);
  });

  it('does not report completion until a delayed vendor operation finishes', async () => {
    let arrived!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { arrived = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const { vendor, control: base } = await start({ arrived, release: waiting });
    const delayed = fetch(`${vendor}/delayed`);
    await started;
    try {
      expect(await control(base, 'requests')).toMatchObject({ complete: false, inFlight: 1, requests: [] });
    } finally { release(); }
    expect(await (await delayed).json()).toEqual({ value: 'delayed' });
    expect(await control(base, 'requests')).toMatchObject({ complete: true, inFlight: 0,
      requests: [expect.objectContaining({ sequence: 1, path: '/delayed', status: 200 })] });
  });

  it('records connection resets as aborted rather than an HTTP success', async () => {
    const { vendor, control: base } = await start();
    await control(base, 'faults/transport:connection-reset/arm', {});
    await expect(fetch(`${vendor}/ok`)).rejects.toThrow();
    await expect.poll(async () => (await control(base, 'requests')).requests.length).toBeGreaterThan(0);
    for (const item of (await control(base, 'requests')).requests) {
      expect(item).toMatchObject({ path: '/ok', status: null, aborted: true });
    }
  });

  it('reports unsupported protocols explicitly instead of claiming an empty complete HTTP history', async () => {
    const { control: base } = await start({ nonHttp: true });
    expect(await control(base, 'requests')).toMatchObject({ supported: false, complete: false, requests: [] });
  });
});
