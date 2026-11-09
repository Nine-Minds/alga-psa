/**
 * Credential lifecycle for the UniFi settings actions: add, replace key, update
 * (relabel / controller URL), remove, list, re-check. Server actions stay thin
 * wrappers (auth, tier gate, error text) around these.
 *
 * Ordering rule for every write: validate (destination binding, label, live key
 * test against the destination the key was supplied for) BEFORE touching the
 * secret provider or the database.
 *
 * Logging: labels and credential ids only, never key material.
 */

import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { UniFiApiClient, UniFiApiError, type UniFiConnectionMode } from '../unifiApiClient';
import { parseUniFiScopeKey } from '../scopeKey';
import { decideDestination, type BoundDestination } from './destinationBinding';
import {
  deleteCredentialRow,
  deleteCredentialSecrets,
  insertCredential,
  listCredentialRecords,
  listRouteRecords,
  markRoutesStale,
  nextLocalHostId,
  readCredentialSecrets,
  updateCredentialRow,
  writeCredentialSecrets,
} from './credentialStore';
import type { UniFiCredentialRecord, UniFiCredentialStatus } from './types';

const MAX_LABEL_LENGTH = 80;

export class UniFiCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UniFiCredentialError';
  }
}

export interface UniFiCredentialView {
  credentialId: string;
  label: string;
  mode: UniFiConnectionMode;
  status: UniFiCredentialStatus;
  /** Console names (not ids) this credential currently reaches. */
  consoles: string[];
  lastError: string | null;
  lastCheckedAt: string | null;
}

export interface UniFiCredentialListView {
  credentials: UniFiCredentialView[];
  /** Consoles that are visible but no key reaches; the UI shows the "add a fabric key" guidance. */
  unreachableConsoles: Array<{ name: string }>;
}

export function normalizeLabel(raw: unknown): string {
  const label = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!label) throw new UniFiCredentialError('Enter a label for this key.');
  if (label.length > MAX_LABEL_LENGTH) {
    throw new UniFiCredentialError(`Labels can be at most ${MAX_LABEL_LENGTH} characters.`);
  }
  return label;
}

function assertLabelAvailable(existing: UniFiCredentialRecord[], label: string, exceptId?: string): void {
  const clash = existing.some((c) => c.credentialId !== exceptId && c.label.toLowerCase() === label.toLowerCase());
  if (clash) throw new UniFiCredentialError('Another key already uses this label. Choose a different label.');
}

async function requireCredential(
  knex: Knex,
  tenant: string,
  integrationId: string,
  credentialId: string
): Promise<{ credential: UniFiCredentialRecord; all: UniFiCredentialRecord[] }> {
  const all = await listCredentialRecords(knex, tenant, integrationId);
  const credential = all.find((c) => c.credentialId === credentialId);
  if (!credential) throw new UniFiCredentialError('That key was not found.');
  return { credential, all };
}

async function storedDestination(knex: Knex, tenant: string, credential: UniFiCredentialRecord): Promise<BoundDestination | null> {
  const secrets = await readCredentialSecrets(knex, tenant, credential);
  if (!secrets?.apiKey) return null;
  return { mode: credential.mode, localBaseUrl: credential.mode === 'local' ? secrets.localBaseUrl : null };
}

/** Live check of a key against the destination it was supplied for. Nothing is persisted. */
export async function verifyKey(args: {
  apiKey: string;
  destination: BoundDestination;
  clientFactory?: (opts: { apiKey: string; mode: UniFiConnectionMode; localBaseUrl?: string }) => { testConnection(): Promise<void> };
}): Promise<void> {
  const make = args.clientFactory ?? ((opts) => new UniFiApiClient(opts));
  const client = make({
    apiKey: args.apiKey,
    mode: args.destination.mode,
    localBaseUrl: args.destination.localBaseUrl ?? undefined,
  });
  await client.testConnection();
}

export async function addCredential(
  knex: Knex,
  tenant: string,
  input: {
    integrationId: string;
    label: string;
    mode: UniFiConnectionMode;
    apiKey?: string;
    localBaseUrl?: string;
    clientFactory?: Parameters<typeof verifyKey>[0]['clientFactory'];
  }
): Promise<UniFiCredentialRecord> {
  const label = normalizeLabel(input.label);
  const existing = await listCredentialRecords(knex, tenant, input.integrationId);
  assertLabelAvailable(existing, label);

  const decision = decideDestination({
    stored: null,
    request: { mode: input.mode, localBaseUrl: input.localBaseUrl, apiKey: input.apiKey },
  });
  if (decision.ok === false) throw new UniFiCredentialError(decision.error);

  const apiKey = input.apiKey!.trim();
  await verifyKey({ apiKey, destination: decision.destination, clientFactory: input.clientFactory });

  const localHostId =
    decision.destination.mode === 'local' ? nextLocalHostIdFor(existing) : null;
  const credential = await insertCredential(knex, tenant, {
    integrationId: input.integrationId,
    label,
    mode: decision.destination.mode,
    localHostId,
  });
  try {
    await writeCredentialSecrets(tenant, credential.credentialId, {
      apiKey,
      localBaseUrl: decision.destination.localBaseUrl,
    });
  } catch (error) {
    await deleteCredentialRow(knex, tenant, credential.credentialId);
    throw error;
  }

  // A new key may reach consoles that were unreachable: let the next sync try them.
  await markRoutesStale(knex, tenant, input.integrationId, { state: 'unreachable' });
  logger.info('[UniFi] Credential added', { credentialId: credential.credentialId, label, mode: credential.mode });
  return credential;
}

function nextLocalHostIdFor(existing: UniFiCredentialRecord[]): string {
  // The first local credential of an integration with no migrated one takes 'local'
  // so a fresh single-controller setup looks exactly like a migrated one.
  const taken = existing.map((c) => c.localHostId);
  return taken.includes('local') ? nextLocalHostId(taken) : 'local';
}

export async function replaceCredentialKey(
  knex: Knex,
  tenant: string,
  input: {
    integrationId: string;
    credentialId: string;
    apiKey: string;
    localBaseUrl?: string;
    clientFactory?: Parameters<typeof verifyKey>[0]['clientFactory'];
  }
): Promise<UniFiCredentialRecord> {
  const { credential } = await requireCredential(knex, tenant, input.integrationId, input.credentialId);
  const stored = await storedDestination(knex, tenant, credential);

  const decision = decideDestination({
    stored,
    request: { mode: credential.mode, localBaseUrl: input.localBaseUrl, apiKey: input.apiKey },
  });
  if (decision.ok === false) throw new UniFiCredentialError(decision.error);
  if (decision.keySource !== 'new') throw new UniFiCredentialError('Enter the new API key.');

  const apiKey = input.apiKey.trim();
  await verifyKey({ apiKey, destination: decision.destination, clientFactory: input.clientFactory });
  await writeCredentialSecrets(tenant, credential.credentialId, {
    apiKey,
    localBaseUrl: decision.destination.localBaseUrl,
  });
  await updateCredentialRow(knex, tenant, credential.credentialId, {
    status: 'active',
    lastError: null,
    lastCheckedAt: new Date(),
  });
  // Routes this key owned, and any console nobody reached, are re-probed.
  await markRoutesStale(knex, tenant, input.integrationId, { credentialId: credential.credentialId });
  await markRoutesStale(knex, tenant, input.integrationId, { state: 'unreachable' });
  logger.info('[UniFi] Credential key replaced', { credentialId: credential.credentialId, label: credential.label });
  return { ...credential, status: 'active', lastError: null };
}

/**
 * Relabel and/or change the controller URL of a local credential. A URL change is
 * a destination change: it needs a new key and is verified against the new URL.
 * Changing the mode is rejected outright: it would change every scope key
 * (`<hostId>:<siteId>`) and orphan the site mappings and assets under them.
 */
export async function updateCredential(
  knex: Knex,
  tenant: string,
  input: {
    integrationId: string;
    credentialId: string;
    label?: string;
    mode?: UniFiConnectionMode;
    localBaseUrl?: string;
    apiKey?: string;
    clientFactory?: Parameters<typeof verifyKey>[0]['clientFactory'];
  }
): Promise<UniFiCredentialRecord> {
  const { credential, all } = await requireCredential(knex, tenant, input.integrationId, input.credentialId);

  if (input.mode && input.mode !== credential.mode) {
    throw new UniFiCredentialError(
      'A key cannot change its connection mode. Remove it and add a new key in the other mode.'
    );
  }

  const label = typeof input.label === 'string' ? normalizeLabel(input.label) : null;
  if (label) assertLabelAvailable(all, label, credential.credentialId);

  const touchesDestination = credential.mode === 'local' && (input.localBaseUrl?.trim() || input.apiKey?.trim());
  if (touchesDestination) {
    const stored = await storedDestination(knex, tenant, credential);
    const decision = decideDestination({
      stored,
      request: { mode: credential.mode, localBaseUrl: input.localBaseUrl, apiKey: input.apiKey },
    });
    if (decision.ok === false) throw new UniFiCredentialError(decision.error);
    if (decision.keySource === 'new') {
      const apiKey = input.apiKey!.trim();
      await verifyKey({ apiKey, destination: decision.destination, clientFactory: input.clientFactory });
      await writeCredentialSecrets(tenant, credential.credentialId, {
        apiKey,
        localBaseUrl: decision.destination.localBaseUrl,
      });
      await updateCredentialRow(knex, tenant, credential.credentialId, { status: 'active', lastError: null });
      await markRoutesStale(knex, tenant, input.integrationId, { credentialId: credential.credentialId });
    }
  }

  if (label && label !== credential.label) {
    await updateCredentialRow(knex, tenant, credential.credentialId, { label });
    logger.info('[UniFi] Credential relabeled', { credentialId: credential.credentialId, label });
  }
  return { ...credential, label: label ?? credential.label };
}

export interface RemoveCredentialOutcome {
  removed: boolean;
  /** Set when mapped sites would lose their key and the caller has not confirmed. */
  requiresConfirmation?: boolean;
  affectedSites: string[];
}

/**
 * Removes a credential. Mapped sites on consoles this key owned are listed first
 * and the caller must confirm. Mappings and assets are never deleted: scope keys
 * stay, and the sites simply stop syncing (and show as unreachable) until another
 * key reaches their console. The credential's routes go with it, so the next
 * call per console re-probes the remaining keys.
 */
export async function removeCredential(
  knex: Knex,
  tenant: string,
  input: { integrationId: string; credentialId: string; confirm?: boolean }
): Promise<RemoveCredentialOutcome> {
  const { credential } = await requireCredential(knex, tenant, input.integrationId, input.credentialId);
  const routes = await listRouteRecords(knex, tenant, input.integrationId);
  const ownedHostIds = new Set(
    routes.filter((route) => route.credentialId === credential.credentialId).map((route) => route.hostId)
  );
  if (credential.localHostId) ownedHostIds.add(credential.localHostId);

  const affectedSites: string[] = [];
  if (ownedHostIds.size > 0) {
    const rows = await tenantDb(knex, tenant)
      .table('rmm_organization_mappings')
      .where({ integration_id: input.integrationId })
      .whereNotNull('client_id')
      .select(['external_organization_id', 'external_organization_name']);
    for (const row of rows as any[]) {
      const scope = String(row.external_organization_id);
      const parsed = parseUniFiScopeKey(scope);
      if (parsed && ownedHostIds.has(parsed.hostId)) affectedSites.push(String(row.external_organization_name ?? scope));
    }
  }

  if (affectedSites.length > 0 && !input.confirm) {
    return { removed: false, requiresConfirmation: true, affectedSites };
  }

  await deleteCredentialRow(knex, tenant, credential.credentialId);
  await deleteCredentialSecrets(tenant, credential.credentialId);
  // Consoles other keys may now own, and ones nobody reached, are re-probed.
  await markRoutesStale(knex, tenant, input.integrationId, { state: 'unreachable' });
  logger.info('[UniFi] Credential removed', {
    credentialId: credential.credentialId,
    label: credential.label,
    affectedSites: affectedSites.length,
  });
  return { removed: true, affectedSites };
}

export async function listCredentialViews(
  knex: Knex,
  tenant: string,
  integrationId: string
): Promise<UniFiCredentialListView> {
  const [credentials, routes] = await Promise.all([
    listCredentialRecords(knex, tenant, integrationId),
    listRouteRecords(knex, tenant, integrationId),
  ]);
  return {
    credentials: credentials.map((credential) => ({
      credentialId: credential.credentialId,
      label: credential.label,
      mode: credential.mode,
      status: credential.status,
      consoles: routes
        .filter((route) => route.state === 'routed' && route.credentialId === credential.credentialId)
        .map((route) => route.consoleName ?? 'Unnamed console')
        .sort((a, b) => a.localeCompare(b)),
      lastError: credential.lastError,
      lastCheckedAt: credential.lastCheckedAt ? credential.lastCheckedAt.toISOString() : null,
    })),
    unreachableConsoles: routes
      .filter((route) => route.state === 'unreachable')
      .map((route) => ({ name: route.consoleName ?? 'Unnamed console' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function isCredentialUserError(error: unknown): error is UniFiCredentialError | UniFiApiError {
  return error instanceof UniFiCredentialError || error instanceof UniFiApiError;
}
