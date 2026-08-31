import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import {
  QBO_CREDENTIALS_SECRET_NAME,
} from '../qbo/qboClientService';
import {
  XERO_CREDENTIALS_SECRET_NAME,
} from '../xero/xeroClientService';
import type { ProviderType } from './types';

export const QBO_CREDENTIALS_TOMBSTONE_SECRET = 'qbo_credentials_disconnect_pending';
export const XERO_CREDENTIALS_TOMBSTONE_SECRET = 'xero_credentials_disconnect_pending';

/**
 * Standard credential secret name for a provider. Normal sync/export paths
 * read only this name; tombstoning moves the value out from under them.
 */
export function standardCredentialsSecretName(provider: ProviderType): string {
  return provider === 'xero' ? XERO_CREDENTIALS_SECRET_NAME : QBO_CREDENTIALS_SECRET_NAME;
}

/** Tombstone secret name holding credential material pending provider cleanup. */
export function tombstoneCredentialsSecretName(provider: ProviderType): string {
  return provider === 'xero' ? XERO_CREDENTIALS_TOMBSTONE_SECRET : QBO_CREDENTIALS_TOMBSTONE_SECRET;
}

export type SecretProviderLike = {
  getTenantSecret(tenant: string, name: string): Promise<unknown>;
  setTenantSecret(tenant: string, name: string, value: string): Promise<void>;
  deleteTenantSecret(tenant: string, name: string): Promise<void>;
};

async function resolveSecretProvider(): Promise<SecretProviderLike> {
  return (await getSecretProviderInstance()) as unknown as SecretProviderLike;
}

/**
 * Moves the live credential secret to the tombstone name so ordinary
 * sync/export code can no longer reach it. Returns the moved value (or null
 * when there was nothing to move). A value already present under the tombstone
 * name wins — the disconnect is already in progress and its material is the
 * one that must be completed.
 */
export async function tombstoneLiveCredentials(
  tenantId: string,
  provider: ProviderType,
  secretProvider?: SecretProviderLike,
): Promise<{ movedValue: string | null; alreadyTombstoned: boolean }> {
  const providerInstance = secretProvider ?? (await resolveSecretProvider());
  const standardName = standardCredentialsSecretName(provider);
  const tombstoneName = tombstoneCredentialsSecretName(provider);

  const tombstoned = await providerInstance.getTenantSecret(tenantId, tombstoneName);
  if (typeof tombstoned === 'string' && tombstoned) {
    return { movedValue: tombstoned, alreadyTombstoned: true };
  }

  const live = await providerInstance.getTenantSecret(tenantId, standardName);
  if (typeof live !== 'string' || !live) {
    return { movedValue: null, alreadyTombstoned: false };
  }

  await providerInstance.setTenantSecret(tenantId, tombstoneName, live);
  await providerInstance.deleteTenantSecret(tenantId, standardName);
  return { movedValue: live, alreadyTombstoned: false };
}

/** Removes the tombstoned credential material. Safe to call when absent. */
export async function clearTombstoneCredentials(
  tenantId: string,
  provider: ProviderType,
  secretProvider?: SecretProviderLike,
): Promise<void> {
  const providerInstance = secretProvider ?? (await resolveSecretProvider());
  const tombstoneName = tombstoneCredentialsSecretName(provider);
  try {
    await providerInstance.deleteTenantSecret(tenantId, tombstoneName);
  } catch {
    // Deleting an absent secret is a no-op for the in-memory/fs providers; a
    // provider that throws on missing keys must not fail finalization.
  }
}

/**
 * True when credential material exists under the standard (live) name only.
 * Used by the disconnect service to distinguish "live credentials exist" (a
 * fresh cycle must run) from "nothing live anywhere" (a finalized record is a
 * stable no-op).
 */
export async function hasLiveProviderCredentials(
  tenantId: string,
  provider: ProviderType,
  secretProvider?: SecretProviderLike,
): Promise<boolean> {
  const providerInstance = secretProvider ?? (await resolveSecretProvider());
  const standard = await providerInstance.getTenantSecret(tenantId, standardCredentialsSecretName(provider));
  return typeof standard === 'string' && standard.length > 0;
}

/**
 * True when any credential material exists under either the standard or the
 * tombstone name. Used to distinguish "genuinely nothing connected" (a clean,
 * no-op disconnect) from "credentials exist but failed to parse" (must not be
 * treated as nothing — that would skip provider cleanup).
 */
export async function hasAnyProviderCredentials(
  tenantId: string,
  provider: ProviderType,
  secretProvider?: SecretProviderLike,
): Promise<boolean> {
  const providerInstance = secretProvider ?? (await resolveSecretProvider());
  const [standard, tombstoned] = await Promise.all([
    providerInstance.getTenantSecret(tenantId, standardCredentialsSecretName(provider)),
    providerInstance.getTenantSecret(tenantId, tombstoneCredentialsSecretName(provider)),
  ]);
  return (
    (typeof standard === 'string' && standard.length > 0) ||
    (typeof tombstoned === 'string' && tombstoned.length > 0)
  );
}
