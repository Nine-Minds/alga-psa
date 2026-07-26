import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Router } from 'express';
import { EmulatorHost } from '../src/host';
import type { ControlRegistry, EmulatorCore, EmulatorPackage, HostEnv } from '../src/types';

/** Minimal but complete emulator: a counter with one action, view, seeder, and domain fault. */
class CounterCore implements EmulatorCore {
  value = 0;
  frozen = false;
  constructor(private readonly env: HostEnv) {}

  increment(by: number): number {
    if (this.frozen) throw new Error('counter is frozen');
    this.value += by;
    return this.value;
  }

  reset(): void {
    this.value = 0;
    this.frozen = false;
  }

  snapshot(): { value: number; at: string } {
    return { value: this.value, at: this.env.clock.now().toISOString() };
  }
}

const counterEmulator: EmulatorPackage<CounterCore> = {
  id: 'counter',
  displayName: 'Counter',
  defaultPort: 0,
  createCore: (env) => new CounterCore(env),
  wire(router: Router, core: CounterCore) {
    router.get('/value', (_req, res) => {
      res.json(core.snapshot());
    });
  },
  register(reg: ControlRegistry, core: CounterCore) {
    reg.action({
      name: 'increment',
      description: 'Add to the counter',
      params: z.object({ by: z.number().int().default(1) }),
      run: ({ by }) => ({ value: core.increment(by) }),
    });
    reg.fault({
      name: 'freeze',
      description: 'Make increments fail',
      arm: () => {
        core.frozen = true;
      },
      disarm: () => {
        core.frozen = false;
      },
    });
    reg.stateView({ name: 'snapshot', description: 'Current value and time', get: () => core.snapshot() });
    reg.seeder({
      name: 'starting-value',
      description: 'Set the counter directly',
      params: z.object({ value: z.number().int() }),
      run: ({ value }) => {
        core.value = value;
        return core.snapshot();
      },
    });
  },
};

async function controlPost(host: EmulatorHost, path: string, body?: unknown): Promise<{ status: number; payload: any }> {
  const response = await fetch(`http://localhost:${host.controlPort}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, payload: await response.json() };
}

async function controlGet(host: EmulatorHost, path: string): Promise<{ status: number; payload: any }> {
  const response = await fetch(`http://localhost:${host.controlPort}${path}`);
  return { status: response.status, payload: await response.json() };
}

describe('EmulatorHost', () => {
  let host: EmulatorHost | undefined;

  afterEach(async () => {
    await host?.stop();
    host = undefined;
  });

  async function startHost(): Promise<EmulatorHost> {
    host = new EmulatorHost({ emulators: [counterEmulator], controlPort: 0 });
    await host.start();
    return host;
  }

  it('serves the vendor surface and the generated control surface', async () => {
    const h = await startHost();
    const vendorPort = h.instance('counter').port;

    const vendor = await fetch(`http://localhost:${vendorPort}/value`);
    expect(vendor.status).toBe(200);
    expect(((await vendor.json()) as { value: number }).value).toBe(0);

    const action = await controlPost(h, '/control/counter/actions/increment', { by: 2 });
    expect(action.payload).toMatchObject({ ok: true, result: { value: 2 } });

    const badParams = await controlPost(h, '/control/counter/actions/increment', { by: 1.5 });
    expect(badParams.status).toBe(400);

    const view = await controlGet(h, '/control/counter/state/snapshot');
    expect(view.payload.result.value).toBe(2);

    const seeded = await controlPost(h, '/control/counter/seed/starting-value', { value: 40 });
    expect(seeded.payload.result.value).toBe(40);

    const catalog = await controlGet(h, '/control/catalog');
    const entry = catalog.payload.result.emulators[0];
    expect(entry.id).toBe('counter');
    expect(entry.actions.map((a: { name: string }) => a.name)).toContain('increment');
    expect(entry.faults.map((f: { name: string }) => f.name)).toEqual(
      expect.arrayContaining(['transport:latency', 'transport:error', 'transport:connection-reset', 'freeze']),
    );
  });

  it('arms domain faults, transport faults, and resets everything', async () => {
    const h = await startHost();
    const vendorPort = h.instance('counter').port;

    await controlPost(h, '/control/counter/faults/freeze/arm');
    const frozen = await controlPost(h, '/control/counter/actions/increment', { by: 1 });
    expect(frozen.status).toBe(500);
    expect(frozen.payload.error).toMatch(/frozen/);

    await controlPost(h, '/control/counter/faults/transport:error/arm', { status: 503 });
    const vendor503 = await fetch(`http://localhost:${vendorPort}/value`);
    expect(vendor503.status).toBe(503);

    await controlPost(h, '/control/counter/faults/transport:error/disarm');
    expect((await fetch(`http://localhost:${vendorPort}/value`)).status).toBe(200);

    await controlPost(h, '/control/counter/seed/starting-value', { value: 7 });
    await controlPost(h, '/control/counter/faults/transport:error/arm', { status: 500 });
    await controlPost(h, '/control/counter/reset');
    expect((await fetch(`http://localhost:${vendorPort}/value`)).status).toBe(200);
    const view = await controlGet(h, '/control/counter/state/snapshot');
    expect(view.payload.result.value).toBe(0);
    const unfrozen = await controlPost(h, '/control/counter/actions/increment', { by: 1 });
    expect(unfrozen.payload).toMatchObject({ ok: true, result: { value: 1 } });
  });

  it('injects 429 with Retry-After and resets connections', async () => {
    const h = await startHost();
    const vendorPort = h.instance('counter').port;

    await controlPost(h, '/control/counter/faults/transport:error/arm', { status: 429 });
    const throttled = await fetch(`http://localhost:${vendorPort}/value`);
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get('retry-after')).toBe('1');
    await controlPost(h, '/control/counter/faults/transport:error/disarm');

    await controlPost(h, '/control/counter/faults/transport:connection-reset/arm');
    await expect(fetch(`http://localhost:${vendorPort}/value`)).rejects.toThrow();
    await controlPost(h, '/control/counter/faults/transport:connection-reset/disarm');
    expect((await fetch(`http://localhost:${vendorPort}/value`)).status).toBe(200);
  });

  it('advances the shared virtual clock', async () => {
    const h = await startHost();
    const before = new Date((await controlGet(h, '/control/counter/state/snapshot')).payload.result.at).getTime();

    const advanced = await controlPost(h, '/control/clock/advance', { duration: '32d' });
    expect(advanced.payload.result.offsetMs).toBe(32 * 86_400_000);

    const after = new Date((await controlGet(h, '/control/counter/state/snapshot')).payload.result.at).getTime();
    expect(after - before).toBeGreaterThanOrEqual(32 * 86_400_000);

    const rejected = await controlPost(h, '/control/clock/advance', { duration: 'yesterday' });
    expect(rejected.status).toBe(500);
  });

  it('404s unknown emulators and controls', async () => {
    const h = await startHost();
    expect((await controlPost(h, '/control/nope/reset')).status).toBe(404);
    expect((await controlPost(h, '/control/counter/actions/nope')).status).toBe(404);
    expect((await controlGet(h, '/control/counter/state/nope')).status).toBe(404);
  });
});
