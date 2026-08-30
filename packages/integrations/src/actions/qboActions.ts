/* eslint-env node */
'use server';

import logger from '@alga-psa/core/logger';
import { withAuth } from '@alga-psa/auth';
import { revalidatePath } from 'next/cache';
import { ISecretProvider } from '@alga-psa/core';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import {
  isQboAutomatedSalesTaxEnabled,
  setQboAutomatedSalesTaxEnabled
} from '../lib/qbo/qboTaxSettings';
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
import {
  PROVIDER_QBO,
  disconnectProvider,
  forceFinalizeProviderDisconnect,
  getProviderDisconnectStatusInfo,
  type ProviderDisconnectStatusInfo,
  type DisconnectServiceResult,
} from '../lib/providerDisconnect';
import type { IUserWithRoles } from '@alga-psa/types';

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
  /**
   * Which Intuit app the OAuth flow will actually use: 'tenant' for credentials
   * this tenant registered itself, 'app' for the deployment-wide app a hosted
   * operator configured. Null when neither resolves. Provenance only — the
   * app-level values themselves never leave the server.
   */
  source?: 'tenant' | 'app' | null;
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
  /**
   * Durable disconnect state, when a disconnect has been started. Non-null
   * while provider-side cleanup is pending or after it concluded; the settings
   * UI uses it to show pending/partial/force-finalize states.
   */
  disconnect?: ProviderDisconnectStatusInfo | null;
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

type QboCatalog =
  | 'accounts'
  | 'classes'
  | 'departments'
  | 'items'
  | 'taxCodes'
  | 'customers'
  | 'paymentTerms';

const QBO_CATALOG_LABELS: Record<QboCatalog, string> = {
  accounts: 'QuickBooks accounts',
  classes: 'QuickBooks classes',
  departments: 'QuickBooks departments',
  items: 'QuickBooks items',
  taxCodes: 'QuickBooks tax codes',
  customers: 'QuickBooks customers',
  paymentTerms: 'QuickBooks payment terms',
};

// A frame plus an English catalogue name does not translate, so every catalogue
// names its own whole sentence.
const QBO_CATALOG_KEYS: Record<QboCatalog, { notConnected: string; reconnect: string; loadFailed: string }> = {
  accounts: {
    notConnected: 'msp/integrations:errors.qbo.accounts.notConnected',
    reconnect: 'msp/integrations:errors.qbo.accounts.reconnect',
    loadFailed: 'msp/integrations:errors.qbo.accounts.loadFailed',
  },
  classes: {
    notConnected: 'msp/integrations:errors.qbo.classes.notConnected',
    reconnect: 'msp/integrations:errors.qbo.classes.reconnect',
    loadFailed: 'msp/integrations:errors.qbo.classes.loadFailed',
  },
  departments: {
    notConnected: 'msp/integrations:errors.qbo.departments.notConnected',
    reconnect: 'msp/integrations:errors.qbo.departments.reconnect',
    loadFailed: 'msp/integrations:errors.qbo.departments.loadFailed',
  },
  items: {
    notConnected: 'msp/integrations:errors.qbo.items.notConnected',
    reconnect: 'msp/integrations:errors.qbo.items.reconnect',
    loadFailed: 'msp/integrations:errors.qbo.items.loadFailed',
  },
  taxCodes: {
    notConnected: 'msp/integrations:errors.qbo.taxCodes.notConnected',
    reconnect: 'msp/integrations:errors.qbo.taxCodes.reconnect',
    loadFailed: 'msp/integrations:errors.qbo.taxCodes.loadFailed',
  },
  customers: {
    notConnected: 'msp/integrations:errors.qbo.customers.notConnected',
    reconnect: 'msp/integrations:errors.qbo.customers.reconnect',
    loadFailed: 'msp/integrations:errors.qbo.customers.loadFailed',
  },
  paymentTerms: {
    notConnected: 'msp/integrations:errors.qbo.paymentTerms.notConnected',
    reconnect: 'msp/integrations:errors.qbo.paymentTerms.reconnect',
    loadFailed: 'msp/integrations:errors.qbo.paymentTerms.loadFailed',
  },
};

function qboCatalogNotConnected(catalog: QboCatalog): QboCatalogActionError {
  return actionError(
    `Connect QuickBooks before loading ${QBO_CATALOG_LABELS[catalog]}.`,
    QBO_CATALOG_KEYS[catalog].notConnected,
  );
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

function qboCatalogFetchError(catalog: QboCatalog, errors: unknown[]): QboCatalogActionError {
  const catalogName = QBO_CATALOG_LABELS[catalog];
  if (errors.some(isQboReconnectError)) {
    return actionError(
      `Reconnect QuickBooks before loading ${catalogName}.`,
      QBO_CATALOG_KEYS[catalog].reconnect,
    );
  }

  return actionError(
    `Could not load ${catalogName}. Try again, or reconnect QuickBooks if the problem persists.`,
    QBO_CATALOG_KEYS[catalog].loadFailed,
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
  Description?: string;
  Active?: boolean;
  SalesTaxRateList?: {
    TaxRateDetail?: Array<{
      TaxRateRef?: { value?: string; name?: string };
      TaxTypeApplicable?: string;
    }>;
  };
};

type QboTaxRateRow = {
  Id?: string;
  RateValue?: number | string;
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

const QBO_QUERY_PAGE_SIZE = 1000;

/**
 * Pages through a QBO query using STARTPOSITION/MAXRESULTS until exhausted.
 * QBO returns only 100 rows when MAXRESULTS is omitted and caps it at 1000, so
 * an unpaged query silently truncates any catalog past the first hundred — an
 * Automated Sales Tax company accumulates a tax code per jurisdiction it bills
 * into, and a long-lived company file outgrows that quickly.
 */
async function queryAllPages<T>(qboClient: QboClientService, baseQuery: string): Promise<T[]> {
  const rows: T[] = [];
  let startPosition = 1;

  while (true) {
    const page = await qboClient.query<T>(
      `${baseQuery} STARTPOSITION ${startPosition} MAXRESULTS ${QBO_QUERY_PAGE_SIZE}`
    );
    rows.push(...page);
    if (page.length < QBO_QUERY_PAGE_SIZE) break;
    startPosition += QBO_QUERY_PAGE_SIZE;
  }

  return rows;
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

function normalizeTaxCodeRow(
  row: QboTaxCodeRow,
  ratePercentByTaxRateId: Map<string, number>
): QboTaxCode {
  // A tax code's effective rate is the sum of its sales-rate components
  // (TaxGroup codes combine several TaxRates, e.g. state + county).
  let ratePercent: number | null = null;
  for (const detail of row.SalesTaxRateList?.TaxRateDetail ?? []) {
    const rateId = detail.TaxRateRef?.value;
    if (!rateId) continue;
    const rate = ratePercentByTaxRateId.get(rateId);
    if (rate === undefined) continue;
    ratePercent = (ratePercent ?? 0) + rate;
  }

  const description = row.Description?.trim();
  return {
    id: row.Id ?? row.id ?? '',
    name: row.Name ?? row.name ?? '',
    description: description && description.length > 0 ? description : null,
    ratePercent
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
    return actionError('QuickBooks Online integration is only available in Enterprise Edition.', 'msp/integrations:errors.qbo.enterpriseOnly');
  }

  const allowed = await hasPermission(user, 'billing_settings', 'read');
  if (!allowed) {
    return permissionError('Forbidden: You do not have permission to view QuickBooks integration settings.', 'msp/integrations:errors.qbo.viewPermission');
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

// --- Disconnect result types ---
export interface QboDisconnectActionResult {
  success: boolean;
  /**
   * 'disconnected' when provider cleanup was confirmed and local credentials
   * were removed; 'pending'/'partial' while retryable provider cleanup is in
   * flight; 'failed_permanent' when an operator force-finalize is required.
   */
  status: 'disconnected' | 'pending' | 'partial' | 'failed_permanent';
  error?: string;
  pendingTargets?: number;
  failedTargets?: number;
}

function mapDisconnectProgress(progress: DisconnectServiceResult): QboDisconnectActionResult {
  switch (progress.status) {
    case 'disconnected':
    case 'already_disconnected':
    case 'no_credentials':
      return { success: true, status: 'disconnected' };
    case 'partial':
      return {
        success: false,
        status: 'partial',
        error: progress.error,
        pendingTargets: progress.record?.targets.filter((t) => t.status === 'pending_revocation').length,
        failedTargets: progress.record?.targets.filter((t) => t.status === 'failed_permanent').length,
      };
    case 'pending':
      return { success: false, status: 'pending', error: progress.error };
    case 'failed_permanent':
      return { success: false, status: 'failed_permanent', error: progress.error };
  }
}

export const forceFinalizeQboDisconnect = withAuth(async (
  user,
  { tenant },
  input: { reason: string }
): Promise<{ success: boolean; error?: string }> => {
  try {
    const accessError = await getQboUpdateAccessError(user);
    if (accessError) {
      return { success: false, error: accessError };
    }

    if (!input?.reason?.trim()) {
      return { success: false, error: 'A reason is required to force-finalize a QuickBooks disconnect.' };
    }

    const { knex } = await createTenantKnex();
    const progress = await forceFinalizeProviderDisconnect(knex, tenant, PROVIDER_QBO, {
      userId: user.user_id,
      reason: input.reason.trim(),
    });

    revalidatePath('/msp/settings');
    if (progress.status === 'disconnected' || progress.status === 'already_disconnected') {
      return { success: true };
    }
    return { success: false, error: progress.error };
  } catch (error) {
    logger.error('QuickBooks force-finalize disconnect failed', { tenantId: tenant, error });
    return { success: false, error: 'Failed to finalize the QuickBooks disconnect. Please try again.' };
  }
});

// --- QBO API Call Helper ---

// --- QBO Entity Types ---

export interface QboItem { // Exporting for use in components
  id: string; // QBO ItemRef.value
  name: string; // Qbo Item Name
}

export interface QboTaxCode { // Exporting for use in components
  id: string; // QBO TaxCodeRef.value
  name: string; // Qbo TaxCode Name
  /** QBO TaxCode.Description when it adds information beyond the name. */
  description?: string | null;
  /** Combined sales rate (%) summed from the code's TaxRate components, when resolvable. */
  ratePercent?: number | null;
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
    return qboCatalogNotConnected('accounts');
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
  return qboCatalogFetchError('accounts', errors);
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
    return qboCatalogNotConnected('classes');
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
  return qboCatalogFetchError('classes', errors);
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
    return qboCatalogNotConnected('departments');
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
  return qboCatalogFetchError('departments', errors);
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
    return qboCatalogNotConnected('items');
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
  return qboCatalogFetchError('items', errors);
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
    clientSecretMasked: clientSecret ? maskSecret(clientSecret) : undefined,
    source: resolvedCredentials?.source ?? null
  };
  const baseStatus = {
    redirectUri,
    scopes: getQboOAuthScopes(),
    environment: getQboEnvironment(),
    credentials: credentialStatus
  };

  const { knex } = await createTenantKnex();
  const disconnect = await getProviderDisconnectStatusInfo(knex, tenant, PROVIDER_QBO).catch(() => null);
  const disconnectBlocking = disconnect !== null && disconnect.status !== 'finalized';

  try {
    const credentialMap = await getTenantCredentialMap(tenant);
    const entries = Object.entries(credentialMap);

    if (entries.length === 0) {
      logger.warn('No QuickBooks credentials stored for tenant', { tenantId: tenant });
      return {
        ...baseStatus,
        connected: false,
        connections: [],
        disconnect,
        error: disconnectBlocking
          ? 'QuickBooks is being disconnected. Sync and exports are paused until the disconnect completes.'
          : credentialStatus.ready
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
      disconnect,
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
      disconnect,
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
 * Disconnects the QuickBooks Online integration for the current tenant.
 *
 * Durable, provider-first workflow: credentials are tombstoned immediately so
 * sync/export paths stop using them, then each connected realm's OAuth grant
 * is revoked with Intuit before local deletion. Transient provider failures
 * leave the disconnect pending (retried by the scheduled job); permanent
 * failures require an operator force-finalize. Repeat calls are idempotent.
 * Corresponds to Task 84.
 */
export const disconnectQbo = withAuth(async (
  user,
  { tenant }
): Promise<QboDisconnectActionResult> => {
  try {
    const accessError = await getQboUpdateAccessError(user);
    if (accessError) {
      return { success: false, status: 'failed_permanent', error: accessError };
    }

    logger.info('Disconnecting QuickBooks integration', { tenantId: tenant });

    // Drop any cached QBO catalog data immediately; the tombstone already stops
    // the sync/export path, and the cache would otherwise serve up to 60s of
    // stale data.
    clearAllCatalogCachesForTenant(tenant);

    const { knex } = await createTenantKnex();
    const progress = await disconnectProvider(knex, tenant, PROVIDER_QBO, {
      userId: user.user_id,
    });

    revalidatePath('/msp/settings');
    return mapDisconnectProgress(progress);
  } catch (error: unknown) {
    logger.error('QuickBooks disconnect failed', { tenantId: tenant, error });
    return {
      success: false,
      status: 'pending',
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
    return qboCatalogNotConnected('taxCodes');
  }

  const errors: unknown[] = [];
  for (const realmId of candidateRealmIds) {
    try {
      logger.debug('Fetching QBO tax codes', { tenantId: tenant, realmId });
      const qboClient = await QboClientService.create(tenant, realmId);

      // SELECT * so the nested SalesTaxRateList comes back — Intuit's own
      // documented TaxCode response carries the rate components only under it,
      // and naming columns omits them. TaxRates then supply the percentages so
      // labels can read "Name (7.25%)".
      const [taxCodeRows, taxRateRows] = await Promise.all([
        queryAllPages<QboTaxCodeRow>(qboClient, 'SELECT * FROM TaxCode'),
        queryAllPages<QboTaxRateRow>(qboClient, 'SELECT Id, RateValue FROM TaxRate')
      ]);

      const ratePercentByTaxRateId = new Map<string, number>();
      for (const rate of taxRateRows) {
        if (!rate.Id) continue;
        const value = Number(rate.RateValue);
        if (Number.isFinite(value)) {
          ratePercentByTaxRateId.set(rate.Id, value);
        }
      }

      // Filtered here rather than as `WHERE Active = true`, which QBO does
      // support: Intuit's published TaxCode response omits Active entirely on
      // the TAX and NON pseudo codes, so a server-side filter would silently
      // drop exactly the two entries an Automated Sales Tax company needs.
      // Inactive codes leave the pick list either way; existing mappings that
      // point at them stay readable via the persisted display-name metadata.
      const mappedTaxCodes = taxCodeRows
        .filter((row) => row.Active !== false)
        .map((row) => normalizeTaxCodeRow(row, ratePercentByTaxRateId));
      setCachedValue(taxCodeCache, buildCacheKey(tenant, realmId, 'tax-codes'), mappedTaxCodes);
      return [...mappedTaxCodes];
    } catch (error) {
      errors.push(error);
      logger.warn('Failed to fetch QBO tax codes', { tenantId: tenant, realmId, error });
      continue;
    }
  }

  logger.warn('Unable to fetch QBO tax codes for any realm', { tenantId: tenant });
  return qboCatalogFetchError('taxCodes', errors);
});

/**
 * Reads whether QuickBooks Automated Sales Tax (AST) mode is enabled for a realm.
 */
export const getQboAutomatedSalesTaxMode = withAuth(async (
  user,
  { tenant },
  options: { realmId?: string | null } = {}
): Promise<{ enabled: boolean } | QboCatalogActionError> => {
  const accessError = await getQboCatalogAccessError(user);
  if (accessError) return accessError;

  const { knex } = await createTenantKnex();
  const enabled = await isQboAutomatedSalesTaxEnabled(knex, tenant, options.realmId ?? null);
  return { enabled };
});

/**
 * Enables or disables QuickBooks Automated Sales Tax (AST) mode for a realm.
 * With AST on, tax-delegated exports carry line TaxCodeRefs (mapped value,
 * else TAX/NON) so Intuit's AST engine taxes the lines; the computed tax then
 * flows back through the existing external tax import path.
 */
export const setQboAutomatedSalesTaxMode = withAuth(async (
  user,
  { tenant },
  options: { realmId: string; enabled: boolean }
): Promise<{ success: boolean; enabled?: boolean; error?: string }> => {
  try {
    const accessError = await getQboUpdateAccessError(user);
    if (accessError) {
      return { success: false, error: accessError };
    }

    if (!options.realmId) {
      return { success: false, error: 'A connected QuickBooks company is required to change Automated Sales Tax mode.' };
    }

    const { knex } = await createTenantKnex();
    const realms = await setQboAutomatedSalesTaxEnabled(knex, tenant, options.realmId, options.enabled);

    // The tax-code pick list is assembled from the cached catalog plus the
    // TAX/NON pseudo codes, and the pseudo codes appear only under AST — so the
    // cached list is wrong the moment this flag flips.
    clearAllCatalogCachesForTenant(tenant);

    logger.info('QBO Automated Sales Tax mode updated', {
      tenantId: tenant,
      realmId: options.realmId,
      enabled: options.enabled
    });

    return { success: true, enabled: realms.includes(options.realmId) };
  } catch (error: unknown) {
    logger.error('Failed to update QBO Automated Sales Tax mode', {
      tenantId: tenant,
      realmId: options.realmId,
      error
    });
    return { success: false, error: 'Failed to update Automated Sales Tax mode. Please try again.' };
  }
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
    return qboCatalogNotConnected('customers');
  }

  const errors: unknown[] = [];
  for (const realmId of candidateRealmIds) {
    try {
      logger.debug('Fetching QBO customers', { tenantId: tenant, realmId });
      const qboClient = await QboClientService.create(tenant, realmId);

      const customerRows = await queryAllPages<QboCustomerRow>(
        qboClient,
        'SELECT Id, DisplayName, Active FROM Customer'
      );
      const allCustomers = customerRows.map(normalizeCustomerRow);

      setCachedValue(customerCache, buildCacheKey(tenant, realmId, 'customers'), allCustomers);
      return [...allCustomers];
    } catch (error) {
      errors.push(error);
      logger.warn('Failed to fetch QBO customers', { tenantId: tenant, realmId, error });
      continue;
    }
  }

  logger.warn('Unable to fetch QBO customers for any realm', { tenantId: tenant });
  return qboCatalogFetchError('customers', errors);
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
    return qboCatalogNotConnected('paymentTerms');
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
  return qboCatalogFetchError('paymentTerms', errors);
});
