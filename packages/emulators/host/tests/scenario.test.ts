import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EmulatorHost } from '../src/host';
import { parseScenario } from '../src/scenario';
import type { ControlRegistry, EmulatorPackage } from '../src/types';

let value = 0;
let broken = false;

const gauge: EmulatorPackage = {
  id: 'gauge',
  displayName: 'Gauge',
  defaultPort: 0,
  createCore: () => ({
    reset() {
      value = 0;
      broken = false;
    },
  }),
  wire(router) {
    router.get('/value', (_req, res) => {
      res.json({ value });
    });
  },
  register(reg: ControlRegistry) {
    reg.seeder({
      name: 'value',
      description: 'Set the gauge',
      params: z.object({ value: z.number() }),
      run: (params) => {
        value = params.value;
        return { value };
      },
    });
    reg.action({ name: 'bump', description: 'Increment', run: () => ({ value: (value += 1) }) });
    reg.fault({
      name: 'break',
      description: 'Break the gauge',
      arm: () => {
        broken = true;
      },
      disarm: () => {
        broken = false;
      },
    });
    reg.stateView({ name: 'gauge', description: 'Value and health', get: () => ({ value, broken }) });
  },
};

describe('scenario runner', () => {
  let host: EmulatorHost | undefined;

  afterEach(async () => {
    await host?.stop();
    host = undefined;
  });

  it('runs steps in order through the control API', async () => {
    host = new EmulatorHost({
      emulators: [gauge],
      controlPort: 0,
      scenarios: [
        parseScenario({
          name: 'warm-up',
          description: 'Seed, bump twice, break, jump a month',
          steps: [
            { reset: 'gauge' },
            { seed: 'gauge/value', params: { value: 10 } },
            { action: 'gauge/bump' },
            { action: 'gauge/bump' },
            { arm: 'gauge/break' },
            { advance: '30d' },
          ],
        }),
      ],
    });
    await host.start();

    const listed = await fetch(`http://localhost:${host.controlPort}/control/scenarios`);
    expect(((await listed.json()) as any).result).toEqual([
      { name: 'warm-up', description: 'Seed, bump twice, break, jump a month', stepCount: 6 },
    ]);

    const run = await fetch(`http://localhost:${host.controlPort}/control/scenarios/warm-up/run`, { method: 'POST' });
    const payload = (await run.json()) as any;
    expect(run.status).toBe(200);
    expect(payload.result.steps).toHaveLength(6);
    expect(payload.result.steps[3].result).toEqual({ value: 12 });
    expect(payload.result.steps[5].result.offsetMs).toBe(30 * 86_400_000);
    expect(value).toBe(12);
    expect(broken).toBe(true);
    expect(host.clock.offset).toBe(30 * 86_400_000);
  });

  it('runs inline scenarios and reports the failing step', async () => {
    host = new EmulatorHost({ emulators: [gauge], controlPort: 0 });
    await host.start();

    const bad = await fetch(`http://localhost:${host.controlPort}/control/scenario`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'doomed',
        steps: [{ action: 'gauge/bump' }, { action: 'gauge/no-such-action' }],
      }),
    });
    expect(bad.status).toBe(404);
    expect(((await bad.json()) as any).error).toMatch(/failed at step 2/);

    const unknown = await fetch(`http://localhost:${host.controlPort}/control/scenarios/nope/run`, { method: 'POST' });
    expect(unknown.status).toBe(404);
  });

  it('rejects malformed scenarios', () => {
    expect(() => parseScenario({ name: 'x', steps: [] })).toThrow(/Invalid scenario/);
    expect(() => parseScenario({ name: 'x', steps: [{ seed: 'no-slash' }] })).not.toThrow();
  });
});
