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
      'threecx',
      'webhook-sink',
      'xero',
    ]);
    const ports = catalog.emulators.map((emu: any) => emu.port);
    expect(new Set(ports).size).toBe(ports.length);
    for (const emu of catalog.emulators) {
      expect(emu.stateViews.length).toBeGreaterThan(0);
    }
  });

  it('threecx owns its listener through serve() so the PBX WebSocket shares the port', () => {
    const threecx = SUITE_EMULATORS.find((emulator) => emulator.id === 'threecx')!;
    expect(typeof threecx.serve).toBe('function');
    expect(threecx.wire).toBeUndefined();
  });

  it('runs the bundled scenarios end to end', async () => {
    const scenarios = ((await (await fetch(`${control}/control/scenarios`)).json()) as any).result;
    expect(scenarios.map((s: any) => s.name).sort()).toEqual([
      'demo-billing-cycle',
      'entra-diagnostics-customer-consent',
      'entra-diagnostics-customer-role',
      'entra-diagnostics-empty',
      'entra-diagnostics-expired-secret',
      'entra-diagnostics-green',
      'entra-diagnostics-partner-consent',
      'token-trouble',
    ]);

    const run = await fetch(`${control}/control/scenarios/demo-billing-cycle/run`, { method: 'POST' });
    expect(run.status).toBe(200);

    const invoices = ((await (await fetch(`${control}/control/qbo/state/invoices`)).json()) as any).result;
    expect(invoices).toHaveLength(1);
    const messages = ((await (await fetch(`${control}/control/msgraph/state/messages`)).json()) as any).result;
    expect(messages[0].subject).toBe('Server down at Acme');
  });

  it('loads the Entra green and empty fixtures and arms every diagnostic fault', async () => {
    const run = async (name: string) => {
      const response = await fetch(`${control}/control/scenarios/${name}/run`, { method: 'POST' });
      expect(response.status).toBe(200);
    };
    const state = async (name: string) =>
      ((await (await fetch(`${control}/control/msgraph/state/${name}`)).json()) as any).result;
    await run('entra-diagnostics-green');
    expect(await state('organizations')).toEqual([expect.objectContaining({
      id: 'bbbbbbbb-1111-4111-8111-111111111111', displayName: 'Cedar Grove Dental',
    })]);
    expect(await state('directory-users')).toEqual([expect.objectContaining({
      userPrincipalName: 'jamie@cedar.example',
    })]);
    for (const name of ['customer-consent', 'customer-role', 'expired-secret', 'partner-consent']) {
      await run(`entra-diagnostics-${name}`);
    }
    await run('entra-diagnostics-empty');
    expect(await state('organizations')).toEqual([]);
    expect(await state('directory-users')).toEqual([]);
  });
});
