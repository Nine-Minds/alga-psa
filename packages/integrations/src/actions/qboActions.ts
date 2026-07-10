/* eslint-env node */
'use server';

import axios from 'axios';
import logger from '@alga-psa/core/logger';
import { withAuth } from '@alga-psa/auth';
import { revalidatePath } from 'next/cache';
import { ISecretProvider } from '@alga-psa/core';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { hasPermission } from '@alga-psa/auth/rbac';
import { notifyQboConnectionChanged } from '../lib/qbo/qboConnectionChangeProvider';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  QboClientService,
  QBO_CLIENT_ID_SECRET_NAME,
  QBO_CLIENT_SECRET_SECRET_NAME,
  getQboEnvironment,
  getQboOAuthScopes,
  getQboRedirectUri,
  resolveQboOAuthCredentials,
  type QboEnvironment
} from '../lib/qbo/qboClientService';
import type { IUserWithRoles } from '@alga-psa/types';

const QBO_TOKEN_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

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

export interface QboCredentialStatus {
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  ready: boolean;
  clientIdMasked?: string;
  clientSecretMasked?: string;
}

export interface QboConnectionStatus {
  connected: boolean;
  connections: QboConnectionSummary[];
  defaultRealmId?: string | null;
  defaultConnection?: QboConnectionSummary;
  redirectUri: string;
  scopes: string[];
  environment: QboEnvironment;
  credentials: QboCredentialStatus;
  error?: string;
  errorCode?: 'FORBIDDEN' | 'ENTERPRISE_REQUIRED';
}

type QboCatalogActionError = ActionMessageError | ActionPermissionError;
type QboCatalogResult<T> = Promise<T[] | QboCatalogActionError>;

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function qboConnectionStatusError(
  error: string,
  errorCode: NonNullable<QboConnectionStatus['errorCode']>
): QboConnectionStatus {
  return {
    connected: false,
    connections: [],
    redirectUri: '',
    scopes: getQboOAuthScopes(),
    environment: getQboEnvironment(),
    credentials: {
      clientIdConfigured: false,
      clientSecretConfigured: false,
      ready: false,
    },
    error,
    errorCode,
  };
}

function qboCatalogNotConnected(catalogName: string): QboCatalogActionError {
  return actionError(`Connect QuickBooks before loading ${catalogName}.`);
}

function isQboReconnectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('re-authentic') ||
    message.includes('refresh token') ||
    message.includes('invalid_grant') ||
    message.includes('unauthorized') ||
    message.includes('expired') ||
    message.includes('401')
  );
}

function qboErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function qboConnectionStatusMessage(error: unknown): string {
  const code = qboErrorCode(error);

  if (code === 'QBO_CONFIG_MISSING') {
    return 'QuickBooks client credentials are not configured. Add credentials and reconnect QuickBooks.';
  }

  if (code === 'QBO_SETUP_INCOMPLETE') {
    return 'No QuickBooks company is connected yet. Click Connect QuickBooks to authorize one.';
  }

  if (code === 'QBO_AUTH_ERROR' || isQboReconnectError(error)) {
    return 'Your QuickBooks connection has expired. Reconnect QuickBooks to continue.';
  }

  if (code === 'QBO_REFRESH_FAILED') {
    return 'QuickBooks token refresh failed. Reconnect QuickBooks if the problem persists.';
  }

  if (code === 'QBO_INIT_FAILED') {
    return 'Failed to initialize the QuickBooks connection. Reconnect QuickBooks and try again.';
  }

  return 'Could not check QuickBooks connection status. Try again, or reconnect QuickBooks if the problem persists.';
}

function qboCatalogFetchError(catalogName: string, errors: unknown[]): QboCatalogActionError {
  if (errors.some(isQboReconnectError)) {
    return actionError(`Reconnect QuickBooks before loading ${catalogName}.`);
  }

  return actionError(
    `Could not load ${catalogName}. Try again, or reconnect QuickBooks if the problem persists.`
  );
}

async function getQboUpdateAccessError(user: IUserWithRoles): Promise<string | null> {
  if (!isEnterpriseEdition()) {
    return 'QuickBooks Online integration is only available in Enterprise Edition.';
  }

  const allowed = await hasPermission(user, 'billing_settings', 'update');
  if (!allowed) {
    return 'Forbidden: You do not have permission to manage QuickBooks integration settings.';
  }

  return null;
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

type QboCustomerRow = {
  Id: string;
  DisplayName?: string;
  Active?: boolean;
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
const customerCache = new Map<string, CacheEntry<QboCustomer[]>>();
const accountCache = new Map<string, CacheEntry<QboAccount[]>>();
const classCache = new Map<string, CacheEntry<QboClass[]>>();
const departmentCache = new Map<string, CacheEntry<QboDepartment[]>>();

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
  clearCacheEntriesForTenant(customerCache, tenantId);
  clearCacheEntriesForTenant(accountCache, tenantId);
  clearCacheEntriesForTenant(classCache, tenantId);
  clearCacheEntriesForTenant(departmentCache, tenantId);
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

function normalizeCustomerRow(row: QboCustomerRow): QboCustomer {
  return {
    id: row.Id,
    name: row.DisplayName ?? row.Id,
    active: row.Active !== false,
  };
}

function normalizeTermRow(row: QboTermRow): QboTerm {
  return {
    id: row.Id ?? row.id ?? '',
    name: row.Name ?? row.name ?? ''
  };
}

async function checkBillingReadAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'billing_settings', 'read');
  if (!allowed) {
    throw new Error('Forbidden: You do not have permission to view QuickBooks integration settings.');
  }
}

async function getQboCatalogAccessError(user: IUserWithRoles): Promise<QboCatalogActionError | null> {
  if (!isEnterpriseEdition()) {
    return actionError('QuickBooks Online integration is only available in Enterprise Edition.');
  }

  const allowed = await hasPermission(user, 'billing_settings', 'read');
  if (!allowed) {
    return permissionError('Forbidden: You do not have permission to view QuickBooks integration settings.');
  }

  return null;
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
  await secretProvider.deleteTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME);
  logger.info('QBO credentials secret deleted', { tenantId });
  clearAllCatalogCachesForTenant(tenantId);
  await notifyQboConnectionChanged(tenantId);
}

async function revokeQboTokens(tenantId: string, credentialMap: QboCredentialsMap): Promise<void> {
  const resolved = await resolveQboOAuthCredentials(tenantId).catch(() => null);
  if (!resolved) {
    logger.warn('Skipping QuickBooks token revocation: no usable client credentials', { tenantId });
    return;
  }

  const authHeader = `Basic ${Buffer.from(`${resolved.clientId}:${resolved.clientSecret}`).toString('base64')}`;
  for (const [realmId, credentials] of Object.entries(credentialMap)) {
    try {
      await axios.post(
        QBO_TOKEN_REVOKE_URL,
        { token: credentials.refreshToken },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: authHeader
          },
          timeout: 10000
        }
      );
      logger.info('Revoked QuickBooks tokens with Intuit', { tenantId, realmId });
    } catch (error) {
      logger.warn('Best-effort QuickBooks token revocation failed', {
        tenantId,
        realmId,
        error: error instanceof Error ? error.message : error
      });
    }
  }
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

export interface QboCustomer { // Exporting for use in components
  id: string; // QBO Customer.Id
  name: string; // QBO Customer.DisplayName
  active: boolean; // QBO Customer.Active
}

export interface QboAccount { // Exporting for use in components
  id: string; // QBO Account.Id
  name: string; // QBO Account.Name
  accountType: string; // QBO Account.AccountType
}

export interface QboClass { // Exporting for use in components
  id: string; // QBO Class.Id
  name: string; // QBO Class.Name
}

export interface QboDepartment { // Exporting for use in components
  id: string; // QBO Department.Id
  name: string; // QBO Department.Name
}

type QboAccountRow = {
  Id?: string;
  id?: string;
  Name?: string;
  name?: string;
  AccountType?: string;
  accountType?: string;
};

type QboClassRow = {
  Id?: string;
  id?: string;
  Name?: string;
  name?: string;
  Active?: boolean;
};

type QboDepartmentRow = {
  Id?: string;
  id?: string;
  Name?: string;
  name?: string;
};

const DEPOSIT_ACCOUNT_TYPES = new Set(['Bank', 'Other Current Asset']);

function normalizeAccountRow(row: QboAccountRow): QboAccount {
  return {
    id: row.Id ?? row.id ?? '',
    name: row.Name ?? row.name ?? '',
    accountType: row.AccountType ?? row.accountType ?? ''
  };
}

function normalizeClassRow(row: QboClassRow): QboClass {
  return {
    id: row.Id ?? row.id ?? '',
    name: row.Name ?? row.name ?? ''
  };
}

function normalizeDepartmentRow(row: QboDepartmentRow): QboDepartment {
  return {
    id: row.Id ?? row.id ?? '',
    name: row.Name ?? row.name ?? ''
  };
}

// --- Server Actions ---

/**
 * Fetches QBO Accounts filtered to valid payment deposit targets:
 * AccountType in ('Bank', 'Other Current Asset').
 * Mirrors the getQboItems cache/realm-priority/EE+read-gate pattern.
 */
export const getQboAccounts = withAuth(async (
  user,
  { tenant },
  options: { realmId?: string | null } = {}
): QboCatalogResult<QboAccount> => {
  const accessError = await getQboCatalogAccessError(user);
  if (accessError) return accessError;

  const targetRealm = options.realmId ?? null;
  const cacheKey = buildCacheKey(tenant, targetRealm, 'accounts');
  const cached = getCachedValue(accountCache, cacheKey);
  if (cached) {
    return [...cached];
  }

  const credentials = await getTenantCredentialMap(tenant);
  const candidateRealmIds = resolveRealmPriority(credentials, targetRealm);

  if (candidateRealmIds.length === 0) {
    logger.warn('Unable to load QBO accounts: no credential entries found', { tenantId: tenant });
    return qboCatalogNotConnected('QuickBooks accounts');
  }

  const errors: unknown[] = [];
  for (const realmId of candidateRealmIds) {
    try {
      logger.debug('Fetching QBO accounts', { tenantId: tenant, realmId });
      const qboClient = await QboClientService.create(tenant, realmId);
      const rows = await qboClient.query<QboAccountRow>('SELECT Id, Name, AccountType FROM Account');
      const filtered = rows
        .map(normalizeAccountRow)
        .filter((a) => DEPOSIT_ACCOUNT_TYPES.has(a.accountType));
      setCachedValue(accountCache, buildCacheKey(tenant, realmId, 'accounts'), filtered);
      return [...filtered];
    } catch (error) {
      errors.push(error);
      logger.warn('Failed to fetch QBO accounts', { tenantId: tenant, realmId, error });
      continue;
    }
  }

  logger.warn('Unable to fetch QBO accounts for any realm', { tenantId: tenant });
  return qboCatalogFetchError('QuickBooks accounts', errors);
});

/**
 * Fetches QBO Classes (active only) for use in per-line ClassRef assignment.
 * Mirrors the getQboItems cache/realm-priority/EE+read-gate pattern.
 */
export const getQboClasses = withAuth(async (
  user,
  { tenant },
  options: { realmId?: string | null } = {}
): QboCatalogResult<QboClass> => {
  const accessError = await getQboCatalogAccessError(user);
  if (accessError) return accessError;

  const targetRealm = options.realmId ?? null;
  const cacheKey = buildCacheKey(tenant, targetRealm, 'classes');
  const cached = getCachedValue(classCache, cacheKey);
  if (cached) {
    return [...cached];
  }

  const credentials = await getTenantCredentialMap(tenant);
  const candidateRealmIds = resolveRealmPriority(credentials, targetRealm);

  if (candidateRealmIds.length === 0) {
    logger.warn('Unable to load QBO classes: no credential entries found', { tenantId: tenant });
    return qboCatalogNotConnected('QuickBooks classes');
  }

  const errors: unknown[] = [];
  for (const realmId of candidateRealmIds) {
    try {
      logger.debug('Fetching QBO classes', { tenantId: tenant, realmId });
      const qboClient = await QboClientService.create(tenant, realmId);
      const rows = await qboClient.query<QboClassRow>('SELECT Id, Name FROM Class');
      const mapped = rows
        .filter((r) => r.Active !== false)
        .map(normalizeClassRow);
      setCachedValue(classCache, buildCacheKey(tenant, realmId, 'classes'), mapped);
      return [...mapped];
    } catch (error) {
      errors.push(error);
      logger.warn('Failed to fetch QBO classes', { tenantId: tenant, realmId, error });
      continue;
    }
  }

  logger.warn('Unable to fetch QBO classes for any realm', { tenantId: tenant });
  return qboCatalogFetchError('QuickBooks classes', errors);
});

/**
 * Fetches QBO Departments for use in invoice-header DepartmentRef assignment.
 * Mirrors the getQboItems cache/realm-priority/EE+read-gate pattern.
 */
export const getQboDepartments = withAuth(async (
  user,
  { tenant },
  options: { realmId?: string | null } = {}
): QboCatalogResult<QboDepartment> => {
  const accessError = await getQboCatalogAccessError(user);
  if (accessError) return accessError;

  const targetRealm = options.realmId ?? null;
  const cacheKey = buildCacheKey(tenant, targetRealm, 'departments');
  const cached = getCachedValue(departmentCache, cacheKey);
  if (cached) {
    return [...cached];
  }

  const credentials = await getTenantCredentialMap(tenant);
  const candidateRealmIds = resolveRealmPriority(credentials, targetRealm);

  if (candidateRealmIds.length === 0) {
    logger.warn('Unable to load QBO departments: no credential entries found', { tenantId: tenant });
    return qboCatalogNotConnected('QuickBooks departments');
  }

  const errors: unknown[] = [];
  for (const realmId of candidateRealmIds) {
    try {
      logger.debug('Fetching QBO departments', { tenantId: tenant, realmId });
      const qboClient = await QboClientService.create(tenant, realmId);
      const rows = await qboClient.query<QboDepartmentRow>('SELECT Id, Name FROM Department');
      const mapped = rows.map(normalizeDepartmentRow);
      setCachedValue(departmentCache, buildCacheKey(tenant, realmId, 'departments'), mapped);
      return [...mapped];
    } catch (error) {
      errors.push(error);
      logger.warn('Failed to fetch QBO departments', { tenantId: tenant, realmId, error });
      continue;
    }
  }

  logger.warn('Unable to fetch QBO departments for any realm', { tenantId: tenant });
  return qboCatalogFetchError('QuickBooks departments', errors);
});

/**
 * Fetches a list of Items (Products/Services) from QuickBooks Online.
 * When a realmId is provided, attempts to load catalog data for that realm first.
 * Falls back to any other connected realms if necessary.
 */
export const getQboItems = withAuth(async (
  user,
  { tenant },
  options: { realmId?: string | null } = {}
): QboCatalogResult<QboItem> => {
  const accessError = await getQboCatalogAccessError(user);
  if (accessError) return accessError;

  const targetRealm = options.realmId ?? null;
  const cacheKey = buildCacheKey(tenant, targetRealm, 'items');
  const cached = getCachedValue(itemCache, cacheKey);
  if (cached) {
    return [...cached];
  }

  const credentials = await getTenantCredentialMap(tenant);
  const candidateRealmIds = resolveRealmPriority(credentials, targetRealm);

  if (candidateRealmIds.length === 0) {
    logger.warn('Unable to load QBO items: no credential entries found', { tenantId: tenant });
    return qboCatalogNotConnected('QuickBooks items');
  }

  const errors: unknown[] = [];
  for (const realmId of candidateRealmIds) {
    try {
      logger.debug('Fetching QBO items', { tenantId: tenant, realmId });
      const qboClient = await QboClientService.create(tenant, realmId);
      const qboItems = await qboClient.query<QboItemRow>('SELECT Id, Name FROM Item');
      const mappedItems = qboItems.map(normalizeItemRow);
      setCachedValue(itemCache, buildCacheKey(tenant, realmId, 'items'), mappedItems);
      return [...mappedItems];
    } catch (error) {
      errors.push(error);
      logger.warn('Failed to fetch QBO items', { tenantId: tenant, realmId, error });
      continue;
    }
  }

  logger.warn('Unable to fetch QBO items for any realm', { tenantId: tenant });
  return qboCatalogFetchError('QuickBooks items', errors);
});

/**
 * Server Action to fetch the current QuickBooks Online connection status for the tenant.
 * Uses QboClientService which automatically handles token refresh.
 * Corresponds to Task 82.
 */
export const getQboConnectionStatus = withAuth(async (
  user,
  { tenant }
): Promise<QboConnectionStatus> => {
  if (!isEnterpriseEdition()) {
    return qboConnectionStatusError(
      'QuickBooks Online integration is only available in Enterprise Edition.',
      'ENTERPRISE_REQUIRED',
    );
  }

  try {
    await checkBillingReadAccess(user);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Forbidden')) {
      return qboConnectionStatusError(error.message, 'FORBIDDEN');
    }
    throw error;
  }

  const secretProvider = await getSecretProviderInstance();
  const [storedClientId, storedClientSecret, redirectUri, resolvedCredentials] = await Promise.all([
    secretProvider.getTenantSecret(tenant, QBO_CLIENT_ID_SECRET_NAME),
    secretProvider.getTenantSecret(tenant, QBO_CLIENT_SECRET_SECRET_NAME),
    getQboRedirectUri(secretProvider),
    resolveQboOAuthCredentials(tenant, secretProvider).catch(() => null)
  ]);
  const clientId = typeof storedClientId === 'string' ? storedClientId.trim() : '';
  const clientSecret = typeof storedClientSecret === 'string' ? storedClientSecret.trim() : '';
  const credentialStatus: QboCredentialStatus = {
    clientIdConfigured: Boolean(clientId),
    clientSecretConfigured: Boolean(clientSecret),
    ready: Boolean(resolvedCredentials),
    clientIdMasked: clientId ? maskSecret(clientId) : undefined,
    clientSecretMasked: clientSecret ? maskSecret(clientSecret) : undefined
  };
  const baseStatus = {
    redirectUri,
    scopes: getQboOAuthScopes(),
    environment: getQboEnvironment(),
    credentials: credentialStatus
  };

  try {
    const credentialMap = await getTenantCredentialMap(tenant);
    const entries = Object.entries(credentialMap);

    if (entries.length === 0) {
      logger.warn('No QuickBooks credentials stored for tenant', { tenantId: tenant });
      return {
        ...baseStatus,
        connected: false,
        connections: [],
        error: credentialStatus.ready
          ? 'No QuickBooks company is connected yet. Click Connect QuickBooks to authorize one.'
          : 'Add a QuickBooks client ID and client secret before connecting QuickBooks Online.'
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
        logger.debug('Validating QuickBooks connection', { tenantId: tenant, realmId });
        const qboClient = await QboClientService.create(tenant, realmId);
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
        const message = qboConnectionStatusMessage(rawError);
        summaryError = message;
        const treatedAsAuthError = isQboReconnectError(rawError);

        status = treatedAsAuthError ? 'expired' : 'error';
        if (!aggregatedError) {
          aggregatedError = message;
        }
        logger.warn('QuickBooks connection validation failed', {
          tenantId: tenant,
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

    const defaultConnection = summaries.find((summary) => summary.realmId === defaultRealmId);

    return {
      ...baseStatus,
      connected: hasActiveConnection,
      connections: summaries,
      defaultRealmId,
      defaultConnection,
      error: hasActiveConnection
        ? undefined
        : aggregatedError ?? 'QuickBooks connections require attention. Please reconnect.'
    };
  } catch (error) {
    const message = qboConnectionStatusMessage(error);
    logger.error('QuickBooks connection status check failed', { tenantId: tenant, error });
    return {
      ...baseStatus,
      connected: false,
      connections: [],
      error: message
    };
  }
});

/**
 * Saves tenant-owned QuickBooks OAuth client credentials. Tenant-owned credentials
 * take precedence over the application-level fallback when starting the OAuth flow
 * and when refreshing tokens.
 */
export const saveQboCredentials = withAuth(async (
  user,
  { tenant },
  input: { clientId: string; clientSecret: string }
): Promise<{ success: boolean; error?: string }> => {
  try {
    const accessError = await getQboUpdateAccessError(user);
    if (accessError) {
      return { success: false, error: accessError };
    }

    const clientId = input.clientId?.trim();
    if (!clientId) {
      return { success: false, error: 'QuickBooks client ID is required.' };
    }

    const clientSecret = input.clientSecret?.trim();
    if (!clientSecret) {
      return { success: false, error: 'QuickBooks client secret is required.' };
    }

    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(tenant, QBO_CLIENT_ID_SECRET_NAME, clientId);
    await secretProvider.setTenantSecret(tenant, QBO_CLIENT_SECRET_SECRET_NAME, clientSecret);

    logger.info('Saved tenant-owned QuickBooks OAuth credentials', {
      tenantId: tenant,
      clientIdConfigured: true,
      clientSecretConfigured: true
    });

    revalidatePath('/msp/settings');
    return { success: true };
  } catch (error) {
    logger.error('Failed to save tenant-owned QuickBooks OAuth credentials', {
      tenantId: tenant,
      error
    });
    return {
      success: false,
      error: 'Failed to save QuickBooks credentials. Please try again.'
    };
  }
});

/**
 * Disconnects the QuickBooks Online integration for the current tenant
 * by deleting stored credentials and optionally revoking the token with Intuit.
 * Corresponds to Task 84.
 */
export const disconnectQbo = withAuth(async (
  user,
  { tenant }
): Promise<{ success: boolean; error?: string }> => {
  const secretProvider = await getSecretProviderInstance();

  try {
    const accessError = await getQboUpdateAccessError(user);
    if (accessError) {
      return { success: false, error: accessError };
    }

    logger.info('Disconnecting QuickBooks integration', { tenantId: tenant });

    const credentialMap = await getTenantCredentialMap(tenant);

    await deleteTenantQboCredentials(secretProvider, tenant);
    logger.info('Deleted stored QuickBooks credentials', { tenantId: tenant });

    if (Object.keys(credentialMap).length > 0) {
      await revokeQboTokens(tenant, credentialMap);
    }

    revalidatePath('/msp/settings');

    return { success: true };
  } catch (error: unknown) {
    logger.error('QuickBooks disconnect failed', { tenantId: tenant, error });
    return {
      success: false,
      error: 'Failed to disconnect QuickBooks. Please try again.'
    };
  }
});


/**
 * Fetches a list of TaxCodes from QuickBooks Online.
 * Respects the requested realm and falls back to other connected realms.
 */
export const getQboTaxCodes = withAuth(async (
  user,
  { tenant },
  options: { realmId?: string | null } = {}
): QboCatalogResult<QboTaxCode> => {
  const accessError = await getQboCatalogAccessError(user);
  if (accessError) return accessError;

  const targetRealm = options.realmId ?? null;
  const cacheKey = buildCacheKey(tenant, targetRealm, 'tax-codes');
  const cached = getCachedValue(taxCodeCache, cacheKey);
  if (cached) {
    return [...cached];
  }

  const credentials = await getTenantCredentialMap(tenant);
  const candidateRealmIds = resolveRealmPriority(credentials, targetRealm);

  if (candidateRealmIds.length === 0) {
    logger.warn('Unable to load QBO tax codes: no credential entries found', { tenantId: tenant });
    return qboCatalogNotConnected('QuickBooks tax codes');
  }

  const errors: unknown[] = [];
  for (const realmId of candidateRealmIds) {
    try {
      logger.debug('Fetching QBO tax codes', { tenantId: tenant, realmId });
      const qboClient = await QboClientService.create(tenant, realmId);
      const qboTaxCodes = await qboClient.query<QboTaxCodeRow>('SELECT Id, Name FROM TaxCode');
      const mappedTaxCodes = qboTaxCodes.map(normalizeTaxCodeRow);
      setCachedValue(taxCodeCache, buildCacheKey(tenant, realmId, 'tax-codes'), mappedTaxCodes);
      return [...mappedTaxCodes];
    } catch (error) {
      errors.push(error);
      logger.warn('Failed to fetch QBO tax codes', { tenantId: tenant, realmId, error });
      continue;
    }
  }

  logger.warn('Unable to fetch QBO tax codes for any realm', { tenantId: tenant });
  return qboCatalogFetchError('QuickBooks tax codes', errors);
});

/**
 * Fetches a list of Terms from QuickBooks Online.
 * Respects the requested realm and falls back to other connected realms.
 */
/**
 * Fetches a paged list of Customers from QuickBooks Online.
 * Pages through all results using STARTPOSITION/MAXRESULTS (1000 per page).
 * Respects the requested realm and falls back to other connected realms.
 * Results are cached for CATALOG_CACHE_TTL_MS per (tenant, realm) pair.
 */
export const getQboCustomers = withAuth(async (
  user,
  { tenant },
  options: { realmId?: string | null } = {}
): QboCatalogResult<QboCustomer> => {
  const accessError = await getQboCatalogAccessError(user);
  if (accessError) return accessError;

  const targetRealm = options.realmId ?? null;
  const cacheKey = buildCacheKey(tenant, targetRealm, 'customers');
  const cached = getCachedValue(customerCache, cacheKey);
  if (cached) {
    return [...cached];
  }

  const credentials = await getTenantCredentialMap(tenant);
  const candidateRealmIds = resolveRealmPriority(credentials, targetRealm);

  if (candidateRealmIds.length === 0) {
    logger.warn('Unable to load QBO customers: no credential entries found', { tenantId: tenant });
    return qboCatalogNotConnected('QuickBooks customers');
  }

  const errors: unknown[] = [];
  for (const realmId of candidateRealmIds) {
    try {
      logger.debug('Fetching QBO customers', { tenantId: tenant, realmId });
      const qboClient = await QboClientService.create(tenant, realmId);

      const PAGE_SIZE = 1000;
      const allCustomers: QboCustomer[] = [];
      let startPosition = 1;

      while (true) {
        const page = await qboClient.query<QboCustomerRow>(
          `SELECT Id, DisplayName, Active FROM Customer STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`
        );
        allCustomers.push(...page.map(normalizeCustomerRow));
        if (page.length < PAGE_SIZE) break;
        startPosition += PAGE_SIZE;
      }

      setCachedValue(customerCache, buildCacheKey(tenant, realmId, 'customers'), allCustomers);
      return [...allCustomers];
    } catch (error) {
      errors.push(error);
      logger.warn('Failed to fetch QBO customers', { tenantId: tenant, realmId, error });
      continue;
    }
  }

  logger.warn('Unable to fetch QBO customers for any realm', { tenantId: tenant });
  return qboCatalogFetchError('QuickBooks customers', errors);
});

export const getQboTerms = withAuth(async (
  user,
  { tenant },
  options: { realmId?: string | null } = {}
): QboCatalogResult<QboTerm> => {
  const accessError = await getQboCatalogAccessError(user);
  if (accessError) return accessError;

  const targetRealm = options.realmId ?? null;
  const cacheKey = buildCacheKey(tenant, targetRealm, 'terms');
  const cached = getCachedValue(termCache, cacheKey);
  if (cached) {
    return [...cached];
  }

  const credentials = await getTenantCredentialMap(tenant);
  const candidateRealmIds = resolveRealmPriority(credentials, targetRealm);

  if (candidateRealmIds.length === 0) {
    logger.warn('Unable to load QBO terms: no credential entries found', { tenantId: tenant });
    return qboCatalogNotConnected('QuickBooks payment terms');
  }

  const errors: unknown[] = [];
  for (const realmId of candidateRealmIds) {
    try {
      logger.debug('Fetching QBO terms', { tenantId: tenant, realmId });
      const qboClient = await QboClientService.create(tenant, realmId);
      const qboTerms = await qboClient.query<QboTermRow>('SELECT Id, Name FROM Term');
      const mappedTerms = qboTerms.map(normalizeTermRow);
      setCachedValue(termCache, buildCacheKey(tenant, realmId, 'terms'), mappedTerms);
      return [...mappedTerms];
    } catch (error) {
      errors.push(error);
      logger.warn('Failed to fetch QBO terms', { tenantId: tenant, realmId, error });
      continue;
    }
  }

  logger.warn('Unable to fetch QBO terms for any realm', { tenantId: tenant });
  return qboCatalogFetchError('QuickBooks payment terms', errors);
});
