import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmulatorHost, loadScenarioDir } from '@alga-psa/emulator-host';
import { SUITE_EMULATORS } from '../src/index';

let host: EmulatorHost;
let control: string;

beforeAll(async () => {
  host = new EmulatorHost({
    emulators: SUITE_EMULATORS,
    controlPort: 0,
    ports: Object.fromEntries(SUITE_EMULATORS.map((emulator) => [emulator.id, 0])),
    scenarios: loadScenarioDir(new URL('../scenarios', import.meta.url).pathname),
  });
  const { controlPort } = await host.start();
  control = `http://127.0.0.1:${controlPort}`;
});

afterAll(async () => {
  await host.stop();
});

describe('emulator suite', () => {
  it('boots all emulators with distinct ports and a full catalog', async () => {
    const catalog = ((await (await fetch(`${control}/control/catalog`)).json()) as any).result;
    expect(catalog.emulators.map((emu: any) => emu.id).sort()).toEqual([
      'msgraph',
      'qbo',
      'smtp-sink',
      'stripe',
      'webhook-sink',
    ]);
    const ports = catalog.emulators.map((emu: any) => emu.port);
    expect(new Set(ports).size).toBe(ports.length);
    for (const emu of catalog.emulators) {
      expect(emu.stateViews.length).toBeGreaterThan(0);
    }
  });

  it('runs the bundled scenarios end to end', async () => {
    const scenarios = ((await (await fetch(`${control}/control/scenarios`)).json()) as any).result;
    expect(scenarios.map((s: any) => s.name).sort()).toEqual(['demo-billing-cycle', 'token-trouble']);

    const run = await fetch(`${control}/control/scenarios/demo-billing-cycle/run`, { method: 'POST' });
    expect(run.status).toBe(200);

    const invoices = ((await (await fetch(`${control}/control/qbo/state/invoices`)).json()) as any).result;
    expect(invoices).toHaveLength(1);
    const messages = ((await (await fetch(`${control}/control/msgraph/state/messages`)).json()) as any).result;
    expect(messages[0].subject).toBe('Server down at Acme');
  });
});
