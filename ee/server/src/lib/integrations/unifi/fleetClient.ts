/**
 * UniFiFleetClient: N single-key UniFiApiClients behind the one client surface
 * the sync engine, alert fetcher and device-sync strategy already use.
 *
 * Why this exists: a Site Manager key created under *Independent* lists every
 * console through /v1/hosts but gets 403 from the Cloud Connector on fabric
 * consoles, and a key created under a *fabric* only sees that fabric. So "which
 * key can reach which console" is a fact Alga has to discover, persist and
 * surface. See ee/docs/plans/2026-11-08-unifi-multiple-api-keys/PRD.md.
 *
 * - Discovery (§4.1): union of /v1/hosts over active Site Manager credentials,
 *   de-duplicated by host id. Listing proves nothing about reachability.
 * - Ownership (§4.2): a console's owner is the first credential, in a stable
 *   order, whose *real* connector call succeeds. console_forbidden falls through
 *   to the next key; a 401 flags that key only and also falls through.
 * - Routes (§3.2) are persisted and trusted for 24h, so routine syncs and the
 *   5-minute alert poller do not re-probe. They are re-probed on
 *   console_forbidden/401 from the owner, on key removal/replacement, on a full
 *   sync (invalidateRoutes) and on a manual re-check.
 * - A console nobody reaches is `unreachable` with one actionable message (§4.4).
 * - Failure isolation (§5): each child client keeps its own retry/rate-limit
 *   state; a 401 flags one credential, and the integration only when all are.
 *
 * Each credential's key is only ever handed to the child client built from that
 * same credential's own secrets (destination binding, §6).
 */

import logger from '@alga-psa/core/logger';
import {
  UNIFI_LOCAL_HOST_ID,
  UniFiApiClient,
  UniFiApiError,
  type UniFiClientSurface,
  type UniFiConsole,
  type UniFiDevice,
  type UniFiSite,
  type UniFiSiteListFailure,
} from './unifiApiClient';
import {
  UNREACHABLE_CONSOLE_ACTION,
  unreachableConsoleMessage,
  type UniFiConsoleRoute,
  type UniFiCredentialRecord,
  type UniFiCredentialReport,
  type UniFiCredentialSecrets,
  type UniFiFleetStore,
  type UniFiUnreachableConsole,
} from './credentials/types';

export const ROUTE_TRUST_MS = 24 * 60 * 60 * 1000;

/** A site as consumers pass it; `hostName` is the console name they recorded, when they have one. */
type SiteRef = Pick<UniFiSite, 'hostId' | 'siteId'> & { hostName?: string | null };

export type UniFiChildClient = Pick<
  UniFiApiClient,
  'testConnection' | 'listConsoles' | 'listSitesForHost' | 'listDevices' | 'getDevice'
>;

export interface UniFiFleetClientOptions {
  store: UniFiFleetStore;
  /** Builds the single-key client for one credential. Overridden in tests. */
  createChild?: (credential: UniFiCredentialRecord, secrets: UniFiCredentialSecrets) => UniFiChildClient;
  now?: () => Date;
  routeTrustMs?: number;
  /** Replaces the integration-level "reconnect required" marker. */
  onIntegrationAuthFailure?: () => Promise<void> | void;
}

/** Thrown for a console every key was tried against and none can access. */
export class UniFiConsoleUnreachableError extends UniFiApiError {
  readonly hostId: string;
  readonly consoleName: string;

  constructor(hostId: string, consoleName: string) {
    super(unreachableConsoleMessage(consoleName), 'console_forbidden', 403);
    this.name = 'UniFiConsoleUnreachableError';
    this.hostId = hostId;
    this.consoleName = consoleName;
  }
}

export interface UniFiCredentialTestResult {
  credentialId: string;
  label: string;
  ok: boolean;
  error?: string;
}

interface FleetState {
  credentials: UniFiCredentialRecord[];
  routes: Map<string, UniFiConsoleRoute>;
}

const KEY_REJECTED_MESSAGE = 'UniFi rejected this API key. Replace the key to reconnect it.';

function errorText(error: unknown): string {
  if (error instanceof UniFiApiError) {
    return error.kind === 'auth' ? KEY_REJECTED_MESSAGE : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** A local credential's host id is what scope keys are built from. */
function looksLikeLocalHostId(hostId: string): boolean {
  return hostId === UNIFI_LOCAL_HOST_ID || /^local-\d+$/.test(hostId);
}

export class UniFiFleetClient implements UniFiClientSurface {
  private readonly store: UniFiFleetStore;
  private readonly createChild: NonNullable<UniFiFleetClientOptions['createChild']>;
  private readonly now: () => Date;
  private readonly routeTrustMs: number;
  private readonly onIntegrationAuthFailure?: UniFiFleetClientOptions['onIntegrationAuthFailure'];

  private statePromise: Promise<FleetState> | null = null;
  private readonly children = new Map<string, Promise<UniFiChildClient | null>>();
  private readonly authFlagged = new Set<string>();
  private readonly touched = new Set<string>();
  private reprobeAll = false;
  private readonly verifiedThisRun = new Set<string>();

  constructor(options: UniFiFleetClientOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.routeTrustMs = options.routeTrustMs ?? ROUTE_TRUST_MS;
    this.onIntegrationAuthFailure = options.onIntegrationAuthFailure;
    this.createChild =
      options.createChild ??
      ((credential, secrets) =>
        new UniFiApiClient({
          apiKey: secrets.apiKey,
          mode: credential.mode,
          localBaseUrl: secrets.localBaseUrl ?? undefined,
          // The fleet records auth failures per credential itself.
          onAuthFailure: async () => undefined,
        }));
  }

  // ── state ────────────────────────────────────────────────────────────────

  private async getState(): Promise<FleetState> {
    if (!this.statePromise) {
      this.statePromise = (async () => {
        const [credentials, routes] = await Promise.all([this.store.listCredentials(), this.store.loadRoutes()]);
        return { credentials, routes: new Map(routes.map((route) => [route.hostId, route])) };
      })();
      this.statePromise.catch(() => {
        this.statePromise = null;
      });
    }
    return this.statePromise;
  }

  private async getChild(credential: UniFiCredentialRecord): Promise<UniFiChildClient | null> {
    let pending = this.children.get(credential.credentialId);
    if (!pending) {
      pending = (async () => {
        const secrets = await this.store.readSecrets(credential);
        if (!secrets?.apiKey) {
          await this.store.recordCredentialResult(credential.credentialId, {
            lastError: 'No API key is stored for this credential. Replace the key.',
          });
          return null;
        }
        return this.createChild(credential, secrets);
      })();
      this.children.set(credential.credentialId, pending);
    }
    return pending;
  }

  private activeCredentials(state: FleetState, mode: 'site_manager' | 'local'): UniFiCredentialRecord[] {
    return state.credentials
      .filter((credential) => credential.mode === mode && credential.status === 'active')
      .sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.credentialId.localeCompare(b.credentialId)
      );
  }

  /** Forget persisted trust: the next call per console probes again (full sync, manual re-check). */
  invalidateRoutes(): void {
    this.reprobeAll = true;
    this.verifiedThisRun.clear();
  }

  // ── failure isolation ────────────────────────────────────────────────────

  /** A 401 flags this one credential; the integration only when every credential is flagged. */
  private async handleAuthFailure(state: FleetState, credential: UniFiCredentialRecord): Promise<void> {
    credential.status = 'reconnect_required';
    credential.lastError = KEY_REJECTED_MESSAGE;
    if (this.authFlagged.has(credential.credentialId)) return;
    this.authFlagged.add(credential.credentialId);

    logger.warn('[UniFi] API key rejected', { credentialId: credential.credentialId, label: credential.label });
    try {
      await this.store.recordCredentialResult(credential.credentialId, {
        status: 'reconnect_required',
        lastError: KEY_REJECTED_MESSAGE,
      });
    } catch (error) {
      logger.warn('[UniFi] Could not record credential failure', {
        credentialId: credential.credentialId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const everyCredentialFlagged = state.credentials
      .filter((candidate) => candidate.status !== 'disabled')
      .every((candidate) => candidate.status === 'reconnect_required');
    if (everyCredentialFlagged) {
      try {
        await (this.onIntegrationAuthFailure?.() ?? this.store.markIntegrationReconnectRequired());
      } catch {
        // Best effort; the caller still receives the auth error.
      }
    }
  }

  private async recordSuccess(credential: UniFiCredentialRecord): Promise<void> {
    credential.lastError = null;
    try {
      await this.store.recordCredentialResult(credential.credentialId, { lastError: null });
    } catch {
      // Bookkeeping only.
    }
  }

  // ── routing ──────────────────────────────────────────────────────────────

  private isFresh(route: UniFiConsoleRoute): boolean {
    return this.now().getTime() - route.lastVerifiedAt.getTime() < this.routeTrustMs;
  }

  private hasTrustedRoute(hostId: string): boolean {
    return !this.reprobeAll || this.verifiedThisRun.has(hostId);
  }

  private childHostId(credential: UniFiCredentialRecord, hostId: string): string {
    // A local child always addresses its one controller as UNIFI_LOCAL_HOST_ID.
    return credential.mode === 'local' ? UNIFI_LOCAL_HOST_ID : hostId;
  }

  private async persistRoute(
    state: FleetState,
    route: {
      hostId: string;
      credentialId: string | null;
      consoleName: string | null;
      state: 'routed' | 'unreachable';
      lastError: string | null;
    }
  ): Promise<void> {
    const prior = state.routes.get(route.hostId);
    const next: UniFiConsoleRoute = {
      ...route,
      firstSeenAt: prior?.firstSeenAt ?? this.now(),
      lastVerifiedAt: this.now(),
    };
    state.routes.set(route.hostId, next);
    if (this.reprobeAll) this.verifiedThisRun.add(route.hostId);
    if (prior?.credentialId !== route.credentialId || prior?.state !== route.state) {
      logger.info('[UniFi] Console route changed', {
        hostId: route.hostId,
        state: route.state,
        credentialId: route.credentialId,
        previousCredentialId: prior?.credentialId ?? null,
      });
    }
    try {
      await this.store.saveRoute(route);
    } catch (error) {
      logger.warn('[UniFi] Could not persist console route', {
        hostId: route.hostId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Runs `operation` against the console's owner, resolving or re-resolving the
   * owner as needed. The operation itself is the reachability probe, so a probe
   * costs no extra request: the first key whose call succeeds becomes the owner.
   */
  private async runOnConsole<T>(
    console: Pick<UniFiConsole, 'hostId' | 'name'>,
    operation: (child: UniFiChildClient, childHostId: string) => Promise<T>
  ): Promise<T> {
    const state = await this.getState();
    const { hostId } = console;
    this.touched.add(hostId);
    const known = state.routes.get(hostId);
    const consoleName = console.name || known?.consoleName || 'this console';

    // Candidate order: a matching local credential, else active Site Manager keys oldest-first.
    const locals = this.activeCredentials(state, 'local').filter((credential) => credential.localHostId === hostId);
    const siteManager = this.activeCredentials(state, 'site_manager');
    if (locals.length === 0 && looksLikeLocalHostId(hostId)) {
      throw new UniFiApiError(
        'The local controller that served this site is no longer connected. Add its key again or unmap the site.',
        'credential_unavailable'
      );
    }
    let candidates = locals.length > 0 ? locals : siteManager;

    // Trusted route: try the owner first, otherwise probe in stable order.
    let trustedOwnerId: string | null = null;
    if (known && locals.length === 0 && this.hasTrustedRoute(hostId) && this.isFresh(known)) {
      const owner = known.credentialId ? candidates.find((c) => c.credentialId === known.credentialId) : undefined;
      if (known.state === 'routed' && owner) {
        trustedOwnerId = owner.credentialId;
        candidates = [owner, ...candidates.filter((c) => c.credentialId !== owner.credentialId)];
      } else if (known.state === 'unreachable') {
        // Trusted until the window ends, unless a key was added after it was verified.
        const addedSince = candidates.some((c) => c.createdAt.getTime() > known.lastVerifiedAt.getTime());
        if (!addedSince) throw new UniFiConsoleUnreachableError(hostId, consoleName);
      }
    }

    const authFailed: UniFiCredentialRecord[] = [];
    let sawForbidden = false;
    let transient: unknown = null;

    for (const credential of candidates) {
      const child = await this.getChild(credential);
      if (!child) continue;
      try {
        const result = await operation(child, this.childHostId(credential, hostId));
        const trustedHit = trustedOwnerId === credential.credentialId && known?.state === 'routed';
        if (!trustedHit || (known && !known.consoleName && console.name)) {
          await this.persistRoute(state, {
            hostId,
            credentialId: credential.credentialId,
            consoleName: console.name || known?.consoleName || null,
            state: 'routed',
            lastError: null,
          });
          await this.recordSuccess(credential);
        }
        return result;
      } catch (error) {
        if (!(error instanceof UniFiApiError)) throw error;
        if (error.kind === 'console_forbidden') {
          sawForbidden = true;
          continue;
        }
        if (error.kind === 'auth') {
          await this.handleAuthFailure(state, credential);
          authFailed.push(credential);
          continue;
        }
        // Network / rate limit / 5xx / bad payload say nothing about reach. A
        // trusted owner's transient failure must not re-route the console.
        if (trustedOwnerId === credential.credentialId) throw error;
        transient ??= error;
      }
    }

    if (transient) throw transient;

    const parkedKeys = state.credentials.filter(
      (credential) => credential.mode === 'site_manager' && credential.status === 'reconnect_required'
    );
    if (locals.length === 0 && authFailed.length > 0 && authFailed.length === candidates.length && parkedKeys.length === authFailed.length) {
      // Every key the tenant has was rejected: same outcome as a single dead key today.
      throw new UniFiApiError('UniFi rejected the API key. Create a new key and reconnect the integration.', 'auth', 401);
    }
    if (locals.length > 0 && authFailed.length > 0) {
      throw new UniFiApiError(
        'UniFi rejected the API key. Create a new key and reconnect the integration.',
        'auth',
        401
      );
    }
    if (parkedKeys.length > 0 || authFailed.length > 0) {
      const labels = [...new Set([...parkedKeys, ...authFailed].map((credential) => credential.label))];
      throw new UniFiApiError(
        `Console "${consoleName}" could not be checked because ${labels.length === 1 ? 'key' : 'keys'} ${labels
          .map((label) => `"${label}"`)
          .join(', ')} need${labels.length === 1 ? 's' : ''} to be reconnected.`,
        'credential_unavailable'
      );
    }
    if (sawForbidden || candidates.length > 0) {
      const message = unreachableConsoleMessage(consoleName);
      await this.persistRoute(state, {
        hostId,
        credentialId: null,
        consoleName: console.name || known?.consoleName || null,
        state: 'unreachable',
        lastError: message,
      });
      throw new UniFiConsoleUnreachableError(hostId, consoleName);
    }
    throw new UniFiApiError('No UniFi key is connected for this console.', 'credential_unavailable');
  }

  // ── client surface ───────────────────────────────────────────────────────

  async listConsoles(): Promise<UniFiConsole[]> {
    const state = await this.getState();
    const siteManager = this.activeCredentials(state, 'site_manager');
    const locals = this.activeCredentials(state, 'local');

    if (siteManager.length + locals.length === 0) {
      const parked = state.credentials.some((credential) => credential.status === 'reconnect_required');
      if (parked) {
        throw new UniFiApiError('UniFi rejected the API key. Create a new key and reconnect the integration.', 'auth', 401);
      }
      throw new UniFiApiError('UniFi API key is not configured for this tenant.', 'config');
    }

    const settled = await Promise.all(
      siteManager.map(async (credential) => {
        try {
          const child = await this.getChild(credential);
          if (!child) return { credential, error: new UniFiApiError('No API key is stored for this credential.', 'config') };
          return { credential, consoles: await child.listConsoles() };
        } catch (error) {
          return { credential, error };
        }
      })
    );

    const byHost = new Map<string, UniFiConsole>();
    const errors: unknown[] = [];
    let succeeded = 0;
    for (const outcome of settled) {
      if ('consoles' in outcome && outcome.consoles) {
        succeeded += 1;
        await this.recordSuccess(outcome.credential);
        for (const console of outcome.consoles) {
          if (!byHost.has(console.hostId)) byHost.set(console.hostId, console);
        }
        continue;
      }
      const { credential, error } = outcome as { credential: UniFiCredentialRecord; error: unknown };
      errors.push(error);
      if (error instanceof UniFiApiError && error.kind === 'auth') {
        await this.handleAuthFailure(state, credential);
      } else {
        await this.store
          .recordCredentialResult(credential.credentialId, { lastError: errorText(error) })
          .catch(() => undefined);
      }
    }

    for (const credential of locals) {
      const hostId = credential.localHostId ?? UNIFI_LOCAL_HOST_ID;
      // The migrated credential keeps today's console name so mapping labels do not change.
      const name = hostId === UNIFI_LOCAL_HOST_ID ? 'Local controller' : credential.label;
      byHost.set(hostId, { hostId, name, type: 'local', state: null });
      const route = state.routes.get(hostId);
      if (route?.credentialId !== credential.credentialId || route.state !== 'routed') {
        await this.persistRoute(state, {
          hostId,
          credentialId: credential.credentialId,
          consoleName: name,
          state: 'routed',
          lastError: null,
        });
      }
    }

    for (const hostId of byHost.keys()) this.touched.add(hostId);

    if (succeeded === 0 && locals.length === 0 && errors.length > 0) {
      const first = errors[0];
      const allAuth = errors.every((error) => error instanceof UniFiApiError && error.kind === 'auth');
      throw allAuth || !(first instanceof Error) ? first : first;
    }
    return [...byHost.values()];
  }

  async listSites(): Promise<{
    sites: UniFiSite[];
    failures: UniFiSiteListFailure[];
    unreachable: UniFiUnreachableConsole[];
  }> {
    const consoles = await this.listConsoles();
    const sites: UniFiSite[] = [];
    const failures: UniFiSiteListFailure[] = [];
    const unreachable: UniFiUnreachableConsole[] = [];
    for (const console of consoles) {
      try {
        sites.push(...(await this.listSitesForHost(console)));
      } catch (error) {
        if (error instanceof UniFiConsoleUnreachableError) {
          unreachable.push({ hostId: console.hostId, name: console.name, suggestedAction: UNREACHABLE_CONSOLE_ACTION });
          continue;
        }
        if (error instanceof UniFiApiError && error.kind === 'auth') throw error;
        failures.push({
          hostId: console.hostId,
          hostName: console.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { sites, failures, unreachable };
  }

  async listSitesForHost(console: Pick<UniFiConsole, 'hostId' | 'name'>): Promise<UniFiSite[]> {
    const sites = await this.runOnConsole(console, (child, childHostId) =>
      child.listSitesForHost({ hostId: childHostId, name: console.name })
    );
    // Local children report their own constant host id; scope keys use the credential's.
    return sites.map((site) => ({ ...site, hostId: console.hostId, hostName: console.name }));
  }

  /**
   * Console name for a site-level call. The route may have been cleared (key
   * replaced or removed), so the caller's own record of the console wins; the
   * cached route name is the fallback. Never an id.
   */
  private consoleFor(state: FleetState, site: SiteRef): Pick<UniFiConsole, 'hostId' | 'name'> {
    return { hostId: site.hostId, name: site.hostName || state.routes.get(site.hostId)?.consoleName || '' };
  }

  async listDevices(site: SiteRef): Promise<UniFiDevice[]> {
    const state = await this.getState();
    return this.runOnConsole(
      this.consoleFor(state, site),
      (child, childHostId) => child.listDevices({ hostId: childHostId, siteId: site.siteId })
    );
  }

  async getDevice(site: SiteRef, deviceId: string): Promise<UniFiDevice> {
    const state = await this.getState();
    return this.runOnConsole(
      this.consoleFor(state, site),
      (child, childHostId) => child.getDevice({ hostId: childHostId, siteId: site.siteId }, deviceId)
    );
  }

  /**
   * Tests every credential that is not disabled, including ones flagged
   * reconnect_required: this is how a replaced key recovers. A passing test makes
   * a credential active again.
   */
  async testCredentials(): Promise<UniFiCredentialTestResult[]> {
    const state = await this.getState();
    const targets = state.credentials.filter((credential) => credential.status !== 'disabled');
    return Promise.all(
      targets.map(async (credential): Promise<UniFiCredentialTestResult> => {
        try {
          const child = await this.getChild(credential);
          if (!child) {
            return { credentialId: credential.credentialId, label: credential.label, ok: false, error: 'No API key is stored.' };
          }
          await child.testConnection();
          credential.status = 'active';
          this.authFlagged.delete(credential.credentialId);
          await this.store.recordCredentialResult(credential.credentialId, { status: 'active', lastError: null });
          return { credentialId: credential.credentialId, label: credential.label, ok: true };
        } catch (error) {
          if (error instanceof UniFiApiError && error.kind === 'auth') {
            await this.handleAuthFailure(state, credential);
          } else {
            await this.store
              .recordCredentialResult(credential.credentialId, { lastError: errorText(error) })
              .catch(() => undefined);
          }
          return {
            credentialId: credential.credentialId,
            label: credential.label,
            ok: false,
            error: errorText(error),
          };
        }
      })
    );
  }

  /** Throws unless at least one credential connects. Per-credential outcomes are recorded either way. */
  async testConnection(): Promise<void> {
    const state = await this.getState();
    if (state.credentials.length === 0) {
      throw new UniFiApiError('UniFi API key is not configured for this tenant.', 'config');
    }
    const results = await this.testCredentials();
    if (results.some((result) => result.ok)) return;
    const everyAuth = state.credentials.every((credential) => credential.status === 'reconnect_required');
    if (everyAuth) {
      throw new UniFiApiError('UniFi rejected the API key. Create a new key and reconnect the integration.', 'auth', 401);
    }
    throw new UniFiApiError(results.find((result) => result.error)?.error ?? 'Unable to connect to UniFi.', 'http');
  }

  /** Observability payload for sync results (PRD §9). Labels only: no ids, no key material. */
  async getFleetReport(): Promise<{
    credentials: UniFiCredentialReport[];
    unreachableConsoles: UniFiUnreachableConsole[];
  }> {
    const state = await this.getState();
    const routes = [...state.routes.values()];
    return {
      credentials: state.credentials.map((credential) => ({
        label: credential.label,
        status: credential.status,
        consolesReached: routes.filter(
          (route) => route.state === 'routed' && route.credentialId === credential.credentialId
        ).length,
      })),
      unreachableConsoles: routes
        .filter((route) => route.state === 'unreachable' && this.touched.has(route.hostId))
        .map((route) => ({
          hostId: route.hostId,
          name: route.consoleName ?? 'Unnamed console',
          suggestedAction: UNREACHABLE_CONSOLE_ACTION,
        })),
    };
  }
}
