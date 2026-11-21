/**
 * Reusable UniFi fabric-key simulator for unit tests (shared with the follow-up
 * card c0758497; keep the surface stable).
 *
 * Models the Site Manager behaviour behind the "multiple keys" work:
 * - a key created under *Independent* lists every console via /v1/hosts but gets
 *   403 from the Cloud Connector on consoles that belong to a fabric;
 * - a key created under a *fabric* lists and reaches only that fabric's consoles;
 * - an unknown or revoked key gets 401 everywhere.
 *
 * Usage:
 *   const sim = createFabricSimulator({
 *     consoles: [
 *       { hostId: 'h-ind', name: 'Independent HQ', fabric: 'independent', sites: [{ id: 's1', name: 'Default' }] },
 *       { hostId: 'h-fab', name: 'Fabric Branch', fabric: 'acme', sites: [{ id: 's2', name: 'Default' }] },
 *     ],
 *     keys: { keyA: 'independent', keyB: 'acme' },
 *   });
 *   const fleet = sim.createFleet({ credentials: [sim.credential('A', 'keyA'), sim.credential('B', 'keyB')] });
 *
 * `sim.calls` records every request (url path + which key was used) so tests can
 * assert routing: no extra probes, and a key never sent where it was not saved.
 */

import { UniFiApiClient } from '../../../lib/integrations/unifi/unifiApiClient';
import { UniFiFleetClient, type UniFiFleetClientOptions } from '../../../lib/integrations/unifi/fleetClient';
import type {
  UniFiConsoleRoute,
  UniFiCredentialRecord,
  UniFiCredentialSecrets,
  UniFiCredentialStatus,
  UniFiFleetStore,
} from '../../../lib/integrations/unifi/credentials/types';

export type FabricScope = 'independent' | string;

export interface SimConsole {
  hostId: string;
  name: string;
  fabric: FabricScope;
  sites: Array<{ id: string; name: string }>;
  devices?: Record<string, Array<Record<string, unknown>>>;
}

export interface SimCall {
  key: string;
  method: string;
  path: string;
  host: string;
  status: number;
}

export interface FabricSimulatorOptions {
  consoles: SimConsole[];
  /** key string -> where it was created. Keys not listed here are rejected (401). */
  keys: Record<string, FabricScope>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function createFabricSimulator(options: FabricSimulatorOptions) {
  const calls: SimCall[] = [];
  const consoles = [...options.consoles];
  const keys: Record<string, FabricScope> = { ...options.keys };

  const visibleTo = (scope: FabricScope) =>
    scope === 'independent' ? consoles : consoles.filter((console) => console.fabric === scope);
  /** The connector accepts a key only for consoles in its own scope. */
  const reaches = (scope: FabricScope, console: SimConsole) => console.fabric === scope;

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = String((init?.headers as Record<string, string> | undefined)?.['X-API-KEY'] ?? '');
    const record = (status: number): void => {
      calls.push({ key, method: init?.method ?? 'GET', path: url.pathname, host: url.host, status });
    };
    const answer = (body: unknown, status = 200): Response => {
      record(status);
      return json(body, status);
    };

    const scope = keys[key];
    if (scope === undefined) return answer({ message: 'unauthorized' }, 401);

    if (url.pathname === '/v1/hosts') {
      return answer({
        data: visibleTo(scope).map((console) => ({
          id: console.hostId,
          type: 'console',
          reportedState: { name: console.name, state: 'connected' },
        })),
      });
    }

    const match = url.pathname.match(
      /^\/v1\/connector\/consoles\/([^/]+)\/proxy\/network\/integration\/v1(\/.*)$/
    );
    if (match) {
      const console = consoles.find((candidate) => candidate.hostId === decodeURIComponent(match[1]));
      if (!console || !reaches(scope, console)) return answer({ message: 'forbidden' }, 403);
      const rest = match[2];
      if (rest === '/sites') {
        return answer({
          offset: 0,
          limit: 200,
          count: console.sites.length,
          totalCount: console.sites.length,
          data: console.sites.map((site) => ({ id: site.id, name: site.name })),
        });
      }
      const devices = rest.match(/^\/sites\/([^/]+)\/devices$/);
      if (devices) {
        const list = console.devices?.[decodeURIComponent(devices[1])] ?? [];
        return answer({ offset: 0, limit: 200, count: list.length, totalCount: list.length, data: list });
      }
      const detail = rest.match(/^\/sites\/([^/]+)\/devices\/([^/]+)$/);
      if (detail) {
        const list = console.devices?.[decodeURIComponent(detail[1])] ?? [];
        const device = list.find((row) => row.id === decodeURIComponent(detail[2]));
        return device ? answer(device) : answer({ message: 'not found' }, 404);
      }
    }
    return answer({ message: 'not found' }, 404);
  }) as unknown as typeof fetch;

  return {
    calls,
    fetchImpl,
    /** Revoke a key mid-test (it starts returning 401). */
    revokeKey(key: string) {
      delete keys[key];
    },
    addKey(key: string, scope: FabricScope) {
      keys[key] = scope;
    },
    connectorCalls(key?: string) {
      return calls.filter((call) => call.path.startsWith('/v1/connector/') && (!key || call.key === key));
    },
    credential(label: string, key: string, extra: Partial<UniFiCredentialRecord> = {}) {
      return makeCredential(label, key, extra);
    },
    createStore(initial: { credentials: Array<ReturnType<typeof makeCredential>>; routes?: UniFiConsoleRoute[] }) {
      return createMemoryStore(initial);
    },
    createFleet(args: {
      credentials: Array<ReturnType<typeof makeCredential>>;
      routes?: UniFiConsoleRoute[];
      now?: () => Date;
      fleetOptions?: Partial<UniFiFleetClientOptions>;
    }) {
      const store = createMemoryStore({ credentials: args.credentials, routes: args.routes });
      const fleet = new UniFiFleetClient({
        store,
        now: args.now,
        createChild: (credential, secrets) =>
          new UniFiApiClient({
            apiKey: secrets.apiKey,
            mode: credential.mode,
            localBaseUrl: secrets.localBaseUrl ?? undefined,
            fetchImpl,
            sleepImpl: async () => undefined,
            maxRetries: 0,
          }),
        ...args.fleetOptions,
      });
      return { fleet, store };
    },
  };
}

let credentialCounter = 0;

export function makeCredential(label: string, key: string, extra: Partial<UniFiCredentialRecord> = {}) {
  credentialCounter += 1;
  const record: UniFiCredentialRecord = {
    credentialId: `cred-${label.toLowerCase().replace(/\W+/g, '-')}-${credentialCounter}`,
    integrationId: 'integration-1',
    label,
    mode: 'site_manager',
    localHostId: null,
    status: 'active',
    lastError: null,
    lastCheckedAt: null,
    adoptsLegacySecret: false,
    // Strictly increasing so probe order (oldest first) follows creation order.
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, credentialCounter)),
    ...extra,
  };
  return Object.assign(record, { __key: key });
}

export interface MemoryStore extends UniFiFleetStore {
  credentials: UniFiCredentialRecord[];
  routes: Map<string, UniFiConsoleRoute>;
  integrationReconnectRequired: boolean;
  secrets: Map<string, UniFiCredentialSecrets>;
}

export function createMemoryStore(initial: {
  credentials: Array<ReturnType<typeof makeCredential>>;
  routes?: UniFiConsoleRoute[];
}): MemoryStore {
  const secrets = new Map<string, UniFiCredentialSecrets>();
  const credentials = initial.credentials.map((entry) => {
    const { __key, ...record } = entry;
    secrets.set(record.credentialId, { apiKey: __key, localBaseUrl: record.mode === 'local' ? 'https://10.0.0.1' : null });
    return record as UniFiCredentialRecord;
  });
  const routes = new Map((initial.routes ?? []).map((route) => [route.hostId, route]));
  const store: MemoryStore = {
    credentials,
    routes,
    secrets,
    integrationReconnectRequired: false,
    async listCredentials() {
      // Hand out copies, like a DB read; the fleet mutates its own view.
      return credentials.map((credential) => ({ ...credential }));
    },
    async readSecrets(credential) {
      return secrets.get(credential.credentialId) ?? null;
    },
    async loadRoutes() {
      return [...routes.values()].map((route) => ({ ...route }));
    },
    async saveRoute(route) {
      const prior = routes.get(route.hostId);
      routes.set(route.hostId, {
        ...route,
        firstSeenAt: prior?.firstSeenAt ?? new Date(),
        lastVerifiedAt: new Date(),
      });
    },
    async recordCredentialResult(credentialId, result: { status?: UniFiCredentialStatus; lastError: string | null }) {
      const credential = credentials.find((candidate) => candidate.credentialId === credentialId);
      if (!credential) return;
      if (result.status) credential.status = result.status;
      credential.lastError = result.lastError;
      credential.lastCheckedAt = new Date();
    },
    async markIntegrationReconnectRequired() {
      store.integrationReconnectRequired = true;
    },
  };
  return store;
}
