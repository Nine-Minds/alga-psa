/* eslint-env node */
'use server';

import logger from '@alga-psa/core/logger';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import { revalidatePath } from 'next/cache';
import { ISecretProvider } from '@alga-psa/core';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { hasPermission } from '@alga-psa/auth/rbac';
import { QboClientService } from '../lib/qbo/qboClientService';

// Corrected QboCredentials interface (using ISO strings for dates)
interface QboCredentials {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  accessTokenExpiresAt: string; // Store as ISO string
  refreshTokenExpiresAt: string; // Store as ISO string
}

// Define the expected response structure based on Sec 5.5.2
export interface QboConnectionSummary {
  realmId: string;
  displayName: string;
  status: 'active' | 'expired' | 'error';
  lastValidatedAt?: string | null;
  error?: string | null;
}

export interface QboConnectionStatus {
  connected: boolean;
  connections: QboConnectionSummary[];
  defaultRealmId?: string | null;
  error?: string;
}

// --- Helper Functions using ISecretProvider ---

const QBO_CREDENTIALS_SECRET_NAME = 'qbo_credentials';
const CATALOG_CACHE_TTL_MS = 60_000;

type QboCredentialsMap = Record<string, QboCredentials>;
type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type QboItemRow = {
  Id?: string;
  id?: string;
  Name?: string;
  name?: string;
};

type QboTaxCodeRow = {
  Id?: string;
  id?: string;
  Name?: string;
  name?: string;
};

type QboTermRow = {
  Id?: string;
  id?: string;
  Name?: string;
  name?: string;
};

type QboClientInfoRow = {
  ClientName?: string;
  Name?: string;
  name?: string;
  CompanyName?: string;
  companyName?: string;
};

function buildCacheKey(tenantId: string, realmId: string | null, scope: string): string {
  return `${tenantId}:${realmId ?? 'default'}:${scope}`;
}

function getCachedValue<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CATALOG_CACHE_TTL_MS
  });
}

const itemCache = new Map<string, CacheEntry<QboItem[]>>();
const taxCodeCache = new Map<string, CacheEntry<QboTaxCode[]>>();
const termCache = new Map<string, CacheEntry<QboTerm[]>>();

function clearCacheEntriesForTenant<T>(
  cache: Map<string, CacheEntry<T>>,
  tenantId: string
): void {
  const prefix = `${tenantId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

function clearAllCatalogCachesForTenant(tenantId: string): void {
  clearCacheEntriesForTenant(itemCache, tenantId);
  clearCacheEntriesForTenant(taxCodeCache, tenantId);
  clearCacheEntriesForTenant(termCache, tenantId);
}

export async function resetQboCatalogCacheForTenant(tenantId: string): Promise<void> {
  clearAllCatalogCachesForTenant(tenantId);
}

function normalizeItemRow(row: QboItemRow): QboItem {
  return {
    id: row.Id ?? row.id ?? '',
    name: row.Name ?? row.name ?? ''
  };
}

function normalizeTaxCodeRow(row: QboTaxCodeRow): QboTaxCode {
  return {
    id: row.Id ?? row.id ?? '',
    name: row.Name ?? row.name ?? ''
  };
}

function normalizeTermRow(row: QboTermRow): QboTerm {
  return {
    id: row.Id ?? row.id ?? '',
    name: row.Name ?? row.name ?? ''
  };
}

type BillingAccess = {
  tenantId: string;
};

async function ensureBillingReadAccess(): Promise<BillingAccess> {
  const user = await getCurrentUser();
  if (!user?.tenant) {
    throw new Error('Authentication required.');
  }

  const allowed = await hasPermission(user, 'billing_settings', 'read');
  if (!allowed) {
    throw new Error('Forbidden: You do not have permission to view QuickBooks integration settings.');
  }

  return {
    tenantId: user.tenant
  };
}

async function ensureBillingUpdateAccess(): Promise<BillingAccess> {
  const user = await getCurrentUser();
  if (!user?.tenant) {
    throw new Error('Authentication required.');
  }

  const allowed = await hasPermission(user, 'billing_settings', 'update');
  if (!allowed) {
    throw new Error('Forbidden: You do not have permission to manage QuickBooks integration settings.');
  }

  return {
    tenantId: user.tenant
  };
}

async function getTenantCredentialMap(tenantId: string): Promise<QboCredentialsMap> {
  const secretProvider = await getSecretProviderInstance();
  const secret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
  if (!secret) {
    return {};
  }

  try {
    const parsed = JSON.parse(secret) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      logger.warn('QBO credentials secret was not an object', { tenantId });
      return {};
    }
    const entries = Object.entries(parsed as Record<string, QboCredentials>).filter(
      ([realmId, creds]) => {
        if (!realmId) {
          return false;
        }
        if (
          typeof creds !== 'object' ||
          !creds ||
          !creds.accessToken ||
          !creds.refreshToken ||
          !creds.realmId
        ) {
          logger.warn('Skipping malformed QBO credential entry', {
            tenantId,
            realmId
          });
          return false;
        }
        return true;
      }
    );
    return Object.fromEntries(entries);
  } catch (error) {
    logger.error('Failed to parse QBO credential secret', { tenantId, error });
    return {};
  }
}

function resolveRealmPriority(
  credentials: QboCredentialsMap,
  preferredRealmId?: string | null
): string[] {
  const realmIds = Object.keys(credentials);
  if (!preferredRealmId) {
    return realmIds;
  }

  if (realmIds.includes(preferredRealmId)) {
    return [preferredRealmId, ...realmIds.filter((realmId) => realmId !== preferredRealmId)];
  }

  return realmIds;
}

export async function getTenantQboCredentials(
  secretProvider: ISecretProvider,
  tenantId: string,
  realmId: string
): Promise<QboCredentials | null> {
  const secret = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
  if (!secret) {
    logger.warn('QBO credentials secret not found', { tenantId });
    return null;
  }
  try {
    const allCredentials = JSON.parse(secret) as Record<string, QboCredentials>;
    if (typeof allCredentials !== 'object' || allCredentials === null) {
      logger.warn('QBO credentials secret not an object', { tenantId });
      return null;
    }
    const credentials = allCredentials[realmId];
    if (
      credentials &&
      credentials.accessToken &&
      credentials.refreshToken &&
      credentials.realmId === realmId &&
      credentials.accessTokenExpiresAt &&
      credentials.refreshTokenExpiresAt
    ) {
      return credentials;
    }
    logger.warn('QBO credentials secret missing realm entry', { tenantId, realmId });
    return null;
  } catch (error) {
    logger.error('Unable to parse QBO credentials secret', { tenantId, realmId, error });
    return null;
  }
}

async function deleteTenantQboCredentials(secretProvider: ISecretProvider, tenantId: string): Promise<void> {
  // Assuming setTenantSecret with null value effectively deletes/invalidates the secret
  await secretProvider.setTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME, null);
  logger.info('QBO credentials secret invalidated', { tenantId });
  clearAllCatalogCachesForTenant(tenantId);
}

// --- QBO API Call Helper ---

// --- QBO Entity Types ---

export interface QboItem { // Exporting for use in components
  id: string; // QBO ItemRef.value
  name: string; // Qbo Item Name
}

export interface QboTaxCode { // Exporting for use in components
  id: string; // QBO TaxCodeRef.value
  name: string; // Qbo TaxCode Name
}

export interface QboTerm { // Exporting for use in components
  id: string; // QBO SalesTermRef.value
  name: string; // Qbo Term Name
}

// --- Server Actions ---

/**
 * Fetches a list of Items (Products/Services) from QuickBooks Online.
 * When a realmId is provided, attempts to load catalog data for that realm first.
 * Falls back to any other connected realms if necessary.
 */
export async function getQboItems(options: { realmId?: string | null } = {}): Promise<QboItem[]> {
  const { tenantId } = await ensureBillingReadAccess();
  const targetRealm = options.realmId ?? null;
  const cacheKey = buildCacheKey(tenantId, targetRealm, 'items');
  const cached = getCachedValue(itemCache, cacheKey);
  if (cached) {
    return [...cached];
  }

  const credentials = await getTenantCredentialMap(tenantId);
  const candidateRealmIds = resolveRealmPriority(credentials, targetRealm);

  if (candidateRealmIds.length === 0) {
    logger.warn('Unable to load QBO items: no credential entries found', { tenantId });
    return [];
  }

  for (const realmId of candidateRealmIds) {
    try {
      logger.debug('Fetching QBO items', { tenantId, realmId });
      const qboClient = await QboClientService.create(tenantId, realmId);
      const qboItems = await qboClient.query<QboItemRow>('SELECT Id, Name FROM Item');
      const mappedItems = qboItems.map(normalizeItemRow);
      setCachedValue(itemCache, buildCacheKey(tenantId, realmId, 'items'), mappedItems);
      return [...mappedItems];
    } catch (error) {
      logger.warn('Failed to fetch QBO items', { tenantId, realmId, error });
      continue;
    }
  }

  logger.warn('Unable to fetch QBO items for any realm', { tenantId });
  return [];
}

/**
 * Server Action to fetch the current QuickBooks Online connection status for the tenant.
 * Uses QboClientService which automatically handles token refresh.
 * Corresponds to Task 82.
 */
export async function getQboConnectionStatus(): Promise<QboConnectionStatus> {
  const { tenantId } = await ensureBillingReadAccess();

  try {
    const credentialMap = await getTenantCredentialMap(tenantId);
    const entries = Object.entries(credentialMap);

    if (entries.length === 0) {
      logger.warn('No QuickBooks credentials stored for tenant', { tenantId });
      return {
        connected: false,
        connections: [],
        error: 'No QuickBooks connections configured.'
      };
    }

    const summaries: QboConnectionSummary[] = [];
    let hasActiveConnection = false;
    let defaultRealmId: string | null = null;
    let aggregatedError: string | undefined;

    for (const [realmId, credentials] of entries) {
      let displayName = credentials.realmId ?? realmId;
      let status: QboConnectionSummary['status'] = 'error';
      let lastValidatedAt: string | null = null;
      let summaryError: string | null = null;

      try {
        logger.debug('Validating QuickBooks connection', { tenantId, realmId });
        const qboClient = await QboClientService.create(tenantId, realmId);
        const clientInfoResult = await qboClient.query<QboClientInfoRow>('SELECT CompanyName FROM CompanyInfo');
        const clientInfo = clientInfoResult?.[0];
        const clientName =
          clientInfo?.CompanyName ??
          clientInfo?.ClientName ??
          clientInfo?.Name ??
          clientInfo?.name ??
          clientInfo?.companyName ??
          null;

        displayName = clientName ?? displayName;
        status = 'active';
        hasActiveConnection = true;
        lastValidatedAt = new Date().toISOString();

        if (!defaultRealmId) {
          defaultRealmId = realmId;
        }
      } catch (rawError) {
        const message =
          rawError instanceof Error
            ? rawError.message
            : 'Failed to validate QuickBooks connection.';
        summaryError = message;
        const lowerCaseMessage = message.toLowerCase();
        const treatedAsAuthError =
          lowerCaseMessage.includes('re-authentic') ||
          lowerCaseMessage.includes('refresh token') ||
          lowerCaseMessage.includes('expired');

        status = treatedAsAuthError ? 'expired' : 'error';
        if (!aggregatedError) {
          aggregatedError = message;
        }
        logger.warn('QuickBooks connection validation failed', {
          tenantId,
          realmId,
          error: message
        });
      }

      summaries.push({
        realmId,
        displayName,
        status,
        lastValidatedAt,
        error: summaryError
      });
    }

    if (!defaultRealmId && summaries.length > 0) {
      defaultRealmId = summaries[0]?.realmId ?? null;
    }

    return {
      connected: hasActiveConnection,
      connections: summaries,
      defaultRealmId,
      error: hasActiveConnection
        ? undefined
        : aggregatedError ?? 'QuickBooks connections require attention. Please reconnect.'
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'An unexpected error occurred while checking the QuickBooks connection status.';
    logger.error('QuickBooks connection status check failed', { tenantId, error });
    return {
      connected: false,
      connections: [],
      error: message
    };
  }
}

/**
 * Disconnects the QuickBooks Online integration for the current tenant
 * by deleting stored credentials and optionally revoking the token with Intuit.
 * Corresponds to Task 84.
 */
export async function disconnectQbo(): Promise<{ success: boolean; error?: string }> {
  let tenantId: string | null = null;
  const secretProvider = await getSecretProviderInstance();

  try {
    ({ tenantId } = await ensureBillingUpdateAccess());

    logger.info('Disconnecting QuickBooks integration', { tenantId });

    const rawSecretContent = await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
    const credentialsExist = Boolean(rawSecretContent);

    await deleteTenantQboCredentials(secretProvider, tenantId);
    logger.info('Deleted stored QuickBooks credentials', { tenantId });

    if (credentialsExist) {
      logger.debug('QuickBooks credential revocation pending implementation', { tenantId });
    }

    revalidatePath('/settings/integrations/quickbooks');
    logger.debug('Revalidated QuickBooks integration settings path', { tenantId });

    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred during disconnection.';
    logger.error('QuickBooks disconnect failed', { tenantId, error });
    return {
      success: false,
      error: message
    };
  }
}


/**
 * Fetches a list of TaxCodes from QuickBooks Online.
 * Respects the requested realm and falls back to other connected realms.
 */
export async function getQboTaxCodes(options: { realmId?: string | null } = {}): Promise<QboTaxCode[]> {
  const { tenantId } = await ensureBillingReadAccess();
  const targetRealm = options.realmId ?? null;
  const cacheKey = buildCacheKey(tenantId, targetRealm, 'tax-codes');
  const cached = getCachedValue(taxCodeCache, cacheKey);
  if (cached) {
    return [...cached];
  }

  const credentials = await getTenantCredentialMap(tenantId);
  const candidateRealmIds = resolveRealmPriority(credentials, targetRealm);

  if (candidateRealmIds.length === 0) {
    logger.warn('Unable to load QBO tax codes: no credential entries found', { tenantId });
    return [];
  }

  for (const realmId of candidateRealmIds) {
    try {
      logger.debug('Fetching QBO tax codes', { tenantId, realmId });
      const qboClient = await QboClientService.create(tenantId, realmId);
      const qboTaxCodes = await qboClient.query<QboTaxCodeRow>('SELECT Id, Name FROM TaxCode');
      const mappedTaxCodes = qboTaxCodes.map(normalizeTaxCodeRow);
      setCachedValue(taxCodeCache, buildCacheKey(tenantId, realmId, 'tax-codes'), mappedTaxCodes);
      return [...mappedTaxCodes];
    } catch (error) {
      logger.warn('Failed to fetch QBO tax codes', { tenantId, realmId, error });
      continue;
    }
  }

  logger.warn('Unable to fetch QBO tax codes for any realm', { tenantId });
  return [];
}

/**
 * Fetches a list of Terms from QuickBooks Online.
 * Respects the requested realm and falls back to other connected realms.
 */
export async function getQboTerms(options: { realmId?: string | null } = {}): Promise<QboTerm[]> {
  const { tenantId } = await ensureBillingReadAccess();
  const targetRealm = options.realmId ?? null;
  const cacheKey = buildCacheKey(tenantId, targetRealm, 'terms');
  const cached = getCachedValue(termCache, cacheKey);
  if (cached) {
    return [...cached];
  }

  const credentials = await getTenantCredentialMap(tenantId);
  const candidateRealmIds = resolveRealmPriority(credentials, targetRealm);

  if (candidateRealmIds.length === 0) {
    logger.warn('Unable to load QBO terms: no credential entries found', { tenantId });
    return [];
  }

  for (const realmId of candidateRealmIds) {
    try {
      logger.debug('Fetching QBO terms', { tenantId, realmId });
      const qboClient = await QboClientService.create(tenantId, realmId);
      const qboTerms = await qboClient.query<QboTermRow>('SELECT Id, Name FROM Term');
      const mappedTerms = qboTerms.map(normalizeTermRow);
      setCachedValue(termCache, buildCacheKey(tenantId, realmId, 'terms'), mappedTerms);
      return [...mappedTerms];
    } catch (error) {
      logger.warn('Failed to fetch QBO terms', { tenantId, realmId, error });
      continue;
    }
  }

  logger.warn('Unable to fetch QBO terms for any realm', { tenantId });
  return [];
}
