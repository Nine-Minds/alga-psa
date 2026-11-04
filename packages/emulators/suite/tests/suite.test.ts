import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmulatorHost, loadScenarioDir, loadScenarioFile, runScenario } from '@alga-psa/emulator-host';
import { retargetScenario } from '@alga-psa/emulator-levelio';
import { SUITE_EMULATORS } from '../src/index';

let host: EmulatorHost;
let control: string;
let ports: Record<string, number>;

beforeAll(async () => {
  host = new EmulatorHost({
    emulators: SUITE_EMULATORS,
    controlPort: 0,
    ports: Object.fromEntries(SUITE_EMULATORS.map((emulator) => [emulator.id, 0])),
    scenarios: loadScenarioDir(new URL('../scenarios', import.meta.url).pathname),
  });
  const started = await host.start();
  ports = started.ports;
  control = `http://127.0.0.1:${started.controlPort}`;
});

afterAll(async () => {
  await host.stop();
});

describe('emulator suite', () => {
  it('boots all emulators with distinct ports and a full catalog', async () => {
    const catalog = ((await (await fetch(`${control}/control/catalog`)).json()) as any).result;
    expect(catalog.emulators.map((emu: any) => emu.id).sort()).toEqual([
      'huntress',
      'levelio',
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
      'huntress-escalation-multi-org',
      'huntress-incident-lifecycle',
      'levelio-automation-alga-template',
      'levelio-native-webhook-signed',
      'multi-tenant-common-ok',
      'platform-app-authority',
      'redirect-uri-missing',
      'single-tenant-common-rejected',
      'single-tenant-tenant-authority-ok',
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

  describe('Entra tenancy scenarios', () => {
    const CUSTOMER = 'bbbbbbbb-1111-4111-8111-111111111111';
    const NINEMINDS = '99999999-9999-4999-8999-999999999999';
    const REDIRECT = 'http://localhost:3000/api/auth/callback/azure-ad';
    const run = async (name: string) => {
      expect((await fetch(`${control}/control/scenarios/${name}/run`, { method: 'POST' })).status).toBe(200);
    };
    const authorize = (authority: string, clientId: string, redirectUri = REDIRECT) =>
      fetch(`http://127.0.0.1:${ports.msgraph}/${authority}/oauth2/v2.0/authorize?${new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, state: 's',
      })}`, { redirect: 'manual' });
    const tid = async (authority: string, clientId: string, clientSecret: string, location: string) => {
      const response = await fetch(`http://127.0.0.1:${ports.msgraph}/${authority}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret,
          code: new URL(location).searchParams.get('code')!, redirect_uri: REDIRECT,
        }),
      });
      expect(response.status).toBe(200);
      const token = ((await response.json()) as any).access_token as string;
      return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).tid;
    };

    it('single-tenant-common-rejected: 50194 redirect', async () => {
      await run('single-tenant-common-rejected');
      const response = await authorize('common', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
      const location = new URL(response.headers.get('location')!);
      expect(location.searchParams.get('error_description')).toContain('AADSTS50194');
      expect(location.searchParams.get('state')).toBe('s');
    });

    it('single-tenant-tenant-authority-ok: home tenant authority issues a home-tenant token', async () => {
      await run('single-tenant-tenant-authority-ok');
      const response = await authorize(CUSTOMER, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
      expect(await tid(CUSTOMER, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'single-tenant-secret', response.headers.get('location')!)).toBe(CUSTOMER);
    });

    it('multi-tenant-common-ok: tid is the user directory', async () => {
      await run('multi-tenant-common-ok');
      const response = await authorize('common', 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa');
      expect(await tid('common', 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', 'multi-tenant-secret', response.headers.get('location')!)).toBe(CUSTOMER);
    });

    it('redirect-uri-missing: hosted 50011 page, no redirect', async () => {
      await run('redirect-uri-missing');
      const response = await authorize('common', 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa', 'http://elsewhere.example/cb');
      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).toContain('AADSTS50011');
    });

    it('platform-app-authority: both issuer kinds side by side', async () => {
      await run('platform-app-authority');
      const platform = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
      const customer = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
      const ok = await authorize('common', platform);
      expect(await tid('common', platform, 'platform-secret', ok.headers.get('location')!)).toBe(CUSTOMER);
      const regression = await authorize(NINEMINDS, platform);
      expect(regression.status).toBe(400);
      expect(await regression.text()).toContain('AADSTS50020');
      expect(new URL((await authorize('common', customer)).headers.get('location')!).searchParams.get('error_description')).toContain('AADSTS50194');
      expect((await authorize(CUSTOMER, customer)).status).toBe(302);
      expect(await (await authorize('cccccccc-2222-4222-8222-cccccccccccc', customer)).text()).toContain('AADSTS700016');
    });
  });

  describe('Level alert-ingestion scenarios, aimed at webhook-sink', () => {
    const scenario = (name: string) =>
      retargetScenario(loadScenarioFile(new URL(`../scenarios/${name}.yaml`, import.meta.url).pathname), {
        'http://localhost:4030': `http://127.0.0.1:${ports['webhook-sink']}`,
      });
    const sinkRequests = async () =>
      ((await (await fetch(`${control}/control/webhook-sink/state/requests`)).json()) as any).result;

    it('native webhook: signed envelopes with no custom Alga header', async () => {
      await host.reset('webhook-sink');
      await runScenario(host, scenario('levelio-native-webhook-signed'));
      const requests = await sinkRequests();
      expect(requests.map((r: any) => r.body.event_type)).toEqual(['alert_active', 'alert_active']);
      for (const request of requests) {
        expect(request.path).toBe('/api/webhooks/levelio');
        expect(request.headers['x-level-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
        expect(request.headers['x-alga-webhook-secret']).toBeUndefined();
        expect(request.body.data.device_id).toBeTruthy(); // device id lives in the envelope's data
      }
    });

    it('automation template: system variables render, so the three alerts arrive distinct', async () => {
      await host.reset('webhook-sink');
      await runScenario(host, scenario('levelio-automation-alga-template'));
      const requests = await sinkRequests();
      expect(requests).toHaveLength(3);
      expect(requests[0].headers['x-alga-webhook-secret']).toBe('algasim-alga-webhook-secret');
      for (const request of requests) {
        expect(JSON.stringify(request.body)).not.toContain('{{');
      }
      expect(requests.map((r: any) => r.body.device_id)).toEqual([
        'Z2lkOi8vbGV2ZWwvRGV2aWNlLzE',
        'Z2lkOi8vbGV2ZWwvRGV2aWNlLzI',
        'Z2lkOi8vbGV2ZWwvRGV2aWNlLzE',
      ]);
      // WS-01 sits in the unmapped Branch Office child group.
      expect(requests[0].body.group_id).toBe('Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMg');
    });
  });
});
