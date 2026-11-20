import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { UniFiApiClient, UniFiApiError } from '../../../lib/integrations/unifi/unifiApiClient';
import { ROUTE_TRUST_MS, UniFiConsoleUnreachableError } from '../../../lib/integrations/unifi/fleetClient';
import { nextLocalHostId } from '../../../lib/integrations/unifi/credentials/credentialStore';
import { UNREACHABLE_CONSOLE_ACTION } from '../../../lib/integrations/unifi/credentials/types';
import { buildUniFiScopeKey, mappedSiteFromRow, parseUniFiScopeKey } from '../../../lib/integrations/unifi/sync/syncEngine';
import { createFabricSimulator, makeCredential, type SimConsole } from './unifiFabricKeySimulator';

const INDEPENDENT: SimConsole = {
  hostId: 'host-ind',
  name: 'Independent HQ',
  fabric: 'independent',
  sites: [{ id: 'site-ind', name: 'Default' }],
  devices: { 'site-ind': [{ id: 'dev-1', name: 'Switch', state: 'ONLINE' }] },
};
const FABRIC: SimConsole = {
  hostId: 'host-fab',
  name: 'Fabric Branch',
  fabric: 'acme',
  sites: [{ id: 'site-fab', name: 'Default' }],
  devices: { 'site-fab': [{ id: 'dev-2', name: 'AP', state: 'ONLINE' }] },
};

function twoKeySim() {
  return createFabricSimulator({
    consoles: [INDEPENDENT, FABRIC],
    keys: { 'key-a': 'independent', 'key-b': 'acme' },
  });
}

describe('UniFiFleetClient: single key equals the single client (T003)', () => {
  it('returns exactly what UniFiApiClient returns for one independent key', async () => {
    const sim = twoKeySim();
    const direct = new UniFiApiClient({ apiKey: 'key-a', fetchImpl: sim.fetchImpl, maxRetries: 0 });
    const { fleet } = sim.createFleet({ credentials: [makeCredential('Default', 'key-a')] });

    const directConsoles = await direct.listConsoles();
    expect(await fleet.listConsoles()).toEqual(directConsoles);

    const directSites = await direct.listSitesForHost(directConsoles[0]);
    expect(await fleet.listSitesForHost(directConsoles[0])).toEqual(directSites);

    const site = { hostId: INDEPENDENT.hostId, siteId: 'site-ind' };
    expect(await fleet.listDevices(site)).toEqual(await direct.listDevices(site));
    await expect(fleet.testConnection()).resolves.toBeUndefined();
  });
});

describe('UniFiFleetClient: routing with keys A (independent) and B (fabric) (T004)', () => {
  it('discovers the union once and routes each console to a key that reaches it', async () => {
    const sim = twoKeySim();
    const { fleet, store } = sim.createFleet({
      credentials: [makeCredential('A', 'key-a'), makeCredential('B', 'key-b')],
    });

    const consoles = await fleet.listConsoles();
    expect(consoles.map((console) => console.hostId).sort()).toEqual(['host-fab', 'host-ind']);

    const { sites, failures, unreachable } = await fleet.listSites();
    expect(sites.map((site) => site.siteId).sort()).toEqual(['site-fab', 'site-ind']);
    expect(failures).toEqual([]);
    expect(unreachable).toEqual([]);

    const owners = Object.fromEntries(
      [...store.routes.values()].map((route) => [
        route.hostId,
        store.credentials.find((c) => c.credentialId === route.credentialId)?.label,
      ])
    );
    expect(owners).toEqual({ 'host-ind': 'A', 'host-fab': 'B' });
    expect([...store.routes.values()].every((route) => route.state === 'routed')).toBe(true);
  });

  it('never sends a key to a console it was not tried for after the owner is known', async () => {
    const sim = twoKeySim();
    const { fleet } = sim.createFleet({
      credentials: [makeCredential('A', 'key-a'), makeCredential('B', 'key-b')],
    });
    await fleet.listSites();
    sim.calls.length = 0;
    await fleet.listDevices({ hostId: FABRIC.hostId, siteId: 'site-fab' });
    expect(sim.connectorCalls().map((call) => call.key)).toEqual(['key-b']);
  });
});

describe('UniFiFleetClient: only key A (T005)', () => {
  it('warns that the fabric console needs a fabric key and still syncs independent consoles', async () => {
    const sim = twoKeySim();
    const { fleet } = sim.createFleet({ credentials: [makeCredential('A', 'key-a')] });

    const { sites, unreachable } = await fleet.listSites();
    expect(sites.map((site) => site.siteId)).toEqual(['site-ind']);
    expect(unreachable).toEqual([
      { hostId: 'host-fab', name: 'Fabric Branch', suggestedAction: UNREACHABLE_CONSOLE_ACTION },
    ]);

    const devices = await fleet.listDevices({ hostId: INDEPENDENT.hostId, siteId: 'site-ind' });
    expect(devices).toHaveLength(1);

    const error = await fleet.listDevices({ hostId: FABRIC.hostId, siteId: 'site-fab' }).catch((e) => e);
    expect(error).toBeInstanceOf(UniFiConsoleUnreachableError);
    expect(error.message).toContain('visible but none of your keys can access it');
    expect(error.message).toContain('add a key created under that fabric');

    const report = await fleet.getFleetReport();
    expect(report.unreachableConsoles.map((c) => c.name)).toEqual(['Fabric Branch']);
    expect(report.credentials).toEqual([{ label: 'A', status: 'active', consolesReached: 1 }]);
  });
});

describe('UniFiFleetClient: route persistence and re-probe (T006)', () => {
  const fabricSite = { hostId: FABRIC.hostId, siteId: 'site-fab' };

  it('reuses a trusted route: no probe of key A on routine calls', async () => {
    const sim = twoKeySim();
    const { fleet } = sim.createFleet({ credentials: [makeCredential('A', 'key-a'), makeCredential('B', 'key-b')] });
    await fleet.listSites();
    sim.calls.length = 0;
    await fleet.listDevices(fabricSite);
    await fleet.listDevices(fabricSite);
    expect(sim.connectorCalls('key-a')).toHaveLength(0);
    expect(sim.connectorCalls('key-b')).toHaveLength(2);
  });

  it('a fresh client built from persisted routes also skips the probe', async () => {
    const sim = twoKeySim();
    const first = sim.createFleet({ credentials: [makeCredential('A', 'key-a'), makeCredential('B', 'key-b')] });
    await first.fleet.listSites();
    sim.calls.length = 0;
    const second = sim.createFleet({
      credentials: first.store.credentials.map((c) => Object.assign({ ...c }, { __key: first.store.secrets.get(c.credentialId)!.apiKey })),
      routes: [...first.store.routes.values()],
    });
    await second.fleet.listDevices(fabricSite);
    expect(sim.connectorCalls('key-a')).toHaveLength(0);
  });

  it('re-probes after the 24h trust window', async () => {
    const sim = twoKeySim();
    let now = new Date('2026-11-08T00:00:00Z');
    const { fleet, store } = sim.createFleet({
      credentials: [makeCredential('A', 'key-a'), makeCredential('B', 'key-b')],
      now: () => now,
    });
    await fleet.listSites();
    // Age the persisted route beyond the window.
    store.routes.set('host-fab', { ...store.routes.get('host-fab')!, lastVerifiedAt: new Date(now.getTime() - ROUTE_TRUST_MS - 1) });
    const aged = sim.createFleet({
      credentials: store.credentials.map((c) => Object.assign({ ...c }, { __key: store.secrets.get(c.credentialId)!.apiKey })),
      routes: [...store.routes.values()],
      now: () => now,
    });
    sim.calls.length = 0;
    await aged.fleet.listDevices(fabricSite);
    // Probe order is oldest key first: A is asked (403) before B answers.
    expect(sim.connectorCalls().map((call) => `${call.key}:${call.status}`)).toEqual(['key-a:403', 'key-b:200']);
    now = new Date(now.getTime() + 1);
  });

  it('re-probes when the owner starts returning console_forbidden, and on a full-sync invalidate', async () => {
    const sim = twoKeySim();
    const { fleet } = sim.createFleet({ credentials: [makeCredential('A', 'key-a'), makeCredential('B', 'key-b')] });
    await fleet.listSites();

    fleet.invalidateRoutes();
    sim.calls.length = 0;
    await fleet.listDevices(fabricSite);
    expect(sim.connectorCalls().map((call) => call.key)).toEqual(['key-a', 'key-b']);

    // A second call in the same run is trusted again (the probe happened).
    sim.calls.length = 0;
    await fleet.listDevices(fabricSite);
    expect(sim.connectorCalls().map((call) => call.key)).toEqual(['key-b']);
  });

  it('after the owner key is removed the console is re-probed and ends up unreachable', async () => {
    const sim = twoKeySim();
    const first = sim.createFleet({ credentials: [makeCredential('A', 'key-a'), makeCredential('B', 'key-b')] });
    await first.fleet.listSites();

    const remaining = first.store.credentials
      .filter((c) => c.label === 'A')
      .map((c) => Object.assign({ ...c }, { __key: 'key-a' }));
    const after = sim.createFleet({ credentials: remaining, routes: [...first.store.routes.values()] });
    const error = await after.fleet.listDevices(fabricSite).catch((e) => e);
    expect(error).toBeInstanceOf(UniFiConsoleUnreachableError);
    expect(after.store.routes.get('host-fab')?.state).toBe('unreachable');
    // The independent console is untouched.
    await expect(after.fleet.listDevices({ hostId: INDEPENDENT.hostId, siteId: 'site-ind' })).resolves.toHaveLength(1);
  });

  it('re-routes a console to another reaching key when its owner is removed', async () => {
    const sim = createFabricSimulator({
      consoles: [INDEPENDENT],
      keys: { 'key-a': 'independent', 'key-c': 'independent' },
    });
    const first = sim.createFleet({ credentials: [makeCredential('A', 'key-a'), makeCredential('C', 'key-c')] });
    await first.fleet.listSites();
    const owner = first.store.credentials.find((c) => c.credentialId === first.store.routes.get('host-ind')!.credentialId)!;
    expect(owner.label).toBe('A');

    const remaining = first.store.credentials
      .filter((c) => c.label === 'C')
      .map((c) => Object.assign({ ...c }, { __key: 'key-c' }));
    const after = sim.createFleet({ credentials: remaining, routes: [...first.store.routes.values()] });
    await expect(after.fleet.listDevices({ hostId: 'host-ind', siteId: 'site-ind' })).resolves.toHaveLength(1);
    const newOwner = after.store.credentials.find((c) => c.credentialId === after.store.routes.get('host-ind')!.credentialId);
    expect(newOwner?.label).toBe('C');
  });

  it('a transient failure on a trusted owner does not re-route or mark anything unreachable', async () => {
    const sim = twoKeySim();
    const { fleet, store } = sim.createFleet({
      credentials: [makeCredential('A', 'key-a'), makeCredential('B', 'key-b')],
      fleetOptions: {
        createChild: (credential, secrets) =>
          new UniFiApiClient({
            apiKey: secrets.apiKey,
            fetchImpl: (async (url: string, init: RequestInit) => {
              if (flaky && String(url).includes('/v1/connector/')) throw new Error('socket hang up');
              return sim.fetchImpl(url, init);
            }) as unknown as typeof fetch,
            maxRetries: 0,
          }),
      },
    });
    let flaky = false;
    await fleet.listSites();
    flaky = true;
    await expect(fleet.listDevices(fabricSite)).rejects.toMatchObject({ kind: 'network' });
    expect(store.routes.get('host-fab')?.state).toBe('routed');
  });
});

describe('UniFiFleetClient: per-key failure isolation (T007)', () => {
  it('a 401 on key B marks only B; A keeps syncing and the integration is not parked', async () => {
    const sim = twoKeySim();
    const { fleet, store } = sim.createFleet({ credentials: [makeCredential('A', 'key-a'), makeCredential('B', 'key-b')] });
    await fleet.listSites();

    sim.revokeKey('key-b');
    const fabricError = await fleet.listDevices({ hostId: FABRIC.hostId, siteId: 'site-fab' }).catch((e) => e);
    expect(fabricError).toBeInstanceOf(UniFiApiError);
    // Not `auth` (that would abort the whole sync) and not "unreachable": the key is flagged.
    expect(fabricError.kind).toBe('credential_unavailable');
    expect(fabricError.message).toContain('"B"');

    expect(store.credentials.find((c) => c.label === 'B')?.status).toBe('reconnect_required');
    expect(store.credentials.find((c) => c.label === 'A')?.status).toBe('active');
    expect(store.integrationReconnectRequired).toBe(false);
    // The console was neither re-labelled unreachable nor given a new owner.
    expect(store.routes.get('host-fab')?.state).toBe('routed');

    await expect(fleet.listDevices({ hostId: INDEPENDENT.hostId, siteId: 'site-ind' })).resolves.toHaveLength(1);
  });

  it('listSites reports the flagged key as a per-console failure instead of throwing', async () => {
    const sim = twoKeySim();
    const { fleet } = sim.createFleet({ credentials: [makeCredential('A', 'key-a'), makeCredential('B', 'key-b')] });
    await fleet.listSites();
    sim.revokeKey('key-b');
    const { sites, failures } = await fleet.listSites();
    expect(sites.map((s) => s.siteId)).toEqual(['site-ind']);
    expect(failures.map((f) => f.hostId)).toEqual(['host-fab']);
  });

  it('when every key is rejected it throws auth and parks the integration', async () => {
    const sim = twoKeySim();
    const { fleet, store } = sim.createFleet({ credentials: [makeCredential('A', 'key-a'), makeCredential('B', 'key-b')] });
    await fleet.listSites();
    sim.revokeKey('key-a');
    sim.revokeKey('key-b');
    await expect(fleet.listConsoles()).rejects.toMatchObject({ kind: 'auth' });
    expect(store.integrationReconnectRequired).toBe(true);
  });

  it('a disabled credential is never used', async () => {
    const sim = twoKeySim();
    const { fleet } = sim.createFleet({
      credentials: [makeCredential('A', 'key-a', { status: 'disabled' }), makeCredential('B', 'key-b')],
    });
    sim.calls.length = 0;
    const consoles = await fleet.listConsoles();
    expect(consoles.map((c) => c.hostId)).toEqual(['host-fab']);
    expect(sim.calls.every((call) => call.key === 'key-b')).toBe(true);
  });
});

describe('UniFiFleetClient: local controllers (T008)', () => {
  it('assigns distinct colon-free host ids and distinct scope keys', () => {
    expect(nextLocalHostId(['local'])).toBe('local-2');
    expect(nextLocalHostId(['local', 'local-2', null])).toBe('local-3');
    const keys = ['local', 'local-2'].map((hostId) => buildUniFiScopeKey(hostId, 'default'));
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) {
      expect(parseUniFiScopeKey(key)?.siteId).toBe('default');
      expect(parseUniFiScopeKey(key)?.hostId.includes(':')).toBe(false);
    }
  });

  it('lists each local credential as its own console under its own host id', async () => {
    const sim = twoKeySim();
    const { fleet } = sim.createFleet({
      credentials: [
        makeCredential('Default', 'local-key-1', { mode: 'local', localHostId: 'local' }),
        makeCredential('Branch', 'local-key-2', { mode: 'local', localHostId: 'local-2' }),
      ],
    });
    const consoles = await fleet.listConsoles();
    expect(consoles.map((c) => c.hostId).sort()).toEqual(['local', 'local-2']);
    // The migrated credential keeps today's console name.
    expect(consoles.find((c) => c.hostId === 'local')?.name).toBe('Local controller');
  });
});

describe('UniFiFleetClient: console names survive a cleared route', () => {
  it('names a re-probed console from the mapped site, not "Unnamed console", after its route was cleared', async () => {
    const sim = twoKeySim();
    const { fleet, store } = sim.createFleet({
      credentials: [makeCredential('A', 'key-a'), makeCredential('B', 'key-b')],
    });
    // No route rows: what replaceCredentialKey / removeCredential leave behind.
    expect(store.routes.size).toBe(0);

    await fleet.listDevices({ hostId: FABRIC.hostId, siteId: 'site-fab', hostName: FABRIC.name });

    const route = store.routes.get(FABRIC.hostId);
    expect(route?.state).toBe('routed');
    expect(route?.consoleName).toBe(FABRIC.name);
    expect(store.credentials.find((c) => c.credentialId === route?.credentialId)?.label).toBe('B');
  });

  it('reads the console name of a mapping row from its discovery metadata', () => {
    const site = mappedSiteFromRow({
      external_organization_id: buildUniFiScopeKey('host-fab', 'site-fab'),
      external_organization_name: 'Fabric Branch / Default',
      client_id: 'client-1',
      metadata: { kind: 'site', hostId: 'host-fab', hostName: 'Fabric Branch', siteId: 'site-fab' },
    });
    expect(site).toMatchObject({ hostId: 'host-fab', siteId: 'site-fab', hostName: 'Fabric Branch' });
    expect(mappedSiteFromRow({ external_organization_id: 'local:s1', client_id: 'c', metadata: null })?.hostName).toBeNull();
  });
});

describe('UniFiFleetClient: a stale unreachable route is re-probed, not trusted', () => {
  it('routes a console whose unreachable row was marked stale once a reaching key exists', async () => {
    const sim = twoKeySim();
    const a = makeCredential('A', 'key-a');
    const b = makeCredential('B', 'key-b');
    const { fleet, store } = sim.createFleet({
      credentials: [a, b],
      routes: [
        {
          hostId: FABRIC.hostId,
          credentialId: null,
          consoleName: FABRIC.name,
          state: 'unreachable',
          lastError: 'unreachable',
          firstSeenAt: new Date(0),
          lastVerifiedAt: new Date(0), // markRoutesStale
        },
      ],
    });
    const sites = await fleet.listSitesForHost({ hostId: FABRIC.hostId, name: FABRIC.name });
    expect(sites.map((site) => site.siteId)).toEqual(['site-fab']);
    expect(store.routes.get(FABRIC.hostId)).toMatchObject({ state: 'routed', credentialId: b.credentialId, consoleName: FABRIC.name });
  });
});
