/**
 * Shapes shared by the UniFi credential store, the fleet client and the actions.
 * No secret material appears in any of these types.
 */

export type UniFiCredentialMode = 'site_manager' | 'local';
export type UniFiCredentialStatus = 'active' | 'reconnect_required' | 'disabled';
export type UniFiRouteState = 'routed' | 'unreachable';

export interface UniFiCredentialRecord {
  credentialId: string;
  integrationId: string;
  label: string;
  mode: UniFiCredentialMode;
  /** Local mode only. 'local' for the migrated credential, else a generated colon-free id. */
  localHostId: string | null;
  status: UniFiCredentialStatus;
  lastError: string | null;
  lastCheckedAt: Date | null;
  /** Backfilled rows read the legacy unnamed secrets once and then clear this. */
  adoptsLegacySecret: boolean;
  createdAt: Date;
}

export interface UniFiCredentialSecrets {
  apiKey: string;
  /** Local mode only. */
  localBaseUrl: string | null;
}

export interface UniFiConsoleRoute {
  hostId: string;
  /** Owner credential; null while the console is unreachable. */
  credentialId: string | null;
  consoleName: string | null;
  state: UniFiRouteState;
  lastError: string | null;
  firstSeenAt: Date;
  lastVerifiedAt: Date;
}

export interface UniFiCredentialReport {
  label: string;
  status: UniFiCredentialStatus;
  consolesReached: number;
}

export interface UniFiUnreachableConsole {
  hostId: string;
  name: string;
  suggestedAction: string;
}

/** Message for a console no key can access. This sentence is the deliverable. */
export function unreachableConsoleMessage(consoleName: string): string {
  return `Console "${consoleName}" is visible but none of your keys can access it. If it belongs to a fabric, add a key created under that fabric.`;
}

export const UNREACHABLE_CONSOLE_ACTION = 'Add a key created under the fabric that this console belongs to.';

/**
 * Persistence seam for the fleet client. The production implementation is
 * credentialStore.ts; tests inject an in-memory one.
 */
export interface UniFiFleetStore {
  listCredentials(): Promise<UniFiCredentialRecord[]>;
  readSecrets(credential: UniFiCredentialRecord): Promise<UniFiCredentialSecrets | null>;
  loadRoutes(): Promise<UniFiConsoleRoute[]>;
  saveRoute(route: {
    hostId: string;
    credentialId: string | null;
    consoleName: string | null;
    state: UniFiRouteState;
    lastError: string | null;
  }): Promise<void>;
  /** Records the outcome of a call made with this key. Never writes key material. */
  recordCredentialResult(
    credentialId: string,
    result: { status?: UniFiCredentialStatus; lastError: string | null }
  ): Promise<void>;
  /** Integration-level reconnect marker; the fleet sets it only when every credential needs it. */
  markIntegrationReconnectRequired(): Promise<void>;
}
